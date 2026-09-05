/**
 * 检查 applyctl 或 MCP 是否可用。
 *
 * 规则文档：`docs/09_Codex与ClaudeCode共用实现.md §8.1、§9.1`
 *
 * 两个平台的检查逻辑是一样的（都是看 Skill 里有没有那两个入口文件），
 * 所以放在共享处，避免两边各写一份。
 * 平台差异在别的地方——浏览器模式、权限文案、CU 调用——不在这里。
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
export async function detectEntrypointByCli(paths) {
    const cli = path.join(paths.root, 'bin', 'applyctl.ts');
    if (existsSync(cli)) {
        return { kind: 'cli', detail: `找到 ${cli}，用 applyctl 调用共享核心。` };
    }
    const mcp = path.join(paths.root, 'src', 'mcp', 'create-mcp-server.ts');
    if (existsSync(mcp)) {
        return { kind: 'mcp', detail: '没有 applyctl，但可以起本地 MCP 服务。' };
    }
    return { kind: 'none', detail: 'applyctl 和 MCP 都没找到，这个 Skill 装得不完整。' };
}
//# sourceMappingURL=detect-entrypoint.js.map