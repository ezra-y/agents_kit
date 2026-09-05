/**
 * 只有结构化方法失败时才调用平台 CU，并限制在局部区域。
 *
 * 规则文档：`docs/06_函数接口与执行循环.md §3.15`、`docs/07 §13`、`docs/13 D15`
 *
 * 五条硬规则：
 * 1. 请求必须由 `buildVisualFallbackRequest()` 生成（已经带了结构化失败证据）。
 * 2. CU 只能在 `request.region` 内动手。
 * 3. CU 只能用 `allowedActions` 里的动作，越界的动作被丢弃并记录。
 * 4. **CU 声称成功不算成功**，每次都用结构化方式验证。
 * 5. **连续两次失败就停**，保存调试包并请求人工接管。
 *
 * 共享核心不认识任何平台的 CU 工具。执行器由适配层注入。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isInsideLocalRoot, toRepoRelative } from "../../config/paths.js";
function visualError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
/** 动作必须在允许清单里，且坐标必须落在局部区域内。 */
export function assertActionAllowed(request, action) {
    if (!request.allowedActions.includes(action.type)) {
        return `动作 ${action.type} 不在允许清单里`;
    }
    const box = request.region.boundingBox;
    if (box === undefined) {
        return undefined;
    }
    if (action.x === undefined || action.y === undefined) {
        return undefined;
    }
    // 坐标是区域内的相对坐标，所以只要落在 0..width / 0..height 就合法。
    if (action.x < 0 || action.y < 0 || action.x > box.width || action.y > box.height) {
        return `动作坐标 (${action.x}, ${action.y}) 超出局部区域 ${box.width}×${box.height}`;
    }
    return undefined;
}
export async function visualFallback(input) {
    const { request } = input;
    if (input.executor === undefined) {
        // 没有适配层就老实说没有，不假装做了。
        return {
            outcome: 'human_required',
            attempts: 0,
            trials: [],
            verified: false,
            requiresHuman: humanTakeover(request, '当前环境没有可用的 Computer Use 执行器，需要人工处理这个控件。'),
        };
    }
    const trials = [];
    let outcome = 'failed';
    for (let attempt = 1; attempt <= request.maxAttempts; attempt += 1) {
        const executed = await input.executor.execute(request).catch((error) => ({
            claimedSuccess: false,
            actions: [],
            message: error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error),
        }));
        // 越界动作直接判失败。宁可失败，也不让 CU 在区域外乱点。
        const violation = executed.actions
            .map((action) => assertActionAllowed(request, action))
            .find((reason) => reason !== undefined);
        if (violation !== undefined) {
            trials.push({ attempt, claimedSuccess: executed.claimedSuccess, verified: false, reason: violation });
            outcome = 'not_actionable';
            continue;
        }
        // CU 说成功不算数，读回真实状态。
        const verification = await input.verify();
        trials.push({
            attempt,
            claimedSuccess: executed.claimedSuccess,
            verified: verification.verified,
            ...(verification.reason === undefined ? {} : { reason: verification.reason }),
        });
        if (verification.verified) {
            return { outcome: 'success', attempts: attempt, trials, verified: true };
        }
        outcome = 'failed';
    }
    // 连续失败到上限：停止盲点，保存调试包，请人接手。
    const debugBundlePath = writeDebugBundle(input, trials);
    return {
        outcome,
        attempts: request.maxAttempts,
        trials,
        verified: false,
        requiresHuman: humanTakeover(request, `局部视觉操作连续 ${request.maxAttempts} 次未通过结构化验证，已停止尝试。`),
        ...(debugBundlePath === undefined ? {} : { debugBundlePath }),
    };
}
function humanTakeover(request, message) {
    return {
        runId: request.runId,
        reason: 'tool_failure',
        message: `${message}\n目标：${request.goal}`,
        resumeCondition: '用户手动处理这个控件后，重新运行当前页面的校验。',
        currentUrl: '',
    };
}
/**
 * 保存局部调试包（`docs/07 §13.5`）。
 *
 * 只写脱敏后的动作结果和失败原因，不写截图内容本身。
 * 原始截图已经在 `.local/runs/` 里，这里只记录索引。
 */
function writeDebugBundle(input, trials) {
    if (input.paths === undefined) {
        return undefined;
    }
    const dir = path.join(input.paths.runsDir, input.runId, 'visual-fallback');
    if (!isInsideLocalRoot(input.paths, dir)) {
        throw visualError('visual_screenshot_outside_local', `${dir} 不在 ${input.paths.localRoot} 内`);
    }
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${input.request.region.ref.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
    writeFileSync(file, `${JSON.stringify({
        version: 1,
        capturedAt: input.now ?? new Date().toISOString(),
        goal: input.request.goal,
        reason: input.request.reason,
        region: input.request.region,
        screenshotPathRedacted: input.request.screenshotPathRedacted,
        allowedActions: input.request.allowedActions,
        forbiddenActions: input.request.forbiddenActions,
        trials,
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return toRepoRelative(input.paths, file);
}
//# sourceMappingURL=visual-fallback.js.map