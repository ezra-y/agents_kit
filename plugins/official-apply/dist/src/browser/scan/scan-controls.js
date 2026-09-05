import { CONTROL_SELECTOR } from "./control-selector.js";
const MAX_ELEMENTS = 3000;
const MAX_TEXT = 200;
export async function collectFrameNodes(frame, framePath, options = {}) {
    const raw = await frame.evaluate(({ maxElements, maxText, rootSelector, rootIndex, controlSelector, }) => {
        const all = Array.from(document.querySelectorAll('*'));
        const indexOf = new Map();
        all.forEach((element, i) => indexOf.set(element, i));
        const clean = (value) => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxText);
        const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return false;
            }
            return element.getClientRects().length > 0;
        };
        const implicitRole = (element) => {
            const tag = element.tagName.toLowerCase();
            const type = (element.getAttribute('type') ?? '').toLowerCase();
            if (tag === 'textarea')
                return 'textbox';
            if (tag === 'select')
                return element.hasAttribute('multiple') ? 'listbox' : 'combobox';
            if (tag === 'button')
                return 'button';
            if (tag === 'a' && element.hasAttribute('href'))
                return 'link';
            if (tag === 'input') {
                if (type === 'checkbox')
                    return 'checkbox';
                if (type === 'radio')
                    return 'radio';
                if (type === 'button' || type === 'submit' || type === 'reset')
                    return 'button';
                if (type === 'file')
                    return 'button';
                if (type === 'number')
                    return 'spinbutton';
                if (type === 'range')
                    return 'slider';
                if (type === 'search')
                    return 'searchbox';
                if (type === 'hidden')
                    return null;
                return 'textbox';
            }
            return null;
        };
        const textOfIds = (ids) => {
            if (ids === null || ids.trim() === '')
                return [];
            return ids
                .split(/\s+/)
                .map((id) => document.getElementById(id))
                .filter((node) => node !== null)
                .map((node) => clean(node.textContent))
                .filter((text) => text !== '');
        };
        /**
         * 读一个「标签容器」的文字，但**剥掉里面的表单控件**。
         *
         * 很多站点（Lever、Workday）把 `<select>` 或整段说明包在 `<label>` 里。
         * 直接取 textContent 会把所有 `<option>` 的文字也拼进来，得到
         * 「性别Select ...男女不愿透露」这种东西——它永远映射不到公共字段，
         * 还会被原样拿去问用户。
         *
         * 2026-08-20 在真实 Lever 申请页上实测撞到。
         */
        const LABEL_MAX_CHARS = 60;
        /** 去掉必填星号一类的装饰，它们不是标签的一部分。 */
        const stripLabelDecoration = (text) => text.replace(/[*＊✱✽﹡]+/g, ' ').replace(/\s+/g, ' ').trim();
        const labelTextOf = (container) => {
            if (container === null) {
                return '';
            }
            const copy = container.cloneNode(true);
            // 控件本身、选项、按钮的文字都不是标签。
            copy.querySelectorAll('input, select, textarea, option, optgroup, button').forEach((node) => {
                node.remove();
            });
            const whole = stripLabelDecoration(clean(copy.textContent));
            if (whole.length <= LABEL_MAX_CHARS) {
                return whole;
            }
            // 太长说明裹进了说明文字、状态提示或加载中文案。
            // 真实标签总是写在最前面，所以退回取第一段直接文字。
            //
            // 实测例子（Lever）：
            //   「Resume/CV ATTACH RESUME/CV Couldn't auto-read resume. Analyzing... Success!」
            //   第一段直接文字就是「Resume/CV」。
            for (const node of Array.from(copy.childNodes)) {
                const chunk = stripLabelDecoration(clean(node.textContent));
                if (chunk !== '' && chunk.length <= LABEL_MAX_CHARS) {
                    return chunk;
                }
            }
            return whole.slice(0, LABEL_MAX_CHARS).trim();
        };
        const labelEvidenceOf = (element) => {
            const evidence = [];
            const push = (source, text, score) => {
                const value = clean(text);
                if (value !== '') {
                    evidence.push({ source, text: value, score });
                }
            };
            const id = element.getAttribute('id');
            if (id !== null && id !== '') {
                const explicit = document.querySelector(`label[for="${CSS.escape(id)}"]`);
                if (explicit !== null) {
                    push('label_for', labelTextOf(explicit), 1);
                }
            }
            const wrapping = element.closest('label');
            if (wrapping !== null) {
                push('wrapping_label', labelTextOf(wrapping), 0.9);
            }
            for (const text of textOfIds(element.getAttribute('aria-labelledby'))) {
                push('aria_labelledby', text, 0.85);
            }
            push('aria_label', element.getAttribute('aria-label') ?? '', 0.8);
            const fieldset = element.closest('fieldset');
            const legend = fieldset?.querySelector('legend') ?? null;
            if (legend !== null) {
                push('legend', labelTextOf(legend), 0.5);
            }
            push('placeholder', element.getAttribute('placeholder') ?? '', 0.4);
            // 最近的前置兄弟文字。很多网站不用 <label>，只放一段文字。
            let sibling = element.previousElementSibling;
            let hops = 0;
            while (sibling !== null && hops < 3) {
                const text = labelTextOf(sibling);
                if (text !== '' && sibling.querySelector('input, select, textarea') === null) {
                    push('nearby_text', text, 0.35);
                    break;
                }
                sibling = sibling.previousElementSibling;
                hops += 1;
            }
            const name = element.getAttribute('name') ?? element.getAttribute('id') ?? '';
            push('technical_name', name, 0.2);
            return evidence;
        };
        const headingTextOf = (container) => {
            const heading = container.querySelector('h1, h2, h3, h4, h5, h6');
            return heading === null ? '' : clean(heading.textContent);
        };
        const sectionPathOf = (element) => {
            const parts = [];
            let current = element.parentElement;
            let hops = 0;
            while (current !== null && hops < 30) {
                const tag = current.tagName.toLowerCase();
                const role = current.getAttribute('role');
                if (tag === 'fieldset') {
                    const legend = current.querySelector('legend');
                    const text = legend === null ? '' : clean(legend.textContent);
                    if (text !== '')
                        parts.push(text);
                }
                else if (role === 'group' || role === 'region') {
                    const label = clean(current.getAttribute('aria-label')) ||
                        textOfIds(current.getAttribute('aria-labelledby'))[0] ||
                        headingTextOf(current);
                    if (label !== '')
                        parts.push(label);
                }
                else if (tag === 'section' || tag === 'article' || tag === 'form') {
                    const label = clean(current.getAttribute('aria-label')) || headingTextOf(current);
                    if (label !== '')
                        parts.push(label);
                }
                else if (tag === 'div' && current.hasAttribute('aria-label')) {
                    const label = clean(current.getAttribute('aria-label'));
                    if (label !== '')
                        parts.push(label);
                }
                current = current.parentElement;
                hops += 1;
            }
            // 去重并从外到内排列。
            const unique = [];
            for (const part of parts.reverse()) {
                if (!unique.includes(part))
                    unique.push(part);
            }
            return unique;
        };
        const signatureOf = (element) => {
            const classes = Array.from(element.classList).sort().join('.');
            return `${element.tagName.toLowerCase()}${classes === '' ? '' : `.${classes}`}`;
        };
        const attributeSelector = (name, value) => `[${name}="${value.replace(/["\\]/g, '\\$&')}"]`;
        const collectionSelectorOf = (element) => {
            const signature = signatureOf(element);
            let ancestor = element.parentElement;
            while (ancestor !== null && ancestor !== document.body) {
                const id = ancestor.getAttribute('id');
                if (id !== null && id !== '') {
                    return `#${CSS.escape(id)} > ${signature}`;
                }
                const testId = ancestor.getAttribute('data-testid');
                if (testId !== null && testId !== '') {
                    return `${attributeSelector('data-testid', testId)} > ${signature}`;
                }
                const ariaLabel = ancestor.getAttribute('aria-label');
                if (ariaLabel !== null && ariaLabel !== '') {
                    return `${attributeSelector('aria-label', ariaLabel)} ${signature}`;
                }
                ancestor = ancestor.parentElement;
            }
            return signature;
        };
        const hasIndexedRecordShape = (element) => {
            if (element.hasAttribute('data-index') ||
                /\d+\s*$/.test(element.getAttribute('aria-label') ?? '') ||
                /\d+\s*$/.test(headingTextOf(element))) {
                return true;
            }
            const names = Array.from(element.querySelectorAll('input[name],select[name],textarea[name]')).map((control) => control.getAttribute('name') ?? '');
            const distinctNames = new Set(names.filter((name) => name !== ''));
            return (distinctNames.size >= 2 &&
                names.some((name) => /\[\d+\]/.test(name)));
        };
        /** 找最近的同类或带索引的表单卡片祖先。 */
        const repeatContainerOf = (element) => {
            let current = element.parentElement;
            let hops = 0;
            while (current !== null && hops < 12) {
                const parent = current.parentElement;
                if (parent !== null) {
                    const signature = signatureOf(current);
                    const twins = Array.from(parent.children).filter((child) => signatureOf(child) === signature);
                    const distinctNames = new Set(Array.from(current.querySelectorAll('input[name],select[name],textarea[name]'))
                        .map((control) => control.getAttribute('name') ?? '')
                        .filter((name) => name !== ''));
                    const cardLike = current.tagName.toLowerCase() !== 'label' &&
                        distinctNames.size >= 2 &&
                        (twins.length >= 2 || hasIndexedRecordShape(current));
                    if (cardLike) {
                        const index = indexOf.get(current);
                        if (index !== undefined) {
                            const css = collectionSelectorOf(current);
                            const locatorIndex = Array.from(document.querySelectorAll(css)).indexOf(current);
                            return {
                                index,
                                signature,
                                css,
                                locatorIndex,
                                htmlId: current.getAttribute('id'),
                                ariaLabel: current.getAttribute('aria-label'),
                                role: current.getAttribute('role'),
                                testId: current.getAttribute('data-testid'),
                            };
                        }
                    }
                }
                current = parent;
                hops += 1;
            }
            return null;
        };
        const ERROR_SELECTOR = '[role=alert],[aria-live=assertive],[aria-live=polite]';
        // 局部扫描时把搜索范围收到浮层内部，索引仍按整页计算，
        // 这样局部结果和整页结果里的 runtimeRef 可以对上。
        const scopeRoot = rootSelector === null
            ? document
            : (document.querySelectorAll(rootSelector)[rootIndex] ?? document);
        /**
         * 这个元素是不是「属于另一个控件的浮层」。
         *
         * 自定义下拉的写法是：一个 `role=combobox` 加一个 `role=listbox` 浮层，
         * 用 `aria-controls` 或 `aria-owns` 关联起来。
         *
         * 浮层不是一个独立要填的字段——它是那个下拉的一部分。
         * 当成字段的话会出现两个字段抢同一个含义，映射直接判成冲突，
         * 然后两个都要人确认，谁也填不进去。
         */
        const ownedPopupIds = new Set();
        for (const owner of Array.from(scopeRoot.querySelectorAll('[aria-controls],[aria-owns]'))) {
            const ids = `${owner.getAttribute('aria-controls') ?? ''} ${owner.getAttribute('aria-owns') ?? ''}`;
            for (const id of ids.split(/\s+/)) {
                if (id !== '') {
                    ownedPopupIds.add(id);
                }
            }
        }
        const isOwnedPopup = (element) => {
            const id = element.getAttribute('id');
            if (id === null || id === '' || !ownedPopupIds.has(id)) {
                return false;
            }
            // 只有浮层类角色才跳过。被 aria-controls 指到的普通输入框仍然是字段。
            const role = element.getAttribute('role') ?? '';
            return ['listbox', 'menu', 'dialog', 'tree', 'grid'].includes(role);
        };
        const candidates = new Set();
        for (const element of Array.from(scopeRoot.querySelectorAll(controlSelector))) {
            if (isOwnedPopup(element)) {
                continue;
            }
            candidates.add(element);
        }
        for (const element of Array.from(scopeRoot.querySelectorAll(ERROR_SELECTOR))) {
            candidates.add(element);
        }
        const elements = Array.from(candidates)
            .slice(0, maxElements)
            .map((element) => {
            const tag = element.tagName.toLowerCase();
            const type = element.getAttribute('type');
            const rect = element.getBoundingClientRect();
            const asInput = element;
            const repeat = repeatContainerOf(element);
            const isErrorNode = element.matches(ERROR_SELECTOR);
            /**
             * 收集这个控件的选项。
             *
             * 原生 `<select>` 的选项就在自己里面。自定义下拉不一样：
             * 选项在它用 `aria-controls` 指向的浮层里。浮层本身不算独立字段
             * （上面已经跳过了），但**选项要还给它的主人**——
             * 拿不到选项，填的时候就没法判断「这个值官网到底有没有」，
             * 只能报格式冲突。
             */
            const optionsFromPopup = () => {
                const ids = `${element.getAttribute('aria-controls') ?? ''} ${element.getAttribute('aria-owns') ?? ''}`;
                const nodes = [];
                for (const id of ids.split(/\s+/)) {
                    if (id === '') {
                        continue;
                    }
                    const popup = document.getElementById(id);
                    if (popup !== null) {
                        nodes.push(...Array.from(popup.querySelectorAll('[role=option]')));
                    }
                }
                return nodes;
            };
            const options = tag === 'select'
                ? Array.from(element.querySelectorAll('option')).map((option) => ({
                    rawLabel: clean(option.textContent),
                    rawValue: option.getAttribute('value') ?? '',
                    disabled: option.hasAttribute('disabled'),
                    selected: option.selected,
                }))
                : optionsFromPopup().map((option) => ({
                    rawLabel: clean(option.textContent),
                    rawValue: option.getAttribute('data-value') ??
                        option.getAttribute('value') ??
                        clean(option.textContent),
                    disabled: option.getAttribute('aria-disabled') === 'true',
                    selected: option.getAttribute('aria-selected') === 'true',
                }));
            const labelText = clean(document.querySelector(element.getAttribute('id') === null || element.getAttribute('id') === ''
                ? '__none__'
                : `label[for="${CSS.escape(element.getAttribute('id') ?? '')}"]`)?.textContent ?? '');
            return {
                index: indexOf.get(element) ?? -1,
                tag,
                type,
                role: element.getAttribute('role') ?? implicitRole(element),
                htmlName: element.getAttribute('name'),
                htmlId: element.getAttribute('id'),
                autocomplete: element.getAttribute('autocomplete'),
                required: element.hasAttribute('required') ||
                    element.getAttribute('aria-required') === 'true' ||
                    labelText.includes('*'),
                disabled: element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true',
                readonly: element.hasAttribute('readonly') || element.getAttribute('aria-readonly') === 'true',
                visible: isVisible(element),
                /**
                 * 当前值。
                 *
                 * 原生控件直接读 `.value`。自定义下拉是一个 `div`，没有 `.value`——
                 * 它把选中项写在自己的文字里、`data-value` 里，或者用
                 * `aria-activedescendant` 指向选中的那个选项。
                 *
                 * 读不出当前值的后果很实在：选完之后没法验证「到底选中没有」，
                 * 于是明明没选上也报成功，下一步点了没反应还查不出原因。
                 */
                value: (() => {
                    if ('value' in element) {
                        return String(asInput.value ?? '');
                    }
                    const role = element.getAttribute('role') ?? '';
                    if (role !== 'combobox' && role !== 'listbox') {
                        return null;
                    }
                    const activeId = element.getAttribute('aria-activedescendant');
                    const active = activeId === null ? null : document.getElementById(activeId);
                    if (active !== null) {
                        return clean(active.textContent);
                    }
                    return (element.getAttribute('data-value') ??
                        element.getAttribute('aria-valuetext') ??
                        clean(element.textContent));
                })(),
                checked: type === 'checkbox' || type === 'radio' ? asInput.checked : null,
                multiple: element.hasAttribute('multiple'),
                accept: element.getAttribute('accept'),
                ariaInvalid: element.getAttribute('aria-invalid') === 'true',
                ariaExpanded: element.getAttribute('aria-expanded'),
                contentEditable: element.getAttribute('contenteditable') === 'true',
                text: clean(element.textContent),
                placeholder: element.getAttribute('placeholder'),
                labelEvidence: labelEvidenceOf(element),
                sectionPath: sectionPathOf(element),
                boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                options,
                describedByText: textOfIds(element.getAttribute('aria-describedby')),
                repeatContainerIndex: repeat === null ? null : repeat.index,
                repeatContainerSignature: repeat === null ? null : repeat.signature,
                repeatContainerCss: repeat === null ? null : repeat.css,
                repeatContainerLocatorIndex: repeat === null ? null : repeat.locatorIndex,
                repeatContainerHtmlId: repeat === null ? null : repeat.htmlId,
                repeatContainerAriaLabel: repeat === null ? null : repeat.ariaLabel,
                repeatContainerRole: repeat === null ? null : repeat.role,
                repeatContainerTestId: repeat === null ? null : repeat.testId,
                isFormControl: tag === 'input' || tag === 'textarea' || tag === 'select' ||
                    element.getAttribute('contenteditable') === 'true' ||
                    ['textbox', 'combobox', 'checkbox', 'radio', 'listbox', 'switch', 'slider', 'spinbutton'].includes(element.getAttribute('role') ?? ''),
                isButtonLike: tag === 'button' ||
                    element.getAttribute('role') === 'button' ||
                    (tag === 'input' && ['button', 'submit', 'reset'].includes(type ?? '')),
                isErrorNode,
            };
        });
        const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
            .map((node) => clean(node.textContent))
            .filter((text) => text !== '');
        const stepNodes = Array.from(document.querySelectorAll('[aria-current]'));
        const steps = [];
        if (stepNodes.length > 0) {
            const container = stepNodes[0]?.parentElement ?? null;
            const siblings = container === null ? stepNodes : Array.from(container.children);
            siblings.forEach((node, order) => {
                const label = clean(node.textContent);
                if (label !== '') {
                    steps.push({
                        key: `step_${order + 1}`,
                        label,
                        current: node.hasAttribute('aria-current'),
                    });
                }
            });
        }
        return {
            url: document.location.href,
            title: document.title,
            headings,
            steps,
            bodyTextSample: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000),
            elements,
        };
    }, {
        maxElements: MAX_ELEMENTS,
        maxText: MAX_TEXT,
        rootSelector: options.rootSelector ?? null,
        rootIndex: options.rootIndex ?? 0,
        controlSelector: CONTROL_SELECTOR,
    });
    return { framePath, ...raw };
}
/** label 取哪一条：按 `docs/04 §6` 的优先级取分数最高的一条。 */
export function isCounterLikeLabel(value) {
    const label = value.replace(/\s+/g, ' ').trim();
    return (/^\d+\s*[/／]\s*\d+$/.test(label) ||
        /^(?:已输入|已填写)\s*\d+\s*(?:个)?(?:字|字符)?$/.test(label) ||
        /^剩余\s*\d+\s*(?:个)?(?:字|字符)?$/.test(label) ||
        /^\d+\s*(?:个)?(?:字|字符)$/.test(label));
}
export function pickRawLabel(evidence) {
    const best = [...evidence]
        .sort((a, b) => b.score - a.score)
        .find((item) => !isCounterLikeLabel(item.text));
    return best?.text ?? '';
}
/** 把网页 tag 归一化成执行器认识的 `control_kind`（`docs/04 §8`）。 */
/**
 * 反爬控件。**永远不填，也不当成要问用户的字段。**
 *
 * reCAPTCHA / hCaptcha / Turnstile 都会在页面里塞一个隐藏的
 * `<textarea>` 或 `<input>` 用来存令牌。它们：
 *
 * - 不是用户要填的东西
 * - 往里写值就是在绕过风控（明令禁止）
 * - 名字里带 captcha，会让页面被误判成「验证码页」
 *
 * 真正需要用户处理的验证码是**看得见的挑战控件**，不是这个隐藏容器。
 * 在真实 Greenhouse 申请页上实测撞到过：整页被判成 captcha，流程直接停死。
 */
