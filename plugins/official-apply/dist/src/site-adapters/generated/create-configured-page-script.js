import { fillTextControl, readControlValue } from "../../browser/actions/fill-text-control.js";
import { selectNativeOption } from "../../browser/actions/select-native-option.js";
import { setCheckbox } from "../../browser/actions/set-checkbox.js";
import { chooseRadio } from "../../browser/actions/choose-radio.js";
import { selectCustomOptionFromLocator } from "../../browser/actions/select-custom-option.js";
import { findActionTarget } from "../../browser/locators/find-action-target.js";
import { toUrlPattern } from "../../browser/network/observe-network.js";
import { pathMatchesPattern } from "../discovery/build-page-script-candidate.js";
const TEXT_CONTROLS = new Set([
    'text',
    'textarea',
    'email',
    'phone',
    'number',
    'date',
    'month',
    'year',
    'contenteditable',
]);
function scalarText(value) {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number') {
        return String(value);
    }
    return undefined;
}
async function targetFor(page, field) {
    const found = await findActionTarget(page.mainFrame(), field.locatorCandidates, {
        runId: 'configured_page_script',
        runtimeRef: field.canonicalKey,
        actionKind: field.controlKind === 'checkbox' ? 'check' : 'fill_text',
    });
    return found.target?.locator;
}
async function fillField(page, field, value) {
    if (value === undefined) {
        return { key: field.canonicalKey, outcome: 'skipped', code: 'no_resolved_value' };
    }
    const locator = await targetFor(page, field);
    if (locator === undefined) {
        return {
            key: field.canonicalKey,
            outcome: 'failed',
            code: 'configured_locator_not_found',
            message: `${field.label}定位失败`,
        };
    }
    if (TEXT_CONTROLS.has(field.controlKind)) {
        const text = scalarText(value);
        if (text === undefined) {
            return {
                key: field.canonicalKey,
                outcome: 'failed',
                code: 'configured_value_type_unsupported',
                message: `${field.label}需要文本值`,
            };
        }
        const result = await fillTextControl(locator, text);
        return result.ok
            ? { key: field.canonicalKey, outcome: result.changed ? 'filled' : 'unchanged' }
            : {
                key: field.canonicalKey,
                outcome: 'failed',
                code: 'configured_fill_failed',
                message: `${field.label}写入或读回失败`,
            };
    }
    if (field.controlKind === 'native_select') {
        const text = scalarText(value);
        if (text === undefined) {
            return {
                key: field.canonicalKey,
                outcome: 'failed',
                code: 'configured_value_type_unsupported',
                message: `${field.label}需要文本选项`,
            };
        }
        const result = await selectNativeOption(locator, text);
        return result.ok
            ? { key: field.canonicalKey, outcome: result.changed ? 'filled' : 'unchanged' }
            : {
                key: field.canonicalKey,
                outcome: 'failed',
                code: 'configured_select_failed',
                message: `${field.label}选择或读回失败`,
            };
    }
    if (field.controlKind === 'radio_group') {
        const text = scalarText(value);
        if (text === undefined) {
            return {
                key: field.canonicalKey,
                outcome: 'failed',
                code: 'configured_value_type_unsupported',
                message: `${field.label}需要文本选项`,
            };
        }
        const label = field.options?.find((option) => option.value === text)?.label ?? text;
        const result = await chooseRadio(locator, label);
        return result.ok
            ? { key: field.canonicalKey, outcome: result.changed ? 'filled' : 'unchanged' }
            : {
                key: field.canonicalKey,
                outcome: 'failed',
                code: 'configured_radio_failed',
                message: result.reason ?? `${field.label}选择失败`,
            };
    }
    if (field.controlKind === 'combobox' || field.controlKind === 'cascading_select') {
        const text = scalarText(value);
        if (text === undefined) {
            return {
                key: field.canonicalKey,
                outcome: 'failed',
                code: 'configured_value_type_unsupported',
                message: `${field.label}需要文本选项`,
            };
        }
        const label = field.options?.find((option) => option.value === text)?.label ?? text;
        const result = await selectCustomOptionFromLocator(page, {
            locator,
            requestedLabel: label,
        });
        return result.ok
            ? { key: field.canonicalKey, outcome: result.changed ? 'filled' : 'unchanged' }
            : {
                key: field.canonicalKey,
                outcome: 'failed',
                code: 'configured_custom_select_failed',
                message: result.reason ?? `${field.label}选择失败`,
            };
    }
    if (field.controlKind === 'checkbox' && typeof value === 'boolean') {
        const result = await setCheckbox(locator, value);
        return result.ok
            ? { key: field.canonicalKey, outcome: result.changed ? 'filled' : 'unchanged' }
            : {
                key: field.canonicalKey,
                outcome: 'failed',
                code: 'configured_checkbox_failed',
                message: `${field.label}设置或读回失败`,
            };
    }
    return {
        key: field.canonicalKey,
        outcome: 'skipped',
        code: 'configured_control_unsupported',
        message: `${field.label}的 ${field.controlKind} 控件还没有候选执行器`,
    };
}
async function fieldMatches(locator, field, expected) {
    if (TEXT_CONTROLS.has(field.controlKind)) {
        const text = scalarText(expected);
        return text !== undefined && (await readControlValue(locator)) === text;
    }
    if (field.controlKind === 'checkbox' && typeof expected === 'boolean') {
        return (await locator.isChecked().catch(() => !expected)) === expected;
    }
    if (field.controlKind === 'native_select') {
        const text = scalarText(expected);
        if (text === undefined) {
            return false;
        }
        const selectedValue = await locator.inputValue().catch(() => '');
        const selectedLabel = (await locator.locator('option:checked').textContent().catch(() => ''))?.trim();
        return selectedValue === text || selectedLabel === text;
    }
    if (field.controlKind === 'radio_group') {
        const text = scalarText(expected);
        if (text === undefined)
            return false;
        const label = field.options?.find((option) => option.value === text)?.label ?? text;
        const option = locator.page().getByRole('radio', { name: label, exact: false });
        return ((await option.count().catch(() => 0)) === 1 &&
            (await option.first().isChecked().catch(() => false)));
    }
    if (field.controlKind === 'combobox' || field.controlKind === 'cascading_select') {
        const text = scalarText(expected);
        if (text === undefined)
            return false;
        const label = field.options?.find((option) => option.value === text)?.label ?? text;
        const value = await readControlValue(locator);
        const visible = value === '' ? await locator.innerText().catch(() => '') : value;
        return visible.includes(label);
    }
    return false;
}
async function validateConfiguredPage(page, spec, payload) {
    const issues = [];
    let checkedCount = 0;
    for (const field of spec.fields) {
        const expected = payload.resolved[field.canonicalKey];
        if (expected === undefined) {
            continue;
        }
        checkedCount += 1;
        const locator = await targetFor(page, field);
        if (locator === undefined || !(await fieldMatches(locator, field, expected))) {
            issues.push({
                key: field.canonicalKey,
                code: 'value_mismatch',
                message: `${field.label}读回失败`,
                severity: 'error',
            });
        }
    }
    return { valid: issues.length === 0, checkedCount, issues };
}
function responseWaiter(page, patterns) {
    if (patterns.length === 0) {
        return undefined;
    }
    return page
        .waitForResponse((response) => patterns.includes(toUrlPattern(response.url())), { timeout: 10_000 })
        .catch(() => undefined);
}
export function createConfiguredPageScript(spec) {
    const script = {
        id: spec.id,
        version: spec.version,
        host: spec.host,
        pageKind: spec.pageKind,
        status: spec.status,
        async match(page) {
            const url = new URL(page.url());
            const hostMatched = url.hostname === spec.host;
            const pathMatched = pathMatchesPattern(spec.pathPattern, url.pathname);
            const anchorChecks = await Promise.all(spec.anchors.map(async (anchor) => ({
                anchor,
                found: (await page.getByText(anchor, { exact: false }).count()) > 0,
            })));
            const matchedAnchors = anchorChecks.filter((item) => item.found).map((item) => item.anchor);
            const missingAnchors = anchorChecks.filter((item) => !item.found).map((item) => item.anchor);
            const matched = hostMatched && pathMatched && missingAnchors.length === 0;
            return {
                matched,
                confidence: matched ? 1 : hostMatched && pathMatched ? 0.5 : 0,
                allowRun: matched,
                reasons: [
                    hostMatched ? '域名匹配' : '域名不匹配',
                    pathMatched ? '路径匹配' : '路径不匹配',
                ],
                matchedAnchors,
                missingAnchors,
                pageVersionChanged: hostMatched && pathMatched && missingAnchors.length > 0,
            };
        },
        async inspect(page) {
            return {
                url: page.url(),
                title: await page.title(),
                pageKind: spec.pageKind,
                anchors: spec.anchors,
            };
        },
        prepare(input) {
            const resolved = {};
            const missing = [];
            const skipped = [];
            for (const field of spec.fields) {
                const value = input.basic[field.canonicalKey];
                if (value === undefined || value === null || value === '') {
                    (field.required ? missing : skipped).push({
                        key: field.canonicalKey,
                        reason: field.required ? '没有已确定答案' : '可选字段没有答案',
                    });
                }
                else {
                    resolved[field.canonicalKey] = value;
                }
            }
            return { resolved, missing, conflicts: [], skipped };
        },
        async fill(page, payload) {
            const fields = [];
            // 同一页上的 Playwright 写操作必须顺序执行，避免键盘事件串值。
            for (const field of spec.fields) {
                fields.push(await fillField(page, field, payload.resolved[field.canonicalKey]));
            }
            const failed = fields.filter((field) => field.outcome === 'failed');
            return {
                attemptedCount: fields.filter((field) => field.outcome !== 'skipped').length,
                filledCount: fields.filter((field) => field.outcome === 'filled').length,
                unchangedCount: fields.filter((field) => field.outcome === 'unchanged').length,
                skippedCount: fields.filter((field) => field.outcome === 'skipped').length,
                failed,
                fields,
                requiresRescan: false,
            };
        },
        validate(page, payload) {
            return validateConfiguredPage(page, spec, payload);
        },
    };
    if (spec.saveAction !== undefined &&
        spec.saveValidationStatus === 'validated') {
        script.saveDraft = async (page, payload) => {
            const beforeUrl = page.url();
            const target = await findActionTarget(page.mainFrame(), spec.saveAction.locatorCandidates, {
                runId: 'configured_page_script',
                actionKind: 'click',
            });
            if (target.target === undefined) {
                return {
                    attempted: false,
                    saved: false,
                    message: '找不到保存草稿按钮',
                    evidence: [],
                    pageChanged: false,
                };
            }
            const pendingResponse = responseWaiter(page, spec.saveAction.responseUrlPatterns);
            await target.target.locator.click();
            const response = pendingResponse === undefined ? undefined : await pendingResponse;
            const evidence = [];
            if (response !== undefined && response.status() >= 200 && response.status() < 300) {
                evidence.push({
                    kind: 'network_response',
                    strength: 'strong',
                    description: `保存接口返回 HTTP ${response.status()}`,
                });
            }
            let successTextFound = false;
            for (const text of spec.saveAction.successTexts) {
                if (await page.getByText(text, { exact: false }).first().isVisible().catch(() => false)) {
                    successTextFound = true;
                    evidence.push({
                        kind: 'toast',
                        strength: 'weak',
                        description: `页面出现“${text}”`,
                    });
                    break;
                }
            }
            if (response === undefined && successTextFound) {
                await page.reload({ waitUntil: 'domcontentloaded' });
                const reloaded = await validateConfiguredPage(page, spec, payload);
                if (reloaded.valid) {
                    evidence.push({
                        kind: 'reload_readback',
                        strength: 'strong',
                        description: '刷新后字段仍能读回',
                    });
                }
            }
            return {
                attempted: true,
                saved: evidence.some((item) => item.strength === 'strong'),
                ...(response === undefined ? {} : { httpStatus: response.status() }),
                evidence,
                pageChanged: page.url() !== beforeUrl,
            };
        };
    }
    return script;
}
//# sourceMappingURL=create-configured-page-script.js.map