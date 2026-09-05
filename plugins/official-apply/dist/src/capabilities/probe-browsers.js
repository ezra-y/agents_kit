const CANDIDATES = [
    { channel: 'chrome', displayName: '系统 Google Chrome', carriesUserLogin: true },
    { channel: 'msedge', displayName: '系统 Microsoft Edge', carriesUserLogin: true },
    { channel: 'bundled', displayName: 'Playwright 自带 Chromium', carriesUserLogin: false },
];
function describeError(error) {
    return error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error);
}
export async function probeBrowsers(timeoutMs = 20_000) {
    let chromium;
    try {
        ({ chromium } = await import('playwright'));
    }
    catch (error) {
        return CANDIDATES.map((candidate) => ({
            ...candidate,
            available: false,
            reason: `playwright 模块加载失败：${describeError(error)}`,
        }));
    }
    const results = [];
    for (const candidate of CANDIDATES) {
        const started = Date.now();
        let browser;
        try {
            browser = await Promise.race([
                chromium.launch({
                    headless: true,
                    ...(candidate.channel === 'bundled' ? {} : { channel: candidate.channel }),
                }),
                new Promise((_resolve, reject) => setTimeout(() => reject(new Error(`超过 ${timeoutMs}ms 没起来`)), timeoutMs)),
            ]);
            results.push({
                ...candidate,
                available: true,
                version: browser.version(),
                // 自带 chromium 能问出路径；系统 channel 的路径 Playwright 不直接给，
                // 拿不到就留空，不编一个。
                ...(candidate.channel === 'bundled'
                    ? { executablePath: chromium.executablePath() }
                    : {}),
            });
        }
        catch (error) {
            results.push({
                ...candidate,
                available: false,
                reason: `${describeError(error)}（用时 ${Date.now() - started}ms）`,
            });
        }
        finally {
            await browser?.close().catch(() => undefined);
        }
    }
    return results;
}
/**
 * 把探测结果讲成人话，重点是**别让人误以为自己在用登录过的浏览器**。
 */
export function describeBrowserProbe(results) {
    const lines = [];
    for (const item of results) {
        lines.push(item.available
            ? `${item.displayName}：可用${item.version === undefined ? '' : `，${item.version}`}` +
                `${item.executablePath === undefined ? '' : `，路径 ${item.executablePath}`}`
            : `${item.displayName}：不可用（${item.reason ?? '未说明原因'}）`);
    }
    const systemAvailable = results.some((item) => item.carriesUserLogin && item.available);
    const bundledAvailable = results.some((item) => !item.carriesUserLogin && item.available);
    if (!systemAvailable && bundledAvailable) {
        lines.push('注意：本机没有可用的系统浏览器，只有 Playwright 自带的 Chromium。' +
            '自带浏览器**不带你的登录态**，需要登录的招聘网站会一直停在登录页。' +
            '要用登录态请先装 Chrome 或 Edge。');
    }
    if (!systemAvailable && !bundledAvailable) {
        lines.push('本机一个可用浏览器都没有。先跑 npm run setup:browser。');
    }
    return lines;
}
//# sourceMappingURL=probe-browsers.js.map