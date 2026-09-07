async function captureScrollableScreenshots(page, sensitiveSelector) {
    // Full-page screenshots already cover document scrolling; only supplement inner panels.
    const handle = await page.evaluateHandle(() => {
        const candidates = Array.from(document.querySelectorAll('body *'))
            .filter((element) => {
            if (element.matches('input, textarea, select, [contenteditable]'))
                return false;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return /auto|scroll/.test(style.overflowY) && style.visibility !== 'hidden' &&
                rect.width > 0 && rect.height > 0 && element.clientHeight > 0 &&
                element.scrollHeight > element.clientHeight + 120;
        });
        return candidates.sort((left, right) => (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight))[0] ?? null;
    });
    const target = handle.asElement();
    if (target === null) {
        await handle.dispose();
        return [];
    }
    const originalTop = await target.evaluate(element => element.scrollTop);
    const screenshots = [];
    const mask = page.frames().flatMap((frame) => [
        frame.locator(sensitiveSelector),
        frame.getByLabel(/password|验证码|密码|captcha|verification.?code|one.?time.?code/i),
        frame.getByPlaceholder(/password|验证码|密码|captcha|verification.?code|one.?time.?code/i),
    ]);
    try {
        const plan = await target.evaluate(element => ({
            maximum: element.scrollHeight - element.clientHeight,
            step: Math.max(1, Math.floor(element.clientHeight * 0.85)),
        }));
        for (let position = 0;; position = Math.min(position + plan.step, plan.maximum)) {
            await target.evaluate((element, top) => { element.scrollTop = top; }, position);
            await page.waitForTimeout(80);
            screenshots.push(await page.screenshot({ fullPage: false, mask }));
            if (position === plan.maximum)
                break;
        }
        return screenshots;
    }
    finally {
        await target.evaluate((element, top) => { element.scrollTop = top; }, originalTop);
        await handle.dispose();
    }
}
/** Visible resume evidence, kept separate from the scanner's abbreviated routing text. */
export async function captureResumeReviewPage(page) {
    const errors = [];
    const frames = [];
    // Moka renders its resume after bootstrap data; an early full-page PNG only captures the spinner.
    if (await page.evaluate(() => 'TurboApply' in window)) {
        try {
            await page.locator('textarea:visible').first().waitFor({ state: 'visible', timeout: 10_000 });
        }
        catch {
            errors.push('resume_content_not_ready: visible resume text areas did not render');
        }
    }
    const sensitiveSelector = [
        'input[type="password"]',
        'input[autocomplete="one-time-code"]',
        '[name*="captcha" i]', '[id*="captcha" i]',
        '[name*="token" i]', '[name*="password" i]',
        '[placeholder*="验证码"]', '[aria-label*="验证码"]',
    ].join(',');
    for (const [frameIndex, frame] of page.frames().entries()) {
        try {
            const snapshot = await frame.evaluate((selector) => {
                const sensitive = /password|passwd|captcha|verification.?code|one.?time.?code|token|cookie|验证码|密码/i;
                const visible = (element) => {
                    const style = getComputedStyle(element);
                    return style.display !== 'none' && style.visibility !== 'hidden' &&
                        element.getClientRects().length > 0;
                };
                const labelOf = (element) => {
                    const labels = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ||
                        element instanceof HTMLSelectElement ? Array.from(element.labels ?? []) : [];
                    return labels.map((label) => {
                        const clone = label.cloneNode(true);
                        if (!(clone instanceof Element))
                            return '';
                        clone.querySelectorAll('input, textarea, select, [contenteditable]').forEach((control) => control.remove());
                        return clone.textContent ?? '';
                    }).join(' ').trim() ||
                        element.getAttribute('aria-label') || element.getAttribute('placeholder') || '';
                };
                const controls = Array.from(document.querySelectorAll('input, textarea, select, [contenteditable="true"], [role="combobox"], [role="textbox"], [role="checkbox"], [role="radio"]'));
                const excluded = new Set(Array.from(document.querySelectorAll(selector)));
                for (const element of controls) {
                    if (sensitive.test([element.id, element.getAttribute('name'), labelOf(element),
                        element.getAttribute('autocomplete')].join(' ')))
                        excluded.add(element);
                }
                const fields = controls.filter((element) => visible(element) && !excluded.has(element) &&
                    !(element instanceof HTMLInputElement && ['hidden', 'password', 'button', 'submit', 'reset'].includes(element.type)))
                    .map((element) => ({
                    id: element.id,
                    name: element.getAttribute('name'),
                    label: labelOf(element),
                    tag: element.tagName.toLowerCase(),
                    type: element.getAttribute('type') ?? element.getAttribute('role'),
                    visible: true,
                    value: element instanceof HTMLSelectElement
                        ? Array.from(element.selectedOptions).map((option) => ({ value: option.value, text: option.text }))
                        : element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
                            ? element.value : element.textContent ?? '',
                    checked: element instanceof HTMLInputElement && ['radio', 'checkbox'].includes(element.type)
                        ? element.checked : element.getAttribute('aria-checked'),
                    readOnly: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
                        ? element.readOnly : null,
                }));
                // Text nodes preserve full preview paragraphs without collecting hidden inputs or scripts.
                const paragraphs = [];
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                while (walker.nextNode()) {
                    const parent = walker.currentNode.parentElement;
                    if (!parent || !visible(parent) || parent.closest('script, style, noscript, input, textarea, select'))
                        continue;
                    if ([...excluded].some((element) => element.contains(parent) || element.closest('label')?.contains(parent)))
                        continue;
                    const text = walker.currentNode.textContent?.trim();
                    if (text && !/^(?:验证码|密码|password|captcha|token|cookie)\s*[:：]/i.test(text))
                        paragraphs.push(text);
                }
                return {
                    url: location.origin + location.pathname,
                    title: document.title,
                    fields,
                    readOnlyText: paragraphs.join('\n'),
                    visibility: 'visible_elements_only',
                    excludedSensitiveControlCount: excluded.size,
                };
            }, sensitiveSelector);
            frames.push({ frameIndex, ...snapshot });
        }
        catch (error) {
            errors.push(`frame ${frameIndex}: ${error instanceof Error ? error.name : 'capture_failed'}`);
        }
    }
    let screenshot;
    try {
        screenshot = await page.screenshot({
            fullPage: true,
            mask: page.frames().flatMap((frame) => [
                frame.locator(sensitiveSelector),
                frame.getByLabel(/password|验证码|密码|captcha|verification.?code|one.?time.?code/i),
                frame.getByPlaceholder(/password|验证码|密码|captcha|verification.?code|one.?time.?code/i),
            ]),
        });
    }
    catch (error) {
        errors.push(`screenshot: ${error instanceof Error ? error.name : 'capture_failed'}`);
    }
    let scrollScreenshots = [];
    try {
        scrollScreenshots = await captureScrollableScreenshots(page, sensitiveSelector);
    }
    catch (error) {
        errors.push(`scroll_screenshot: ${error instanceof Error ? error.name : 'capture_failed'}`);
    }
    let structuredData;
    try {
        structuredData = await page.evaluate(() => {
            const root = window;
            const candidateAccount = root.TurboApply?.data?.candidateAccount;
            return candidateAccount !== null &&
                typeof candidateAccount === 'object' &&
                !Array.isArray(candidateAccount)
                ? { source: 'TurboApply.data.candidateAccount', candidateAccount }
                : undefined;
        });
    }
    catch (error) {
        errors.push(`structured_data: ${error instanceof Error ? error.name : 'capture_failed'}`);
    }
    return {
        capturedAt: new Date().toISOString(),
        frames,
        errors,
        screenshotCaptured: screenshot !== undefined,
        scrollScreenshotCount: scrollScreenshots.length,
        scrollScreenshots,
        screenshot,
        ...(structuredData === undefined ? {} : { structuredData }),
    };
}
//# sourceMappingURL=capture-resume-review-page.js.map