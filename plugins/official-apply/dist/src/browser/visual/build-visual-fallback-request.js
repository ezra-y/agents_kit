/** 区域向外留一点边距，避免边框和标签被切掉。 */
const REGION_PADDING = 12;
/** 局部区域的面积上限。超过就说明选错了范围，不是「局部」了。 */
export const MAX_REGION_AREA = 1200 * 700;
/** 默认允许的动作。不含任何会翻页或提交的操作。 */
const DEFAULT_ALLOWED_ACTIONS = ['click', 'type', 'press_key', 'scroll'];
/**
 * 永远禁止 CU 做的事。
 *
 * 最终提交排第一：`docs/12` 阶段 11 明确写「不要允许 CU 点击最终提交」。
 */
export const FORBIDDEN_VISUAL_ACTIONS = [
    '点击最终提交按钮',
    '点击「下一步」或任何翻页动作',
    '关闭或刷新页面',
    '在本区域之外点击',
    '接受任何协议或声明',
    '输入验证码',
];
function visualError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
/** 向外扩一点，并且不越过页面左上角。 */
export function padRegion(box) {
    return {
        x: Math.max(0, Math.round(box.x - REGION_PADDING)),
        y: Math.max(0, Math.round(box.y - REGION_PADDING)),
        width: Math.round(box.width + REGION_PADDING * 2),
        height: Math.round(box.height + REGION_PADDING * 2),
    };
}
export function buildVisualFallbackRequest(input) {
    // 1. 没有结构化失败证据就不许上 CU。
    if (input.evidence.attempts.length === 0) {
        throw visualError('visual_no_structured_evidence', '调用 CU 之前必须先有结构化定位失败的证据');
    }
    if (input.evidence.attempts.every((attempt) => attempt.outcome === 'success')) {
        throw visualError('visual_no_structured_evidence', '结构化定位并没有失败，不应该走视觉兜底');
    }
    // 2. 区域必须是「局部」。
    const region = padRegion(input.regionBox);
    if (region.width * region.height > MAX_REGION_AREA) {
        throw visualError('visual_region_too_large', `区域 ${region.width}×${region.height} 太大，CU 只处理局部；请先用 DOM 缩小范围`);
    }
    // 3. 截图必须在 .local/runs 内。
    if (!input.screenshotPathRedacted.startsWith('.local/runs/')) {
        throw visualError('visual_screenshot_outside_local', `截图路径 ${input.screenshotPathRedacted} 必须在 .local/runs/ 内`);
    }
    const successChecks = input.successChecks ?? [{ kind: 'field_value_changed', target: input.field.runtimeRef }];
    return {
        runId: input.runId,
        goal: input.goal,
        reason: [
            `字段「${input.field.rawLabel || input.field.runtimeRef}」结构化定位失败。`,
            ...input.evidence.attempts.map((attempt) => `- ${attempt.strategy}：${attempt.outcome}${attempt.reason === undefined ? '' : `（${attempt.reason}）`}`),
        ].join('\n'),
        region: {
            ref: `visual:${input.field.runtimeRef}`,
            framePath: input.field.frame.path,
            sectionPath: input.field.sectionPath,
            ...(input.field.role === null || input.field.role === undefined
                ? {}
                : { role: input.field.role }),
            ...(input.field.rawLabel === '' ? {} : { accessibleName: input.field.rawLabel }),
            boundingBox: region,
        },
        screenshotPathRedacted: input.screenshotPathRedacted,
        allowedActions: input.allowedActions ?? DEFAULT_ALLOWED_ACTIONS,
        forbiddenActions: FORBIDDEN_VISUAL_ACTIONS,
        successChecks,
        // 连续两次失败就停（`docs/07 §13.5`）。
        maxAttempts: input.maxAttempts ?? 2,
    };
}
//# sourceMappingURL=build-visual-fallback-request.js.map