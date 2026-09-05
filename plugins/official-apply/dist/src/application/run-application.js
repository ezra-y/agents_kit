import { inspectPage } from "../browser/scan/inspect-page.js";
import { computePageDigest } from "../browser/scan/page-schema-cache.js";
import { buildRecipeCandidate, recipeVariantKey } from "../recipes/build-recipe-candidate.js";
import { captureLearning } from "../learning/capture-learning.js";
import { resolvePageWithRecipe } from "./resolve-page-with-recipe.js";
import { resolveCurrentPage } from "./resolve-current-page.js";
import { resolveAnswers } from "../answers/resolve-answers.js";
import { persistMissingAnswerRequests } from "../answers/save-user-answers.js";
import { buildActionPlan } from "../browser/actions/build-action-plan.js";
import { planUploads } from "../browser/actions/plan-uploads.js";
import { fillProfileGroups } from "./fill-profile-groups.js";
import { readAutoSubmitApproval } from "../tasks/auto-submit-approval.js";
import { prepareSubmission } from "../submission/prepare-submission.js";
import { submitApplication } from "../submission/submit-application.js";
import { buildCommitExecutors, checkCommitPreconditions, } from "../submission/commit-current-page.js";
import { uploadFiles } from "../browser/actions/upload-files.js";
import { fillPage } from "../browser/actions/fill-page.js";
import { validatePage, expectedFieldStates } from "../browser/validation/validate-page.js";
import { advancePage } from "./advance-page.js";
import { transitionRunState, TERMINAL_STATES } from "./run-state-machine.js";
import { getRunStatus } from "./get-run-status.js";
const DEFAULT_MAX_PAGES = 10;
/**
 * 同一页最多重扫几轮。
 *
 * 条件字段可能一层套一层（选「是」出现新字段，新字段又是个单选……），
 * 但真实表单不会深到哪里去。配合状态哈希去重，足够防住死循环。
 */
const MAX_RESCAN_ROUNDS = 5;
/**
 * 页面状态指纹。
 *
 * 只看「有哪些可见字段、各自当前值是什么」。用来判断上一轮填写有没有
 * 真的让页面变化——没变还接着填就是死循环。
 */
