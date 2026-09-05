#!/usr/bin/env node
/**
 * 本地 MCP 服务入口：JSON-RPC 2.0 over stdio。
 *
 * 规则文档：`docs/09_Codex与ClaudeCode共用实现.md §5.2`
 *
 * 和 `bin/applyctl.ts` 一样，这个文件只做搬运：
 * 从 stdin 读一行一条的 JSON-RPC，交给 `createMcpServer()`，把回复写回 stdout。
 *
 * 注意：**日志一律走 stderr**。stdout 是协议通道，
 * 混进一行普通文本就会把对面的解析器搞坏。
 *
 * 会话清理有三层（修复清单 P0-3）：
 * 1. 显式：`apply.close_run`。
 * 2. 空闲：超过 `IDLE_TIMEOUT_MS` 没被用到就回收。
 * 3. 退出：进程收到信号或 stdin 关闭时全部关掉。
 *
 * 前两层保证「页面一直开着」不会变成「浏览器越攒越多」。
 */
import { createInterface } from 'node:readline';
import { getSkillPaths } from "../src/config/paths.js";
import { createMcpServer } from "../src/mcp/create-mcp-server.js";
/** 一个会话空闲多久就回收。默认 30 分钟：够你去开个会再回来。 */
const IDLE_TIMEOUT_MS = Number(process.env['OFFICIAL_APPLY_IDLE_TIMEOUT_MS'] ?? 30 * 60 * 1000);
const REAP_INTERVAL_MS = 60 * 1000;
const server = createMcpServer({ paths: getSkillPaths() });
const lines = createInterface({ input: process.stdin });
process.stderr.write('official-apply MCP 已就绪，等待 JSON-RPC 请求。\n');
// 空闲回收。unref() 让它不会拖住进程退出。
const reaper = setInterval(() => {
    void server.reapIdleSessions(IDLE_TIMEOUT_MS).then((reaped) => {
        if (reaped.length > 0) {
            process.stderr.write(`[official-apply] 回收了 ${reaped.length} 个空闲会话：${reaped.join(', ')}\n`);
        }
    }).catch((error) => {
        process.stderr.write(`[official-apply] 空闲会话回收失败：${describeError(error)}\n`);
    });
}, REAP_INTERVAL_MS);
reaper.unref();
/** 进程退出前把浏览器关干净，别留下孤儿进程。 */
let shutdownPromise;
const shutdown = (why) => {
    shutdownPromise ??= (async () => {
        clearInterval(reaper);
        process.stderr.write(`[official-apply] 正在关闭（${why}）……\n`);
        try {
            await server.close();
            return true;
        }
        catch (error) {
            process.stderr.write(`[official-apply] 退出清理失败：${describeError(error)}\n`);
            process.exitCode = 1;
            return false;
        }
    })();
    return shutdownPromise;
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
        void shutdown(signal).then((ok) => process.exit(ok ? 0 : 1));
    });
}
for await (const line of lines) {
    const text = line.trim();
    if (text === '') {
        continue;
    }
    let request;
    try {
        request = JSON.parse(text);
    }
    catch {
        process.stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
        })}\n`);
        continue;
    }
    const response = await server.handleJsonRpc(request);
    if (response !== undefined) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
    }
}
await shutdown('stdin 关闭');
function describeError(error) {
    return error instanceof Error ? (error.message.split('\n')[0] ?? error.name) : String(error);
}
//# sourceMappingURL=applyctl-mcp.js.map