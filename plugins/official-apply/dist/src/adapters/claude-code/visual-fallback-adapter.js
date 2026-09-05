export function toClaudePayload(request) {
    const box = request.region.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 };
    return {
        region: { x: box.x, y: box.y, width: box.width, height: box.height },
        // 目标和禁止事项写成一段人话，CU 更容易照做。
        instruction: [
            request.goal,
            '只允许在给定区域内操作。',
            `禁止：${request.forbiddenActions.join('；')}。`,
        ].join('\n'),
        constraints: {
            allowedActions: request.allowedActions,
            forbidden: request.forbiddenActions,
        },
        screenshotPath: request.screenshotPathRedacted,
        successCriteria: request.successChecks.map((check) => check.target === undefined ? check.kind : `${check.kind}:${check.target}`),
    };
}
export function createClaudeVisualFallbackExecutor(tool) {
    return {
        platform: 'claude-code',
        async execute(request) {
            if (tool === undefined) {
                return {
                    claimedSuccess: false,
                    actions: [],
                    message: 'Claude Code CU 工具在当前环境不可用',
                };
            }
            const result = await tool.invoke(toClaudePayload(request));
            return {
                claimedSuccess: result.ok,
                actions: result.actions ?? [],
                ...(result.message === undefined ? {} : { message: result.message }),
            };
        },
    };
}
/** 兼容 `docs/12` 阶段 11 函数表里的名字。 */
export async function executeClaudeVisualFallback(request, tool) {
    return createClaudeVisualFallbackExecutor(tool).execute(request);
}
//# sourceMappingURL=visual-fallback-adapter.js.map