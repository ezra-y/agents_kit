/**
 * 用共享核心创建本地 MCP 服务。
 *
 * 规则文档：`docs/09_Codex与ClaudeCode共用实现.md §5.2`、`docs/06 §8`
 *
 * 服务只做三件事：
 * 1. 列工具。
 * 2. 调工具，并把浏览器会话在多次调用之间保持住。
 * 3. 说 JSON-RPC 2.0。
 *
 * **不创建第二套数据库，也不创建第二套浏览器逻辑**（`docs/12 阶段14 数据读写`）。
 * 每个工具都转发给共享核心，和 CLI 调的是同一批函数。
 *
 * 关于依赖：MCP 的传输层就是 JSON-RPC 2.0，这里直接实现，不引入 SDK。
 * 这个项目刻意保持依赖极少（同样的理由，SQLite 用的是 `node:sqlite`）。
 */
import { registerMcpTools } from "./register-mcp-tools.js";
import { closeBrowserSession } from "../browser/session/close-browser-session.js";
import { findStaleBrowserSessions, writeBrowserSessionStatus, } from "../browser/session/browser-session-lifecycle.js";
import { describeToolInputProblems, validateToolInput } from "./validate-tool-input.js";
/**
 * 支持的协议版本，新的在前。
 *
 * 协商的意义是：客户端说它要哪一版，我们支持就照它的来。
 * 回一个写死的版本等于永远不承认对方——将来客户端升级，
 * 我们连「我不支持」都表达不出来。
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];
/** JSON-RPC 2.0 标准错误码。 */
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INVALID_PARAMS = -32602;
const RPC_INTERNAL_ERROR = -32603;
/**
 * 会话登记表。
 *
 * MCP 是多次调用的：`open_task` 开页面，`fill_page` 要用同一个页面。
 * 所以会话必须活在服务里。放进工具里就会每调一次开一个浏览器。
 */
