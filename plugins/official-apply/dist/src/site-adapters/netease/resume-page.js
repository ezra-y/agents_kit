import { fullRecordDescription } from "../../materials/record-description.js";
import { fillDateControl } from "../../browser/actions/fill-date-control.js";
import { fillTextControl, readControlValue } from "../../browser/actions/fill-text-control.js";
import { setCheckbox } from "../../browser/actions/set-checkbox.js";
const HOST = 'campus.game.163.com';
const PATH = '/app/personal/resume';
const CARD_ATTRIBUTE = 'data-official-apply-card';
const MAX_PROJECT_CARDS = 5;
const MAX_SKILL_CARDS = 6;
const SECTION_HEADINGS = [
    '1. 个人信息（必填）',
    '2. 教育背景（必填）',
    '3. 工作/实习经历',
    '4. 项目/活动经历',
    '6. 专业技能',
    '7. 作品附件',
];
function recordText(record, ...keys) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim() !== '') {
            return value.trim();
        }
        if (typeof value === 'number') {
            return String(value);
        }
    }
    return undefined;
}
function recordBoolean(record, ...keys) {
    for (const key of keys) {
        if (typeof record[key] === 'boolean') {
            return record[key];
        }
    }
    return undefined;
}
function recordsOf(payload, key) {
    const value = payload.resolved[key];
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item) => typeof item === 'object' && item !== null && !Array.isArray(item));
}
function sectionValue(records) {
    return records.map((record) => record.values);
}
function packSkills(records) {
    const names = records
        .map((record) => recordText(record, 'name', 'skill'))
        .filter((item) => item !== undefined);
    if (names.length <= MAX_SKILL_CARDS) {
        return names.map((name) => ({ name, level: '熟练' }));
    }
    const groups = [
        {
            name: 'Agent 工程、MCP 与多智能体开发',
            level: '精通',
            pattern: /Agent|MCP|Multi-Agent|Claude Code|Codex/i,
        },
        {
            name: 'Agent Skill 全周期开发',
            level: '精通',
            pattern: /Agent Skill/i,
        },
        {
            name: 'AIGC、LoRA 与 ComfyUI 工作流',
            level: '精通',
            pattern: /AIGC|LoRA|ComfyUI/i,
        },
        {
            name: 'Python、桌面端与服务器工程',
            level: '熟练',
            pattern: /Python|Tauri|SwiftUI|Git|Linux|Docker|Caddy|PostgreSQL/i,
        },
        {
            name: '用户研究、交互原型与视觉设计',
            level: '熟练',
            pattern: /用户研究|竞品|信息架构|Figma|视觉|动效|PS|AE|Rhino|KeyShot/i,
        },
        {
            name: '问卷统计、质性研究与 Codebook',
            level: '熟练',
            pattern: /问卷|统计|SPSS|STATA|扎根理论|Codebook|MAXQDA/i,
        },
    ];
    const unmatched = names.filter((name) => !groups.some((group) => group.pattern.test(name)));
    if (unmatched.length > 0) {
        groups[MAX_SKILL_CARDS - 1].name += `、${unmatched.join('、')}`;
    }
    return groups.map(({ name, level }) => ({ name, level }));
}
function normalizedDegree(value) {
    if (/master|硕士/i.test(value))
        return '硕士';
    if (/bachelor|本科/i.test(value))
        return '本科';
    if (/doctor|phd|博士/i.test(value))
        return '博士';
    return value;
}
function normalizedIndustry(record) {
    const direct = recordText(record, 'industry');
    const aliases = Array.isArray(record['industryAliases'])
        ? record['industryAliases'].filter((item) => typeof item === 'string')
        : [];
    const value = direct ?? aliases[0];
    if (value === undefined)
        return undefined;
    if (/广告|会展|公关|营销/.test(value))
        return '广告';
    if (/AI|人工智能|互联网|软件|信息技术/i.test(value)) {
        return '软件和信息技术';
    }
    return value;
}
function fixedFailure(key, label, code) {
    return { key, outcome: 'failed', code, message: `${label}写入或读回失败` };
}
async function fillText(locator, value, key, label) {
    if (value === undefined) {
        return { key, outcome: 'skipped', code: 'no_resolved_value' };
    }
    const result = await fillTextControl(locator, value, { timeoutMs: 6_000 });
    return result.ok
        ? { key, outcome: result.changed ? 'filled' : 'unchanged' }
        : fixedFailure(key, label, 'netease_text_fill_failed');
}
async function fillDate(page, locator, value, key, label) {
    if (value === undefined) {
        return { key, outcome: 'skipped', code: 'no_resolved_value' };
    }
    const direct = await fillDateControl(locator, value, { timeoutMs: 4_000 });
    if (direct.ok) {
        return { key, outcome: direct.changed ? 'filled' : 'unchanged' };
    }
    try {
        await locator.click({ force: true, timeout: 4_000 });
        if (/^\d{4}-\d{2}$/.test(value)) {
            const [year = '', month = ''] = value.split('-');
            let panel = page.locator('.ant-calendar-month-panel:visible').last();
            if ((await panel.count()) > 0) {
                const currentYear = (await panel
                    .locator('.ant-calendar-month-panel-year-select-content')
                    .innerText()).trim();
                if (currentYear !== year) {
                    await panel.locator('.ant-calendar-month-panel-year-select').click();
                    const yearCell = page
                        .locator(`.ant-calendar-year-panel:visible td[title="${year}"]`)
                        .last();
                    if ((await yearCell.count()) === 0) {
                        throw new Error(`netease_month_year_not_found:${year}`);
                    }
                    await yearCell.click();
                    panel = page.locator('.ant-calendar-month-panel:visible').last();
                }
                const monthNames = [
                    '一月',
                    '二月',
                    '三月',
                    '四月',
                    '五月',
                    '六月',
                    '七月',
                    '八月',
                    '九月',
                    '十月',
                    '十一月',
                    '十二月',
                ];
                const monthName = monthNames[Number(month) - 1];
                if (monthName === undefined) {
                    throw new Error(`netease_month_invalid:${month}`);
                }
                await panel.locator(`td[title="${monthName}"]`).click();
                await page.waitForTimeout(150);
                return (await locator.inputValue().catch(() => '')) === value
                    ? { key, outcome: 'filled' }
                    : fixedFailure(key, label, 'netease_date_readback_failed');
            }
        }
        const input = page.locator('.ant-calendar-input:visible').first();
        if ((await input.count()) > 0) {
            await input.fill(value, { timeout: 4_000 });
            await input.press('Enter', { timeout: 4_000 });
            await page.keyboard.press('Escape').catch(() => undefined);
        }
    }
    catch {
        return fixedFailure(key, label, 'netease_date_fill_failed');
    }
    return (await locator.inputValue().catch(() => '')) === value
        ? { key, outcome: 'filled' }
        : fixedFailure(key, label, 'netease_date_readback_failed');
}
async function selectAntOption(page, locator, value, key, label) {
    if (value === undefined) {
        return { key, outcome: 'skipped', code: 'no_resolved_value' };
    }
    if ((await locator.evaluate((element) => element.tagName).catch(() => '')) === 'SELECT') {
        const beforeValue = await locator.inputValue().catch(() => '');
        const beforeLabel = (await locator.locator('option:checked').textContent().catch(() => ''))?.trim();
        if (beforeValue === value || beforeLabel === value) {
            return { key, outcome: 'unchanged' };
        }
        try {
            await locator.selectOption({ label: value }, { timeout: 6_000 });
        }
        catch {
            return fixedFailure(key, label, 'netease_select_failed');
        }
        const afterValue = await locator.inputValue().catch(() => '');
        const afterLabel = (await locator.locator('option:checked').textContent().catch(() => ''))?.trim();
        return afterValue === value || afterLabel === value
            ? { key, outcome: 'filled' }
            : fixedFailure(key, label, 'netease_select_readback_failed');
    }
    const before = (await locator.innerText().catch(() => '')).trim();
    if (optionTextMatches(before, value)) {
        return { key, outcome: 'unchanged' };
    }
    try {
        await locator.click({ force: true, timeout: 6_000 });
        await page.keyboard.insertText(value);
        const dropdown = page.locator('.ant-select-dropdown:visible').last();
        const exact = dropdown.locator('li').filter({ hasText: new RegExp(`^${escapeRegExp(value)}$`) }).first();
        const partial = dropdown.locator('li').filter({ hasText: value }).first();
        const option = (await exact.count()) > 0 ? exact : partial;
        if ((await option.count()) === 0) {
            await page.keyboard.press('Escape').catch(() => undefined);
            return fixedFailure(key, label, 'netease_option_not_found');
        }
        await option.click({ force: true, timeout: 6_000 });
        await page.keyboard.press('Escape').catch(() => undefined);
    }
    catch {
        return fixedFailure(key, label, 'netease_select_failed');
    }
    return optionTextMatches(await locator.innerText().catch(() => ''), value)
        ? { key, outcome: 'filled' }
        : fixedFailure(key, label, 'netease_select_readback_failed');
}
function optionTextMatches(actual, expected) {
    const compact = (value) => value
        .replace(/\s+/g, '')
        .replace(/^请输入公司名称/, '')
        .replace(/(?:股份有限公司|有限责任公司|有限公司|公司)$/u, '');
    const left = compact(actual);
    const right = compact(expected);
    return left !== '' && right !== '' && (left.includes(right) || right.includes(left));
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
async function markCards(page, kind) {
    const config = {
        education: {
            anchor: 'input[placeholder="请填写学院全称"]',
            required: 'input[placeholder="请填写专业全称"]',
            minSelects: 2,
            minDates: 2,
        },
        experience: {
            anchor: 'input[placeholder="请输入岗位名称"]',
            required: 'textarea[placeholder="请输入工作职责"]',
            minSelects: 2,
            minDates: 2,
        },
        project: {
            anchor: 'input[placeholder="请输入项目全称"]',
            required: 'textarea[placeholder="请填写项目描述"]',
            minSelects: 0,
            minDates: 2,
        },
        skill: {
            anchor: 'input[placeholder="请输入技能名称"]',
            required: '.ant-select',
            minSelects: 1,
            minDates: 0,
        },
    }[kind];
    await page.evaluate(({ kind: cardKind, config: cardConfig, attribute }) => {
        document
            .querySelectorAll(`[${attribute}^="${cardKind}-"]`)
            .forEach((element) => element.removeAttribute(attribute));
        const anchors = Array.from(document.querySelectorAll(cardConfig.anchor));
        anchors.forEach((anchor, index) => {
            let node = anchor.parentElement;
            for (let depth = 0; depth < 16 && node !== null; depth += 1) {
                const matches = node.querySelector(cardConfig.required) !== null &&
                    node.querySelectorAll('.ant-select').length >= cardConfig.minSelects &&
                    node.querySelectorAll('input.ant-calendar-picker-input, input[type=date], input[type=month]')
                        .length >= cardConfig.minDates;
                if (matches) {
                    node.setAttribute(attribute, `${cardKind}-${index}`);
                    break;
                }
                node = node.parentElement;
            }
        });
    }, { kind, config, attribute: CARD_ATTRIBUTE });
}
async function cards(page, kind) {
    await markCards(page, kind);
    return page.locator(`[${CARD_ATTRIBUTE}^="${kind}-"]`);
}
async function markAddAction(page, heading, kind) {
    return page.evaluate(({ sectionHeading, cardKind }) => {
        const all = Array.from(document.querySelectorAll('*'));
        const heading = all.find((element) => (element.textContent ?? '').trim() === sectionHeading);
        if (heading === undefined) {
            return false;
        }
        const numbered = all.filter((element) => /^\d+\.\s/.test((element.textContent ?? '').trim()));
        const nextHeading = numbered.find((element) => element !== heading &&
            Boolean(heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING));
        const actions = Array.from(document.querySelectorAll('i.anticon-plus-circle, button, a, span'));
        const target = actions.find((element) => {
            const text = (element.textContent ?? '').trim();
            const className = String(element.getAttribute('class') ?? '');
            const looksLikeAdd = /plus-circle/.test(className) || /^添加/.test(text);
            const afterHeading = Boolean(heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
            const beforeNext = nextHeading === undefined ||
                Boolean(element.compareDocumentPosition(nextHeading) & Node.DOCUMENT_POSITION_FOLLOWING);
            return looksLikeAdd && afterHeading && beforeNext;
        });
        if (target === undefined) {
            return false;
        }
        target.setAttribute('data-official-apply-add', cardKind);
        return true;
    }, { sectionHeading: heading, cardKind: kind });
}
async function addCard(page, kind, heading) {
    const before = await (await cards(page, kind)).count();
    if (!(await markAddAction(page, heading, kind))) {
        return false;
    }
    await page.locator(`[data-official-apply-add="${kind}"]`).click({ force: true, timeout: 6_000 });
    await page.waitForTimeout(350);
    return (await (await cards(page, kind)).count()) > before;
}
async function cardFingerprint(card) {
    const inputValues = await card.locator('input:not([type=checkbox]):not([type=radio]), textarea')
        .evaluateAll((elements) => elements
        .map((element) => element.value.trim())
        .filter((value) => value !== ''))
        .catch(() => []);
    const nativeSelected = await card.locator('select option:checked')
        .allTextContents()
        .catch(() => []);
    const antSelected = await card.locator('.ant-select-selection-selected-value, .ant-select-selection__rendered')
        .allTextContents()
        .catch(() => []);
    return [...inputValues, ...nativeSelected, ...antSelected]
        .map((value) => value.trim())
        .filter((value) => value !== '' && !/^请选择/.test(value));
}
async function assignCards(page, kind, heading, records, identity, maxCards) {
    const assigned = [];
    const used = new Set();
    for (const record of records) {
        let list = await cards(page, kind);
        let count = await list.count();
        const wanted = identity(record);
        let selected = -1;
        if (wanted !== undefined) {
            for (let index = 0; index < count; index += 1) {
                if (used.has(index))
                    continue;
                const fingerprint = await cardFingerprint(list.nth(index));
                if (fingerprint.some((value) => value.includes(wanted) || wanted.includes(value))) {
                    selected = index;
                    break;
                }
            }
        }
        if (selected < 0) {
            for (let index = 0; index < count; index += 1) {
                if (used.has(index))
                    continue;
                if ((await cardFingerprint(list.nth(index))).length === 0) {
                    selected = index;
                    break;
                }
            }
        }
        if (selected < 0) {
            if (maxCards !== undefined && count >= maxCards) {
                selected = Array.from({ length: count }, (_, index) => index).find((index) => !used.has(index)) ?? -1;
            }
        }
        if (selected < 0) {
            if (!(await addCard(page, kind, heading))) {
                assigned.push({ record, index: -1 });
                continue;
            }
            list = await cards(page, kind);
            count = await list.count();
            selected = count - 1;
        }
        used.add(selected);
        assigned.push({ record, card: list.nth(selected), index: selected });
    }
    return assigned;
}
async function fillEducation(page, records, awards) {
    const results = [];
    const assigned = await assignCards(page, 'education', '2. 教育背景（必填）', records, (record) => recordText(record, 'school', 'profile.education[].school'));
    for (const item of assigned) {
        const prefix = `education[${item.index}]`;
        if (item.card === undefined) {
            results.push(fixedFailure(prefix, '教育经历', 'netease_add_education_failed'));
            continue;
        }
        const selects = item.card.locator('.ant-select');
        const dates = item.card.locator('input.ant-calendar-picker-input, input[type=date], input[type=month]');
        results.push(await selectAntOption(page, selects.nth(0), normalizedDegree(recordText(item.record, 'degree', 'profile.education[].degree') ?? ''), `${prefix}.degree`, '学历'));
        results.push(await selectAntOption(page, selects.nth(1), recordText(item.record, 'school', 'profile.education[].school'), `${prefix}.school`, '学校'));
        results.push(await fillDate(page, dates.nth(0), recordText(item.record, 'startDate', 'start_date', 'profile.education[].start_date'), `${prefix}.startDate`, '入校时间'));
        results.push(await fillDate(page, dates.nth(1), recordText(item.record, 'endDate', 'end_date', 'profile.education[].end_date'), `${prefix}.endDate`, '毕业时间'));
        results.push(await fillText(item.card.locator('input[placeholder="请填写学院全称"]').first(), recordText(item.record, 'college', 'profile.education[].college'), `${prefix}.college`, '学院'));
        results.push(await fillText(item.card.locator('input[placeholder="请填写专业全称"]').first(), recordText(item.record, 'major', 'profile.education[].major'), `${prefix}.major`, '专业'));
        const fullTime = recordBoolean(item.record, 'fullTime', 'full_time');
        const checkbox = item.card.locator('input[type=checkbox]').last();
        if (fullTime !== undefined && (await checkbox.count()) > 0) {
            const checked = await setCheckbox(checkbox, fullTime, { timeoutMs: 5_000 });
            results.push(checked.ok
                ? {
                    key: `${prefix}.fullTime`,
                    outcome: checked.changed ? 'filled' : 'unchanged',
                }
                : fixedFailure(`${prefix}.fullTime`, '全日制', 'netease_checkbox_failed'));
        }
    }
    if (awards.length > 0 && assigned.length > 0) {
        const latest = assigned
            .filter((item) => item.card !== undefined)
            .sort((left, right) => {
            const leftEnd = recordText(left.record, 'endDate', 'end_date') ?? '';
            const rightEnd = recordText(right.record, 'endDate', 'end_date') ?? '';
            return rightEnd.localeCompare(leftEnd);
        })[0];
        if (latest?.card !== undefined) {
            const awardText = awards
                .map((award) => [recordText(award, 'date'), recordText(award, 'name'), recordText(award, 'level')]
                .filter(Boolean)
                .join(' '))
                .filter(Boolean)
                .join('\n');
            results.push(await fillText(latest.card.locator('textarea[placeholder="请说明获奖时间和获奖名称"]').first(), awardText === '' ? undefined : awardText, 'awards', '荣誉奖项'));
        }
    }
    return results;
}
async function fillExperience(page, records) {
    const results = [];
    const assigned = await assignCards(page, 'experience', '3. 工作/实习经历', records, (record) => recordText(record, 'title', 'profile.experience[].title') ??
        recordText(record, 'company', 'profile.experience[].company'));
    for (const item of assigned) {
        const prefix = `experience[${item.index}]`;
        if (item.card === undefined) {
            results.push(fixedFailure(prefix, '工作经历', 'netease_add_experience_failed'));
            continue;
        }
        const selects = item.card.locator('.ant-select');
        const dates = item.card.locator('input.ant-calendar-picker-input, input[type=date], input[type=month]');
        const title = recordText(item.record, 'title', 'profile.experience[].title');
        results.push(await fillDate(page, dates.nth(0), recordText(item.record, 'startDate', 'start_date', 'profile.experience[].start_date'), `${prefix}.startDate`, '工作开始时间'));
        results.push(await fillDate(page, dates.nth(1), recordText(item.record, 'endDate', 'end_date', 'profile.experience[].end_date'), `${prefix}.endDate`, '工作结束时间'));
        results.push(await selectAntOption(page, selects.nth(0), recordText(item.record, 'employmentType', 'employment_type') ??
            (title !== undefined && /实习/.test(title) ? '实习' : undefined), `${prefix}.employmentType`, '工作性质'));
        results.push(await selectAntOption(page, selects.nth(1), recordText(item.record, 'company', 'profile.experience[].company'), `${prefix}.company`, '公司名称'));
        results.push(await selectAntOption(page, selects.nth(2), normalizedIndustry(item.record), `${prefix}.industry`, '公司类型'));
        results.push(await fillText(item.card.locator('input[placeholder="请输入部门名称"]').first(), recordText(item.record, 'department', 'profile.experience[].department'), `${prefix}.department`, '部门'));
        results.push(await fillText(item.card.locator('input[placeholder="请输入岗位名称"]').first(), title, `${prefix}.title`, '岗位名称'));
        results.push(await fillText(item.card.locator('textarea[placeholder="请输入工作职责"]').first(), fullRecordDescription(item.record, 'profile.experience[].description'), `${prefix}.description`, '工作职责'));
    }
    return results;
}
async function fillProjects(page, records) {
    const results = [];
    const assigned = await assignCards(page, 'project', '4. 项目/活动经历', records, (record) => recordText(record, 'name', 'profile.project[].name'), MAX_PROJECT_CARDS);
    for (const item of assigned) {
        const prefix = `project[${item.index}]`;
        if (item.card === undefined) {
            results.push(fixedFailure(prefix, '项目经历', 'netease_add_project_failed'));
            continue;
        }
        const dates = item.card.locator('input.ant-calendar-picker-input, input[type=date], input[type=month]');
        results.push(await fillDate(page, dates.nth(0), recordText(item.record, 'startDate', 'start_date', 'profile.project[].start_date'), `${prefix}.startDate`, '项目开始时间'));
        results.push(await fillDate(page, dates.nth(1), recordText(item.record, 'endDate', 'end_date', 'profile.project[].end_date'), `${prefix}.endDate`, '项目结束时间'));
        results.push(await fillText(item.card.locator('input[placeholder="请输入项目全称"]').first(), recordText(item.record, 'name', 'profile.project[].name'), `${prefix}.name`, '项目名称'));
        const description = fullRecordDescription(item.record, 'profile.project[].description');
        results.push(await fillText(item.card.locator('textarea[placeholder="请填写项目描述"]').first(), description, `${prefix}.description`, '项目描述'));
    }
    return results;
}
async function fillSkills(page, records) {
    const results = [];
    const assigned = await assignCards(page, 'skill', '6. 专业技能', records, (record) => recordText(record, 'name', 'skill'), MAX_SKILL_CARDS);
    for (const item of assigned) {
        const prefix = `skill[${item.index}]`;
        if (item.card === undefined) {
            results.push(fixedFailure(prefix, '专业技能', 'netease_add_skill_failed'));
            continue;
        }
        results.push(await fillText(item.card.locator('input[placeholder="请输入技能名称"]').first(), recordText(item.record, 'name', 'skill'), `${prefix}.name`, '技能名称'));
        results.push(await selectAntOption(page, item.card.locator('.ant-select').first(), recordText(item.record, 'level', 'proficiency'), `${prefix}.level`, '掌握程度'));
    }
    return results;
}
async function markResumeUpload(page) {
    return page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input[type=file]'));
        const target = inputs.find((input) => {
            let node = input.parentElement;
            for (let depth = 0; depth < 8 && node !== null; depth += 1) {
                const text = (node.textContent ?? '').replace(/\s+/g, '');
                if (text.includes('简历') && !text.includes('简历解析')) {
                    return true;
                }
                node = node.parentElement;
            }
            return false;
        });
        if (target === undefined) {
            return false;
        }
        target.setAttribute('data-official-apply-resume', 'true');
        return true;
    });
}
async function hasExistingResumeAttachment(page, localPath) {
    const fileName = localPath.split(/[\\/]/).at(-1);
    if (fileName === undefined || fileName === '')
        return false;
    const links = await page.locator('a').allInnerTexts().catch(() => []);
    return links.some((value) => value.trim() === fileName);
}
async function validateTextValue(locator, expected, key, label, issues) {
    if (expected === undefined)
        return 0;
    if ((await readControlValue(locator)) !== expected) {
        issues.push({ key, code: 'value_mismatch', message: `${label}读回失败`, severity: 'error' });
    }
    return 1;
}
async function validateNeteasePage(page, payload) {
    const issues = [];
    let checkedCount = 0;
    const basic = payload.resolved['basic'];
    if (typeof basic === 'object' && basic !== null && !Array.isArray(basic)) {
        checkedCount += await validateTextValue(page.locator('input[placeholder="请填写姓名"]').first(), typeof basic['person.identity.full_name'] === 'string'
            ? basic['person.identity.full_name']
            : undefined, 'person.identity.full_name', '姓名', issues);
    }
    const checks = [
        {
            kind: 'education',
            records: recordsOf(payload, 'education'),
            identity: (record) => recordText(record, 'school', 'profile.education[].school'),
            input: 'input[placeholder="请填写专业全称"]',
            label: '教育经历',
        },
        {
            kind: 'experience',
            records: recordsOf(payload, 'experience'),
            identity: (record) => recordText(record, 'title', 'profile.experience[].title'),
            input: 'input[placeholder="请输入岗位名称"]',
            label: '工作经历',
        },
        {
            kind: 'project',
            records: recordsOf(payload, 'projects'),
            identity: (record) => recordText(record, 'name', 'profile.project[].name'),
            input: 'input[placeholder="请输入项目全称"]',
            label: '项目经历',
        },
        {
            kind: 'skill',
            records: recordsOf(payload, 'skills'),
            identity: (record) => recordText(record, 'name', 'skill'),
            input: 'input[placeholder="请输入技能名称"]',
            label: '专业技能',
        },
    ];
    for (const check of checks) {
        const list = await cards(page, check.kind);
        for (const record of check.records) {
            const expected = check.identity(record);
            if (expected === undefined)
                continue;
            checkedCount += 1;
            let found = false;
            for (let index = 0; index < (await list.count()); index += 1) {
                if ((await cardFingerprint(list.nth(index))).some((value) => value.includes(expected))) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                issues.push({
                    key: `${check.kind}.identity`,
                    code: 'value_mismatch',
                    message: `${check.label}中的关键名称读回失败`,
                    severity: 'error',
                });
            }
        }
    }
    return { valid: issues.length === 0, checkedCount, issues };
}
function saveResponse(page) {
    return page
        .waitForResponse((response) => response.url().includes('saveResume'), { timeout: 15_000 })
        .catch(() => undefined);
}
export function createNeteaseResumePage(options = {}) {
    const host = options.host ?? HOST;
    const pathPattern = options.pathPattern ?? PATH;
    return {
        id: 'netease.campus-game.resume',
        version: 2,
        host,
        pageKind: 'resume_edit',
        status: 'verified',
        lastVerifiedAt: '2026-08-28T17:55:00.000+08:00',
        async match(page) {
            const url = new URL(page.url());
            const hostMatched = url.hostname === host;
            const pathMatched = url.pathname === pathPattern;
            if (hostMatched && pathMatched) {
                await page
                    .getByText(SECTION_HEADINGS[0], { exact: true })
                    .first()
                    .waitFor({ state: 'visible', timeout: 15_000 })
                    .catch(() => undefined);
            }
            const checks = await Promise.all(SECTION_HEADINGS.slice(0, 4).map(async (heading) => ({
                heading,
                found: (await page.getByText(heading, { exact: true }).count()) > 0,
            })));
            const matchedAnchors = checks.filter((item) => item.found).map((item) => item.heading);
            const missingAnchors = checks.filter((item) => !item.found).map((item) => item.heading);
            const matched = hostMatched && pathMatched && missingAnchors.length === 0;
            return {
                matched,
                confidence: matched ? 1 : hostMatched && pathMatched ? 0.5 : 0,
                allowRun: matched,
                reasons: [hostMatched ? '域名匹配' : '域名不匹配', pathMatched ? '路径匹配' : '路径不匹配'],
                matchedAnchors,
                missingAnchors,
                pageVersionChanged: hostMatched && pathMatched && missingAnchors.length > 0,
            };
        },
        async inspect(page) {
            const counts = {};
            for (const kind of ['education', 'experience', 'project', 'skill']) {
                counts[kind] = await (await cards(page, kind)).count();
            }
            return {
                url: page.url(),
                title: await page.title(),
                pageKind: 'resume_edit',
                anchors: SECTION_HEADINGS,
                runtimeData: counts,
            };
        },
        prepare(input) {
            const fullName = input.basic['person.identity.full_name'];
            const missing = [];
            input.experience.forEach((record, index) => {
                const title = recordText(record.values, 'title') ?? '';
                if (!recordText(record.values, 'employmentType', 'employment_type') && !/实习/.test(title)) {
                    missing.push({ key: `experience[${index}].employmentType`, reason: '任职性质没有明确来源，需要用户补充' });
                }
            });
            if (typeof fullName !== 'string' || fullName === '') {
                missing.push({ key: 'person.identity.full_name', reason: '没有已确定答案' });
            }
            if (input.education.length === 0) {
                missing.push({ key: 'education', reason: '网易简历要求至少一段教育经历' });
            }
            return {
                resolved: {
                    basic: input.basic,
                    education: sectionValue(input.education),
                    experience: sectionValue(input.experience),
                    projects: input.projects.slice(0, MAX_PROJECT_CARDS).map((record) => record.values),
                    awards: sectionValue(input.awards),
                    skills: packSkills((input.skills ?? []).map((record) => record.values)),
                    ...(input.materials?.['attachment.resume'] === undefined
                        ? {}
                        : { 'attachment.resume': input.materials['attachment.resume'] }),
                },
                missing,
                conflicts: [],
                skipped: [
                    ...input.projects.slice(MAX_PROJECT_CARDS).map((record, index) => ({
                        key: `projects[${MAX_PROJECT_CARDS + index}]`,
                        reason: `官网最多填写 ${MAX_PROJECT_CARDS} 个独立项目；${String(record.values['name'] ?? record.values['label'] ?? '该项目')}未填写到官网`,
                    })),
                    ...(input.languages === undefined || input.languages.length === 0
                        ? []
                        : [{ key: 'languages', reason: '语言能力暂未从正式 payload 写入网易页面' }]),
                ],
            };
        },
        async fill(page, payload) {
            const results = [];
            const basic = payload.resolved['basic'];
            if (typeof basic === 'object' && basic !== null && !Array.isArray(basic)) {
                results.push(await fillText(page.locator('input[placeholder="请填写姓名"]').first(), typeof basic['person.identity.full_name'] === 'string'
                    ? basic['person.identity.full_name']
                    : undefined, 'person.identity.full_name', '姓名'));
            }
            results.push(...(await fillEducation(page, recordsOf(payload, 'education'), recordsOf(payload, 'awards'))));
            results.push(...(await fillExperience(page, recordsOf(payload, 'experience'))));
            results.push(...(await fillProjects(page, recordsOf(payload, 'projects'))));
            results.push(...(await fillSkills(page, recordsOf(payload, 'skills'))));
            const resume = payload.resolved['attachment.resume'];
            if (typeof resume === 'object' &&
                resume !== null &&
                !Array.isArray(resume) &&
                typeof resume['localPath'] === 'string') {
                if (await hasExistingResumeAttachment(page, resume['localPath'])) {
                    results.push({ key: 'attachment.resume', outcome: 'unchanged' });
                }
                else if (await markResumeUpload(page)) {
                    try {
                        await page
                            .locator('input[data-official-apply-resume="true"]')
                            .setInputFiles(resume['localPath']);
                        results.push({ key: 'attachment.resume', outcome: 'filled' });
                    }
                    catch {
                        results.push(fixedFailure('attachment.resume', '简历附件', 'netease_upload_failed'));
                    }
                }
                else {
                    results.push(fixedFailure('attachment.resume', '简历附件', 'netease_upload_not_found'));
                }
            }
            const failed = results.filter((result) => result.outcome === 'failed');
            return {
                attemptedCount: results.filter((result) => result.outcome !== 'skipped').length,
                filledCount: results.filter((result) => result.outcome === 'filled').length,
                unchangedCount: results.filter((result) => result.outcome === 'unchanged').length,
                skippedCount: results.filter((result) => result.outcome === 'skipped').length,
                failed,
                fields: results,
                requiresRescan: false,
            };
        },
        validate(page, payload) {
            return validateNeteasePage(page, payload);
        },
        async saveDraft(page, payload) {
            const button = page.locator('button').filter({ hasText: /保\s*存/ }).last();
            if ((await button.count()) === 0) {
                return {
                    attempted: false,
                    saved: false,
                    message: '找不到保存按钮',
                    evidence: [],
                    pageChanged: false,
                };
            }
            const beforeUrl = page.url();
            const pending = saveResponse(page);
            await button.click({ force: true, timeout: 6_000 });
            const response = await pending;
            const evidence = [];
            if (response !== undefined && response.status() >= 200 && response.status() < 300) {
                evidence.push({
                    kind: 'network_response',
                    strength: 'strong',
                    description: `saveResume 返回 HTTP ${response.status()}`,
                });
            }
            const message = (await page.locator('.ant-message, [role=status]').allInnerTexts().catch(() => [])).join(' ');
            if (/保存成功|保存完成|已保存/.test(message)) {
                evidence.push({ kind: 'toast', strength: 'weak', description: '页面出现保存成功提示' });
            }
            if (response === undefined && evidence.some((item) => item.kind === 'toast')) {
                await page.reload({ waitUntil: 'domcontentloaded' });
                const reloaded = await validateNeteasePage(page, payload);
                if (reloaded.valid) {
                    evidence.push({
                        kind: 'reload_readback',
                        strength: 'strong',
                        description: '刷新后关键字段仍能读回',
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
        },
    };
}
export const neteaseResumePage = createNeteaseResumePage();
//# sourceMappingURL=resume-page.js.map