const ANTI_BOT_NAME_PATTERN = /^(g-recaptcha-response|h-captcha-response|cf-turnstile-response|recaptcha_token|__RequestVerificationToken)$/i;
export function isAntiBotField(field) {
    if (ANTI_BOT_NAME_PATTERN.test(field.htmlName ?? '')) {
        return true;
    }
    // 隐藏的、名字里带 captcha 的控件，一律当反爬容器。
    return !field.visible && /captcha|turnstile/i.test(`${field.htmlName ?? ''} ${field.rawLabel}`);
}
export function normalizeControlKind(element) {
    if (element.isButtonLike) {
        return 'action_button';
    }
    // 有些自定义下拉用原生 input 承载，但 role 明确是 combobox。
    // 这里必须先尊重 ARIA 语义，否则会被 input 的默认 text 类型盖掉。
    if (element.tag !== 'select' &&
        (element.role === 'combobox' || element.role === 'listbox')) {
        return 'combobox';
    }
    if (element.tag === 'textarea') {
        return 'textarea';
    }
    if (element.tag === 'select') {
        return element.multiple ? 'checkbox_group' : 'native_select';
    }
    if (element.contentEditable) {
        return 'contenteditable';
    }
    if (element.tag === 'input') {
        switch (element.type) {
            case 'file':
                return 'file_upload';
            case 'checkbox':
                return 'checkbox';
            case 'radio':
                return 'radio_group';
            case 'email':
                return 'email';
            case 'tel':
                return 'phone';
            case 'number':
                return 'number';
            case 'date':
                return 'date';
            case 'month':
                return 'month';
            default:
                return 'text';
        }
    }
    switch (element.role) {
        case 'combobox':
            return 'combobox';
        case 'listbox':
            return 'combobox';
        case 'checkbox':
        case 'switch':
            return 'checkbox';
        case 'radio':
            return 'radio_group';
        case 'textbox':
            return 'text';
        default:
            return 'unknown';
    }
}
/**
 * 生成字段指纹（`docs/04 §17`）。
 *
 * 只用可解释、跨刷新稳定的部分。不用运行期 ref、坐标和绝对 XPath。
 */
