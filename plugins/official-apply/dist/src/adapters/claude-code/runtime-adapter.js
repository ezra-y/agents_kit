/**
 * 处理 Claude Code 的能力发现、权限提示和 CU 调用差异。
 *
 * 规则文档：`docs/09_Codex与ClaudeCode共用实现.md §9`
 *
 * 只负责：
 * 1. 检查 applyctl 或 MCP 是否可用。
 * 2. 连接可用 Chrome 或持久 profile。
 * 3. 站点权限和用户接管的文案。
 * 4. 共享视觉兜底失败后，把请求转成 Claude computer-use 调用。
 *
 * 同样不复制业务逻辑，也**不导入任何数据库模块**。
 */
import { createClaudeVisualFallbackExecutor } from "./visual-fallback-adapter.js";
import { detectEntrypointByCli } from "../shared/detect-entrypoint.js";
export function adaptClaudeRuntime(request) {
    const tool = request.computerUseTool;
    return {
        platform: 'claude_code',
        detectEntrypoint: request.probeEntrypoint ?? (() => detectEntrypointByCli(request.paths)),
        /**
         * Claude Code 跑在用户自己的机器上，可以接管已经开着的浏览器，
         * 这样登录态是现成的。接不上再退回持久 profile。
         *
         * Chrome 和 Edge 都支持，走的是同一套 CDP，共用同一份实现。
         *
         * 注意：Chrome 136 之后默认 profile 不再允许远程调试，
         * 必须用一个专门的 `--user-data-dir` 启动才连得上。Edge 同理。
         */
        browserModePreference() {
            return ['attach_existing', 'persistent', 'isolated_test'];
        },
        sitePermissionPrompt(host) {
            return [
                `这一步需要在 ${host} 上操作。`,
                '如果 Claude Code 提示站点权限，请允许这个域名后再继续。',
            ].join('\n');
        },
        submitConfirmationPrompt(input) {
            const what = [input.companyName, input.jobTitle].filter((x) => x !== undefined).join(' · ');
            return [
                `即将提交${what === '' ? '这份申请' : `：${what}`}。`,
                '提交之后不可撤销，系统也不会自动重试。',
                '确认无误请回复「确认提交」。',
            ].join('\n');
        },
        visualExecutor() {
            return tool === undefined ? undefined : createClaudeVisualFallbackExecutor(tool);
        },
        limitations() {
            return [
                '接管已有浏览器（Chrome 或 Edge）需要用户先用独立 user-data-dir 打开调试端口。',
                'CU 只能用于局部视觉兜底，不能用来通读整页。',
            ];
        },
    };
}
//# sourceMappingURL=runtime-adapter.js.map