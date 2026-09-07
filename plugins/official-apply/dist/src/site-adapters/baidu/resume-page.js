import { fullRecordDescription, fullProjectDescription } from "../../materials/record-description.js";
import { fillTextControl, readControlValue } from "../../browser/actions/fill-text-control.js";
const HOST = 'talent.baidu.com';
const PATHS = new Set(['/jobs/resume/create', '/jobs/resume/edit']);
function recordText(record, ...keys) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim() !== '')
            return value.trim();
        if (typeof value === 'number')
            return String(value);
    }
    return undefined;
}
function recordsOf(payload, key) {
    const value = payload.resolved[key];
    return Array.isArray(value)
        ? value.filter((item) => typeof item === 'object' && item !== null && !Array.isArray(item))
        : [];
}
function sectionValue(records) {
    return records.map((record) => record.values);
}
function field(page, suffix) {
    return page.locator(`[class*="-${suffix}"]`).first();
}
function fixedFailure(key, label, code) {
    return { key, outcome: 'failed', code, message: `${label}写入或读回失败` };
}
function materialPath(payload, key) {
    const materials = payload.resolved['materials'];
    if (typeof materials !== 'object' || materials === null || Array.isArray(materials)) {
        return undefined;
    }
    const material = materials[key];
    if (typeof material !== 'object' || material === null || Array.isArray(material)) {
        return undefined;
    }
    return typeof material['localPath'] === 'string' ? material['localPath'] : undefined;
}
async function fillResumeAttachment(page, localPath) {
    const key = 'attachment.resume';
    if (localPath === undefined)
        return { key, outcome: 'skipped', code: 'no_resolved_value' };
    const input = page.locator('input[type=file]').nth(0);
    if ((await input.count()) === 0) {
        return fixedFailure(key, '附件简历', 'baidu_resume_upload_not_found');
    }
    const pending = page
        .waitForResponse((response) => {
        const method = response.request().method();
        return (response.url().includes('talent.baidu.com') &&
            method !== 'GET' &&
            method !== 'HEAD' &&
            method !== 'OPTIONS');
    }, { timeout: 30_000 })
        .catch(() => undefined);
    await input.setInputFiles(localPath, { timeout: 30_000 });
    const replaceOnly = page.getByRole('button', { name: '仅替换简历', exact: true });
    const uploadChoiceShown = await replaceOnly
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
    if (uploadChoiceShown) {
        await replaceOnly.click({ timeout: 6_000 });
    }
    const response = await pending;
    const selected = (await input.inputValue().catch(() => '')) !== '';
    return response?.ok() === true || selected
        ? { key, outcome: 'filled' }
        : fixedFailure(key, '附件简历', 'baidu_resume_upload_failed');
}
function stringValues(value) {
    if (typeof value === 'string' && value.trim() !== '') {
        return [value.trim()];
    }
    if (Array.isArray(value)) {
        return value
            .filter((item) => typeof item === 'string' && item.trim() !== '')
            .map((item) => item.trim());
    }
    return [];
}
function normalizedOption(value) {
    return value.toLowerCase().replace(/[\s/、（）()_-]+/g, '');
}
function optionScore(option, intent) {
    const candidate = normalizedOption(option);
    const wanted = normalizedOption(intent);
    if (candidate === '' || wanted === '')
        return 0;
    if (candidate === wanted)
        return 100;
    if (candidate.includes(wanted))
        return 90;
    if (wanted.includes(candidate))
        return 80;
    if (/线上|远程/.test(intent) && option.includes('国内远程'))
        return 95;
    if (/ai|人工智能|互联网/i.test(intent) && option.includes('互联网'))
        return 85;
    return 0;
}
async function antSelectedText(select) {
    const item = select.locator('.ant-select-selection-item');
    return (await item.count()) === 0
        ? ''
        : ((await item.first().textContent({ timeout: 500 }).catch(() => ''))?.trim() ?? '');
}
async function fillText(locator, value, key, label) {
    if (value === undefined)
        return { key, outcome: 'skipped', code: 'no_resolved_value' };
    if ((await locator.count()) === 0) {
        return fixedFailure(key, label, 'baidu_field_not_found');
    }
    const outcome = await fillTextControl(locator.first(), value, { timeoutMs: 6_000 });
    return outcome.ok
        ? { key, outcome: outcome.changed ? 'filled' : 'unchanged' }
        : fixedFailure(key, label, 'baidu_text_fill_failed');
}
async function fillAntSearch(page, root, value, key, label, acceptWithEnter = false) {
    if (value === undefined)
        return { key, outcome: 'skipped', code: 'no_resolved_value' };
    const select = root.locator('.ant-select').first();
    if ((await select.count()) === 0) {
        return fixedFailure(key, label, 'baidu_select_not_found');
    }
    const input = select.locator('input[role=combobox]').first();
    const current = await antSelectedText(select);
    const currentInput = (await input.inputValue().catch(() => '')).trim();
    if (current === value || currentInput === value) {
        return { key, outcome: 'unchanged' };
    }
    let lastStage = 'unknown';
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            lastStage = 'click';
            await select.locator('.ant-select-selector').click({ timeout: 6_000 });
            lastStage = 'fill';
            await input.fill(value, { timeout: 6_000 });
            await page.waitForTimeout(800);
            if (acceptWithEnter) {
                lastStage = 'enter';
                await input.press('Enter', { timeout: 6_000 });
            }
            else {
                lastStage = 'option';
                const options = page.locator('.ant-select-dropdown:visible .ant-select-item-option, .ant-select-dropdown:visible [role=option]');
                const exact = options.filter({ hasText: new RegExp(`^${escapeRegExp(value)}$`) }).first();
                const partial = options.filter({ hasText: value }).first();
                const option = (await exact.count()) > 0 ? exact : partial;
                if ((await option.count()) === 0) {
                    await page.keyboard.press('Escape').catch(() => undefined);
                    throw new Error('option_not_ready');
                }
                lastStage = 'option_click';
                await option.click({ timeout: 6_000 });
            }
            await page.waitForTimeout(200);
            lastStage = 'readback';
            const accepted = (await antSelectedText(select)) === value ||
                (await input.inputValue().catch(() => '')) === value;
            if (accepted)
                return { key, outcome: 'filled' };
        }
        catch (error) {
            lastError = (error instanceof Error ? (error.message.split('\n')[0] ?? error.name) : String(error))
                .replaceAll(value, '<value>')
                .slice(0, 180);
            await page.keyboard.press('Escape').catch(() => undefined);
        }
        await page.waitForTimeout(300);
    }
    return {
        ...fixedFailure(key, label, `baidu_select_${lastStage}_failed`),
        ...(lastError === '' ? {} : { message: `${label}${lastStage}失败：${lastError}` }),
    };
}
async function fillBrickSelect(page, root, value, key, label) {
    if (value === undefined)
        return { key, outcome: 'skipped', code: 'no_resolved_value' };
    const selection = root.locator('.brick-select-selection').first();
    if ((await selection.count()) === 0) {
        return fixedFailure(key, label, 'baidu_brick_select_not_found');
    }
    const current = (await root.locator('.brick-select-selection-selected').textContent().catch(() => ''))?.trim();
    if (current === value)
        return { key, outcome: 'unchanged' };
    try {
        await selection.click({ timeout: 6_000 });
        const options = page.locator('.brick-popup-visible .brick-select-option');
        const exact = options.filter({ hasText: new RegExp(`^${escapeRegExp(value)}$`) }).first();
        const partial = options.filter({ hasText: value }).first();
        const option = (await exact.count()) > 0 ? exact : partial;
        if ((await option.count()) === 0) {
            await page.keyboard.press('Escape').catch(() => undefined);
            return fixedFailure(key, label, 'baidu_brick_option_not_found');
        }
        await option.click({ timeout: 6_000 });
    }
    catch {
        return fixedFailure(key, label, 'baidu_brick_select_failed');
    }
    const after = (await root.locator('.brick-select-selection-selected').textContent().catch(() => ''))?.trim();
    return after === value
        ? { key, outcome: 'filled' }
        : fixedFailure(key, label, 'baidu_brick_select_readback_failed');
}
async function fillBrickSelectIntent(page, root, intents, key, label) {
    if (intents.length === 0)
        return { key, outcome: 'skipped', code: 'no_resolved_value' };
    const selection = root.locator('.brick-select-selection').first();
    if ((await selection.count()) === 0) {
        return fixedFailure(key, label, 'baidu_brick_select_not_found');
    }
    const current = (await root.locator('.brick-select-selection-selected').textContent().catch(() => ''))?.trim() ?? '';
    if (intents.some((intent) => optionScore(current, intent) > 0)) {
        return { key, outcome: 'unchanged' };
    }
    try {
        await selection.click({ timeout: 6_000 });
        const options = page.locator('.brick-popup-visible .brick-select-option');
        await options.first().waitFor({ state: 'visible', timeout: 6_000 });
        const texts = (await options.allInnerTexts()).map((text) => text.trim());
        let bestIndex = -1;
        let bestScore = 0;
        for (let intentIndex = 0; intentIndex < intents.length; intentIndex += 1) {
            for (let optionIndex = 0; optionIndex < texts.length; optionIndex += 1) {
                const score = optionScore(texts[optionIndex] ?? '', intents[intentIndex] ?? '') -
                    intentIndex;
                if (score > bestScore) {
                    bestScore = score;
                    bestIndex = optionIndex;
                }
            }
        }
        if (bestIndex < 0) {
            await page.keyboard.press('Escape').catch(() => undefined);
            return fixedFailure(key, label, 'baidu_brick_option_not_found');
        }
        await options.nth(bestIndex).click({ timeout: 6_000 });
    }
    catch {
        return fixedFailure(key, label, 'baidu_brick_select_failed');
    }
    const after = (await root.locator('.brick-select-selection-selected').textContent().catch(() => ''))?.trim() ?? '';
    return after !== '' && intents.some((intent) => optionScore(after, intent) > 0)
        ? { key, outcome: 'filled' }
        : fixedFailure(key, label, 'baidu_brick_select_readback_failed');
}
async function fillGender(page, value) {
    const key = 'person.identity.gender';
    if (value === undefined)
        return { key, outcome: 'skipped', code: 'no_resolved_value' };
    const root = field(page, 'sex');
    const option = root.getByText(value, { exact: true }).first();
    if ((await option.count()) === 0) {
        return fixedFailure(key, '性别', 'baidu_gender_option_not_found');
    }
    const checked = root.locator('input:checked');
    if ((await checked.count()) > 0) {
        return { key, outcome: 'unchanged' };
    }
    await option.click({ timeout: 6_000 });
    const selectedLabel = await root.locator('label:has(input:checked)').innerText().catch(() => '');
    return selectedLabel.trim() === value
        ? { key, outcome: 'filled' }
        : fixedFailure(key, '性别', 'baidu_gender_readback_failed');
}
async function fillPrivacyAgreement(page, value) {
    const key = 'privacy.agreement';
    if (value !== true)
        return { key, outcome: 'skipped', code: 'no_resolved_value' };
    const checkbox = page.getByLabel('我已阅读并同意');
    if ((await checkbox.count()) === 0) {
        return fixedFailure(key, '隐私条款', 'baidu_privacy_checkbox_not_found');
    }
    if (await checkbox.isChecked().catch(() => false)) {
        return { key, outcome: 'unchanged' };
    }
    await checkbox.check({ timeout: 3_000 }).catch(() => undefined);
    if (!(await checkbox.isChecked().catch(() => false))) {
        await page.getByText('我已阅读并同意', { exact: true }).click({ timeout: 6_000 });
    }
    return await checkbox.isChecked().catch(() => false)
        ? { key, outcome: 'filled' }
        : fixedFailure(key, '隐私条款', 'baidu_privacy_readback_failed');
}
async function fillDateRange(root, start, end, prefix) {
    const inputs = root.locator('input');
    return [
        await fillText(inputs.nth(0), start, `${prefix}.startDate`, '开始时间'),
        await fillText(inputs.nth(1), end, `${prefix}.endDate`, '结束时间'),
    ];
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function degreeLabel(value) {
    if (value === undefined)
        return undefined;
    if (/master|硕士/i.test(value))
        return '硕士研究生';
    if (/doctor|phd|博士/i.test(value))
        return '博士研究生';
    if (/bachelor|本科/i.test(value))
        return '本科';
    return value;
}
function sectionTitle(kind) {
    return {
        education: '教育经历',
        experience: '工作经历',
        project: '项目经验',
    }[kind];
}
function identitySuffix(kind, index) {
    return {
        education: `school${index}`,
        experience: `companyName${index}`,
        project: `subjectName${index}`,
    }[kind];
}
function identityOf(kind, record) {
    return {
        education: recordText(record, 'school', 'profile.education[].school'),
        experience: recordText(record, 'company', 'profile.experience[].company'),
        project: recordText(record, 'name', 'profile.project[].name'),
    }[kind];
}
async function currentIdentity(page, kind, index) {
    const root = field(page, identitySuffix(kind, index));
    if (kind === 'education') {
        return antSelectedText(root.locator('.ant-select').first());
    }
    return (await root.locator('input').first().inputValue().catch(() => '')).trim();
}
async function countCards(page, kind) {
    if (kind === 'education') {
        return page.locator('[class*="-school"]').filter({ has: page.locator('.ant-select') }).count();
    }
    const prefix = kind === 'experience' ? 'companyName' : 'subjectName';
    return page.locator(`input[name^="${prefix}"]`).count();
}
async function waitForRepeatIdentities(page) {
    const url = new URL(page.url());
    if (url.pathname !== '/jobs/resume/edit' || !url.searchParams.has('id')) {
        return;
    }
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        let ready = true;
        for (const kind of ['education', 'experience', 'project']) {
            const count = await countCards(page, kind);
            for (let index = 0; index < count; index += 1) {
                if ((await currentIdentity(page, kind, index)) === '') {
                    ready = false;
                    break;
                }
            }
            if (!ready)
                break;
        }
        if (ready)
            return;
        await page.waitForTimeout(200);
    }
}
function addCardControl(page, kind) {
    const section = page
        .locator('[class^="resume-item"], [class*=" resume-item"]')
        .filter({ has: page.getByText(sectionTitle(kind), { exact: true }) })
        .first();
    return section.locator('i[class*="add-icon"]').first();
}
async function addCard(page, kind) {
    const before = await countCards(page, kind);
    const add = addCardControl(page, kind);
    if ((await add.count()) === 0)
        return false;
    await add.click({ timeout: 6_000 });
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
        if ((await countCards(page, kind)) > before)
            return true;
        await page.waitForTimeout(100);
    }
    return false;
}
async function assignIndices(page, kind, records) {
    const result = [];
    const used = new Set();
    for (const record of records) {
        let count = await countCards(page, kind);
        const wanted = identityOf(kind, record);
        let selected = -1;
        for (let index = 0; index < count; index += 1) {
            if (used.has(index))
                continue;
            if (wanted !== undefined && (await currentIdentity(page, kind, index)) === wanted) {
                selected = index;
                break;
            }
        }
        if (selected < 0) {
            for (let index = 0; index < count; index += 1) {
                if (!used.has(index) && (await currentIdentity(page, kind, index)) === '') {
                    selected = index;
                    break;
                }
            }
        }
        if (selected < 0) {
            for (let index = 0; index < count; index += 1) {
                if (!used.has(index)) {
                    selected = index;
                    break;
                }
            }
        }
        if (selected < 0) {
            if (!(await addCard(page, kind))) {
                result.push({ record, index: -1 });
                continue;
            }
            count = await countCards(page, kind);
            selected = count - 1;
            if (selected < 0 || used.has(selected)) {
                result.push({ record, index: -1 });
                continue;
            }
        }
        used.add(selected);
        result.push({ record, index: selected });
    }
    return result;
}
async function fillEducation(page, records) {
    const results = [];
    for (const item of await assignIndices(page, 'education', records)) {
        if (item.index < 0) {
            results.push(fixedFailure('education', '教育经历', 'baidu_add_education_failed'));
            continue;
        }
        const prefix = `education[${item.index}]`;
        results.push(await fillAntSearch(page, field(page, `school${item.index}`), recordText(item.record, 'school', 'profile.education[].school'), `${prefix}.school`, '学校'));
        results.push(...(await fillDateRange(field(page, `edudate${item.index}`), recordText(item.record, 'startDate', 'start_date'), recordText(item.record, 'endDate', 'end_date'), prefix)));
        results.push(await fillBrickSelect(page, field(page, `academic${item.index}`), degreeLabel(recordText(item.record, 'degree')), `${prefix}.degree`, '学历'));
        results.push(await fillAntSearch(page, field(page, `major${item.index}`), recordText(item.record, 'major'), `${prefix}.major`, '专业', true));
    }
    return results;
}
async function fillExperience(page, records) {
    const results = [];
    for (const item of await assignIndices(page, 'experience', records)) {
        if (item.index < 0) {
            results.push(fixedFailure('experience', '工作经历', 'baidu_add_experience_failed'));
            continue;
        }
        const prefix = `experience[${item.index}]`;
        results.push(await fillText(field(page, `companyName${item.index}`).locator('input').first(), recordText(item.record, 'company'), `${prefix}.company`, '企业名称'));
        results.push(await fillBrickSelectIntent(page, field(page, `industryType${item.index}`), [
            ...stringValues(item.record['industry']),
            ...stringValues(item.record['industryAliases']),
        ], `${prefix}.industry`, '行业类别'));
        results.push(...(await fillDateRange(field(page, `workdate${item.index}`), recordText(item.record, 'startDate', 'start_date'), recordText(item.record, 'endDate', 'end_date'), prefix)));
        results.push(await fillText(field(page, `department${item.index}`).locator('input').first(), recordText(item.record, 'department'), `${prefix}.department`, '所在部门'));
        results.push(await fillText(field(page, `positionName${item.index}`).locator('input').first(), recordText(item.record, 'title'), `${prefix}.title`, '职位名称'));
        const description = fullRecordDescription(item.record);
        results.push(await fillText(field(page, `workDesc${item.index}`).locator('textarea[name]').first(), description, `${prefix}.description`, '工作描述'));
    }
    return results;
}
async function fillProjects(page, records) {
    const results = [];
    for (const item of await assignIndices(page, 'project', records)) {
        if (item.index < 0) {
            results.push(fixedFailure('projects', '项目经验', 'baidu_add_project_failed'));
            continue;
        }
        const prefix = `project[${item.index}]`;
        const endDate = recordText(item.record, 'endDate', 'end_date') ??
            (item.record['current'] === true ? new Date().toISOString().slice(0, 7) : undefined);
        results.push(await fillText(field(page, `subjectName${item.index}`).locator('input').first(), recordText(item.record, 'name'), `${prefix}.name`, '项目名称'));
        results.push(await fillText(field(page, `position${item.index}`).locator('input').first(), recordText(item.record, 'role'), `${prefix}.role`, '项目职务'));
        results.push(...(await fillDateRange(field(page, `subjectDate${item.index}`), recordText(item.record, 'startDate', 'start_date'), endDate, prefix)));
        results.push(await fillText(field(page, `subjectDesc${item.index}`).locator('textarea[name]').first(), fullProjectDescription(item.record), `${prefix}.description`, '项目描述'));
        const duties = field(page, `positionDesc${item.index}`).locator('textarea[name]').first();
        if (await duties.count()) {
            results.push(await fillText(duties, '', `${prefix}.responsibilities`, '项目职责'));
        }
    }
    return results;
}
async function expectText(locator, expected, key, label, issues) {
    if (expected === undefined)
        return 0;
    if ((await locator.count()) === 0 || (await readControlValue(locator.first())) !== expected) {
        issues.push({ key, code: 'value_mismatch', message: `${label}读回失败`, severity: 'error' });
    }
    return 1;
}
async function validatePage(page, payload) {
    await waitForRepeatIdentities(page);
    const issues = [];
    let checkedCount = 0;
    const basic = payload.resolved['basic'];
    if (typeof basic === 'object' && basic !== null && !Array.isArray(basic)) {
        for (const [name, key, label] of [
            ['name', 'person.identity.full_name', '姓名'],
            ['mobile', 'person.contact.phone', '移动电话'],
            ['email', 'person.contact.email', '电子邮箱'],
        ]) {
            checkedCount += await expectText(page.locator(`input[name="${name}"]`), typeof basic[key] === 'string' ? basic[key] : undefined, key, label, issues);
        }
    }
    for (const [kind, records] of [
        ['education', recordsOf(payload, 'education')],
        ['experience', recordsOf(payload, 'experience')],
        ['project', recordsOf(payload, 'projects')],
    ]) {
        for (const record of records) {
            checkedCount += 1;
            const expected = identityOf(kind, record);
            let found = false;
            for (let index = 0; index < (await countCards(page, kind)); index += 1) {
                if (expected !== undefined && (await currentIdentity(page, kind, index)) === expected) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                issues.push({
                    key: `${kind}.identity`,
                    code: 'value_mismatch',
                    message: `${sectionTitle(kind)}关键名称读回失败`,
                    severity: 'error',
                });
            }
        }
    }
    const requiredChecks = [
        ['person.identity.gender', field(page, 'sex').locator('input:checked')],
        ['application.preference.desired_city', field(page, 'targetCity').locator('.brick-select-selection-has-value')],
        ['application.preference.desired_role', field(page, 'targetPositionType').locator('.brick-select-selection-has-value')],
        ['application.interview.method', field(page, 'interviewOnlineType').locator('.brick-select-selection-has-value')],
    ];
    for (const [key, locator] of requiredChecks) {
        checkedCount += 1;
        if ((await locator.count()) === 0) {
            issues.push({
                key,
                code: 'required_missing',
                message: `${key} 仍为空`,
                severity: 'blocking',
            });
        }
    }
    checkedCount += 1;
    if (!(await page.getByLabel('我已阅读并同意').isChecked().catch(() => false))) {
        issues.push({
            key: 'privacy.agreement',
            code: 'required_missing',
            message: 'privacy.agreement 仍为空',
            severity: 'blocking',
        });
    }
    for (let index = 0; index < recordsOf(payload, 'experience').length; index += 1) {
        checkedCount += 1;
        if ((await field(page, `industryType${index}`)
            .locator('.brick-select-selection-has-value')
            .count()) === 0) {
            issues.push({
                key: `experience[${index}].industry`,
                code: 'required_missing',
                message: `experience[${index}].industry 仍为空`,
                severity: 'blocking',
            });
        }
    }
    return { valid: issues.length === 0, checkedCount, issues };
}
function waitForSaveResponse(page) {
    return page
        .waitForResponse((response) => {
        const method = response.request().method();
        return (response.url().includes('talent.baidu.com') &&
            method !== 'GET' &&
            method !== 'HEAD' &&
            method !== 'OPTIONS');
    }, { timeout: 15_000 })
        .catch(() => undefined);
}
export const baiduResumePage = {
    id: 'baidu.talent.campus-resume',
    version: 1,
    host: HOST,
    pageKind: 'resume_edit',
    status: 'verified',
    lastVerifiedAt: '2026-08-25T17:27:32.000Z',
    async match(page) {
        const url = new URL(page.url());
        const hostMatched = url.hostname === HOST;
        const pathMatched = PATHS.has(url.pathname);
        if (hostMatched && pathMatched) {
            await Promise.all([
                page
                    .getByText(/创建简历|编辑简历/, { exact: true })
                    .first()
                    .waitFor({ state: 'visible', timeout: 20_000 })
                    .catch(() => undefined),
                page
                    .getByText(/你好[，,]/)
                    .first()
                    .waitFor({ state: 'visible', timeout: 20_000 })
                    .catch(() => undefined),
            ]);
        }
        const heading = (await page.getByText('编辑简历', { exact: true }).count()) > 0
            ? '编辑简历'
            : '创建简历';
        const anchors = [heading, '基础信息', '教育经历', '工作经历', '项目经验'];
        const checks = await Promise.all(anchors.map(async (anchor) => ({
            anchor,
            found: (await page.getByText(anchor, { exact: true }).count()) > 0,
        })));
        const matchedAnchors = checks.filter((item) => item.found).map((item) => item.anchor);
        const missingAnchors = checks.filter((item) => !item.found).map((item) => item.anchor);
        const accountVisible = await page
            .getByText(/你好[，,]/)
            .first()
            .isVisible()
            .catch(() => false);
        const matched = hostMatched && pathMatched && missingAnchors.length === 0 && accountVisible;
        return {
            matched,
            confidence: matched ? 1 : hostMatched && pathMatched && accountVisible ? 0.5 : 0,
            allowRun: matched,
            reasons: [
                hostMatched ? '域名匹配' : '域名不匹配',
                pathMatched ? '路径匹配' : '路径不匹配',
                accountVisible ? '页头显示当前账号' : '当前页面需要登录',
            ],
            matchedAnchors,
            missingAnchors: accountVisible ? missingAnchors : [...missingAnchors, '登录状态'],
            pageVersionChanged: hostMatched && pathMatched && accountVisible && missingAnchors.length > 0,
        };
    },
    async inspect(page) {
        await waitForRepeatIdentities(page);
        const educationCount = await countCards(page, 'education');
        const experienceCount = await countCards(page, 'experience');
        const projectCount = await countCards(page, 'project');
        const projectCanAdd = (await addCardControl(page, 'project').count()) > 0;
        return {
            url: page.url(),
            title: await page.title(),
            pageKind: 'resume_edit',
            anchors: ['创建简历', '基础信息', '教育经历', '工作经历', '项目经验'],
            runtimeData: {
                educationCount,
                experienceCount,
                projectCount,
                projectCanAdd,
                projectCapacity: projectCanAdd ? null : projectCount,
            },
        };
    },
    prepare(input, facts) {
        const missing = [];
        const skipped = [];
        const basic = input.basic;
        for (const key of [
            'person.identity.full_name',
            'person.contact.phone',
            'person.contact.email',
            'person.identity.gender',
            'application.preference.desired_city',
            'application.preference.desired_role',
            'application.interview.method',
            'privacy.agreement',
        ]) {
            if (basic[key] === undefined || basic[key] === null || basic[key] === '') {
                missing.push({ key, reason: '百度必填，但任务资料没有已确定答案' });
            }
        }
        if (input.education.length === 0) {
            missing.push({ key: 'education', reason: '百度简历要求教育经历' });
        }
        input.experience.forEach((record, index) => {
            if (record.values['industry'] === undefined &&
                record.values['profile.experience[].industry'] === undefined) {
                missing.push({
                    key: `experience[${index}].industry`,
                    reason: '百度工作经历要求行业类别，任务资料没有答案',
                });
            }
        });
        const runtimeCapacity = facts.runtimeData?.['projectCapacity'];
        const projectCapacity = typeof runtimeCapacity === 'number' && runtimeCapacity > 0
            ? runtimeCapacity
            : input.projects.length;
        const selectedProjects = input.projects.slice(0, projectCapacity);
        for (let index = selectedProjects.length; index < input.projects.length; index += 1) {
            skipped.push({
                key: `projects[${index}]`,
                reason: `百度当前页面最多保存 ${projectCapacity} 条项目；完整记录保留在附件简历`,
            });
        }
        return {
            resolved: {
                basic,
                education: sectionValue(input.education),
                experience: sectionValue(input.experience),
                projects: sectionValue(selectedProjects),
                materials: input.materials ?? {},
            },
            missing,
            conflicts: [],
            skipped,
        };
    },
    async fill(page, payload) {
        const results = [];
        results.push(await fillResumeAttachment(page, materialPath(payload, 'attachment.resume')));
        const basic = payload.resolved['basic'];
        if (typeof basic === 'object' && basic !== null && !Array.isArray(basic)) {
            results.push(await fillText(page.locator('input[name="name"]'), typeof basic['person.identity.full_name'] === 'string'
                ? basic['person.identity.full_name']
                : undefined, 'person.identity.full_name', '姓名'));
            results.push(await fillText(page.locator('input[name="mobile"]'), typeof basic['person.contact.phone'] === 'string'
                ? basic['person.contact.phone']
                : undefined, 'person.contact.phone', '移动电话'));
            results.push(await fillText(page.locator('input[name="email"]'), typeof basic['person.contact.email'] === 'string'
                ? basic['person.contact.email']
                : undefined, 'person.contact.email', '电子邮箱'));
            results.push(await fillGender(page, typeof basic['person.identity.gender'] === 'string'
                ? basic['person.identity.gender']
                : undefined));
            results.push(await fillBrickSelectIntent(page, field(page, 'targetCity'), stringValues(basic['application.preference.desired_city']), 'application.preference.desired_city', '目标工作城市'));
            results.push(await fillBrickSelectIntent(page, field(page, 'targetPositionType'), stringValues(basic['application.preference.desired_role']), 'application.preference.desired_role', '目标职位类别'));
            results.push(await fillBrickSelectIntent(page, field(page, 'interviewOnlineType'), [
                ...stringValues(basic['application.interview.preferred_method']),
                ...stringValues(basic['application.interview.method']),
            ], 'application.interview.method', '面试方式'));
            results.push(await fillPrivacyAgreement(page, basic['privacy.agreement']));
        }
        await page.waitForTimeout(300);
        results.push(...(await fillEducation(page, recordsOf(payload, 'education'))));
        results.push(...(await fillExperience(page, recordsOf(payload, 'experience'))));
        results.push(...(await fillProjects(page, recordsOf(payload, 'projects'))));
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
        return validatePage(page, payload);
    },
    async saveDraft(page, payload) {
        const button = page.getByRole('button', { name: '保存', exact: true });
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
        const pending = waitForSaveResponse(page);
        await button.click({ timeout: 6_000 });
        const deferIncomplete = page.getByRole('button', { name: '稍后再说', exact: true });
        const warningShown = await deferIncomplete
            .waitFor({ state: 'visible', timeout: 2_000 })
            .then(() => true)
            .catch(() => false);
        if (warningShown) {
            await deferIncomplete.click({ timeout: 6_000 });
        }
        const response = await pending;
        await page.waitForTimeout(500);
        const evidence = [];
        if (warningShown) {
            evidence.push({
                kind: 'dom_marker',
                strength: 'weak',
                description: '页面提示仍有未填写字段；按用户规则选择“稍后再说”保存草稿',
            });
        }
        let siteCode;
        let message;
        let responseSaysSaved = false;
        if (response !== undefined) {
            try {
                const body = (await response.json());
                const rawCode = body['code'] ?? body['status'];
                siteCode = rawCode === undefined ? undefined : String(rawCode);
                message = typeof body['message'] === 'string'
                    ? body['message']
                    : typeof body['msg'] === 'string'
                        ? body['msg']
                        : undefined;
                responseSaysSaved =
                    body['success'] === true ||
                        rawCode === 0 ||
                        rawCode === '0' ||
                        rawCode === 200 ||
                        rawCode === '200';
            }
            catch {
                responseSaysSaved = false;
            }
            if (response.status() >= 200 && response.status() < 300 && responseSaysSaved) {
                evidence.push({
                    kind: 'network_response',
                    strength: 'strong',
                    description: `保存接口返回 HTTP ${response.status()}，站点码 ${siteCode ?? 'unknown'}`,
                });
            }
        }
        const pageText = (await page.locator('[role=alert], .brick-message, .ant-message').allInnerTexts().catch(() => [])).join(' ');
        if (/保存成功|已保存/.test(pageText)) {
            evidence.push({ kind: 'toast', strength: 'weak', description: '页面出现保存成功提示' });
        }
        const returnedToCenter = new URL(page.url()).pathname === '/jobs/center';
        if (returnedToCenter) {
            evidence.push({
                kind: 'dom_marker',
                strength: 'weak',
                description: '点击保存后页面跳转到个人中心，仍需服务器读回确认',
            });
        }
        const validation = returnedToCenter ? undefined : await validatePage(page, payload);
        const networkConfirmed = evidence.some((item) => item.kind === 'network_response' && item.strength === 'strong');
        const saved = networkConfirmed && (returnedToCenter || validation?.valid === true);
        return {
            attempted: true,
            saved,
            ...(response === undefined ? {} : { httpStatus: response.status() }),
            ...(siteCode === undefined ? {} : { siteCode }),
            ...(message === undefined
                ? saved
                    ? {}
                    : { message: `保存前仍有 ${validation?.issues.length ?? 0} 个必填或读回问题` }
                : { message }),
            evidence,
            pageChanged: page.url() !== beforeUrl,
        };
    },
};
//# sourceMappingURL=resume-page.js.map