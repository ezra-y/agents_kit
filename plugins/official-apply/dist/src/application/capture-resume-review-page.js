/** Visible resume evidence, kept separate from the scanner's abbreviated routing text. */
export async function captureResumeReviewPage(page) {
    const errors = [];
    const frames = [];
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
    return {
        capturedAt: new Date().toISOString(),
        frames,
        errors,
        screenshotCaptured: screenshot !== undefined,
        screenshot,
    };
}
//# sourceMappingURL=capture-resume-review-page.js.map