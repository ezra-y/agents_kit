/**
 * 等待页面出现**预期中的**变化。
 *
 * 规则文档：`docs/07_浏览器工具与CU最高效方案.md §6`、`docs/01` 阶段 J
 *
 * 为什么不能只等固定时间：
 * 点了「下一步」之后，页面可能进了下一步，也可能被必填校验拦住。
 * 只 sleep 两秒就继续，等于闭着眼睛往下走。
 *
 * 所以要明确说出「我期待看到什么变化」，然后去验证它。
 */
import { setTimeout as delay } from 'node:timers/promises';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_MS = 150;
/** 读当前步骤：优先看 `aria-current`。 */
export async function readCurrentStep(page) {
    return page
        .evaluate(() => {
        const current = document.querySelector('[aria-current]');
        return (current?.textContent ?? '').replace(/\s+/g, ' ').trim();
    })
        .catch(() => '');
}
/** 读页面上正在显示的错误。被错误拦住时不该继续等。 */
export async function readVisibleErrors(page) {
    return page
        .evaluate(() => Array.from(document.querySelectorAll('[role=alert],[aria-live=assertive]'))
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim())
        .filter((text) => text !== ''))
        .catch(() => []);
}
async function checkOne(page, expected) {
    switch (expected.kind) {
        case 'url_changed':
            return page.url() !== (expected.before ?? '');
        case 'step_changed': {
            const step = await readCurrentStep(page);
            if (expected.target !== undefined && expected.target !== '') {
                return step.includes(expected.target);
            }
            return step !== (expected.before ?? '');
        }
        case 'region_appeared': {
            if (expected.target === undefined || expected.target === '') {
                return false;
            }
            return page
                .locator(expected.target)
                .first()
                .isVisible()
                .catch(() => false);
        }
        case 'region_disappeared': {
            if (expected.target === undefined || expected.target === '') {
                return false;
            }
            const visible = await page
                .locator(expected.target)
                .first()
                .isVisible()
                .catch(() => false);
            return !visible;
        }
        case 'success_marker_appeared': {
            if (expected.target === undefined || expected.target === '') {
                return false;
            }
            const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
            return text.includes(expected.target);
        }
        default:
            return false;
    }
}
export async function waitForExpectedPageChange(page, options) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
    const startedAt = performance.now();
    // 动作前的错误必须由调用方给。这里再采一次，采到的已经是动作之后的状态了。
    const errorsBefore = new Set(options.knownErrors ?? (await readVisibleErrors(page)));
    while (!options.signal?.aborted && performance.now() - startedAt < timeoutMs) {
        const observed = [];
        for (const expected of options.expected) {
            if (await checkOne(page, expected)) {
                observed.push(expected);
            }
        }
        if (observed.length > 0) {
            return {
                changed: true,
                observed,
                waitedMs: Math.round(performance.now() - startedAt),
            };
        }
        // 新出现的错误说明被拦住了，不用再等满超时。
        const errorsNow = await readVisibleErrors(page);
        const fresh = errorsNow.find((text) => !errorsBefore.has(text));
        if (fresh !== undefined) {
            return {
                changed: false,
                observed: [],
                blockedByError: fresh,
                waitedMs: Math.round(performance.now() - startedAt),
            };
        }
        try {
            await delay(pollIntervalMs, undefined, options.signal === undefined ? {} : { signal: options.signal });
        }
        catch (error) {
            if (!options.signal?.aborted)
                throw error;
        }
    }
    return {
        changed: false,
        observed: [],
        waitedMs: Math.round(performance.now() - startedAt),
    };
}
//# sourceMappingURL=wait-for-expected-page-change.js.map