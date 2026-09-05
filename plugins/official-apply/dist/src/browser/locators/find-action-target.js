/**
 * 按候选顺序在页面上真正找到目标元素。
 *
 * 规则文档：`docs/07_浏览器工具与CU最高效方案.md §4、§8`
 *
 * 两条硬规则：
 * 1. **命中多个就算歧义，不动手。** 宁可失败，也不能填错字段。
 * 2. **不使用坐标。** 全部走 Playwright 的语义 locator。
 *
 * 「先找房间，再找桌子」：有区域锚点时先把范围收到那个容器里。
 */
import { randomUUID } from 'node:crypto';
import { rankLocatorCandidates } from "./rank-locator-candidates.js";
const DEFAULT_TIMEOUT_MS = 5_000;
/** 可能承载区域的容器。找房间时只在这些里面找。 */
const REGION_SELECTOR = 'fieldset, section, article, form, [role=group], [role=region]';
function newId(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
/** 把一条候选翻译成 Playwright locator。翻译不了就返回 undefined。 */
export function toPlaywrightLocator(frame, descriptor) {
    const target = descriptor.target ?? {};
    // 有区域锚点就先收窄范围，避免同名字段串门。
    const anchorText = descriptor.regionAnchor?.text;
    const scope = anchorText === undefined || anchorText === ''
        ? frame.locator('body')
        : frame.locator(REGION_SELECTOR).filter({ hasText: anchorText }).last();
    let locator;
    switch (descriptor.strategy) {
        case 'site_recipe':
        case 'family_recipe':
        case 'region_role_name':
        case 'role_name': {
            if (target.accessibleName === undefined || target.accessibleName === '') {
                return undefined;
            }
            const role = normalizeRole(target.role);
            if (role === undefined) {
                locator = scope.getByLabel(target.accessibleName, { exact: false });
                break;
            }
            locator = scope.getByRole(role, { name: target.accessibleName, exact: false });
            break;
        }
        case 'label': {
            if (target.label === undefined || target.label === '') {
                return undefined;
            }
            // 用精确匹配。模糊匹配会把 aria-label="期望城市选项" 的浮层也算进来，
            // 结果动手动到隐藏元素上（真实踩过的坑）。
            locator = scope.getByLabel(target.label, { exact: true });
            break;
        }
        case 'aria_label':
        case 'aria_labelledby': {
            if (target.accessibleName === undefined || target.accessibleName === '') {
                return undefined;
            }
            locator = scope.locator(`[aria-label="${cssEscape(target.accessibleName)}"]`);
            break;
        }
        case 'autocomplete': {
            if (target.autocomplete === undefined || target.autocomplete === '') {
                return undefined;
            }
            locator = scope.locator(`[autocomplete="${cssEscape(target.autocomplete)}"]`);
            break;
        }
        case 'stable_attribute': {
            const attributes = target.stableAttributes ?? {};
            const selector = Object.entries(attributes)
                .map(([name, value]) => `[${name}="${cssEscape(value)}"]`)
                .join('');
            locator = selector === '' ? undefined : scope.locator(selector);
            break;
        }
        case 'css_fallback': {
            locator =
                target.css === undefined || target.css === '' ? undefined : scope.locator(target.css);
            break;
        }
        default:
            // xpath、视觉兜底等不在这一层处理。
            return undefined;
    }
    if (locator === undefined) {
        return undefined;
    }
    return target.nth === undefined ? locator : locator.nth(target.nth);
}
/** Playwright 的 role 是有限集合。给不出合法值就退回 label 定位。 */
function normalizeRole(role) {
    const allowed = new Set([
        'button',
        'checkbox',
        'combobox',
        'link',
        'listbox',
        'option',
        'radio',
        'searchbox',
        'slider',
        'spinbutton',
        'switch',
        'textbox',
    ]);
    return role !== undefined && allowed.has(role)
        ? role
        : undefined;
}
function cssEscape(value) {
    return value.replace(/["\\]/g, '\\$&');
}
/**
 * 按排序后的候选逐个尝试。
 *
 * 每次尝试都记录策略、命中数量、耗时和失败原因，
 * 供以后统计「哪种策略真的更稳」（`docs/08 §8.1`）。
 */
export async function findActionTarget(frame, candidates, options) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const ranked = rankLocatorCandidates({
        candidates,
        ...(options.stats === undefined ? {} : { stats: options.stats }),
    });
    const attempts = [];
    let sawAmbiguous = false;
    for (const { descriptor } of ranked) {
        const startedAt = performance.now();
        const locator = toPlaywrightLocator(frame, descriptor);
        if (locator === undefined) {
            attempts.push(makeAttempt(options, descriptor, 0, 'not_actionable', startedAt, '这条候选无法翻译成定位表达式'));
            continue;
        }
        let count = 0;
        try {
            count = await locator.count();
        }
        catch (error) {
            attempts.push(makeAttempt(options, descriptor, 0, 'failed', startedAt, describeError(error)));
            continue;
        }
        if (count === 0) {
            attempts.push(makeAttempt(options, descriptor, 0, 'not_found', startedAt, '页面上找不到'));
            continue;
        }
        if (count > 1) {
            /**
             * 命中多个通常要停手——填错字段比填不上更糟。
             *
             * 但有一个例外：**同名的一组 radio 本来就是一个控件**。
             * 「是 / 否」两个 input 共享一个 name，在页面语义上是一个单选题。
             * 把它判成歧义的话，所有单选题都填不上。
             *
             * 只在确认「全部命中都是同名 radio」时才放行，其余照旧停手。
             */
            const sameRadioGroup = await isSingleRadioGroup(locator, count);
            if (!sameRadioGroup) {
                sawAmbiguous = true;
                attempts.push(makeAttempt(options, descriptor, count, 'ambiguous', startedAt, `命中 ${count} 个元素`));
                continue;
            }
        }
        try {
            await locator.first().waitFor({ state: 'attached', timeout: timeoutMs });
        }
        catch (error) {
            attempts.push(makeAttempt(options, descriptor, count, 'timeout', startedAt, describeError(error)));
            continue;
        }
        // 需要真实交互的动作必须落在可见元素上。
        // 命中一个隐藏元素而继续动手，会白等一个完整超时，还可能点错东西。
        // 文件上传例外：`input[type=file]` 常常被样式藏在拖拽区后面。
        if (needsVisibleTarget(options.actionKind)) {
            const visible = await locator
                .first()
                .isVisible()
                .catch(() => false);
            if (!visible) {
                attempts.push(makeAttempt(options, descriptor, count, 'not_actionable', startedAt, '命中的元素不可见'));
                continue;
            }
        }
        attempts.push(makeAttempt(options, descriptor, count, 'success', startedAt));
        return {
            target: { locator: locator.first(), descriptor, attempts, candidateCount: count },
            outcome: 'success',
            attempts,
        };
    }
    return { outcome: sawAmbiguous ? 'ambiguous' : 'not_found', attempts };
}
/**
 * 这些命中是不是同一组 radio。
 *
 * 判据是共享同一个 `name`——那正是浏览器用来分组单选的依据。
 * 名字不一样就不是一组，照旧算歧义。
 */
async function isSingleRadioGroup(locator, count) {
    if (count > 12) {
        // 一个单选题不会有几十个选项。太多说明选择器本身就不准。
        return false;
    }
    try {
        const names = await locator.evaluateAll((elements) => elements.map((element) => {
            const input = element;
            return input.tagName === 'INPUT' && input.type === 'radio' ? input.name : '';
        }));
        return names.length > 1 && names.every((name) => name !== '' && name === names[0]);
    }
    catch {
        return false;
    }
}
/** 文件上传之外的动作都要求目标可见。 */
function needsVisibleTarget(actionKind) {
    return actionKind !== 'upload_file';
}
function makeAttempt(options, descriptor, candidateCount, outcome, startedAt, failureReason) {
    return {
        id: newId('locattempt'),
        runId: options.runId,
        ...(options.runtimeRef === undefined ? {} : { runtimeRef: options.runtimeRef }),
        strategy: descriptor.strategy,
        description: descriptor.description,
        candidateCount,
        outcome,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        ...(failureReason === undefined ? {} : { failureReason }),
        createdAt: new Date().toISOString(),
    };
}
function describeError(error) {
    if (error instanceof Error) {
        return error.message.split('\n')[0] ?? error.name;
    }
    return String(error);
}
//# sourceMappingURL=find-action-target.js.map