export function computeFieldFingerprint(parts) {
    const stableName = (parts.htmlName ?? '')
        .replace(/\[\d+\]/g, '[]')
        .replace(/\d{3,}/g, '#')
        .toLowerCase();
    return [
        parts.sectionPath.join('/'),
        parts.normalizedLabel,
        parts.controlKind,
        stableName,
        parts.repeatGroupKey ?? '',
        parts.optionSignature,
    ].join('|');
}
function buildLocatorCandidates(element, label, sectionPath) {
    const candidates = [];
    const sectionAnchor = sectionPath.length > 0 ? sectionPath[sectionPath.length - 1] : undefined;
    if (label !== '' && sectionAnchor !== undefined) {
        candidates.push({
            strategy: 'region_role_name',
            description: `在「${sectionAnchor}」区域内找 role=${element.role ?? '?'} 且名称为「${label}」的控件`,
            regionAnchor: { sectionPath, text: sectionAnchor },
            target: { role: element.role ?? undefined, accessibleName: label },
            source: 'scanner',
            basePriority: 100,
            confidence: 0.9,
        });
    }
    if (label !== '') {
        candidates.push({
            strategy: 'label',
            description: `按标签「${label}」定位`,
            target: { label },
            source: 'scanner',
            basePriority: 80,
            confidence: 0.75,
        });
    }
    if (element.autocomplete !== null && element.autocomplete !== '') {
        candidates.push({
            strategy: 'autocomplete',
            description: `按 autocomplete=${element.autocomplete} 定位`,
            target: { autocomplete: element.autocomplete },
            source: 'scanner',
            basePriority: 70,
            confidence: 0.7,
        });
    }
    if (element.htmlName !== null && element.htmlName !== '') {
        candidates.push({
            strategy: 'stable_attribute',
            description: `按 name=${element.htmlName} 定位`,
            target: { stableAttributes: { name: element.htmlName } },
            source: 'scanner',
            basePriority: 60,
            confidence: 0.65,
        });
    }
    if (element.htmlId !== null && element.htmlId !== '') {
        candidates.push({
            strategy: 'stable_attribute',
            description: `按 id=${element.htmlId} 定位`,
            target: { stableAttributes: { id: element.htmlId } },
            source: 'scanner',
            basePriority: 55,
            confidence: 0.6,
        });
    }
    return candidates;
}
function frameRefOf(snapshot, sameOrigin) {
    return {
        path: snapshot.framePath,
        url: snapshot.url,
        sameOrigin,
    };
}
/**
 * 把原始节点归一化成字段列表。
 *
 * radio 和 checkbox 按 `name` 聚合成一组（`docs/04 §9`），其余控件一对一。
 * 按钮不进字段列表，由 `scanActions()` 处理。
 */
