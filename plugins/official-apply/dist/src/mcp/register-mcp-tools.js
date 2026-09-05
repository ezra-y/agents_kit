/**
 * 只暴露少量稳定高级工具，不暴露几十个内部小函数。
 *
 * 规则文档：
 * - `docs/06_函数接口与执行循环.md §8`
 * - `docs/09_Codex与ClaudeCode共用实现.md §5.2`
 *
 * 为什么要控制数量：Agent 面对 60 个小函数会乱调，面对 10 个高级工具
 * 才会按流程走。`apply.resolve_page` 内部组合了
 * `persistSiteFields + mapSiteFields + resolveAnswers`，
 * 底层仍然是模块化的，只是不往外抖。
 *
 * 这一层**不写业务**：每个 handler 只做参数搬运和转发。
 * 合同测试会检查这个文件里没有 SQL、没有直接开数据库、没有 import playwright。
 */
import { startRunSession } from "../application/start-run-session.js";
import { openResumePage } from "../application/open-resume-page.js";
import { savePageScriptWithReadback } from "../application/save-page-script-with-readback.js";
import { resolveCurrentPage } from "../application/resolve-current-page.js";
import { resolvePageWithRecipe } from "../application/resolve-page-with-recipe.js";
import { getRunStatus } from "../application/get-run-status.js";
import { advancePage } from "../application/advance-page.js";
import { fillProfileGroups } from "../application/fill-profile-groups.js";
import { asPageScript, fillWithPageScript, inspectWithPageScript, resolvePageScriptForPage, resolveWithPageScript, validateWithPageScript, } from "../application/page-script-flow.js";
import { confirmGenericSave } from "../application/confirm-generic-save.js";
import { discoverPageScriptCandidate } from "../application/discover-page-script-candidate.js";
import { captureLearning } from "../learning/capture-learning.js";
import { buildRecipeCandidate, recipeVariantKey } from "../recipes/build-recipe-candidate.js";
import { validatePageScriptCandidate, validatePageScriptSaveAction, } from "../site-adapters/discovery/save-page-script-candidate.js";
import { writeRunSummary } from "../reporting/write-run-summary.js";
import { writeSubmissionEvidence } from "../reporting/write-submission-evidence.js";
import { collectSubmissionNetworkEvidence } from "../submission/collect-submission-network-evidence.js";
import { resolveAnswers } from "../answers/resolve-answers.js";
import { saveUserAnswers } from "../answers/save-user-answers.js";
import { confirmFieldMapping } from "../fields/confirm-field-mapping.js";
import { inspectPage } from "../browser/scan/inspect-page.js";
import { buildActionPlan } from "../browser/actions/build-action-plan.js";
import { fillPageUntilStable } from "../browser/actions/fill-page-until-stable.js";
import { planUploads } from "../browser/actions/plan-uploads.js";
import { computePageDigest, createPageSchemaCache, } from "../browser/scan/page-schema-cache.js";
import { loadLocatorStats, recordLocatorAttempt, } from "../browser/locators/record-locator-attempt.js";
import { uploadFiles } from "../browser/actions/upload-files.js";
import { validatePage, expectedFieldStates } from "../browser/validation/validate-page.js";
import { prepareVisualFallback } from "../browser/visual/prepare-visual-fallback.js";
import { verifyVisualFallback } from "../browser/visual/verify-visual-fallback.js";
import { findActionTarget } from "../browser/locators/find-action-target.js";
import { manageLogin } from "../browser/login/manage-login.js";
import { loginHumanTakeover } from "../browser/login/login-human-takeover.js";
import { syncHumanTakeover } from "../application/sync-human-takeover.js";
import { prepareSubmission } from "../submission/prepare-submission.js";
import { buildCommitExecutors, checkCommitPreconditions, } from "../submission/commit-current-page.js";
import { updateTaskFromRun } from "../tasks/update-task-from-run.js";
import { approveHost, listHostApprovals } from "../tasks/host-approval.js";
import { describeNextBatchWork, getNextBatchWork } from "../tasks/get-next-batch-work.js";
import { submitApplication } from "../submission/submit-application.js";
import { resolveSubmissionOutcome } from "../submission/resolve-submission-outcome.js";
import { consumeSubmissionApproval, issueSubmissionApproval, } from "../submission/submission-approval.js";
/** 规格点名要有的工具（`docs/06 §8` 的清单 + `docs/09 §5.2` 的 `apply.` 前缀）。 */
export const EXPECTED_TOOL_NAMES = [
    'apply.open_task',
    'apply.login',
    'apply.open_resume',
    'apply.inspect_page',
    'apply.resolve_page',
    'apply.save_answers',
    'apply.fill_page',
    'apply.validate_page',
    'apply.advance',
    'apply.submit',
    'apply.resolve_submission',
    'apply.get_status',
    'apply.build_visual_fallback',
    'apply.verify_visual_fallback',
    'apply.approve_host',
    'apply.close_run',
    'apply.list_open_runs',
    'apply.next_work',
];
function toJson(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}
function ok(data, message) {
    return { ok: true, data: toJson(data), ...(message === undefined ? {} : { message }) };
}
function fail(errorCode, message, data = null) {
    return { ok: false, data: toJson(data), message, errorCode };
}
function readString(args, name) {
    const value = args[name];
    return typeof value === 'string' ? value : undefined;
}
function readStringArray(args, name) {
    const value = args[name];
    return Array.isArray(value) && value.every((item) => typeof item === 'string')
        ? value
        : undefined;
}
/** 拿到这次运行的活会话。拿不到就明说，不偷偷再开一个。 */
function requireSession(input) {
    const runId = readString(input.args, 'runId');
    if (runId === undefined) {
        return fail('mcp_missing_argument', '缺少 runId。');
    }
    const run = input.sessions.get(runId);
    if (run === undefined) {
        return fail('mcp_session_not_found', `运行 ${runId} 还没有打开的页面，先调用 apply.open_task。`);
    }
    return { session: run.session, page: run.page, run };
}
function isToolResult(value) {
    return typeof value === 'object' && value !== null && 'ok' in value;
}
function rememberPageScriptRoute(run, script, source) {
    if (script === undefined) {
        run.executionRoute = 'generic_scan';
        run.pageScriptId = undefined;
        return;
    }
    run.pageScriptId = script.id;
    run.executionRoute =
        source === 'local_candidate'
            ? 'local_page_script'
            : script.host.startsWith('*.')
                ? 'family_page_script'
                : 'site_page_script';
}
function runSummaryFacts(run) {
    return {
        ...(run.executionRoute === undefined ? {} : { executionRoute: run.executionRoute }),
        ...(run.pageScriptId === undefined ? {} : { pageScriptId: run.pageScriptId }),
        ...(run.visualAttemptCount === undefined
            ? {}
            : { visualAttemptCount: run.visualAttemptCount }),
        ...(run.fillDurationMs === undefined ? {} : { fillDurationMs: run.fillDurationMs }),
        ...(run.saveStatus === undefined ? {} : { saveStatus: run.saveStatus }),
        ...(run.evidencePath === undefined ? {} : { evidencePath: run.evidencePath }),
        ...(run.pageScriptCandidate === undefined
            ? {}
            : {
                candidate: {
                    id: run.pageScriptCandidate.id,
                    validationStatus: run.pageScriptCandidate.validationStatus,
                },
            }),
    };
}
/** 每次动作前重扫一次当前页。页面才是事实源，不吃缓存。 */
/**
 * 拿当前页面结构。**能复用就复用，不重复扫。**
 *
 * 理想链路是「inspect 一次 → resolve 和 fill 共用 → validate 一次」。
 * 每个工具各扫一遍的话，一个普通单页要扫五六次——既慢，
 * 又平白多出好几次「页面正好在这一刻变了」的机会。
 *
 * 缓存是否还算数由 `PageSchemaCache` 判断：URL、控件摘要、失效标记三者
 * 共同决定。拿不准一律重扫——用过期结构去点东西比多扫一次危险得多。
 */
