/**
 * 处理保存、下一步、上一步和进入确认页。
 *
 * 规则文档：`docs/06_函数接口与执行循环.md §3.13`、`docs/10 §3`
 *
 * **最硬的一条规则：`advancePage()` 不得点击最终提交。**
 *
 * 即使调用方传错了参数，只要目标动作被标成 `commitAction`，
 * 这里也必须拒绝。提交是阶段 12 的独立函数，走独立的幂等保护。
 *
 * 点击之后必须验证预期变化（`docs/01` 阶段 J）：
 * URL、步骤或锚点真的变了才算推进成功；被必填错误拦住就如实报回去。
 */
import { randomUUID } from 'node:crypto';
import { findActionTarget } from "../browser/locators/find-action-target.js";
import { waitForExpectedPageChange, readCurrentStep, readVisibleErrors, } from "../browser/actions/wait-for-expected-page-change.js";
import { inspectPage } from "../browser/scan/inspect-page.js";
import { openRuntimeDatabase } from "../storage/open-runtime-database.js";
import { setSessionPage, watchForOwnedPopup, } from "../browser/session/browser-session-lifecycle.js";
const DEFAULT_TIMEOUT_MS = 10_000;
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
function failure(request, errorCode, errorMessage) {
    return {
        actionPlanItemId: `advance_${request.actionKind}`,
        kind: 'click',
        outcome: 'failed',
        locatorAttemptIds: [],
        pageChanged: false,
        errorCode,
        errorMessage,
    };
}
/** 找出这一页对应的动作按钮。绝不返回被标成最终提交的那个。 */
export function pickAdvanceAction(request) {
    const wanted = request.actionKind;
    const candidates = request.pageSchema.actions.filter((action) => action.kind === wanted);
    const commit = candidates.find((action) => action.commitAction);
    if (commit !== undefined) {
        return { refusedCommit: true };
    }
    const enabled = candidates.filter((action) => !action.disabled);
    const jobDetailStart = wanted === 'start_application' &&
        /\/job\//.test(request.pageSchema.url);
    const usable = jobDetailStart ? enabled.at(-1) : enabled[0];
    return { ...(usable === undefined ? {} : { action: usable }), refusedCommit: false };
}
export async function advancePage(session, page, request) {
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const now = request.now ?? new Date().toISOString();
    const newId = request.idFactory ?? defaultIdFactory;
    // 从点动作之前开始计时：定位、点击、等待与重扫的总耗时都要落在检查点上。
    const startedAt = performance.now();
    const elapsedMs = () => Math.max(0, Math.round(performance.now() - startedAt));
    const { action, refusedCommit } = pickAdvanceAction(request);
    if (refusedCommit) {
        return {
            result: failure(request, 'advance_commit_action_refused', 'advancePage() 不允许点击最终提交；提交请走 submitApplication()'),
            blockedByErrors: [],
            changed: { changed: false, observed: [], waitedMs: 0 },
        };
    }
    if (action === undefined) {
        return {
            result: failure(request, 'advance_action_not_found', `页面上没有可用的「${request.actionKind}」动作`),
            blockedByErrors: [],
            changed: { changed: false, observed: [], waitedMs: 0 },
        };
    }
    const frame = page.mainFrame();
    const found = await findActionTarget(frame, action.locatorCandidates, {
        runId: request.runId,
        actionKind: 'click',
        timeoutMs,
    });
    if (found.target === undefined) {
        return {
            result: failure(request, 'advance_action_not_found', `找不到「${action.label}」按钮`),
            blockedByErrors: [],
            changed: { changed: false, observed: [], waitedMs: 0 },
        };
    }
    // 点击前先记住 URL 和当前步骤，才能验证「真的变了」。
    const urlBefore = page.url();
    const stepBefore = await readCurrentStep(page);
    const expected = [
        { kind: 'url_changed', before: urlBefore },
        ...(stepBefore === '' ? [] : [{ kind: 'step_changed', before: stepBefore }]),
    ];
    // 点击前先记下已有错误。不这样做，新弹出的必填错误会被当成「本来就有」。
    const errorsBefore = await readVisibleErrors(page);
    const popupWatcher = watchForOwnedPopup(page);
    const changeAbort = new AbortController();
    const changedPromise = waitForExpectedPageChange(page, {
        expected,
        timeoutMs,
        knownErrors: errorsBefore,
        signal: changeAbort.signal,
    });
    try {
        await found.target.locator.click({ timeout: timeoutMs });
    }
    catch (error) {
        popupWatcher.cancel();
        changeAbort.abort();
        await Promise.allSettled([popupWatcher.promise, changedPromise]);
        return {
            result: failure(request, 'advance_action_not_found', error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error)),
            blockedByErrors: [],
            changed: { changed: false, observed: [], waitedMs: 0 },
        };
    }
    const outcome = await Promise.race([
        popupWatcher.promise.then((popup) => ({ kind: 'popup', popup })),
        changedPromise.then((changed) => ({ kind: 'changed', changed })),
    ]);
    popupWatcher.cancel();
    changeAbort.abort();
    await Promise.allSettled([popupWatcher.promise, changedPromise]);
    if (outcome.kind === 'popup' && outcome.popup !== undefined) {
        await outcome.popup
            .waitForLoadState('domcontentloaded', { timeout: timeoutMs })
            .catch(() => undefined);
        setSessionPage(session, outcome.popup);
        const inspection = await inspectPage(session, outcome.popup, {
            runId: request.runId,
            persist: false,
            now,
        });
        const result = {
            actionPlanItemId: newId('advance'),
            kind: 'click',
            outcome: 'success',
            locatorAttemptIds: found.attempts.map((attempt) => attempt.id),
            pageChanged: true,
            newSnapshotId: inspection.schema.snapshotId,
        };
        recordCheckpoint(request, result, elapsedMs(), now, newId);
        return {
            result,
            newPageSchema: inspection.schema,
            blockedByErrors: inspection.schema.errors,
            changed: {
                changed: true,
                observed: [{ kind: 'url_changed', before: urlBefore }],
                waitedMs: 0,
            },
        };
    }
    const changed = outcome.kind === 'changed'
        ? outcome.changed
        : {
            changed: false,
            observed: [],
            waitedMs: 0,
        };
    // 被错误拦住：不算推进成功，把错误如实返回。
    if (!changed.changed) {
        const inspection = await inspectPage(session, page, {
            runId: request.runId,
            persist: false,
            now,
        });
        // 站点校验错误拦住：如实归 rejected。真正超时没变化：归 timeout，
        // 不再把两种混成一码，避免把校验阻断误统计成超时。
        const outcome = changed.blockedByError === undefined ? 'timeout' : 'rejected_by_site';
        const errorCode = changed.blockedByError === undefined ? 'advance_change_timeout' : 'advance_blocked_by_error';
        const result = {
            actionPlanItemId: newId('advance'),
            kind: 'click',
            outcome,
            locatorAttemptIds: found.attempts.map((attempt) => attempt.id),
            pageChanged: false,
            errorCode,
            errorMessage: changed.blockedByError ?? '点击后没有观察到预期变化（超时）',
        };
        recordCheckpoint(request, result, elapsedMs(), now, newId);
        return {
            result,
            blockedByErrors: inspection.schema.errors,
            changed,
            newPageSchema: inspection.schema,
        };
    }
    // 推进成功：重扫一次，把新页面交回上层。
    const inspection = await inspectPage(session, page, {
        runId: request.runId,
        persist: false,
        now,
    });
    const result = {
        actionPlanItemId: newId('advance'),
        kind: 'click',
        outcome: 'success',
        locatorAttemptIds: found.attempts.map((attempt) => attempt.id),
        pageChanged: true,
        newSnapshotId: inspection.schema.snapshotId,
    };
    recordCheckpoint(request, result, elapsedMs(), now, newId);
    return {
        result,
        newPageSchema: inspection.schema,
        blockedByErrors: inspection.schema.errors,
        changed,
    };
}
/**
 * 每次推进都写恢复点（`docs/10 §7`）。
 *
 * 失败后能从最近检查点继续，而不是从头重填全部页面。
 */
function recordCheckpoint(request, result, durationMs, now, newId) {
    if (request.paths === undefined) {
        return;
    }
    let runtime;
    try {
        runtime = openRuntimeDatabase({ paths: request.paths });
    }
    catch (error) {
        if (error instanceof Error && error.message.startsWith('database_not_migrated')) {
            return;
        }
        throw error;
    }
    try {
        const runExists = runtime.db
            .prepare('SELECT 1 FROM application_runs WHERE id = ?')
            .get(request.runId);
        if (runExists === undefined) {
            return;
        }
        runtime.db
            .prepare(`INSERT INTO action_attempts
           (id, run_id, action_kind, outcome, duration_ms, page_changed,
            error_code, error_message_redacted, created_at)
         VALUES (?, ?, 'click', ?, ?, ?, ?, ?, ?)`)
            .run(newId('advance_attempt'), request.runId, result.outcome, durationMs, result.pageChanged ? 1 : 0, result.errorCode ?? null, result.errorMessage ?? null, now);
        runtime.db
            .prepare('UPDATE application_runs SET updated_at = ? WHERE id = ?')
            .run(now, request.runId);
    }
    finally {
        runtime.close();
    }
}
//# sourceMappingURL=advance-page.js.map