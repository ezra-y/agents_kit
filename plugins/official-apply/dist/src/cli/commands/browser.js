import { migrateBrowserLoginState } from "../../browser/session/migrate-login-state.js";
import { ok, readList, readString, usageError } from "./shared.js";
export const browserCommands = [
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
];
//# sourceMappingURL=browser.js.map