async function currentSchema(session, page, runId, now, run) {
    const cache = run?.schemaCache;
    const observer = run?.networkObserver;
    // 等在途响应解析完再取观察数：接口已经回来、页面已经渲染，
    // 那条观察却可能还在解析。不等的话缓存判定和家族识别都会少证据。
    await observer?.settle?.();
    const observationCount = observer?.observations().length ?? 0;
    if (cache !== undefined) {
        const hit = await cache.get(page, observationCount);
        if (hit !== undefined) {
            return hit.schema;
        }
    }
    // 把网络监听到的候选 schema 一起交给扫描器融合。
    // 接口里的字段名和选项常常比 DOM 更完整，能少猜很多。
    // 完整扫描就是一次真快照，落盘留痕。
    // 缓存把扫描次数压下来了，所以这里落盘不会变成噪音；
    // 反过来不落盘的话，提交前检查和事后排查都没有依据可查。
    const inspection = await inspectPage(session, page, {
        runId,
        persist: true,
        now,
        ...(observer === undefined ? {} : { networkObservations: observer.observations() }),
    });
    if (cache !== undefined) {
        cache.countFullScan();
        cache.set(inspection.schema, await computePageDigest(page), now, observationCount);
        if (run !== undefined) {
            run.schemaGeneration = cache.generation();
        }
    }
    return inspection.schema;
}
/** 声明页面被动过。下一次取结构一定会重扫。 */
function markPageMutated(run, reason, now) {
    run.schemaCache?.invalidate(reason);
    run.lastMutationAt = now;
}
function generationOf(run) {
    return (run.schemaCache?.generation() ??
        run.schemaGeneration ??
        0);
}
function recordResolutionState(run, schema, missingCount, unresolvedCount, now) {
    const revision = (run.lastResolutionState?.revision ?? 0) + 1;
    run.lastResolutionState = {
        revision,
        missingCount,
        unresolvedCount,
        pageUrl: schema.url,
        schemaGeneration: generationOf(run),
        resolvedAt: now,
    };
}
function sameDigest(left, right) {
    return (left.controlCount >= 0 &&
        right.controlCount >= 0 &&
        left.url === right.url &&
        left.controlCount === right.controlCount &&
        left.valueHash === right.valueHash);
}
/** 提交只认已保存、仍对应当前页面的干净状态。 */
export function checkMcpSubmissionState(input) {
    const blockers = [];
    const resolution = input.run.lastResolutionState;
    if (resolution === undefined) {
        blockers.push('尚未保存解析结果；先调用 apply.resolve_page');
    }
    else {
        if (resolution.missingCount > 0) {
            blockers.push(`解析结果还有 ${resolution.missingCount} 个缺失答案`);
        }
        if (resolution.unresolvedCount > 0) {
            blockers.push(`解析结果还有 ${resolution.unresolvedCount} 个未确定字段`);
        }
    }
    const validation = input.run.lastValidationState;
    if (validation === undefined) {
        blockers.push('尚未保存校验结果；先调用 apply.validate_page');
        return blockers;
    }
    if (!validation.result.valid || !validation.result.readyForReview) {
        blockers.push('最近一次页面校验未通过');
    }
    if (resolution !== undefined &&
        validation.resolutionRevision !== resolution.revision) {
        blockers.push('最近一次解析之后还没有重新校验');
    }
    if (validation.schemaGeneration !== generationOf(input.run) ||
        validation.pageUrl !== input.pageSchema.url ||
        !sameDigest(validation.pageDigest, input.pageDigest)) {
        blockers.push('校验后页面已经变化；请重新调用 apply.validate_page');
    }
    return blockers;
}
/**
 * 从上一次 `fill_page` 的结果里挑出这个字段的失败记录。
 *
 * 这是「结构化方式真的试过而且失败了」的证据。没有它就不该上 CU——
 * 定位得到不等于操作得了，但两者都要有真凭实据，不能靠宿主一句话。
 */