export function createSessionRegistry(clock = () => new Date().toISOString()) {
    const sessions = new Map();
    const closeOne = async (run) => {
        // 先停网络监听，再关会话。留着监听会一直往内存里攒记录。
        const observer = run.networkObserver;
        try {
            observer?.stop?.();
        }
        catch {
            // 停不掉也不该拦住关会话。
        }
        const session = run.session;
        const errors = [];
        try {
            // 只断开或关闭会话，绝不删除用户的浏览器 profile。
            await closeBrowserSession(session);
        }
        catch (error) {
            errors.push(new Error(`浏览器关闭失败：${describeError(error)}`, { cause: error }));
        }
        if (errors.length > 0) {
            throw errors.length === 1
                ? errors[0]
                : new AggregateError(errors, `运行 ${run.runId} 清理失败：${errors.map((error) => error.message).join('；')}`);
        }
    };
    /** 页面还活着吗。Playwright 的 Page 有 isClosed()，但这里只拿到 unknown。 */
    const pageAlive = (run) => {
        const page = run.page;
        if (page === undefined) {
            return false;
        }
        try {
            return typeof page.isClosed === 'function' ? !page.isClosed() : true;
        }
        catch {
            return false;
        }
    };
    const currentUrl = (run) => {
        const page = run.page;
        try {
            const raw = typeof page?.url === 'function' ? page.url() : undefined;
            if (raw === undefined) {
                return undefined;
            }
            // 只留 origin + pathname，query 里可能有私有参数。
            const url = new URL(raw);
            return `${url.origin}${url.pathname}`;
        }
        catch {
            return undefined;
        }
    };
    return {
        get(runId) {
            const run = sessions.get(runId);
            if (run !== undefined) {
                const currentPage = run.session.page;
                if (currentPage !== undefined && !currentPage.isClosed()) {
                    run.page = currentPage;
                }
                // 被用到就刷新一次时间，空闲回收才不会误伤正在用的会话。
                run.lastUsedAt = clock();
            }
            return run;
        },
        set: (runId, run) => {
            const at = clock();
            sessions.set(runId, { openedAt: at, lastUsedAt: at, ...run });
        },
        async delete(runId) {
            const run = sessions.get(runId);
            if (run !== undefined) {
                // 只有真正关成功才从登记表移除，失败保留，当前进程还能重试。
                await closeOne(run);
                sessions.delete(runId);
            }
        },
        async closeAll() {
            const errors = [];
            for (const [runId, run] of [...sessions.entries()]) {
                try {
                    await closeOne(run);
                    sessions.delete(runId);
                }
                catch (error) {
                    // 关失败的保留在登记表，聚合报错，当前进程还能重试。
                    errors.push(error);
                }
            }
            if (errors.length > 0) {
                throw new AggregateError(errors, `关闭全部 MCP 浏览器会话失败：${errors.map(describeError).join('；')}`);
            }
        },
        list() {
            return [...sessions.values()].map((run) => ({
                runId: run.runId,
                taskId: run.taskId,
                siteHost: run.siteHost,
                ...(run.openedAt === undefined ? {} : { openedAt: run.openedAt }),
                ...(run.lastUsedAt === undefined ? {} : { lastUsedAt: run.lastUsedAt }),
                pageAlive: pageAlive(run),
                ...(currentUrl(run) === undefined ? {} : { currentUrlRedacted: currentUrl(run) }),
            }));
        },
        async reapIdle(idleMs, now) {
            const cutoff = Date.parse(now ?? clock()) - idleMs;
            const reaped = [];
            const errors = [];
            for (const [runId, run] of [...sessions.entries()]) {
                const last = Date.parse(run.lastUsedAt ?? run.openedAt ?? '');
                // 页面已经死了的会话也一并回收，留着只会占资源。
                const idle = Number.isFinite(last) && last <= cutoff;
                if (idle || !pageAlive(run)) {
                    try {
                        await closeOne(run);
                        sessions.delete(runId);
                        reaped.push(runId);
                    }
                    catch (error) {
                        // 关失败的保留在登记表，不计入 reaped，聚合报错，当前进程还能重试。
                        errors.push(error);
                    }
                }
            }
            if (errors.length > 0) {
                throw new AggregateError(errors, `回收空闲 MCP 浏览器会话失败：${errors.map(describeError).join('；')}`);
            }
            return reaped;
        },
    };
}
function describeError(error) {
    if (error instanceof Error) {
        return error.message.split('\n')[0] ?? error.message;
    }
    return String(error);
}
export function createMcpServer(request) {
    const tools = request.tools ?? registerMcpTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const clock = request.now ?? (() => new Date().toISOString());
    const now = clock();
    const staleSessions = findStaleBrowserSessions(request.paths);
    const staleErrors = [];
    for (const { sessionId } of staleSessions) {
        try {
            writeBrowserSessionStatus(request.paths, sessionId, 'disconnected', now, 'MCP 进程重建后没有真实页面');
        }
        catch (error) {
            staleErrors.push(new Error(`旧会话 ${sessionId} 清理失败：${describeError(error)}`, { cause: error }));
        }
    }
    if (staleErrors.length > 0) {
        throw new AggregateError(staleErrors, `MCP 启动时清理旧会话失败：${staleErrors.map(describeError).join('；')}`);
    }
    const sessions = createSessionRegistry(clock);
    const listTools = () => tools.map(({ handler: _handler, ...rest }) => rest);
    const callTool = async (name, args) => {
        const tool = byName.get(name);
        if (tool === undefined) {
            return {
                ok: false,
                data: { availableTools: tools.map((item) => item.name) },
                errorCode: 'mcp_unknown_tool',
                message: `没有这个工具：${name}`,
            };
        }
        // 参数在进入 handler 之前按 schema 校验一遍，错误信息统一。
        //
        // 以前只查必填。类型给错的时候（runtimeRef 传成数字），
        // handler 里的 readString() 返回 undefined，报出来却是「缺少 runtimeRef」——
        // 明明给了，只是给错了类型。调用方照着这句话去补一个已经存在的参数，
        // 来回好几轮都对不上。
        const problems = validateToolInput(tool, args);
        if (problems.length > 0) {
            return {
                ok: false,
                data: {
                    problems: problems,
                    required: tool.inputSchema.required ?? [],
                },
                errorCode: problems.every((problem) => problem.reason === '必填，但没给')
                    ? 'mcp_missing_argument'
                    : 'mcp_invalid_argument',
                message: describeToolInputProblems(name, problems),
            };
        }
        try {
            return await tool.handler({ paths: request.paths, args, sessions, now: clock() });
        }
        catch (error) {
            // 工具抛错不能把整个服务带下去。
            return {
                ok: false,
                data: { tool: name },
                errorCode: 'mcp_tool_failed',
                message: describeError(error),
            };
        }
    };
    /**
     * 被取消掉的请求 id。
     *
     * 客户端发 `notifications/cancelled` 之后就不再等这个 id 的回复了。
     * 这时候还把结果写回去，对面会当成一条没人要的消息——轻则日志报警，
     * 重则解析器状态错乱。所以记下来，做完之后把回复丢掉。
     */
    const cancelled = new Set();
    const handleJsonRpc = async (message) => {
        // 通知没有 id，按协议不回复。但有的通知要处理。
        if (message.id === undefined) {
            if (message.method === 'notifications/cancelled') {
                const requestId = message.params?.['requestId'];
                if (typeof requestId === 'string' || typeof requestId === 'number') {
                    cancelled.add(String(requestId));
                }
            }
            return undefined;
        }
        const id = message.id;
        const reply = (result) => ({ jsonrpc: '2.0', id, result });
        const rpcError = (code, msg, data) => ({
            jsonrpc: '2.0',
            id,
            // `data` 让调用方拿到能编程处理的细节，不用去解析中文句子。
            error: { code, message: msg, ...(data === undefined ? {} : { data }) },
        });
        switch (message.method) {
            case 'initialize': {
                // 真的协商，不是回一个写死的版本。
                //
                // 客户端要的版本我们支持就照它的来；不支持就回我们最新的，
                // 由它决定继续还是断开（这是 MCP 规定的做法）。
                // 一直回死值的话，将来客户端升级了，我们连「我不支持」都表达不出来。
                const wanted = message.params?.['protocolVersion'];
                const agreed = typeof wanted === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(wanted)
                    ? wanted
                    : LATEST_PROTOCOL_VERSION;
                return reply({
                    protocolVersion: agreed,
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: { name: 'official-apply', version: '0.1.0' },
                });
            }
            // 健康检查。对面用它确认服务还活着。
            case 'ping':
                return reply({});
            case 'tools/list':
                // 按 MCP 的约定给出 annotations，客户端才知道哪些工具是只读的。
                //
                // 我们内部用 `mutating` 表达同一件事，但那是自己的字段名，
                // 对面不认识。宿主拿不到 readOnlyHint 时只能把所有工具都当成会改东西，
                // 于是每次调用都要问一遍用户——包括 apply.get_status 这种纯查询。
                return reply({
                    tools: JSON.parse(JSON.stringify(listTools().map((tool) => ({
                        ...tool,
                        annotations: {
                            readOnlyHint: tool.mutating !== true,
                            // apply.submit 是唯一不可撤销的：投出去就收不回来。
                            destructiveHint: tool.name === 'apply.submit',
                        },
                    })))),
                });
            case 'tools/call': {
                const name = message.params?.['name'];
                if (typeof name !== 'string') {
                    return rpcError(RPC_INVALID_PARAMS, 'tools/call 缺少 name。');
                }
                const rawArgs = message.params?.['arguments'];
                const args = rawArgs !== null && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
                    ? rawArgs
                    : {};
                try {
                    const result = await callTool(name, args);
                    // 做的过程中被取消了，就别把结果塞回去——对面已经不等了。
                    if (cancelled.delete(String(id))) {
                        return undefined;
                    }
                    // MCP 约定：工具自身的失败用 isError 表示，不是协议层错误。
                    return reply({
                        content: [{ type: 'text', text: JSON.stringify(result) }],
                        isError: !result.ok,
                    });
                }
                catch (error) {
                    if (cancelled.delete(String(id))) {
                        return undefined;
                    }
                    return rpcError(RPC_INTERNAL_ERROR, describeError(error), { tool: name });
                }
            }
            default:
                return rpcError(RPC_METHOD_NOT_FOUND, `不支持的方法：${message.method}`, {
                    supportedMethods: ['initialize', 'ping', 'tools/list', 'tools/call'],
                });
        }
    };
    return {
        listTools,
        callTool,
        handleJsonRpc,
        reapIdleSessions: (idleMs, now) => sessions.reapIdle(idleMs, now),
        openRuns: () => sessions.list(),
        /**
         * 交出某次运行的页面句柄。
         *
         * 给**同进程内的适配层**用：局部视觉兜底时，平台适配需要把
         * CU 的动作落到这一页上。返回 unknown 是故意的——
         * 共享核心不该在这里依赖 Playwright 的类型。
         *
         * 这不是绕过工具的后门。正常业务一律走 `callTool()`；
         * 拿到页面之后能做的也只有适配层该做的事。
         */
        pageOf: (runId) => sessions.get(runId)?.page,
        async close() {
            await sessions.closeAll();
        },
    };
}
//# sourceMappingURL=create-mcp-server.js.map