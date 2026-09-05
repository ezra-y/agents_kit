/**
 * 真机能力核验。
 *
 * 规则文档：
 * - `docs/09_Codex与ClaudeCode共用实现.md §13`
 * - `appendix/外部能力核验.md §9`
 *
 * 一条硬规则：官方文档说支持不算数，本机跑通才算。
 * 不可用的能力必须明确写 `fail` 并给出原因，不得写成 `pass` 或悄悄跳过。
 *
 * 共享核心不认识 Codex 和 Claude Code 的专用 API。
 * 平台工具清单由适配层通过 `PlatformProbe` 注入；没有注入就保持空数组。
 */
import { createServer } from 'node:http';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isInsideLocalRoot } from "../config/paths.js";
export const CAPABILITY_CHECK_KEYS = [
    'playwright.module',
    'playwright.launchPersistent',
    'playwright.attachExistingChrome',
    'playwright.fileUpload',
    'playwright.ariaSnapshot',
    'playwright.networkObserve',
    'codex.callCli',
    'claudeCode.callCli',
];
import { describeBrowserProbe, probeBrowsers } from "./probe-browsers.js";
const DEFAULT_TIMEOUT_MS = 15_000;
/** 探测用的最小表单。只在本机内存里渲染，不访问任何真实招聘网站。 */
const PROBE_FORM_HTML = `<!doctype html>
<html lang="zh">
  <body>
    <main>
      <h1>能力探测表单</h1>
      <label for="probe-name">姓名</label>
      <input id="probe-name" name="name" type="text" />
      <label for="probe-file">简历</label>
      <input id="probe-file" name="resume" type="file" />
      <button type="button">下一步</button>
    </main>
  </body>
</html>`;
function describeError(error) {
    if (error instanceof Error) {
        return error.message.split('\n')[0] ?? error.name;
    }
    return String(error);
}
async function withTimeout(promise, timeoutMs) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`capability_probe_timeout: 超过 ${timeoutMs}ms`)), timeoutMs);
            }),
        ]);
    }
    finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}
