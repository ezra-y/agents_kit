/**
 * 连接共享浏览器会话。
 *
 * 规则文档：
 * - `docs/07_浏览器工具与CU最高效方案.md §3`
 * - `docs/09_Codex与ClaudeCode共用实现.md §7`
 *
 * Codex 和 Claude Code 共用这一个执行层。
 * 平台差异只出现在适配层，不进入这里。
 *
 * 三种模式：
 * - `persistent`：默认稳定路径，登录一次长期保存，profile 在 `.local/browser-profile/`。
 * - `attach_existing`：便利路径，接管用户已经登录好的浏览器。
 * - `isolated_test`：只给测试用，不落 profile。
 *
 * 支持 Chrome 和 Edge。两者都是 Chromium 内核，Playwright 用同一套 API 驱动，
 * 差别只有一个 `channel` 参数，所以**不需要两套代码**。
 * `attach_existing` 更是完全一样：Edge 同样认 `--remote-debugging-port`。
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isInsideLocalRoot } from "../../config/paths.js";
import { restorePersistentSessionStorage } from "./persist-session-storage.js";
import { activateBrowserSession, bindBrowserSessionLifecycle, } from "./browser-session-lifecycle.js";
const DEFAULT_PROFILE_NAME = 'default';
/** 显式参数优先，其次启动器读入的用户配置；测试使用独立 Chromium。 */
function resolveChannel(mode, channel) {
    if (channel !== undefined) {
        return channel;
    }
    const configured = process.env['OFFICIAL_APPLY_BROWSER_CHANNEL'];
    if (mode !== 'isolated_test' && (configured === 'chrome' || configured === 'msedge' || configured === 'chromium'))
        return configured;
    return mode === 'isolated_test' ? 'chromium' : 'chrome';
}
/** Playwright 的 `channel` 只对系统浏览器有意义，自带的 chromium 不传。 */
function channelOption(channel) {
    return channel === 'chromium' ? {} : { channel };
}
function headedWindowArgs(headless) {
    if (headless)
        return [];
    const args = [];
    const position = process.env['OFFICIAL_APPLY_WINDOW_POSITION'];
    const size = process.env['OFFICIAL_APPLY_WINDOW_SIZE'];
    if (position !== undefined && /^-?\d+,-?\d+$/.test(position)) {
        args.push(`--window-position=${position}`);
    }
    if (size !== undefined && /^\d+,\d+$/.test(size)) {
        args.push(`--window-size=${size}`);
    }
    return args;
}
/** 仅浏览器未安装时尝试备用内核；档案占用和其他启动错误保留原始原因。 */
async function withChannelFallback(channel, launch) {
    try {
        return await launch(channel);
    }
    catch (error) {
        if (channel === 'chromium' || !/Executable doesn't exist|distribution.*is not found/i.test(describeError(error))) {
            throw error;
        }
        process.stderr.write(`[official-apply] 启动 ${channel} 失败（${describeError(error)}），退回 Playwright 自带的 chromium。\n`);
        try {
            return await launch('chromium');
        }
        catch (fallbackError) {
            throw new Error(`${describeError(error)}；备用 Chromium 启动失败：${describeError(fallbackError)}`);
        }
    }
}
const DEFAULT_TIMEOUT_MS = 60_000;
function connected(session) {
    activateBrowserSession(session);
    bindBrowserSessionLifecycle(session);
    return session;
}
/** 新建会话默认无头；接管现有窗口保留显示状态，显式参数优先。 */
export function resolveHeadless(mode, explicit) {
    if (explicit !== undefined) {
        return explicit;
    }
    return mode !== 'attach_existing';
}
export function browserError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
function describeError(error) {
    if (error instanceof Error) {
        return error.message.split('\n')[0] ?? error.name;
    }
    return String(error);
}
export async function connectBrowser(options) {
    const { paths, mode } = options;
    const headless = resolveHeadless(mode, options.headless);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const startedAt = new Date().toISOString();
    const sessionId = options.sessionId ?? `session_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const downloadsDir = path.join(paths.tmpDir, 'downloads');
    if (!isInsideLocalRoot(paths, downloadsDir)) {
        throw browserError('browser_profile_outside_local', `${downloadsDir} 不在 ${paths.localRoot} 内`);
    }
    mkdirSync(downloadsDir, { recursive: true });
    const { chromium } = await import('playwright');
    const channel = resolveChannel(mode, options.channel);
    if (mode === 'persistent') {
        const profileName = options.profileName ?? DEFAULT_PROFILE_NAME;
        const profileDir = path.join(paths.browserProfileDir, profileName);
        // 登录状态是最敏感的东西之一，只能落在 .local/ 内。
        if (!isInsideLocalRoot(paths, profileDir)) {
            throw browserError('browser_profile_outside_local', `${profileDir} 不在 ${paths.localRoot} 内；浏览器 profile 只能放 .local/browser-profile/`);
        }
        mkdirSync(profileDir, { recursive: true });
        let context;
        let actualChannel = channel;
        try {
            context = await withChannelFallback(channel, async (used) => {
                actualChannel = used;
                return chromium.launchPersistentContext(profileDir, {
                    headless,
                    args: headedWindowArgs(headless),
                    downloadsPath: downloadsDir,
                    acceptDownloads: true,
                    timeout: timeoutMs,
                    ...channelOption(used),
                });
            });
        }
        catch (error) {
            if (/ProcessSingleton|profile.*in use|SingletonLock/i.test(describeError(error))) {
                throw browserError('browser_profile_in_use', `${profileDir} 正被另一个浏览器会话使用。请复用该会话，或用 --profile-name 指定独立档案（新档案可能需要登录）；不要删除锁文件或关闭用户浏览器。`);
            }
            throw browserError('browser_launch_failed', describeError(error));
        }
        await restorePersistentSessionStorage(context, profileDir);
        return connected({
            ref: {
                sessionId,
                mode,
                browserName: actualChannel,
                profileName,
                startedAt,
            },
            paths,
            mode,
            profileDir,
            downloadsDir,
            defaultTimeoutMs: timeoutMs,
            context,
            headless,
            closed: false,
        });
    }
    if (mode === 'attach_existing') {
        const endpoint = options.cdpEndpoint;
        if (endpoint === undefined || endpoint.trim() === '') {
            throw browserError('browser_cdp_endpoint_missing', 'attach_existing 需要调用方提供完整动态 CDP 地址');
        }
        let browser;
        try {
            browser = await chromium.connectOverCDP(endpoint, { timeout: timeoutMs });
        }
        catch (error) {
            // 连不上就明确失败。悄悄降级成新开浏览器会让用户以为在用自己的登录态。
            throw browserError('browser_attach_failed', [
                `连接 ${endpoint} 失败：${describeError(error)}。`,
                '请用 --remote-debugging-port 启动浏览器。Chrome 和 Edge 都支持这个参数。',
                '注意 Chrome 136 之后不再允许在默认 profile 上开远程调试，',
                '必须同时指定一个独立的 --user-data-dir。',
            ].join(''));
        }
        return connected({
            ref: { sessionId, mode, browserName: channel, startedAt },
            paths,
            mode,
            downloadsDir,
            defaultTimeoutMs: timeoutMs,
            browser,
            ...(browser.contexts()[0] === undefined ? {} : { context: browser.contexts()[0] }),
            headless,
            closed: false,
        });
    }
    let browser;
    let launchedChannel = channel;
    try {
        browser = await withChannelFallback(channel, async (used) => {
            launchedChannel = used;
            return chromium.launch({
                headless,
                downloadsPath: downloadsDir,
                timeout: timeoutMs,
                ...channelOption(used),
            });
        });
    }
    catch (error) {
        throw browserError('browser_launch_failed', describeError(error));
    }
    return connected({
        ref: { sessionId, mode, browserName: launchedChannel, startedAt },
        paths,
        mode,
        downloadsDir,
        defaultTimeoutMs: timeoutMs,
        browser,
        headless,
        closed: false,
    });
}
//# sourceMappingURL=connect-browser.js.map