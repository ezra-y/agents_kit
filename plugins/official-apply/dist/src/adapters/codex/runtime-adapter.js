/**
 * 处理 Codex 的能力发现、权限提示和 CU 调用差异。
 *
 * 规则文档：`docs/09_Codex与ClaudeCode共用实现.md §8`
 *
 * 只负责：
 * 1. 检查 applyctl 或 MCP 是否可用。
 * 2. 选择浏览器会话模式。
 * 3. 站点权限和最终确认的文案。
 * 4. 共享视觉兜底失败后，把请求转成 Codex CU 调用。
 *
 * 不负责：自己重新扫描字段、维护另一套 field catalog、决定答案 scope、
 * 在正常输入框上循环截图。
 *
 * 这个文件**不导入任何数据库模块**（`docs/12 阶段14 验收`）。
 * 合同测试会检查这一点。
 */
import { createCodexVisualFallbackExecutor } from "./visual-fallback-adapter.js";
import { detectEntrypointByCli } from "../shared/detect-entrypoint.js";
export function adaptCodexRuntime(request) {
    const tool = request.computerUseTool;
    return {
        platform: 'codex',
        detectEntrypoint: request.probeEntrypoint ?? (() => detectEntrypointByCli(request.paths)),
        /**
         * Codex 也能接管用户已经开着的浏览器，所以顺序和 Claude Code 一样：
         * 先试接管（登录态现成），接不上再退回 Skill 自己的持久 profile。
         *
         * 本地 `isolated_test` 已在真实 Codex 宿主通过。
         * `attach_existing` 真机多标签仍待验证。
         */
        browserModePreference() {
            return ['attach_existing', 'persistent', 'isolated_test'];
        },
        sitePermissionPrompt(host) {
            return [
                `Codex 需要访问 ${host} 才能继续这次投递。`,
                '请在 Codex 的站点权限里允许这个域名，然后重新运行当前步骤。',
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
            return tool === undefined ? undefined : createCodexVisualFallbackExecutor(tool);
        },
        limitations() {
            return [
                '接管已有浏览器需要用户先用独立 user-data-dir 打开调试端口。',
                'CU 只能用于局部视觉兜底，不能用来通读整页。',
                '待验证：真实 Codex CU 动作和 attach_existing 真机多标签尚未执行。',
            ];
        },
    };
}
//# sourceMappingURL=runtime-adapter.js.map