function pageStateKey(schema) {
    return schema.fields
        .filter((field) => field.visible)
        .map((field) => `${field.runtimeRef}=${String(field.currentValue ?? '')}`)
        .sort()
        .join('|');
}
export async function runApplication(context, request) {
    const now = request.now ?? new Date().toISOString();
    const maxPages = request.maxPages ?? DEFAULT_MAX_PAGES;
    let pagesProcessed = 0;
    let stoppedBecause = '达到本次运行的页数上限';
    let pendingQuestions = [];
    /** 上传被拒的原因。汇总到结果里，不吞掉。 */
    const uploadRejections = [];
    /** 每条履历绑到了哪张卡片，为什么。绑错本科硕士要能追查。 */
    const groupBindings = [];
    /** 没能绑上的履历记录。不硬塞。 */
    const unboundRecords = [];
    /** 学习环节出的问题。学不到东西不该拖垮已经填好的申请，但也不许吞掉。 */
    const learningWarnings = [];
    /** 配方用得怎么样。用来证明「第二次跑更省」，不是感觉。 */
    const recipeUsage = {
        pages: [],
        recipeHintFieldCount: 0,
        scoredFieldCount: 0,
        scoreCallCount: 0,
        savedCandidatePaths: [],
        pendingProposalCount: 0,
    };
    /**
     * 迁移状态。被状态机拒绝时**不静默吞掉**。
     *
     * 静默失败最危险：状态还停在旧值，后面的检查全部基于错的状态，
     * 最坏情况是绕过「只能从 ready_to_submit 进入 submitting」这条保护。
     * 所以拒绝时返回 false，让主循环立刻停下来。
     */
    let rejectedTransition;
    const move = (to, reasonCode) => {
        const result = transitionRunState({
            paths: request.paths,
            runId: request.runId,
            to,
            reasonCode,
            now,
        });
        if (!result.allowed) {
            rejectedTransition = result.reason;
        }
        return result.allowed;
    };
    // 进入循环前先对齐状态。页面是调用方打开的，所以 queued 要先走到 opening。
    if (!move('opening', 'page_already_open')) {
        const status = getRunStatus({ paths: request.paths, runId: request.runId });
        return {
            status,
            pagesProcessed: 0,
            stoppedBecause: rejectedTransition ?? status.resumeHint,
            pendingQuestions: [],
            recipeUsage,
        };
    }
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
        context.page = context.session.page ?? context.page;
        // 1. 扫描当前页。
        if (!move('discovering', 'inspect_page')) {
            stoppedBecause = rejectedTransition ?? '状态机拒绝了本次迁移';
            break;
        }
        // 先等在途的接口响应解析完。
        // 表单结构常常是接口回来之后才渲染的：页面已经画好了，那条观察却还在路上。
        // 不等就会漏掉它，家族识别和 schema 融合都会少一半证据。
        await context.networkObserver?.settle?.();
        const inspection = await inspectPage(context.session, context.page, {
            runId: request.runId,
            now,
            ...(context.networkObserver === undefined
                ? {}
                : { networkObservations: context.networkObserver.observations() }),
        });
        let schema = inspection.schema;
        pagesProcessed += 1;
        // 登录和验证码不是自动化能解决的，直接停。
        if (schema.pageType === 'login' || schema.pageType === 'captcha') {
            move('waiting_for_user', schema.pageType);
            stoppedBecause = schema.pageType === 'login' ? '需要登录' : '需要处理验证码';
            break;
        }
        // 2. 保存官网字段并映射。这一步之前先问配方。
        //
        // 顺序是硬规定（`docs/08 §6`）：
        // 识别家族 → 站点/家族配方 → 验证关键锚点 → 对不上就全局语义扫描
        // → 语义扫描也解决不了才轮到局部视觉兜底。
        //
        // 配方是查表，语义扫描是推理。便宜且可解释的手段先上。
        const withRecipe = resolvePageWithRecipe({
            paths: request.paths,
            runId: request.runId,
            taskId: request.taskId,
            siteHost: context.siteHost,
            ...(context.companyKey === undefined ? {} : { companyKey: context.companyKey }),
            ...(context.companyName === undefined ? {} : { companyName: context.companyName }),
            pageSchema: schema,
            now,
        });
        const recipeDecision = withRecipe.decision;
        const resolvedPage = withRecipe.resolved;
        recipeUsage.recipeHintFieldCount += resolvedPage.recipeHintFieldCount;
        recipeUsage.scoredFieldCount += resolvedPage.scoredFieldCount;
        recipeUsage.scoreCallCount += resolvedPage.scoreCallCount;
        recipeUsage.pages.push({
            url: schema.url,
            familyKey: recipeDecision.familyKey,
            matchLevel: recipeDecision.matchLevel,
            strategy: recipeDecision.strategy,
            ...(recipeDecision.recipe === undefined
                ? {}
                : {
                    recipeKey: recipeDecision.recipe.recipeKey,
                    recipeKind: recipeDecision.recipe.recipeKind,
                }),
            reason: recipeDecision.reason,
        });
        // 3. 找答案。
        if (!move('collecting_answers', 'resolve_answers')) {
            stoppedBecause = rejectedTransition ?? '状态机拒绝了本次迁移';
            break;
        }
        let answers = resolveAnswers({
            paths: request.paths,
            runId: request.runId,
            taskId: request.taskId,
            ...(context.companyKey === undefined ? {} : { companyKey: context.companyKey }),
            ...(context.jobKey === undefined ? {} : { jobKey: context.jobKey }),
            pageSchema: schema,
            mappings: resolvedPage.mappings,
            materialRefs: context.materialRefs,
            profileRecordIds: context.profileRecordIds,
            now,
        });
        // 4. 缺答案就一次问完，然后停下来等人。
        if (answers.missing.length > 0) {
            persistMissingAnswerRequests({ paths: request.paths, runId: request.runId, now }, answers.missing);
            move('waiting_for_user', 'missing_answers');
            pendingQuestions = answers.missing;
            stoppedBecause = `还有 ${answers.missing.length} 个问题需要你回答`;
            break;
        }
        // 5. 批量填写。
        if (!move('filling', 'fill_page')) {
            stoppedBecause = rejectedTransition ?? '状态机拒绝了本次迁移';
            break;
        }
        // 5a. 先上传文件。
        //
        // 上传常常会让页面插入「已上传」提示或解锁后续字段，所以放在普通字段之前，
        // 这样后面那一轮扫描看到的就是上传之后的样子。
        const uploadPlan = planUploads({
            paths: request.paths,
            pageSchema: schema,
            materialRefs: context.materialRefs,
        });
        if (uploadPlan.assignments.length > 0) {
            const uploaded = await uploadFiles(context.page, {
                runId: request.runId,
                pageSchema: schema,
                assignments: uploadPlan.assignments.map((item) => ({
                    runtimeRef: item.runtimeRef,
                    localPath: item.localPath,
                })),
                paths: request.paths,
            });
            uploadRejections.push(...uploaded.rejected.map((item) => item.reason));
        }
        // 必填的上传控件没配到材料，就别往下走了——交上去也是缺材料。
        const blockingUploads = uploadPlan.unmatched.filter((item) => item.required);
        if (blockingUploads.length > 0) {
            move('waiting_for_user', 'upload_material_missing');
            stoppedBecause = `有 ${blockingUploads.length} 个必传材料没准备好：${blockingUploads
                .map((item) => item.reason)
                .join('；')}`;
            break;
        }
        // 5b. 填重复经历（教育、实习、项目）。
        //
        // 放在普通字段之前：新增卡片会改变页面结构，先做完这一步，
        // 后面那轮扫描看到的才是完整的表单。
        //
        // 本科和硕士填反是很贵的错误，所以绑定由
        // `bindPageGroupToProfileRecord()` 综合学历、时间和卡片文字来判断，
        // 不是「第 1 条填第 1 张」。
        if (schema.repeatableGroups.length > 0) {
            const groupsFilled = await fillProfileGroups({
                paths: request.paths,
                runId: request.runId,
                page: context.page,
                pageSchema: schema,
                mappings: resolvedPage.mappings,
                profileRecordIds: context.profileRecordIds,
            });
            groupBindings.push(...groupsFilled.bindings);
            unboundRecords.push(...groupsFilled.unbound.map((item) => item.profileRecordId));
            // 新增过卡片就重扫一次，后面的普通字段要用新的 runtimeRef。
            if (groupsFilled.addedInstances > 0) {
                const rescanned = await inspectPage(context.session, context.page, {
                    runId: request.runId,
                    persist: false,
                    now,
                });
                schema = rescanned.schema;
            }
        }
        // 5c. 填普通字段。
        //
        // `fillPage()` 遇到会改变页面结构的动作（单选、下拉、勾选）会**主动停下**，
        // 因为后面那些 runtimeRef 可能已经失效了。这时候要在**同一页**重扫、
        // 重新解析、接着填剩下的，而不是把整页从头再来一遍。
        let workingSchema = schema;
        let workingAnswers = answers;
        let filled = await fillPage({ page: context.page }, {
            runId: request.runId,
            plan: buildActionPlan({
                runId: request.runId,
                snapshotId: workingSchema.snapshotId,
                resolved: workingAnswers.resolved,
                pageSchema: workingSchema,
                unresolvedRuntimeRefs: resolvedPage.requiresReviewRuntimeRefs,
                now,
            }),
            pageSchema: workingSchema,
        });
        // 防死循环：记住每一轮之后的页面状态，重复出现就说明填不动了。
        const seenStates = new Set([pageStateKey(workingSchema)]);
        let rescanRound = 0;
        while (filled.requiresRescan && rescanRound < MAX_RESCAN_ROUNDS) {
            rescanRound += 1;
            const rescanned = await inspectPage(context.session, context.page, {
                runId: request.runId,
                persist: false,
                now,
            });
            const stateKey = pageStateKey(rescanned.schema);
            if (seenStates.has(stateKey)) {
                // 页面其实没变。再填一轮也是同样结果，停下来交给校验去报。
                break;
            }
            seenStates.add(stateKey);
            workingSchema = rescanned.schema;
            // 条件字段带出的新字段同样先查配方，不能因为是「重扫」就退化成纯打分。
            const rescannedPage = resolveCurrentPage({
                paths: request.paths,
                runId: request.runId,
                taskId: request.taskId,
                siteHost: context.siteHost,
                ...(context.companyKey === undefined ? {} : { companyKey: context.companyKey }),
                ...(context.companyName === undefined ? {} : { companyName: context.companyName }),
                pageSchema: workingSchema,
                ...(recipeDecision.hints.length === 0 ? {} : { recipeHints: recipeDecision.hints }),
                now,
            });
            recipeUsage.recipeHintFieldCount += rescannedPage.recipeHintFieldCount;
            recipeUsage.scoredFieldCount += rescannedPage.scoredFieldCount;
            recipeUsage.scoreCallCount += rescannedPage.scoreCallCount;
            workingAnswers = resolveAnswers({
                paths: request.paths,
                runId: request.runId,
                taskId: request.taskId,
                ...(context.companyKey === undefined ? {} : { companyKey: context.companyKey }),
                ...(context.jobKey === undefined ? {} : { jobKey: context.jobKey }),
                pageSchema: workingSchema,
                mappings: rescannedPage.mappings,
                materialRefs: context.materialRefs,
                profileRecordIds: context.profileRecordIds,
                now,
            });
            // 条件字段带出了新问题，就停下来一次问完。
            if (workingAnswers.missing.length > 0) {
                persistMissingAnswerRequests({ paths: request.paths, runId: request.runId, now }, workingAnswers.missing);
                move('waiting_for_user', 'missing_answers_after_conditional');
                pendingQuestions = workingAnswers.missing;
                break;
            }
            const nextFill = await fillPage({ page: context.page }, {
                runId: request.runId,
                plan: buildActionPlan({
                    runId: request.runId,
                    snapshotId: workingSchema.snapshotId,
                    resolved: workingAnswers.resolved,
                    pageSchema: workingSchema,
                    unresolvedRuntimeRefs: rescannedPage.requiresReviewRuntimeRefs,
                    now,
                }),
                pageSchema: workingSchema,
            });
            filled = {
                ...nextFill,
                // 失败项要累计，不能被后一轮覆盖掉。
                failed: [...filled.failed, ...nextFill.failed],
                toolRoundTrips: filled.toolRoundTrips + nextFill.toolRoundTrips,
            };
        }
        if (pendingQuestions.length > 0) {
            stoppedBecause = `条件字段带出了 ${pendingQuestions.length} 个新问题，需要你回答`;
            break;
        }
        schema = workingSchema;
        answers = workingAnswers;
        // 6. 统一校验。
        if (!move('validating', 'validate_page')) {
            stoppedBecause = rejectedTransition ?? '状态机拒绝了本次迁移';
            break;
        }
        const expectedValues = new Map(answers.resolved.map((answer) => [answer.runtimeRef, answer.formattedValue]));
        const validation = await validatePage(context.session, context.page, {
            runId: request.runId,
            snapshotId: schema.snapshotId,
            expectedFields: expectedFieldStates(schema.fields, expectedValues),
            previousSchema: schema,
            paths: request.paths,
            now,
        });
        // 7. 出现新条件字段就重新走一轮，不硬往下推。
        if (validation.newlyVisibleFields.length > 0) {
            stoppedBecause = '出现了新的条件字段，需要重新解析答案';
            continue;
        }
        if (!validation.valid) {
            // 校验没过：如果还有可修的失败字段就再来一轮，否则交给人。
            if (filled.failed.length > 0 && pageIndex + 1 < maxPages) {
                stoppedBecause = '校验未通过，重试失败字段';
                continue;
            }
            move('waiting_for_user', 'validation_failed');
            stoppedBecause = '页面校验未通过，需要你看一下';
            break;
        }
        // 8. 还有没解决的字段就不能往下走。
        if (resolvedPage.requiresReviewRuntimeRefs.length > 0) {
            move('waiting_for_user', 'fields_require_review');
            stoppedBecause = `有 ${resolvedPage.requiresReviewRuntimeRefs.length} 个字段需要你确认含义`;
            break;
        }
        // 8b. 这一页跑通了，把学到的东西存下来。
        //
        // 只在**校验通过、没有待确认字段**之后才学。跑歪了的页面不值得记住，
        // 记下来只会污染下一次。
        //
        // 学到的一律先进 `.local/learning/`：
        //
        // ```text
        // 真实运行 → .local/learning/ → 脱敏 → 人工 Review
        // → promoteKnowledgeProposal() → knowledge/ → Git
        // ```
        //
        // 这里绝不调用 promoteKnowledgeProposal()。没人看过的东西不能进公共知识，
        // 那是要发给所有人用的。
        const built = buildRecipeCandidate({
            host: context.siteHost,
            pageSchema: schema,
            mappings: resolvedPage.mappings,
            ...(schema.saasFamily === undefined ? {} : { familyDetection: schema.saasFamily }),
        });
        try {
            const learned = captureLearning({
                paths: request.paths,
                runId: request.runId,
                siteId: resolvedPage.siteId,
                siteHost: context.siteHost,
                pageSchema: schema,
                mappings: resolvedPage.mappings,
                networkCandidates: schema.networkSchemaCandidates,
                ...(schema.saasFamily === undefined ? {} : { familyDetection: schema.saasFamily }),
                ...(built.recipe === undefined
                    ? {}
                    : { recipeCandidate: built.recipe, variantKey: recipeVariantKey(built.recipe) }),
                now,
            });
            if (learned.recipeCandidatePath !== undefined) {
                recipeUsage.savedCandidatePaths.push(learned.recipeCandidatePath);
            }
            recipeUsage.pendingProposalCount += learned.proposalCount;
        }
        catch (error) {
            // 学习是附加价值，不是投递本身。存不下来就如实记一笔，
            // 但不能让它拖垮一次已经填好的申请。
            learningWarnings.push(`学习记录没能保存：${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
        }
        // 9. 最后一页：停在提交前。提交由 submitApplication() 独立完成。
        const hasCommitAction = schema.actions.some((action) => action.commitAction);
        const hasNextAction = schema.actions.some((action) => action.kind === 'next' && !action.commitAction);
        if (hasCommitAction && !hasNextAction) {
            move('ready_to_submit', 'reached_final_page');
            // review 模式到此为止：提交是独立动作，由用户自己发起。
            if (request.mode !== 'auto') {
                stoppedBecause = '已填完，停在最终提交前等你确认';
                break;
            }
            const pageDigest = await computePageDigest(context.page);
            const prepared = prepareSubmission({
                paths: request.paths,
                runId: request.runId,
                taskId: request.taskId,
                mode: 'auto',
                validation,
                pageSchema: schema,
                pageDigest,
                unresolvedRuntimeRefs: resolvedPage.requiresReviewRuntimeRefs,
                now,
            });
            // 任何一条不满足就降级，不硬做（`docs/10 §9`）。
            const sessionProblem = checkCommitPreconditions({
                session: context.session,
                page: context.page,
                pageSchema: schema,
            });
            if (!prepared.ready || sessionProblem !== undefined) {
                move('waiting_for_user', 'auto_preconditions_failed');
                stoppedBecause =
                    `auto 模式的前置条件没满足，已停下等你处理：` +
                        [...prepared.blockers, sessionProblem ?? ''].filter((x) => x !== '').join('；');
                break;
            }
            const executors = buildCommitExecutors({
                session: context.session,
                page: context.page,
                pageSchema: schema,
                runId: request.runId,
            });
            const submitted = await submitApplication({
                paths: request.paths,
                runId: request.runId,
                taskId: request.taskId,
                mode: 'auto',
                pageSchema: schema,
                prepared,
                clickCommit: executors.clickCommit,
                collectEvidence: executors.collectEvidence,
                readCurrentPageDigest: () => computePageDigest(context.page),
                now,
            });
            const approval = readAutoSubmitApproval(request.paths, request.taskId);
            stoppedBecause =
                submitted.finalState === 'submitted_confirmed'
                    ? `已自动提交并确认成功（批准人：${approval?.approvedBy ?? '已记录'}）`
                    : `已经点过一次提交，但没拿到确认。系统不会再点第二次，请你去官网确认结果。`;
            break;
        }
        // 10. 推进到下一步。
        const advanced = await advancePage(context.session, context.page, {
            runId: request.runId,
            actionKind: schema.pageType === 'job_detail' ? 'start_application' : 'next',
            pageSchema: schema,
            paths: request.paths,
            now,
        });
        if (advanced.result.outcome !== 'success') {
            move('waiting_for_user', 'advance_failed');
            stoppedBecause = `无法推进到下一步：${advanced.result.errorMessage ?? '未知原因'}`;
            break;
        }
    }
    const status = getRunStatus({ paths: request.paths, runId: request.runId });
    if (TERMINAL_STATES.has(status.state)) {
        stoppedBecause = status.resumeHint;
    }
    else if (rejectedTransition !== undefined && !stoppedBecause.includes(rejectedTransition)) {
        // 状态机拒绝过迁移，就要如实说出来，不能只报一句「停在这里」。
        stoppedBecause = `${stoppedBecause}（${rejectedTransition}）`;
    }
    return {
        status,
        pagesProcessed,
        stoppedBecause,
        pendingQuestions,
        ...(uploadRejections.length === 0 ? {} : { uploadRejections }),
        ...(groupBindings.length === 0 ? {} : { groupBindings }),
        ...(unboundRecords.length === 0 ? {} : { unboundRecords }),
        ...(learningWarnings.length === 0 ? {} : { learningWarnings }),
        recipeUsage,
    };
}
//# sourceMappingURL=run-application.js.map