function fillFailuresFor(lastFillResult, runtimeRef) {
    const failed = lastFillResult?.failed;
    if (!Array.isArray(failed)) {
        return [];
    }
    return failed
        .filter((item) => typeof item === 'object' &&
        item !== null &&
        item.runtimeRef === runtimeRef)
        .map((item) => ({
        strategy: 'role_name',
        outcome: 'failed',
        reason: `结构化填写失败：${item.errorMessage ?? '未说明原因'}`,
    }));
}
export function registerMcpTools() {
    return [
        {
            name: 'apply.next_work',
            description: '读取批次中下一项可继续的工作。只有全部剩余任务都阻断时才返回整批等待。',
            mutating: false,
            inputSchema: {
                type: 'object',
                properties: { batchId: { type: 'string' } },
                required: ['batchId'],
            },
            handler(input) {
                const batchId = readString(input.args, 'batchId');
                if (batchId === undefined) {
                    return fail('mcp_missing_argument', '缺少 batchId。');
                }
                const result = getNextBatchWork(batchId, input.paths);
                return ok(result, describeNextBatchWork(result, batchId));
            },
        },
        {
            name: 'apply.open_task',
            description: '打开一条投递任务并加载申请页面。返回 runId，后面所有工具都要用它。',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: {
                    taskId: { type: 'string', description: '任务 id' },
                    browserMode: { type: 'string', enum: ['persistent', 'attach_existing'] },
                    channel: { type: 'string', enum: ['chromium', 'chrome', 'msedge'] },
                    profileName: { type: 'string', description: 'persistent 模式使用的项目 profile 名。' },
                    headless: { type: 'boolean', description: '是否无头运行。真实测试可设为 true。' },
                    loginStateSource: {
                        type: 'string',
                        enum: ['chrome', 'msedge'],
                        description: '先从已登录浏览器按域名迁移 Cookie，再打开项目隔离 profile。',
                    },
                    loginStateSourceProfile: {
                        type: 'string',
                        description: '来源浏览器 profile 名，缺省 Default。',
                    },
                    loginStateDomains: {
                        type: 'array',
                        description: '只迁移这些 Cookie 域名，不迁移历史、密码和缓存。',
                        items: { type: 'string' },
                    },
                    cdpEndpoint: {
                        type: 'string',
                        description: 'attach_existing 使用的完整动态 CDP 地址。该模式必须由调用方提供。',
                    },
                },
                required: ['taskId'],
            },
            async handler(input) {
                const taskId = readString(input.args, 'taskId');
                if (taskId === undefined) {
                    return fail('mcp_missing_argument', '缺少 taskId。');
                }
                // 这一串和 CLI 用的是同一个函数，不另写一遍（`docs/09 §5.2`）。
                const started = await startRunSession({
                    paths: input.paths,
                    taskId,
                    ...(typeof input.args['browserMode'] === 'string'
                        ? { browserMode: input.args['browserMode'] }
                        : {}),
                    ...(typeof input.args['channel'] === 'string'
                        ? { channel: input.args['channel'] }
                        : {}),
                    ...(typeof input.args['profileName'] === 'string'
                        ? { profileName: input.args['profileName'] }
                        : {}),
                    ...(typeof input.args['headless'] === 'boolean'
                        ? { headless: input.args['headless'] }
                        : {}),
                    ...(typeof input.args['loginStateSource'] === 'string'
                        ? { loginStateSource: input.args['loginStateSource'] }
                        : {}),
                    ...(typeof input.args['loginStateSourceProfile'] === 'string'
                        ? { loginStateSourceProfile: input.args['loginStateSourceProfile'] }
                        : {}),
                    ...(readStringArray(input.args, 'loginStateDomains') === undefined
                        ? {}
                        : { loginStateDomains: readStringArray(input.args, 'loginStateDomains') }),
                    ...(typeof input.args['cdpEndpoint'] === 'string'
                        ? { cdpEndpoint: input.args['cdpEndpoint'] }
                        : {}),
                    now: input.now,
                });
                const pageScript = await resolvePageScriptForPage({
                    paths: input.paths,
                    page: started.page,
                    host: started.siteHost,
                });
                // 会话交给服务持有，后面所有工具靠 runId 找回同一个页面。
                const runSession = {
                    runId: started.runId,
                    taskId,
                    materialRefs: started.materialRefs,
                    profileRecordIds: started.profileRecordIds,
                    schemaCache: createPageSchemaCache(),
                    ...(started.networkObserver === undefined
                        ? {}
                        : { networkObserver: started.networkObserver }),
                    session: started.session,
                    page: started.page,
                    browserMode: started.session.mode,
                    siteHost: started.siteHost,
                    ...(pageScript.script === undefined ? {} : { pageScript: pageScript.script }),
                    ...(pageScript.match === undefined ? {} : { pageScriptMatch: toJson(pageScript.match) }),
                    ...(started.companyKey === undefined ? {} : { companyKey: started.companyKey }),
                    ...(started.companyName === undefined ? {} : { companyName: started.companyName }),
                    ...(started.jobKey === undefined ? {} : { jobKey: started.jobKey }),
                };
                rememberPageScriptRoute(runSession, pageScript.script, pageScript.source);
                input.sessions.set(started.runId, runSession);
                if (started.requiresHuman !== undefined) {
                    return fail('mcp_tool_failed', started.requiresHuman.message, {
                        runId: started.runId,
                        requiresHuman: started.requiresHuman,
                    });
                }
                return ok({
                    runId: started.runId,
                    taskId,
                    mode: started.mode,
                    siteHost: started.siteHost,
                    adapter: pageScript.script === undefined
                        ? null
                        : {
                            id: pageScript.script.id,
                            version: pageScript.script.version,
                            source: pageScript.source,
                        },
                    adapterSkipped: pageScript.skipped,
                    loginStateMigration: started.loginStateMigration === undefined
                        ? null
                        : {
                            sourceBrowser: started.loginStateMigration.sourceBrowser,
                            sourceProfileName: started.loginStateMigration.sourceProfileName,
                            targetProfileName: started.loginStateMigration.targetProfileName,
                            domains: started.loginStateMigration.domains,
                            cookieCount: started.loginStateMigration.cookieCount,
                            cookieHosts: started.loginStateMigration.cookieHosts,
                            previousCookiesPreserved: started.loginStateMigration.previousCookiesPreserved,
                        },
                }, pageScript.script === undefined
                    ? '任务已打开，未命中 PageScript。接下来调用 apply.inspect_page 走页面发现。'
                    : `任务已打开，命中 ${pageScript.script.id}。接下来调用 apply.inspect_page。`);
            },
        },
        {
            name: 'apply.login',
            description: '在 apply.open_task 保留的同一个页面里检查或完成登录。' +
                '支持 inspect、begin_sms、submit_sms_code；手机号和验证码只在本次调用中使用，不写入证据或数据库。',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: {
                    runId: { type: 'string' },
                    action: {
                        type: 'string',
                        enum: ['inspect', 'begin_sms', 'submit_sms_code'],
                    },
                    phone: {
                        type: 'string',
                        description: 'begin_sms 使用。只在用户明确指定该手机号和登录站点后传入。',
                    },
                    code: {
                        type: 'string',
                        description: 'submit_sms_code 使用。不会写入数据库、证据目录或工具结果。',
                    },
                },
                required: ['runId', 'action'],
            },
            async handler(input) {
                const found = requireSession(input);
                if (isToolResult(found)) {
                    return found;
                }
                const action = readString(input.args, 'action');
                if (action !== 'inspect' &&
                    action !== 'begin_sms' &&
                    action !== 'submit_sms_code') {
                    return fail('mcp_invalid_argument', 'action 必须是 inspect、begin_sms 或 submit_sms_code。');
                }
                const login = await manageLogin({
                    page: found.page,
                    action,
                    ...(readString(input.args, 'phone') === undefined
                        ? {}
                        : { phone: readString(input.args, 'phone') }),
                    ...(readString(input.args, 'code') === undefined
                        ? {}
                        : { code: readString(input.args, 'code') }),
                    now: input.now,
                });
                // 映射成卡点并立即同步进运行库：失败返回前也已经记录，
                // logged_in / sms_ready 会解除旧 pending。MCP 层不写 SQL，
                // 只调用共享函数。
                const takeover = loginHumanTakeover(found.run.runId, login);
                syncHumanTakeover({
                    paths: input.paths,
                    runId: found.run.runId,
                    ...(takeover === undefined
                        ? {
                            resolveReasons: [
                                'login',
                                'captcha',
                                'sms_code',
                                'site_blocked',
                                'tool_failure',
                            ],
                        }
                        : { active: takeover }),
                    now: input.now,
                });
                if (action !== 'inspect') {
                    markPageMutated(found.run, `login_${action}`, input.now);
                }
                if (login.stage === 'logged_in') {
                    const hostname = new URL(found.page.url()).hostname;
                    const pageScript = await resolvePageScriptForPage({
                        paths: input.paths,
                        page: found.page,
                        host: hostname,
                    });
                    found.run.siteHost = hostname;
                    found.run.pageScript = pageScript.script;
                    found.run.pageScriptMatch =
                        pageScript.match === undefined ? undefined : toJson(pageScript.match);
                    rememberPageScriptRoute(found.run, pageScript.script, pageScript.source);
                    return ok({
                        ...login,
                        adapter: pageScript.script === undefined
                            ? null
                            : {
                                id: pageScript.script.id,
                                version: pageScript.script.version,
                                source: pageScript.source,
                            },
                    }, '登录状态已验证，可以继续读取和填写申请页。');
                }
                if (login.stage === 'failed' || login.stage === 'unsupported') {
                    return fail(login.errorCode ?? 'login_failed', login.message ?? '登录流程没有完成。', login);
                }
                const message = login.stage === 'code_sent'
                    ? '短信请求已被页面确认。接下来读取请求时间之后的最新验证码。'
                    : login.stage === 'captcha_required'
                        ? '页面出现验证码。保留当前窗口，操作当下确认后再处理。'
                        : login.stage === 'code_rejected'
                            ? '验证码没有通过。当前窗口仍保留，可以读取新验证码后重试。'
                            : login.stage === 'sms_ready'
                                ? '短信登录页已明确打开。'
                                : '当前需要登录。';
                return ok(login, message);
            },
        },
        {
            name: 'apply.open_resume',
            description: '在现有 runId 中进入站内简历编辑页。优先复用已知稳定入口；百度从个人中心读取当前账号的真实简历链接。',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: {
                    runId: { type: 'string' },
                },
                required: ['runId'],
            },
            async handler(input) {
                const found = requireSession(input);
                if (isToolResult(found)) {
                    return found;
                }
                let opened;
                try {
                    opened = await openResumePage({
                        session: found.session,
                        page: found.page,
                        runId: found.run.runId,
                    });
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    const matched = /^([a-z][a-z0-9_]*):\s*/.exec(message);
                    return fail(matched?.[1] ?? 'resume_entry_failed', message);
                }
                markPageMutated(found.run, 'open_resume', input.now);
                const hostname = new URL(found.page.url()).hostname;
                const pageScript = await resolvePageScriptForPage({
                    paths: input.paths,
                    page: found.page,
                    host: hostname,
                });
                found.run.siteHost = hostname;
                found.run.pageScript = pageScript.script;
                found.run.pageScriptMatch =
                    pageScript.match === undefined ? undefined : toJson(pageScript.match);
                rememberPageScriptRoute(found.run, pageScript.script, pageScript.source);
                if (pageScript.script === undefined) {
                    const login = await manageLogin({
                        page: found.page,
                        action: 'inspect',
                        now: input.now,
                    });
                    if (login.stage !== 'logged_in' && login.stage !== 'unsupported') {
                        return fail('resume_login_required', '已找到简历网址，但当前登录状态无效。继续使用原 runId 调用 apply.login。', {
                            ...opened,
                            login,
                            checkedScriptIds: pageScript.checkedScriptIds,
                        });
                    }
                    return ok({
                        ...opened,
                        pageScript: null,
                        checkedScriptIds: pageScript.checkedScriptIds,
                        skipped: pageScript.skipped,
                    }, `已进入 ${opened.resumeUrl}，未命中 PageScript。接下来调用 apply.inspect_page 走通用填写。`);
                }
                return ok({
                    ...opened,
                    siteHost: hostname,
                    pageScript: {
                        id: pageScript.script.id,
                        version: pageScript.script.version,
                        status: pageScript.script.status,
                        source: pageScript.source,
                    },
                }, `已进入站内简历，并命中 ${pageScript.script.id}。`);
            },
        },
        {
            name: 'apply.inspect_page',
            description: '扫描当前页面，返回字段、动作、上传控件和页面类型。只读。',
            mutating: false,
            inputSchema: {
                type: 'object',
                properties: { runId: { type: 'string' } },
                required: ['runId'],
            },
            async handler(input) {
                const found = requireSession(input);
                if (isToolResult(found)) {
                    return found;
                }
                const pageScript = asPageScript(found.run.pageScript);
                if (pageScript !== undefined) {
                    const result = await inspectWithPageScript({
                        paths: input.paths,
                        page: found.page,
                        script: pageScript,
                        taskId: found.run.taskId,
                        profileRecordIds: found.run.profileRecordIds,
                        materialRefs: found.run.materialRefs,
                    });
                    return ok(result, `命中 ${pageScript.id}，已读取真实页面状态。`);
                }
                const schema = await currentSchema(found.session, found.page, found.run.runId, input.now, found.run);
                // 这一份就是「填写之前的基准」。校验时拿它和填后现状对比。
                found.run.lastPreFillSchema = schema;
                const cache = found.run.schemaCache;
                return ok(schema, `扫到 ${schema.fields.length} 个字段（本页累计完整扫描 ${cache?.fullScanCount() ?? 1} 次）。`);
            },
        },
        {
            name: 'apply.resolve_page',
            description: '保存官网字段、映射到公共字段、找出答案和缺失问题。内部组合 persistSiteFields、mapSiteFields 和 resolveAnswers。',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: { runId: { type: 'string' } },
                required: ['runId'],
            },
            async handler(input) {
                const found = requireSession(input);
                if (isToolResult(found)) {
                    return found;
                }
                const pageScript = asPageScript(found.run.pageScript);
                if (pageScript !== undefined) {
                    const result = await resolveWithPageScript({
                        paths: input.paths,
                        page: found.page,
                        script: pageScript,
                        taskId: found.run.taskId,
                        profileRecordIds: found.run.profileRecordIds,
                        materialRefs: found.run.materialRefs,
                    });
                    found.run.lastPageScriptResult = toJson(result);
                    return ok(result, result.preparation.missing.length > 0
                        ? `已按 ${pageScript.id} 准备数据，还有 ${result.preparation.missing.length} 个缺失项。`
                        : `已按 ${pageScript.id} 准备数据，可以调用 apply.fill_page。`);
                }
                found.run.executionRoute = 'generic_scan';
                const schema = await currentSchema(found.session, found.page, found.run.runId, input.now, found.run);
                // 和 CLI 主循环走同一个入口：先查站点/家族配方，对不上才全局语义扫描。
                // 两边各写一遍的话，迟早有一边忘记查配方。
                const withRecipe = resolvePageWithRecipe({
                    paths: input.paths,
                    runId: found.run.runId,
                    taskId: found.run.taskId,
                    siteHost: found.run.siteHost,
                    ...(found.run.companyKey === undefined ? {} : { companyKey: found.run.companyKey }),
                    ...(found.run.companyName === undefined ? {} : { companyName: found.run.companyName }),
                    pageSchema: schema,
                    now: input.now,
                });
                const resolved = withRecipe.resolved;
                found.run.lastRecipeDecision = withRecipe.decision;
                const answers = resolveAnswers({
                    paths: input.paths,
                    runId: found.run.runId,
                    taskId: found.run.taskId,
                    ...(found.run.companyKey === undefined ? {} : { companyKey: found.run.companyKey }),
                    ...(found.run.jobKey === undefined ? {} : { jobKey: found.run.jobKey }),
                    pageSchema: schema,
                    mappings: resolved.mappings,
                    materialRefs: found.run.materialRefs,
                    profileRecordIds: found.run.profileRecordIds,
                    now: input.now,
                });
                const observer = found.run.networkObserver;
                await observer?.settle?.();
                const pageScriptCandidate = discoverPageScriptCandidate({
                    paths: input.paths,
                    runId: found.run.runId,
                    host: found.run.siteHost,
                    pageSchema: schema,
                    mappings: resolved.mappings,
                    observations: observer?.observations() ?? [],
                    now: input.now,
                });
                found.run.lastMappings = resolved.mappings;
                found.run.learningPageSchema = schema;
                if (pageScriptCandidate.generated &&
                    'candidateId' in pageScriptCandidate &&
                    'candidatePath' in pageScriptCandidate &&
                    typeof pageScriptCandidate.candidateId === 'string' &&
                    typeof pageScriptCandidate.candidatePath === 'string') {
                    found.run.pageScriptCandidate = {
                        id: pageScriptCandidate.candidateId,
                        path: pageScriptCandidate.candidatePath,
                        validationStatus: pageScriptCandidate.validationStatus,
                    };
                }
                // 记住这一轮的解析结果。校验时要靠它算「本来应该填什么」。
                found.run.lastPreFillSchema = schema;
                found.run.lastResolvedAnswers = answers.resolved;
                const requiredRuntimeRefs = new Set(schema.fields
                    .filter((field) => field.visible && field.required)
                    .map((field) => field.runtimeRef));
                recordResolutionState(found.run, schema, answers.missing.filter((entry) => entry.required).length, resolved.requiresReviewRuntimeRefs.filter((runtimeRef) => requiredRuntimeRefs.has(runtimeRef)).length, input.now);
                return ok({
                    mappings: resolved.mappings,
                    requiresReviewRuntimeRefs: resolved.requiresReviewRuntimeRefs,
                    resolved: answers.resolved,
                    missing: answers.missing,
                    recipe: {
                        familyKey: withRecipe.decision.familyKey,
                        matchLevel: withRecipe.decision.matchLevel,
                        strategy: withRecipe.decision.strategy,
                        recipeKey: withRecipe.decision.recipe?.recipeKey ?? null,
                        hintFieldCount: resolved.recipeHintFieldCount,
                        scoredFieldCount: resolved.scoredFieldCount,
                        scoreCallCount: resolved.scoreCallCount,
                        reason: withRecipe.decision.reason,
                    },
                    pageScriptCandidate,
                }, `${withRecipe.decision.reason}。` +
                    `本页 ${resolved.recipeHintFieldCount} 个字段靠配方定下含义，` +
                    `${resolved.scoredFieldCount} 个字段走了全局语义扫描。` +
                    (answers.missing.length > 0
                        ? `还有 ${answers.missing.length} 个问题需要用户回答，先问完再填。`
                        : '答案齐了，可以调用 apply.fill_page。'));
            },
        },
        {
            name: 'apply.save_answers',
            description: '保存用户回答。每条回答必须自带 scope，系统不替用户猜作用域。' +
                '带上 siteFieldId 时，同时把这个字段的映射确认为 verified——' +
                '用户对着这个框给了答案，就说明他认可「这个框 = 这个公共字段」。',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: {
                    runId: { type: 'string' },
                    answers: { type: 'array', description: '每项含 canonicalKey、value 和 scope' },
                },
                required: ['runId', 'answers'],
            },
            handler(input) {
                const runId = readString(input.args, 'runId');
                const answers = input.args['answers'];
                if (runId === undefined || !Array.isArray(answers)) {
                    return fail('mcp_missing_argument', '缺少 runId 或 answers。');
                }
                const result = saveUserAnswers({
                    paths: input.paths,
                    runId,
                    answers: answers,
                    now: input.now,
                });
                const run = input.sessions.get(runId);
                if (run !== undefined) {
                    run.lastResolutionState = undefined;
                    run.lastValidationState = undefined;
                }
                // 用户对着某个字段给了答案，就等于确认了这个字段的含义。
                // 不做这一步的话，低置信度映射永远停在「要人确认」，
                // 下一轮解析又问一遍，永远填不进去。
                const confirmed = [];
                for (const raw of answers) {
                    const siteFieldId = raw['siteFieldId'];
                    const canonicalKey = raw['canonicalKey'];
                    if (typeof siteFieldId !== 'string' || typeof canonicalKey !== 'string') {
                        continue;
                    }
                    const outcome = confirmFieldMapping({
                        paths: input.paths,
                        siteFieldId,
                        canonicalKey,
                        confirmedBy: `user_via_run:${runId}`,
                        now: input.now,
                    });
                    if (outcome.confirmed) {
                        confirmed.push(canonicalKey);
                    }
                }
                return ok({ ...result, confirmedMappings: confirmed }, `保存了 ${result.savedAnswerIds.length} 条回答` +
                    (confirmed.length === 0 ? '。' : `，确认了 ${confirmed.length} 个字段映射。`));
            },
        },
        {
            name: 'apply.fill_page',
            description: '按已解析的答案批量填写当前页。不会点击最终提交。',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: { runId: { type: 'string' } },
                required: ['runId'],
            },
            async handler(input) {
                const found = requireSession(input);
                if (isToolResult(found)) {
                    return found;
                }
                const fillStartedAt = Date.now();
                const pageScript = asPageScript(found.run.pageScript);
                if (pageScript !== undefined) {
                    const result = await fillWithPageScript({
                        paths: input.paths,
                        page: found.page,
                        script: pageScript,
                        taskId: found.run.taskId,
                        profileRecordIds: found.run.profileRecordIds,
                        materialRefs: found.run.materialRefs,
                    });
                    markPageMutated(found.run, 'page_script_fill', input.now);
                    found.run.lastPageScriptResult = toJson(result);
                    found.run.fillDurationMs =
                        (found.run.fillDurationMs ?? 0) + Math.max(result.durationMs, Date.now() - fillStartedAt);
                    return (result.fill?.failed.length ?? 0) > 0 || result.failure !== undefined
                        ? fail('mcp_tool_failed', `${pageScript.id} 有 ${result.fill?.failed.length ?? 0} 个字段失败。`, result)
                        : ok(result, result.outcome === 'partial'
                            ? `${pageScript.id} 已填写确定字段，缺失项保持空白。`
                            : `${pageScript.id} 填写和读回通过。`);
                }
                let schema = await currentSchema(found.session, found.page, found.run.runId, input.now, found.run);
                // 沿用 resolve_page 那一轮的配方判定。同一页不重新判一次，
                // 也不能因为换了个工具就退化成纯语义打分。
                const recipeHints = found.run.lastRecipeDecision?.hints ?? [];
                let resolved = resolveCurrentPage({
                    paths: input.paths,
                    runId: found.run.runId,
                    taskId: found.run.taskId,
                    siteHost: found.run.siteHost,
                    ...(found.run.companyKey === undefined ? {} : { companyKey: found.run.companyKey }),
                    pageSchema: schema,
                    ...(recipeHints.length === 0 ? {} : { recipeHints }),
                    now: input.now,
                });
                let answers = resolveAnswers({
                    paths: input.paths,
                    runId: found.run.runId,
                    taskId: found.run.taskId,
                    ...(found.run.companyKey === undefined ? {} : { companyKey: found.run.companyKey }),
                    ...(found.run.jobKey === undefined ? {} : { jobKey: found.run.jobKey }),
                    pageSchema: schema,
                    mappings: resolved.mappings,
                    materialRefs: found.run.materialRefs,
                    profileRecordIds: found.run.profileRecordIds,
                    now: input.now,
                });
                found.run.lastResolvedAnswers = answers.resolved;
                recordResolutionState(found.run, schema, answers.missing.length, resolved.requiresReviewRuntimeRefs.length, input.now);
                // 2026-08-24 放宽（网易简历页实测，经用户批准）：
                // 以前 missing > 0 直接拒绝整页填写。真实长表单上这会变成死锁——
                // 比如「证件号」这类宿主不允许代填、但页面已有值的字段永远清不掉。
                // 现在改为：只填 resolved 的字段，missing 原样带回给调用方去问人，
                // 不再阻塞已经有答案的那部分。缺失字段本来就不会出现在填写计划里，
                // 所以这不会让任何没有答案的字段被乱填。
                if (answers.missing.length > 0 && answers.resolved.length === 0) {
                    const detail = answers.missing
                        .map((item) => `${item.rawQuestion}(${item.reason})`)
                        .join('、');
                    return fail('mcp_tool_failed', `没有任何已解出的答案可填；${answers.missing.length} 个问题待回答：${detail}。先调用 apply.save_answers。`, { missing: answers.missing });
                }
                const groupsFilled = await fillProfileGroups({
                    paths: input.paths,
                    runId: found.run.runId,
                    page: found.page,
                    pageSchema: schema,
                    mappings: resolved.mappings,
                    profileRecordIds: found.run.profileRecordIds,
                });
                const failedProfileFields = groupsFilled.results.filter((result) => result.outcome !== 'success');
                if (failedProfileFields.length > 0) {
                    return fail('mcp_tool_failed', `有 ${failedProfileFields.length} 个履历字段没填上。`, { groupsFilled });
                }
                if (groupsFilled.addedInstances > 0 ||
                    groupsFilled.results.some((result) => result.pageChanged)) {
                    markPageMutated(found.run, 'fill_profile_groups', input.now);
                    schema = await currentSchema(found.session, found.page, found.run.runId, input.now, found.run);
                    resolved = resolveCurrentPage({
                        paths: input.paths,
                        runId: found.run.runId,
                        taskId: found.run.taskId,
                        siteHost: found.run.siteHost,
                        ...(found.run.companyKey === undefined
                            ? {}
                            : { companyKey: found.run.companyKey }),
                        pageSchema: schema,
                        ...(recipeHints.length === 0 ? {} : { recipeHints }),
                        now: input.now,
                    });
                    answers = resolveAnswers({
                        paths: input.paths,
                        runId: found.run.runId,
                        taskId: found.run.taskId,
                        ...(found.run.companyKey === undefined
                            ? {}
                            : { companyKey: found.run.companyKey }),
                        ...(found.run.jobKey === undefined ? {} : { jobKey: found.run.jobKey }),
                        pageSchema: schema,
                        mappings: resolved.mappings,
                        materialRefs: found.run.materialRefs,
                        profileRecordIds: found.run.profileRecordIds,
                        now: input.now,
                    });
                    found.run.lastResolvedAnswers = answers.resolved;
                    recordResolutionState(found.run, schema, answers.missing.length, resolved.requiresReviewRuntimeRefs.length, input.now);
                }
                if (answers.missing.length > 0) {
                    return fail('mcp_tool_failed', '填写履历后页面出现了新问题，先调用 apply.resolve_page。', { missing: answers.missing });
                }
                // 先上传文件。上传常常会解锁后续字段，所以排在普通字段之前。
                // 这一段和 runApplication() 用的是同一个 planUploads()/uploadFiles()，
                // 不另写一遍。
                const uploadPlan = planUploads({
                    paths: input.paths,
                    pageSchema: schema,
                    materialRefs: found.run.materialRefs,
                });
                const uploadRejections = [];
                if (uploadPlan.assignments.length > 0) {
                    const uploaded = await uploadFiles(found.page, {
                        runId: found.run.runId,
                        pageSchema: schema,
                        assignments: uploadPlan.assignments.map((item) => ({
                            runtimeRef: item.runtimeRef,
                            localPath: item.localPath,
                        })),
                        paths: input.paths,
                    });
                    uploadRejections.push(...uploaded.rejected.map((item) => item.reason));
                    // 上传会改变页面：先让缓存失效，再重扫。
                    markPageMutated(found.run, 'upload_files', input.now);
                    schema = await currentSchema(found.session, found.page, found.run.runId, input.now, found.run);
                }
                const blockingUploads = uploadPlan.unmatched.filter((item) => item.required);
                if (blockingUploads.length > 0) {
                    return fail('mcp_tool_failed', `有 ${blockingUploads.length} 个必传材料没准备好：${blockingUploads
                        .map((item) => item.reason)
                        .join('；')}`, { unmatched: uploadPlan.unmatched });
                }
                // 一页可能要填好几轮：下拉、单选、勾选都会改变页面结构，
                // 填写器遇到就会停下等重扫。不循环的话，一页上只会填到
                // 第一个下拉为止，后面的字段一个都不填，而且不报错。
                // 载入这个站点的历史成功率，用来给定位候选排序；
                // 这一轮的尝试结果再记回去，下次就更准。
                // 排序只在「相近策略之间」微调，不会让脆弱 CSS 越过明确语义定位——
                // 那条基础优先级在 rankLocatorCandidates() 里守着。
                const siteId = resolved.siteId;
                const stats = loadLocatorStats(input.paths, siteId);
                let latestMissingCount = answers.missing.length;
                let latestUnresolvedCount = resolved.requiresReviewRuntimeRefs.length;
                let latestResolutionSchema = schema;
                const filled = await fillPageUntilStable({
                    session: found.session,
                    page: found.page,
                    runId: found.run.runId,
                    stats,
                    recordAttempts: ({ attempts, actionKind }) => {
                        recordLocatorAttempt({
                            paths: input.paths,
                            runId: found.run.runId,
                            siteId,
                            attempts,
                            actionKind,
                            now: input.now,
                        });
                    },
                    pageSchema: schema,
                    resolved: answers.resolved,
                    unresolvedRuntimeRefs: resolved.requiresReviewRuntimeRefs,
                    now: input.now,
                    rescan: () => currentSchema(found.session, found.page, found.run.runId, input.now, found.run),
                    reresolve: async (next) => {
                        const nextPage = resolveCurrentPage({
                            paths: input.paths,
                            runId: found.run.runId,
                            taskId: found.run.taskId,
                            siteHost: found.run.siteHost,
                            ...(found.run.companyKey === undefined ? {} : { companyKey: found.run.companyKey }),
                            ...(found.run.companyName === undefined
                                ? {}
                                : { companyName: found.run.companyName }),
                            pageSchema: next,
                            ...(recipeHints.length === 0 ? {} : { recipeHints }),
                            now: input.now,
                        });
                        const nextAnswers = resolveAnswers({
                            paths: input.paths,
                            runId: found.run.runId,
                            taskId: found.run.taskId,
                            ...(found.run.companyKey === undefined ? {} : { companyKey: found.run.companyKey }),
                            ...(found.run.jobKey === undefined ? {} : { jobKey: found.run.jobKey }),
                            pageSchema: next,
                            mappings: nextPage.mappings,
                            materialRefs: found.run.materialRefs,
                            profileRecordIds: found.run.profileRecordIds,
                            now: input.now,
                        });
                        latestMissingCount = nextAnswers.missing.length;
                        latestUnresolvedCount = nextPage.requiresReviewRuntimeRefs.length;
                        latestResolutionSchema = next;
                        found.run.lastResolvedAnswers = nextAnswers.resolved;
                        return {
                            resolved: nextAnswers.resolved,
                            unresolvedRuntimeRefs: nextPage.requiresReviewRuntimeRefs,
                            missingCount: nextAnswers.missing.length,
                        };
                    },
                });
                // 先记事实，再决定报成功还是报失败。
                //
                // 这两行原来在失败分支**后面**，于是「填了 3 项、成功 2 项」的时候
                // 直接 return 走了：页面明明被改过，缓存却没作废，下一次扫描可能
                // 拿到过期结构；失败记录也没留下，后面想知道「哪一项结构化填不进去」
                // 就无从查起——视觉兜底恰恰要靠这条记录才允许启动。
                markPageMutated(found.run, 'fill_page', input.now);
                found.run.lastFillResult = toJson(filled);
                found.run.fillDurationMs =
                    (found.run.fillDurationMs ?? 0) + (Date.now() - fillStartedAt);
                recordResolutionState(found.run, latestResolutionSchema, latestMissingCount, latestUnresolvedCount, input.now);
                // 有失败项就不能报成功。以前不管填没填上都返回 ok，
                // 调用方看到 ok=true 就往下走，结果页面上根本没填进去。
                if (filled.failed.length > 0) {
                    const detail = filled.failed
                        .map((item) => `${item.runtimeRef}:${item.errorMessage ?? item.errorCode ?? '未知'}`)
                        .join('、');
                    return fail('mcp_tool_failed', `${filled.results.length} 项里有 ${filled.failed.length} 项没填上：${detail}`, filled);
                }
                if (filled.stoppedForQuestions) {
                    return fail('mcp_tool_failed', '条件字段带出了新问题，先调用 apply.resolve_page 看缺什么。', filled);
                }
                return ok({ ...filled, uploadRejections, profileBindings: groupsFilled.bindings }, `填了 ${filled.results.length} 项，全部成功（共 ${filled.rounds} 轮）` +
                    (uploadPlan.assignments.length === 0
                        ? '。'
                        : `，上传 ${uploadPlan.assignments.length} 份材料。`));
            },
        },
        {
            name: 'apply.validate_page',
            description: '重扫一次并统一校验：值写进去没有、有没有报错、有没有新出现的条件字段。',
            mutating: false,
            inputSchema: {
                type: 'object',
                properties: { runId: { type: 'string' } },
                required: ['runId'],
            },
            async handler(input) {
                const found = requireSession(input);
                if (isToolResult(found)) {
                    return found;
                }
                const pageScript = asPageScript(found.run.pageScript);
                if (pageScript !== undefined) {
                    const result = await validateWithPageScript({
                        paths: input.paths,
                        page: found.page,
                        script: pageScript,
                        taskId: found.run.taskId,
                        profileRecordIds: found.run.profileRecordIds,
                        materialRefs: found.run.materialRefs,
                    });
                    found.run.lastPageScriptResult = toJson(result);
                    return ok(result, result.validation.valid
                        ? `${pageScript.id} 读回校验通过。`
                        : `${pageScript.id} 有 ${result.validation.issues.length} 个读回问题。`);
                }
                const schema = await currentSchema(found.session, found.page, found.run.runId, input.now, found.run);
                // 用上一轮解析出来的答案当作「本来应该填什么」。
                // 以前这里传的是空表，所以校验永远说不出「哪个值没写进去」——
                // 只能报页面自己的红字，填了没生效的字段一个都发现不了。
                const expected = new Map((found.run.lastResolvedAnswers ?? []).map((answer) => [answer.runtimeRef, answer.formattedValue]));
                const result = await validatePage(found.session, found.page, {
                    runId: found.run.runId,
                    snapshotId: schema.snapshotId,
                    expectedFields: expectedFieldStates(schema.fields, expected),
                    ...(found.run.lastPreFillSchema === undefined
                        ? { previousSchema: schema }
                        : { previousSchema: found.run.lastPreFillSchema }),
                    paths: input.paths,
                    now: input.now,
                });
                const digest = await computePageDigest(found.page);
                const cache = found.run.schemaCache;
                const observer = found.run.networkObserver;
                cache?.set(result.currentSchema, digest, input.now, observer?.observations().length ?? 0);
                found.run.schemaGeneration = generationOf(found.run);
                found.run.lastValidationState = {
                    result,
                    resolutionRevision: found.run.lastResolutionState?.revision ?? 0,
                    pageUrl: result.currentSchema.url,
                    schemaGeneration: generationOf(found.run),
                    pageDigest: digest,
                    validatedAt: input.now,
                };
                let learning = null;
                const resolutionRevision = found.run.lastResolutionState?.revision;
                if (result.valid &&
                    result.readyForReview &&
                    resolutionRevision !== undefined &&
                    found.run.lastResolutionState?.missingCount === 0 &&
                    found.run.lastResolutionState.unresolvedCount === 0 &&
                    found.run.learningPageSchema !== undefined &&
                    found.run.lastMappings !== undefined &&
                    found.run.learningCapturedResolutionRevision !== resolutionRevision) {
                    try {
                        const learningSchema = found.run.learningPageSchema;
                        const built = buildRecipeCandidate({
                            host: found.run.siteHost,
                            pageSchema: learningSchema,
                            mappings: found.run.lastMappings,
                            ...(learningSchema.saasFamily === undefined
                                ? {}
                                : { familyDetection: learningSchema.saasFamily }),
                        });
                        const captured = captureLearning({
                            paths: input.paths,
                            runId: found.run.runId,
                            siteHost: found.run.siteHost,
                            pageSchema: learningSchema,
                            mappings: found.run.lastMappings,
                            networkCandidates: learningSchema.networkSchemaCandidates,
                            ...(learningSchema.saasFamily === undefined
                                ? {}
                                : { familyDetection: learningSchema.saasFamily }),
                            ...(built.recipe === undefined
                                ? {}
                                : {
                                    recipeCandidate: built.recipe,
                                    variantKey: recipeVariantKey(built.recipe),
                                }),
                            now: input.now,
                        });
                        const candidate = found.run.pageScriptCandidate === undefined
                            ? undefined
                            : validatePageScriptCandidate(input.paths, {
                                host: found.run.siteHost,
                                candidateId: found.run.pageScriptCandidate.id,
                                runId: found.run.runId,
                                now: input.now,
                            });
                        if (candidate !== undefined) {
                            found.run.pageScriptCandidate = {
                                id: candidate.candidateId,
                                path: candidate.candidatePath,
                                validationStatus: candidate.validationStatus,
                            };
                        }
                        found.run.learningCapturedResolutionRevision = resolutionRevision;
                        learning = toJson({
                            ...captured,
                            candidate: candidate ?? null,
                        });
                        found.run.learningResult = learning;
                    }
                    catch (error) {
                        learning = toJson({
                            warning: error instanceof Error ? error.message : String(error),
                        });
                    }
                }
                const mismatches = result.issues.filter((issue) => issue.code === 'value_mismatch');
                return ok({ ...result, learning }, result.valid
                    ? `校验通过（对比了 ${expected.size} 个预期值）。`
                    : mismatches.length > 0
                        ? `有 ${mismatches.length} 个预期值没写进去：${mismatches
                            .map((issue) => issue.runtimeRef ?? '')
                            .join('、')}`
                        : `还有 ${result.issues.length} 个问题。`);
            },
        },
        {
            name: 'apply.advance',
            description: '从岗位详情开始申请，或点保存、下一步、上一步。绝不会点最终提交——那是 apply.submit 的事。',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: {
                    runId: { type: 'string' },
                    actionKind: {
                        type: 'string',
                        enum: ['start_application', 'next', 'previous', 'save', 'review'],
                    },
                },
                required: ['runId'],
            },
            async handler(input) {
                const found = requireSession(input);
                if (isToolResult(found)) {
                    return found;
                }
                const pageScript = asPageScript(found.run.pageScript);
                const requestedAction = readString(input.args, 'actionKind');
                if (pageScript !== undefined && (requestedAction === undefined || requestedAction === 'save')) {
                    const result = await savePageScriptWithReadback({
                        paths: input.paths,
                        session: found.session,
                        page: found.page,
                        runId: found.run.runId,
                        script: pageScript,
                        taskId: found.run.taskId,
                        profileRecordIds: found.run.profileRecordIds,
                        materialRefs: found.run.materialRefs,
                    });
                    markPageMutated(found.run, 'page_script_save', input.now);
                    found.run.lastPageScriptResult = toJson(result);
                    found.run.saveStatus = result.saveDraft.saved ? 'confirmed' : 'unconfirmed';
                    if ('evidencePath' in result && typeof result.evidencePath === 'string') {
                        found.run.evidencePath = result.evidencePath;
                    }
                    return result.saveDraft.saved
                        ? ok(result, `${pageScript.id} 已保存草稿并完成服务器读回。`)
                        : fail('mcp_tool_failed', result.saveDraft.message ?? '保存草稿没有强证据。', result);
                }
                const schema = await currentSchema(found.session, found.page, found.run.runId, input.now, found.run);
                const actionKind = (readString(input.args, 'actionKind') ??
                    (schema.pageType === 'job_detail' ? 'start_application' : 'next'));
                const observer = found.run.networkObserver;
                await observer?.settle?.();
                const observationOffset = observer?.observations().length ?? 0;
                const result = await advancePage(found.session, found.page, {
                    runId: found.run.runId,
                    actionKind,
                    pageSchema: schema,
                    paths: input.paths,
                    now: input.now,
                });
                await observer?.settle?.();
                const saveConfirmation = actionKind === 'save'
                    ? confirmGenericSave(observer?.observations().slice(observationOffset) ?? [])
                    : undefined;
                markPageMutated(found.run, 'advance', input.now);
                if (actionKind === 'save') {
                    found.run.saveStatus =
                        saveConfirmation?.confirmed === true
                            ? 'confirmed'
                            : result.result.outcome === 'success'
                                ? 'observed'
                                : 'unconfirmed';
                    if (saveConfirmation?.confirmed === true &&
                        found.run.pageScriptCandidate !== undefined) {
                        try {
                            validatePageScriptSaveAction(input.paths, {
                                host: found.run.siteHost,
                                candidateId: found.run.pageScriptCandidate.id,
                                runId: found.run.runId,
                                responseUrlPatterns: saveConfirmation.responseUrlPatterns,
                            });
                        }
                        catch {
                            // 保存已经成功。候选保存动作没能升级只影响下次复用，不改写当次结果。
                        }
                    }
                }
                return result.result.outcome === 'success' || saveConfirmation?.confirmed === true
                    ? ok({ ...result, saveConfirmation: saveConfirmation ?? null }, saveConfirmation?.confirmed === true
                        ? `保存接口明确成功（HTTP ${saveConfirmation.statuses.join('/')}）。`
                        : '已推进到下一步。')
                    : fail('mcp_tool_failed', result.result.errorMessage ?? '没能推进。', result);
            },
        },
        {
            name: 'apply.submit',
            description: '最终提交。先做提交前检查并取得一次性批准令牌；最终提交必须带回该令牌。' +
                '只允许执行一次，结果不确定时绝不自动再点。',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: {
                    runId: { type: 'string' },
                    confirm: { type: 'boolean', description: '缺省 false 时只做检查；true 时尝试最终提交。' },
                    approvalToken: {
                        type: 'string',
                        description: '提交前检查返回的一次性令牌。任务或页面变化、过期、使用后都会失效。',
                    },
                },
                required: ['runId'],
            },
            async handler(input) {
                const found = requireSession(input);
                if (isToolResult(found)) {
                    return found;
                }
                const confirm = input.args['confirm'] === true;
                const approvalToken = readString(input.args, 'approvalToken');
                if (confirm && approvalToken === undefined) {
                    return fail('mcp_submission_approval_required', '最终提交需要一次性批准令牌。请先不带 confirm 调用 apply.submit，展示检查摘要并取得确认。', { requiresDryRun: true });
                }
                const schema = await currentSchema(found.session, found.page, found.run.runId, input.now, found.run);
                const digest = await computePageDigest(found.page);
                const stateBlockers = checkMcpSubmissionState({
                    run: found.run,
                    pageSchema: schema,
                    pageDigest: digest,
                });
                if (stateBlockers.length > 0) {
                    return confirm
                        ? fail('mcp_submission_state_not_clean', `还不能提交：${stateBlockers.join('；')}`, { blockers: stateBlockers })
                        : ok({ dryRun: true, ready: false, blockers: stateBlockers }, `还不能提交：${stateBlockers.join('；')}`);
                }
                const validation = found.run.lastValidationState?.result;
                if (validation === undefined) {
                    return fail('mcp_submission_state_not_clean', '还不能提交：没有已保存的校验结果。');
                }
                const prepared = prepareSubmission({
                    paths: input.paths,
                    runId: found.run.runId,
                    taskId: found.run.taskId,
                    mode: 'review',
                    validation,
                    unresolvedRuntimeRefs: [],
                    pageSchema: schema,
                    pageDigest: digest,
                    now: input.now,
                });
                // 活会话检查必须在 dry-run 里也跑一遍，这样用户在确认之前
                // 就知道「页面还在不在」，而不是点了确认才发现会话没了。
                const sessionProblem = checkCommitPreconditions({
                    session: found.session,
                    page: found.page,
                    pageSchema: schema,
                });
                if (!confirm) {
                    const approval = prepared.ready && sessionProblem === undefined
                        ? issueSubmissionApproval({
                            paths: input.paths,
                            runId: found.run.runId,
                            taskId: found.run.taskId,
                            idempotencyKey: prepared.idempotencyKey,
                            pageDigest: digest,
                            summary: {
                                ...(schema.title === undefined ? {} : { pageTitle: schema.title }),
                                commitLabel: schema.actions.find((action) => action.commitAction)?.label ??
                                    '最终提交',
                            },
                            now: input.now,
                        })
                        : undefined;
                    return ok({
                        dryRun: true,
                        prepared,
                        sessionProblem: sessionProblem ?? null,
                        approval: approval ?? null,
                    }, sessionProblem ??
                        (prepared.ready
                            ? '检查通过。请向用户展示批准摘要；收到后续确认后，带 approvalToken 和 confirm=true 调用一次。'
                            : `还不能提交：${prepared.blockers.join('；')}`));
                }
                if (!prepared.ready) {
                    return fail('mcp_tool_failed', `还不能提交：${prepared.blockers.join('；')}`, prepared);
                }
                // **在写 attempt 之前**就拒绝（修复清单 P0-5）。
                // submitApplication() 为了幂等会先写 attempt 再点击；
                // 如果到那时候才发现没有执行器，唯一一次提交机会就白白烧掉了。
                if (sessionProblem !== undefined) {
                    return fail('mcp_tool_failed', sessionProblem, { prepared });
                }
                const executors = buildCommitExecutors({
                    session: found.session,
                    page: found.page,
                    pageSchema: schema,
                    runId: found.run.runId,
                });
                const observer = found.run.networkObserver;
                await observer?.settle?.();
                const submissionObservationOffset = observer?.observations().length ?? 0;
                const consumed = consumeSubmissionApproval({
                    paths: input.paths,
                    approvalToken: approvalToken,
                    runId: found.run.runId,
                    taskId: found.run.taskId,
                    idempotencyKey: prepared.idempotencyKey,
                    pageDigest: digest,
                    now: input.now,
                });
                if (!consumed.ok) {
                    return fail(consumed.errorCode ?? 'mcp_submission_approval_invalid', consumed.message ?? '提交批准令牌无效。', { approvalId: consumed.approvalId ?? null });
                }
                // 点提交一定会改变页面（跳成功页、弹提示、按钮变灰）。
                // 先声明失效，再执行——不然之后任何一次取结构都会拿到点击之前的旧页面，
                // 证据判定和状态查询全都读错。
                markPageMutated(found.run, 'submit_commit', input.now);
                const beforeSubmissionScreenshot = await found.page
                    .screenshot({ fullPage: true })
                    .catch(() => undefined);
                const result = await submitApplication({
                    paths: input.paths,
                    runId: found.run.runId,
                    taskId: found.run.taskId,
                    mode: 'review',
                    pageSchema: schema,
                    prepared,
                    explicitApprovalToken: approvalToken,
                    approvalReceipt: {
                        approvalId: consumed.approvalId,
                        tokenHash: consumed.tokenHash,
                    },
                    clickCommit: executors.clickCommit,
                    readCurrentPageDigest: () => computePageDigest(found.page),
                    collectEvidence: async () => {
                        const pageEvidence = await executors.collectEvidence();
                        await observer?.settle?.();
                        const networkEvidence = collectSubmissionNetworkEvidence(observer?.observations().slice(submissionObservationOffset) ?? []);
                        return [...pageEvidence, ...networkEvidence];
                    },
                    now: input.now,
                });
                // 点完之后页面已经不是刚才那一份了，再失效一次。
                markPageMutated(found.run, 'after_submit', input.now);
                const afterSubmissionScreenshot = await found.page
                    .screenshot({ fullPage: true })
                    .catch(() => undefined);
                let formalEvidence;
                try {
                    formalEvidence = writeSubmissionEvidence({
                        paths: input.paths,
                        host: found.run.siteHost,
                        taskId: found.run.taskId,
                        runId: found.run.runId,
                        result,
                        ...(found.run.pageScriptId === undefined
                            ? {}
                            : { pageScriptId: found.run.pageScriptId }),
                        ...(beforeSubmissionScreenshot === undefined
                            ? {}
                            : { beforeScreenshot: beforeSubmissionScreenshot }),
                        ...(afterSubmissionScreenshot === undefined
                            ? {}
                            : { afterScreenshot: afterSubmissionScreenshot }),
                        now: input.now,
                    });
                    found.run.evidencePath = formalEvidence.evidencePath;
                }
                catch (error) {
                    formalEvidence = {
                        warning: error instanceof Error ? error.message : String(error),
                    };
                }
                // 不管成没成，都把结果回写到任务上并排进 outbox（修复清单 P1-12）。
                // 「不确定」也要回写——用户必须知道有一条需要他自己去官网确认。
                const written = updateTaskFromRun({
                    paths: input.paths,
                    runId: found.run.runId,
                    now: input.now,
                });
                let runSummary;
                try {
                    runSummary = writeRunSummary({
                        paths: input.paths,
                        runId: found.run.runId,
                        runtime: runSummaryFacts(found.run),
                        now: input.now,
                    });
                }
                catch (error) {
                    runSummary = {
                        warning: error instanceof Error ? error.message : String(error),
                    };
                }
                return result.finalState === 'submitted_confirmed'
                    ? ok({
                        ...result,
                        approvalId: consumed.approvalId,
                        taskUpdate: written,
                        formalEvidence,
                        runSummary,
                    }, '提交已确认成功，结果已回写任务。')
                    : fail('mcp_tool_failed', result.refusedReason ?? result.requiresHuman?.message ?? '提交结果不确定。', {
                        ...result,
                        taskUpdate: written,
                        formalEvidence,
                        runSummary,
                    });
            },
        },
        {
            name: 'apply.resolve_submission',
            description: '人工核对一次提交结果不确定的运行。必须先由用户在官网确认结果；' +
                '这个工具只修正本地记录，绝不再次点击提交。',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: {
                    runId: { type: 'string' },
                    result: {
                        type: 'string',
                        enum: ['submitted', 'not_submitted'],
                        description: 'submitted=官网确认已提交；not_submitted=官网确认没有提交。',
                    },
                    confirmedBy: { type: 'string', description: '谁在官网核对的。' },
                    note: { type: 'string', description: '可选的人工核对说明。' },
                },
                required: ['runId', 'result', 'confirmedBy'],
            },
            handler(input) {
                const runId = readString(input.args, 'runId');
                const result = readString(input.args, 'result');
                const confirmedBy = readString(input.args, 'confirmedBy');
                const note = readString(input.args, 'note');
                if (runId === undefined || result === undefined || confirmedBy === undefined) {
                    return fail('mcp_missing_argument', '缺少 runId、result 或 confirmedBy。');
                }
                if (result !== 'submitted' && result !== 'not_submitted') {
                    return fail('mcp_tool_failed', `result 只能是 submitted 或 not_submitted，收到 ${result}。`);
                }
                try {
                    const resolved = resolveSubmissionOutcome({
                        paths: input.paths,
                        runId,
                        result,
                        confirmedBy,
                        ...(note === undefined ? {} : { note }),
                        now: input.now,
                    });
                    return ok(resolved, result === 'submitted'
                        ? '已按人工核对确认提交成功。'
                        : '已确认没有提交，已释放合法重试资格。');
                }
                catch (error) {
                    return fail('mcp_tool_failed', error instanceof Error ? error.message : String(error));
                }
            },
        },
        {
            name: 'apply.get_status',
            description: '读出一次运行停在哪里、还缺什么、下一步该做什么。只读。',
            mutating: false,
            inputSchema: {
                type: 'object',
                properties: { runId: { type: 'string' } },
                required: ['runId'],
            },
            handler(input) {
                const runId = readString(input.args, 'runId');
                if (runId === undefined) {
                    return fail('mcp_missing_argument', '缺少 runId。');
                }
                const status = getRunStatus({ paths: input.paths, runId });
                return status.exists
                    ? ok(status, status.resumeHint)
                    : fail('mcp_tool_failed', status.resumeHint, status);
            },
        },
        {
            name: 'apply.build_visual_fallback',
            description: '给一个结构化操作不了的控件做一次局部视觉交接：截它那一小块、写清目标、' +
                '允许动作、禁止动作和成功判据。你拿到之后用你自己的浏览器或 CU 工具在**那块区域内**动手，' +
                '动完必须调 apply.verify_visual_fallback 验证——你说点到了不算数。' +
                '普通 input/select/radio/checkbox/file upload 会被直接拒绝：' +
                '它们在 DOM 里有名有姓，定位不到说明扫描有问题，该去修那里。',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: {
                    runId: { type: 'string' },
                    runtimeRef: { type: 'string', description: '当前页面快照里的字段引用' },
                    goal: { type: 'string', description: '要达成什么，例如「把学历选成硕士」' },
                },
                required: ['runId', 'runtimeRef', 'goal'],
            },
            async handler(input) {
                const found = requireSession(input);
                if (isToolResult(found)) {
                    return found;
                }
                const runtimeRef = readString(input.args, 'runtimeRef');
                const goal = readString(input.args, 'goal');
                if (runtimeRef === undefined || goal === undefined) {
                    return fail('mcp_missing_argument', '缺少 runtimeRef 或 goal。');
                }
                const schema = await currentSchema(found.session, found.page, found.run.runId, input.now, found.run);
                const field = schema.fields.find((item) => item.runtimeRef === runtimeRef);
                if (field === undefined) {
                    return fail('mcp_tool_failed', `当前页面快照里没有 ${runtimeRef}。先调 apply.inspect_page 拿最新的引用。`);
                }
                // 连续失败到上限就停手，不让宿主无限重试。
                const attempts = (found.run.visualAttempts ??= {});
                const used = attempts[runtimeRef] ?? 0;
                const prepared = await prepareVisualFallback({
                    page: found.page,
                    paths: input.paths,
                    runId: found.run.runId,
                    field,
                    goal,
                    priorFailures: fillFailuresFor(found.run.lastFillResult, runtimeRef),
                });
                if (used >= (prepared.request?.maxAttempts ?? 2)) {
                    return fail('mcp_tool_failed', `「${field.rawLabel || runtimeRef}」已经试过 ${used} 次局部视觉都没通过验证，不再重试。请人工处理这个控件。`, { runtimeRef, attemptsUsed: used, requiresHuman: true });
                }
                if (prepared.request === undefined) {
                    return fail('mcp_tool_failed', prepared.refused ?? '无法生成视觉兜底请求。', {
                        runtimeRef,
                        evidence: prepared.evidence,
                    });
                }
                attempts[runtimeRef] = used + 1;
                found.run.visualAttemptCount = (found.run.visualAttemptCount ?? 0) + 1;
                const request = prepared.request;
                return ok({
                    request: request,
                    screenshotPath: request.screenshotPathRedacted,
                    region: request.region.boundingBox ?? null,
                    goal: request.goal,
                    allowedActions: request.allowedActions,
                    forbiddenActions: request.forbiddenActions,
                    successChecks: request.successChecks,
                    attemptsUsed: used + 1,
                    maxAttempts: request.maxAttempts,
                }, `第 ${used + 1}/${request.maxAttempts} 次局部视觉交接。截图：${request.screenshotPathRedacted}。` +
                    `区域坐标是**页面坐标**，动作只能落在这块里。禁止：${request.forbiddenActions.join('、')}。` +
                    '动完调 apply.verify_visual_fallback。' +
                    (found.run.browserMode === 'attach_existing'
                        ? ''
                        : '\n注意：这次跑的是隔离浏览器，你自己的浏览器工具**看不到**这个页面。' +
                            '你能做的只有看截图判断该点哪里；真要动手需要用 attach_existing 模式重开，' +
                            '或者由平台适配层注入 CU 执行器。'));
            },
        },
        {
            name: 'apply.verify_visual_fallback',
            description: '用结构化方式验证刚才那次局部视觉操作到底成没成：读回 DOM 值、ARIA 状态、' +
                '浮层关没关。宿主声称成功一律不作数。',
            mutating: false,
            inputSchema: {
                type: 'object',
                properties: {
                    runId: { type: 'string' },
                    runtimeRef: { type: 'string' },
                    expectedValue: { description: '期望读回的值。不给就只要求「不再是空的」。' },
                    expectClosedSelector: { type: 'string', description: '期望已经关掉的浮层选择器' },
                },
                required: ['runId', 'runtimeRef'],
            },
            async handler(input) {
                const found = requireSession(input);
                if (isToolResult(found)) {
                    return found;
                }
                const runtimeRef = readString(input.args, 'runtimeRef');
                if (runtimeRef === undefined) {
                    return fail('mcp_missing_argument', '缺少 runtimeRef。');
                }
                // CU 动过页面，缓存一定作废——拿旧结构去读值就是自欺欺人。
                markPageMutated(found.run, 'visual_fallback', input.now);
                const schema = await currentSchema(found.session, found.page, found.run.runId, input.now, found.run);
                const field = schema.fields.find((item) => item.runtimeRef === runtimeRef);
                if (field === undefined) {
                    return fail('mcp_tool_failed', `重扫之后页面上没有 ${runtimeRef} 了。可能操作把页面改成了另一个样子，先 apply.inspect_page 看看。`);
                }
                const target = await findActionTarget(found.page.mainFrame(), field.locatorCandidates, { runId: found.run.runId, runtimeRef });
                const expectClosedSelector = readString(input.args, 'expectClosedSelector');
                const verification = await verifyVisualFallback({
                    ...(target.target === undefined ? {} : { locator: target.target.locator }),
                    ...(input.args['expectedValue'] === undefined
                        ? {}
                        : { expectedValue: input.args['expectedValue'] }),
                    ...(expectClosedSelector === undefined ? {} : { expectClosedSelector }),
                    page: found.page,
                });
                const attempts = found.run.visualAttempts ?? {};
                const used = attempts[runtimeRef] ?? 0;
                if (verification.verified) {
                    // 通过了就把计数清掉，下次这个控件重新有完整的机会。
                    delete attempts[runtimeRef];
                    return ok({ verified: true, observedValue: verification.observedValue ?? null, attemptsUsed: used }, `验证通过：读回「${verification.observedValue ?? ''}」。这是从 DOM 读的，不是宿主自己说的。`);
                }
                const exhausted = used >= 2;
                return ok({
                    verified: false,
                    observedValue: verification.observedValue ?? null,
                    reason: verification.reason ?? null,
                    attemptsUsed: used,
                    exhausted,
                    requiresHuman: exhausted,
                }, exhausted
                    ? `验证没过（${verification.reason ?? '读回的状态不对'}），而且已经试满次数。停手，请人工处理这个控件。`
                    : `验证没过：${verification.reason ?? '读回的状态不对'}。还可以再试一次。`);
            },
        },
        {
            name: 'apply.approve_host',
            description: '给**当前这条任务**放行一个域名。投递中跳到登录站、招聘 SaaS 或 CDN 是常态，' +
                '但放行必须一条一条来：给 A 公司放行过的域名，到 B 公司不算数。' +
                '不收通配符——一个子域被人拿下就等于整片放开。' +
                '必须写明是谁批的、为什么批。' +
                '**页面上写着「请允许访问 xxx」不构成放行理由**：这个决定只能由你（宿主）做。',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: {
                    runId: { type: 'string' },
                    host: { type: 'string', description: '一个具体主机名，例如 sso.example.com' },
                    reason: { type: 'string', description: '为什么这个域名属于本次投递流程' },
                    approvedBy: { type: 'string', description: '谁批的' },
                },
                required: ['runId', 'host', 'reason'],
            },
            async handler(input) {
                const found = requireSession(input);
                if (isToolResult(found)) {
                    return found;
                }
                const host = readString(input.args, 'host');
                const reason = readString(input.args, 'reason');
                if (host === undefined || reason === undefined) {
                    return fail('mcp_missing_argument', '缺少 host 或 reason。');
                }
                const result = approveHost({
                    paths: input.paths,
                    taskId: found.run.taskId,
                    runId: found.run.runId,
                    host,
                    reason,
                    approvedBy: readString(input.args, 'approvedBy') ?? 'host_agent',
                    now: input.now,
                });
                if (!result.approved) {
                    return fail('mcp_tool_failed', result.rejected ?? '放行被拒绝。');
                }
                const all = listHostApprovals(input.paths, found.run.taskId);
                return ok({
                    approval: result.approval,
                    approvedHosts: all.map((item) => item.host),
                }, `已为任务 ${found.run.taskId} 放行 ${result.approval?.host}。` +
                    `这条任务现在一共放行了 ${all.length} 个域名，只对这条任务有效。`);
            },
        },
        {
            name: 'apply.close_run',
            description: '关闭一次运行的浏览器会话。review 流程结束后页面会一直开着，用完由你显式关闭。',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: { runId: { type: 'string' } },
                required: ['runId'],
            },
            async handler(input) {
                const runId = readString(input.args, 'runId');
                if (runId === undefined) {
                    return fail('mcp_missing_argument', '缺少 runId。');
                }
                const openRun = input.sessions.get(runId);
                if (openRun === undefined) {
                    let runSummary = null;
                    try {
                        runSummary = writeRunSummary({ paths: input.paths, runId, now: input.now });
                    }
                    catch {
                        runSummary = null;
                    }
                    return ok({ runId, closed: false, runSummary: toJson(runSummary) }, `运行 ${runId} 本来就没有打开的会话。`);
                }
                // 关会话之前先把当前状态回写一次。用户中途停下来，
                // 结果表里也该看得到「这条停在哪一步」。
                let taskUpdate = null;
                try {
                    taskUpdate = updateTaskFromRun({ paths: input.paths, runId, now: input.now });
                }
                catch {
                    // 回写失败不该拦住关闭会话。会话留着不关问题更大。
                    taskUpdate = null;
                }
                let runSummary = null;
                try {
                    runSummary = writeRunSummary({
                        paths: input.paths,
                        runId,
                        runtime: runSummaryFacts(openRun),
                        now: input.now,
                    });
                }
                catch {
                    runSummary = null;
                }
                await input.sessions.delete(runId);
                return ok({
                    runId,
                    closed: true,
                    taskUpdate: toJson(taskUpdate),
                    runSummary: toJson(runSummary),
                }, `已关闭运行 ${runId} 的浏览器会话。`);
            },
        },
        {
            name: 'apply.list_open_runs',
            description: '列出当前还开着页面的运行。只读。',
            mutating: false,
            inputSchema: { type: 'object', properties: {} },
            handler(input) {
                const open = input.sessions.list();
                const dead = open.filter((run) => !run.pageAlive);
                return ok({ openRuns: toJson(open) }, dead.length === 0
                    ? `当前有 ${open.length} 个运行开着。`
                    : `当前有 ${open.length} 个运行，其中 ${dead.length} 个页面已经没了，建议 close_run。`);
            },
        },
    ];
}
//# sourceMappingURL=register-mcp-tools.js.map