export function scanControls(snapshot, context = {}) {
    const frame = frameRefOf(snapshot, true);
    const fields = [];
    const radioGroups = new Map();
    for (const element of snapshot.elements) {
        if (element.isErrorNode && !element.isFormControl) {
            continue;
        }
        if (element.isButtonLike) {
            continue;
        }
        if (!element.isFormControl) {
            continue;
        }
        const isGrouped = (element.type === 'radio' || element.type === 'checkbox') &&
            element.htmlName !== null &&
            element.htmlName !== '';
        if (isGrouped) {
            const key = `${element.type}:${element.htmlName ?? ''}`;
            const bucket = radioGroups.get(key);
            if (bucket === undefined) {
                radioGroups.set(key, [element]);
            }
            else {
                bucket.push(element);
            }
            continue;
        }
        fields.push(toField(snapshot, frame, element, context));
    }
    for (const [key, members] of radioGroups) {
        const first = members[0];
        if (first === undefined) {
            continue;
        }
        const isRadio = key.startsWith('radio:');
        const options = members.map((member) => ({
            rawLabel: pickRawLabel(member.labelEvidence) || member.value || '',
            rawValue: member.value ?? undefined,
            selected: member.checked === true,
            disabled: member.disabled,
            source: 'dom',
        }));
        // 组的名字优先用外层 group 的 aria-label，而不是某一个选项的文字。
        const groupLabel = first.sectionPath[first.sectionPath.length - 1] ?? pickRawLabel(first.labelEvidence);
        const field = toField(snapshot, frame, first, context);
        field.rawLabel = groupLabel;
        field.controlKind = isRadio ? 'radio_group' : 'checkbox_group';
        field.options = options;
        field.currentValue = options.find((option) => option.selected)?.rawValue ?? undefined;
        field.required = members.some((member) => member.required);
        field.fieldFingerprint = computeFieldFingerprint({
            sectionPath: field.sectionPath,
            normalizedLabel: normalizeLabel(field.rawLabel),
            controlKind: field.controlKind,
            htmlName: first.htmlName,
            ...(field.repeatGroupKey === undefined ? {} : { repeatGroupKey: field.repeatGroupKey }),
            optionSignature: options.map((option) => option.rawValue ?? option.rawLabel).join(','),
        });
        fields.push(field);
    }
    return fields;
}
/** 归一化 label：去空白、去必填星号、去全角冒号。 */
export function normalizeLabel(label) {
    return label
        .replace(/[*＊]/g, '')
        .replace(/[：:]\s*$/, '')
        .replace(/\s+/g, '')
        .trim();
}
function toField(snapshot, frame, element, context) {
    const label = pickRawLabel(element.labelEvidence);
    const controlKind = normalizeControlKind(element);
    const options = element.options.map((option) => ({
        rawLabel: option.rawLabel,
        rawValue: option.rawValue,
        disabled: option.disabled,
        selected: option.selected,
        source: 'dom',
    }));
    const repeatGroupKey = element.repeatContainerSignature ?? undefined;
    return {
        runtimeRef: `${snapshot.framePath.join('>') || 'main'}#${element.index}`,
        frame,
        ...(context.stepKey === undefined ? {} : { stepKey: context.stepKey }),
        ...(context.stepLabel === undefined ? {} : { stepLabel: context.stepLabel }),
        sectionPath: element.sectionPath,
        ...(repeatGroupKey === undefined ? {} : { repeatGroupKey }),
        rawLabel: label,
        accessibleName: element.labelEvidence.find((item) => item.source === 'aria_label')?.text ?? label,
        labelEvidence: element.labelEvidence.map((item) => ({
            source: item.source,
            text: item.text,
            score: item.score,
        })),
        role: element.role,
        htmlTag: element.tag,
        inputType: element.type,
        htmlName: element.htmlName,
        htmlId: element.htmlId,
        autocomplete: element.autocomplete,
        controlKind,
        required: element.required || /必填项未填写/.test(label),
        disabled: element.disabled,
        readonly: element.readonly,
        visible: element.visible,
        ...(element.value === null || element.value === '' ? {} : { currentValue: element.value }),
        options,
        errorTexts: element.describedByText,
        locatorCandidates: buildLocatorCandidates(element, label, element.sectionPath),
        fieldFingerprint: computeFieldFingerprint({
            sectionPath: element.sectionPath,
            normalizedLabel: normalizeLabel(label),
            controlKind,
            htmlName: element.htmlName,
            ...(repeatGroupKey === undefined ? {} : { repeatGroupKey }),
            optionSignature: options.map((option) => option.rawValue ?? option.rawLabel).join(','),
        }),
    };
}
//# sourceMappingURL=scan-controls.js.map