export function toCodexPayload(request) {
    const box = request.region.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 };
    return {
        region: { x: box.x, y: box.y, width: box.width, height: box.height },
        goal: request.goal,
        forbidden: request.forbiddenActions,
        allowed: request.allowedActions,
        screenshot: request.screenshotPathRedacted,
        expected: request.successChecks.map((check) => check.target === undefined ? check.kind : `${check.kind}:${check.target}`),
    };
}
export function createCodexVisualFallbackExecutor(tool) {
    return {
        platform: 'codex',
        async execute(request) {
            if (tool === undefined) {
                // 工具不可用就说不可用，不假装支持（`docs/12` 阶段 1 禁区）。
                return { claimedSuccess: false, actions: [], message: 'Codex CU 工具在当前环境不可用' };
            }
            const result = await tool.invoke(toCodexPayload(request));
            return {
                claimedSuccess: result.ok,
                actions: result.actions ?? [],
                ...(result.message === undefined ? {} : { message: result.message }),
            };
        },
    };
}
/** 兼容 `docs/12` 阶段 11 函数表里的名字。 */
export async function executeCodexVisualFallback(request, tool) {
    return createCodexVisualFallbackExecutor(tool).execute(request);
}
//# sourceMappingURL=visual-fallback-adapter.js.map