class DetailRecorder {
    details = [];
    record(key, startedAt, outcome) {
        this.details.push({
            key,
            status: outcome.status,
            durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
            ...(outcome.failureReason === undefined ? {} : { failureReason: outcome.failureReason }),
        });
        return outcome;
    }
    skip(key, reason) {
        const outcome = { status: 'unknown', failureReason: reason };
        this.details.push({ key, status: 'unknown', durationMs: 0, failureReason: reason });
        return outcome;
    }
}
/** 起一个只监听回环地址的临时服务器，用来验证网络监听是否真的能拿到请求。 */
async function startLocalServer() {
    const server = createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(PROBE_FORM_HTML);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    return {
        url: `http://127.0.0.1:${address.port}/probe`,
        close: () => new Promise((resolve) => {
            server.close(() => resolve());
        }),
    };
}
async function runBrowserChecks(chromium, paths, probeDir, timeoutMs, recorder) {
    const profileDir = path.join(probeDir, 'profile');
    mkdirSync(profileDir, { recursive: true });
    const launchStartedAt = performance.now();
    let context;
    try {
        context = await withTimeout(chromium.launchPersistentContext(profileDir, { headless: true }), timeoutMs);
    }
    catch (error) {
        const reason = describeError(error);
        return {
            launchPersistent: recorder.record('playwright.launchPersistent', launchStartedAt, {
                status: 'fail',
                failureReason: reason,
            }),
            fileUpload: recorder.record('playwright.fileUpload', performance.now(), {
                status: 'fail',
                failureReason: '浏览器未能启动，无法验证上传',
            }),
            ariaSnapshot: recorder.record('playwright.ariaSnapshot', performance.now(), {
                status: 'fail',
                failureReason: '浏览器未能启动，无法读取 ARIA 快照',
            }),
            networkObserve: recorder.record('playwright.networkObserve', performance.now(), {
                status: 'fail',
                failureReason: '浏览器未能启动，无法监听网络',
            }),
        };
    }
    const launchPersistent = recorder.record('playwright.launchPersistent', launchStartedAt, {
        status: 'pass',
    });
    try {
        const page = await context.newPage();
        // ARIA 快照：证明能读到页面结构，而不是只能看图。
        const ariaStartedAt = performance.now();
        let ariaSnapshot;
        try {
            await page.setContent(PROBE_FORM_HTML);
            const snapshot = await withTimeout(page.locator('main').ariaSnapshot(), timeoutMs);
            ariaSnapshot = snapshot.includes('textbox')
                ? { status: 'pass' }
                : { status: 'fail', failureReason: 'ARIA 快照里读不到 textbox' };
        }
        catch (error) {
            ariaSnapshot = { status: 'fail', failureReason: describeError(error) };
        }
        recorder.record('playwright.ariaSnapshot', ariaStartedAt, ariaSnapshot);
        // 文件上传：证明能直接把本地文件交给 input，不需要走系统弹窗。
        const uploadStartedAt = performance.now();
        let fileUpload;
        try {
            const probeFile = path.join(probeDir, 'probe-resume.txt');
            writeFileSync(probeFile, '能力探测用的假简历，不含任何真实信息。\n', 'utf8');
            await page.setInputFiles('#probe-file', probeFile);
            const uploadedName = await page.evaluate(() => {
                const input = document.querySelector('#probe-file');
                return input instanceof HTMLInputElement ? (input.files?.[0]?.name ?? '') : '';
            });
            fileUpload =
                uploadedName === 'probe-resume.txt'
                    ? { status: 'pass' }
                    : { status: 'fail', failureReason: `input.files 里读不到探测文件（实际为 "${uploadedName}"）` };
        }
        catch (error) {
            fileUpload = { status: 'fail', failureReason: describeError(error) };
        }
        recorder.record('playwright.fileUpload', uploadStartedAt, fileUpload);
        // 网络监听：证明能看到页面发出的请求，用于以后发现表单 schema 候选。
        const networkStartedAt = performance.now();
        let networkObserve;
        const server = await startLocalServer();
        try {
            const seen = [];
            page.on('request', (request) => seen.push(request.url()));
            await withTimeout(page.goto(server.url, { waitUntil: 'load' }), timeoutMs);
            networkObserve = seen.some((url) => url.startsWith(server.url))
                ? { status: 'pass' }
                : { status: 'fail', failureReason: '没有捕获到页面请求' };
        }
        catch (error) {
            networkObserve = { status: 'fail', failureReason: describeError(error) };
        }
        finally {
            await server.close();
        }
        recorder.record('playwright.networkObserve', networkStartedAt, networkObserve);
        return { launchPersistent, fileUpload, ariaSnapshot, networkObserve };
    }
    finally {
        await context.close().catch(() => undefined);
    }
}
async function runPlatformProbe(probe, key, recorder, notes) {
    if (probe === undefined) {
        recorder.skip(key, '适配层未注入平台探针');
        notes.push(`${key} 未由适配层注入，工具清单保持为空。`);
        return { callCli: 'unknown', browserTools: [], computerUseTools: [] };
    }
    const startedAt = performance.now();
    let callCli = 'unknown';
    let failureReason;
    try {
        callCli = await probe.callCli();
    }
    catch (error) {
        callCli = 'fail';
        failureReason = describeError(error);
    }
    if (callCli === 'fail' && failureReason === undefined) {
        // 失败必须有原因，否则报告读起来只是「不行」，无法排查。
        failureReason = `${probe.platform} 适配层返回 fail：命令不可用或未安装`;
    }
    recorder.record(key, startedAt, {
        status: callCli,
        ...(failureReason === undefined ? {} : { failureReason }),
    });
    let browserTools = [];
    let computerUseTools = [];
    try {
        browserTools = await probe.listBrowserTools();
    }
    catch (error) {
        notes.push(`${probe.platform} 浏览器工具清单读取失败：${describeError(error)}`);
    }
    try {
        computerUseTools = await probe.listComputerUseTools();
    }
    catch (error) {
        notes.push(`${probe.platform} CU 工具清单读取失败：${describeError(error)}`);
    }
    return { callCli, browserTools, computerUseTools };
}
export async function probeCapabilities(input) {
    const { paths } = input;
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const endpoint = input.existingChromeEndpoint;
    const generatedAt = input.now ?? new Date().toISOString();
    const recorder = new DetailRecorder();
    const notes = [];
    const probeDir = path.join(paths.tmpDir, 'capability-probe');
    if (!isInsideLocalRoot(paths, probeDir)) {
        throw new Error(`capability_report_outside_local: ${probeDir} 不在 ${paths.localRoot} 内`);
    }
    rmSync(probeDir, { recursive: true, force: true });
    mkdirSync(probeDir, { recursive: true });
    // 1. Playwright 模块本身。
    const moduleStartedAt = performance.now();
    let playwright;
    let playwrightVersion;
    try {
        playwright = await import('playwright');
        playwrightVersion = await readPlaywrightVersion();
        recorder.record('playwright.module', moduleStartedAt, { status: 'pass' });
    }
    catch (error) {
        recorder.record('playwright.module', moduleStartedAt, {
            status: 'fail',
            failureReason: describeError(error),
        });
        notes.push('Playwright 不可用，浏览器相关能力全部保持 unknown。');
    }
    // 2. 浏览器相关探测。
    let browserChecks;
    let attachExistingChrome;
    if (playwright === undefined) {
        browserChecks = {
            launchPersistent: recorder.skip('playwright.launchPersistent', 'Playwright 未安装'),
            fileUpload: recorder.skip('playwright.fileUpload', 'Playwright 未安装'),
            ariaSnapshot: recorder.skip('playwright.ariaSnapshot', 'Playwright 未安装'),
            networkObserve: recorder.skip('playwright.networkObserve', 'Playwright 未安装'),
        };
        attachExistingChrome = recorder.skip('playwright.attachExistingChrome', 'Playwright 未安装');
    }
    else {
        browserChecks = await runBrowserChecks(playwright.chromium, paths, probeDir, timeoutMs, recorder);
        if (endpoint === undefined) {
            attachExistingChrome = recorder.skip('playwright.attachExistingChrome', '未提供动态 CDP 地址；本次不探测 attach_existing');
            notes.push('attach_existing 未配置。本能力只有在调用方提供动态 CDP 地址时探测。');
        }
        else {
            const attachStartedAt = performance.now();
            try {
                const browser = await withTimeout(playwright.chromium.connectOverCDP(endpoint, { timeout: timeoutMs }), timeoutMs);
                await browser.close();
                attachExistingChrome = { status: 'pass' };
            }
            catch (error) {
                attachExistingChrome = {
                    status: 'fail',
                    failureReason: `连接 ${endpoint} 失败：${describeError(error)}`,
                };
                notes.push('动态 CDP 地址连接失败；确认调试浏览器仍在运行后再测。');
            }
            recorder.record('playwright.attachExistingChrome', attachStartedAt, attachExistingChrome);
        }
    }
    // 3. 平台探针。
    const probes = input.platformProbes ?? [];
    const codex = await runPlatformProbe(probes.find((probe) => probe.platform === 'codex'), 'codex.callCli', recorder, notes);
    const claudeCode = await runPlatformProbe(probes.find((probe) => probe.platform === 'claude-code'), 'claudeCode.callCli', recorder, notes);
    rmSync(probeDir, { recursive: true, force: true });
    // 3b. 本机到底有哪些浏览器、分别是谁。
    //
    // 「浏览器起来了」没什么信息量。真正会出事的是：
    // 以为在用系统 Chrome（带着登录态），实际起的是自带 chromium（什么都没登录），
    // 表单填到一半跳登录页，还以为是网站抽风。
    const browsers = playwright === undefined ? [] : await probeBrowsers(timeoutMs);
    notes.push(...describeBrowserProbe(browsers));
    const report = {
        generatedAt,
        environment: {
            os: process.platform,
            nodeVersion: process.version,
            ...(playwrightVersion === undefined ? {} : { playwrightVersion }),
        },
        playwright: {
            launchPersistent: browserChecks.launchPersistent.status,
            attachExistingChrome: attachExistingChrome.status,
            fileUpload: browserChecks.fileUpload.status,
            ariaSnapshot: browserChecks.ariaSnapshot.status,
            networkObserve: browserChecks.networkObserve.status,
        },
        ...(browsers.length === 0 ? {} : { browsers }),
        codex,
        claudeCode,
        notes,
        details: recorder.details,
        blockingFailures: computeBlockingFailures(browserChecks, codex.callCli, claudeCode.callCli),
    };
    return { report };
}
function computeBlockingFailures(browserChecks, codexCli, claudeCli) {
    const failures = [];
    if (codexCli !== 'pass' && claudeCli !== 'pass') {
        failures.push('共享 CLI 无法被任一平台调用');
    }
    if (browserChecks.launchPersistent.status !== 'pass') {
        failures.push('浏览器会话无法跨命令保持');
    }
    if (browserChecks.fileUpload.status !== 'pass') {
        failures.push('文件上传无法完成');
    }
    return failures;
}
async function readPlaywrightVersion() {
    try {
        const module = await import('playwright/package.json', { with: { type: 'json' } });
        const version = module.default.version;
        return typeof version === 'string' ? version : undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=probe-capabilities.js.map