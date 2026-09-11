import { migrateBrowserLoginState } from "../../browser/session/migrate-login-state.js";
import { inventoryLoginStateAsync } from "../../browser/session/inventory-login-state.js";
import { reuseLoginStateFromAttachedBrowser, reuseLoginStateFromOpenCliBridge, } from "../../browser/session/reuse-login-state.js";
import { ok, readList, readString, usageError } from "./shared.js";
export const browserCommands = [
    {
        name: 'browser login-inventory',
        summary: '只读盘点系统浏览器和项目 profile 的登录态元数据，不读取凭据值。',
        usage: 'applyctl browser login-inventory [--domains <host,...>] [--json]',
        valueOptions: ['domains'],
        async handler(context) {
            const domains = readList(context.args.options, 'domains');
            const entries = await inventoryLoginStateAsync(context.paths, domains ?? []);
            return ok({ entries, ...(domains === undefined ? {} : { requestedDomains: domains }) }, `已盘点 ${entries.length} 个浏览器配置；有状态文件只代表未验证，不能直接当成已登录。`);
        },
    },
    {
        name: 'browser login-state',
        summary: '只迁移指定域名的 Chrome 或 Edge Cookie 到项目隔离 profile。',
        usage: 'applyctl browser login-state --from <chrome|msedge> --to <profile> ' +
            '--domains <a.com,b.com> [--source-profile Default] [--json]',
        requiredOptions: ['from', 'to', 'domains'],
        valueOptions: ['from', 'to', 'domains', 'source-profile'],
        async handler(context) {
            const sourceBrowser = readString(context.args.options, 'from');
            const targetProfileName = readString(context.args.options, 'to');
            const domains = readList(context.args.options, 'domains');
            const sourceProfileName = readString(context.args.options, 'source-profile');
            if ((sourceBrowser !== 'chrome' && sourceBrowser !== 'msedge') ||
                targetProfileName === undefined ||
                domains === undefined) {
                return usageError('--from 只支持 chrome 或 msedge；同时必须提供 --to 和 --domains。');
            }
            const result = await migrateBrowserLoginState({
                paths: context.paths,
                sourceBrowser,
                targetProfileName,
                domains,
                ...(sourceProfileName === undefined ? {} : { sourceProfileName }),
                now: context.now,
            });
            return ok(result, `已迁移 ${result.cookieCount} 条 Cookie 到项目 profile ${result.targetProfileName}。` +
                `打开时使用 channel=${result.recommendedChannel}。`);
        },
    },
    {
        name: 'browser login-reuse',
        summary: '从用户明确提供的活 browser CDP 或 Browser Bridge 会话导出指定域名登录态，并重新检查隔离 profile。',
        usage: 'applyctl browser login-reuse --to <profile> ' +
            '--url <https-url> --domains <a.com,b.com> [--login-marker <text>] ' +
            '[--cdp-endpoint <url> --from chrome|msedge] ' +
            '[--from bridge --bridge-session <name> --bridge-context <id> --channel <chrome|msedge|chromium>] [--json]',
        requiredOptions: ['to', 'url', 'domains'],
        valueOptions: [
            'cdp-endpoint', 'to', 'url', 'login-marker', 'domains', 'from',
            'bridge-session', 'bridge-context', 'channel',
        ],
        async handler(context) {
            const cdpEndpoint = readString(context.args.options, 'cdp-endpoint');
            const targetProfileName = readString(context.args.options, 'to');
            const targetUrl = readString(context.args.options, 'url');
            const loginMarker = readString(context.args.options, 'login-marker');
            const domains = readList(context.args.options, 'domains');
            const source = readString(context.args.options, 'from') ??
                (readString(context.args.options, 'bridge-session') === undefined ? 'chrome' : 'bridge');
            const bridgeSession = readString(context.args.options, 'bridge-session');
            const bridgeContextId = readString(context.args.options, 'bridge-context');
            const targetChannel = readString(context.args.options, 'channel') ?? 'msedge';
            if (targetProfileName === undefined || targetUrl === undefined ||
                domains === undefined ||
                (targetChannel !== 'chrome' && targetChannel !== 'msedge' && targetChannel !== 'chromium')) {
                return usageError('--channel 只支持 chrome、msedge 或 chromium；同时必须提供 --to、--url 和 --domains。');
            }
            if (source === 'bridge') {
                if (bridgeSession === undefined || bridgeContextId === undefined || cdpEndpoint !== undefined) {
                    return usageError('--from bridge 需要 --bridge-session 和 --bridge-context，不能同时提供 --cdp-endpoint。');
                }
                const result = await reuseLoginStateFromOpenCliBridge({
                    paths: context.paths,
                    targetProfileName,
                    targetUrl,
                    loginMarker,
                    domains,
                    bridgeSession,
                    bridgeContextId,
                    targetChannel,
                });
                return ok(result, `已保存 ${result.domains.length} 个域名的状态；源登录${result.sourceLoginVerified ? '已确认' : '待确认'}，恢复后登录${result.targetLoginVerified ? '已确认' : '待确认'}。`);
            }
            if ((source !== 'chrome' && source !== 'msedge') || cdpEndpoint === undefined) {
                return usageError('--from 只支持 chrome、msedge 或 bridge；CDP 来源必须提供 --cdp-endpoint。');
            }
            const result = await reuseLoginStateFromAttachedBrowser({
                paths: context.paths,
                cdpEndpoint,
                targetProfileName,
                targetUrl,
                loginMarker,
                domains,
                sourceChannel: source,
                targetChannel,
            });
            return ok(result, `已验证源 browser 和目标 profile 的登录标记，迁移 ${result.domains.length} 个域名。`);
        },
    },
];
//# sourceMappingURL=browser.js.map