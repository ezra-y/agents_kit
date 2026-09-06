import { basename } from 'node:path';
const HOST = '*.jobs.feishu.cn';
const CREATE_PATH = '/api/v1/user/resumes/';
const READ_PATH = '/api/v1/user/latest/resume';
const STAGED_KEY = '__officialApplyFeishuJobsResume';
const PORTAL_TYPE_CAMPUS = 6;
const PORTAL_ENTRANCE = 1;
function text(values, ...keys) {
    for (const key of keys) {
        const value = values[key];
        if (typeof value === 'string' && value.trim() !== '')
            return value.trim();
        if (typeof value === 'number')
            return String(value);
    }
    return undefined;
}
function asRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}
function asRows(value) {
    return Array.isArray(value)
        ? value.filter((item) => item !== null && typeof item === 'object' && !Array.isArray(item))
        : [];
}
function valuesOf(rows) {
    return rows.map((row) => row.values);
}
function stringList(value) {
    if (typeof value === 'string' && value.trim() !== '')
        return [value.trim()];
    if (!Array.isArray(value))
        return [];
    return value
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item !== '');
}
function serverResume(facts) {
    return asRecord(facts?.['serverResume']);
}
function chinaMonthTimestamp(value, current = false) {
    if (value !== undefined && /^\d{4}-\d{2}$/.test(value)) {
        return Date.parse(`${value}-01T00:00:00+08:00`);
    }
    if (current) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        return Date.parse(`${year}-${month}-01T00:00:00+08:00`);
    }
    return undefined;
}
function awardTimestamp(value) {
    if (value === undefined || !/^\d{4}$/.test(value))
        return undefined;
    return Date.parse(`${value}-01-01T00:00:00+08:00`);
}
function clipped(value, max) {
    return value.length <= max ? value : value.slice(0, max);
}
function recordDescription(record) {
    const values = record.values;
    const bullets = Array.isArray(values['bullets'])
        ? values['bullets'].filter((item) => typeof item === 'string')
        : [];
    return clipped([
        text(values, 'description'),
        ...bullets.map((item) => item.trim()).filter((item) => item !== ''),
    ]
        .filter((item) => item !== undefined && item !== '')
        .join('\n'), 3_950);
}
function degree(value) {
    if (value === undefined)
        return undefined;
    if (/博士|phd|doctor/i.test(value))
        return 8;
    if (/mba/i.test(value))
        return 11;
    if (/硕士|master/i.test(value))
        return 7;
    if (/本科|bachelor/i.test(value))
        return 6;
    if (/大专|associate/i.test(value))
        return 5;
    if (/高中/.test(value))
        return 4;
    return 9;
}
function compactObject(value) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
function settingValue(settings, key, label) {
    if (label === undefined)
        return undefined;
    const normalized = label.replace(/\s+/g, '');
    return asRows(settings[key]).find((item) => String(item['val'] ?? '').replace(/\s+/g, '') === normalized)?.['key'];
}
function educationRows(input, includeEducationType, includeAcademicRanking, settings) {
    return input.education.map((record) => compactObject({
        major: text(record.values, 'major') ?? '',
        start_time: chinaMonthTimestamp(text(record.values, 'startDate', 'start_date')),
        end_time: chinaMonthTimestamp(text(record.values, 'endDate', 'end_date')),
        school: text(record.values, 'school') ?? '',
        degree: degree(text(record.values, 'degree')),
        ...(includeEducationType ? { education_type: 2 } : {}),
        ...(includeAcademicRanking
            ? {
                academic_ranking: settingValue(settings, 'academic_ranking', text(record.values, 'rank', 'academic_ranking')),
            }
            : {}),
        customized_data: [],
    }));
}
function isInternship(record) {
    return /实习|intern/i.test(text(record.values, 'title', 'role') ?? '');
}
function careerRows(input, kind) {
    return input.experience
        .filter((record) => isInternship(record) === (kind === 'internship'))
        .map((record) => compactObject({
        company: text(record.values, 'company') ?? '',
        ...(kind === 'career'
            ? { title: text(record.values, 'title', 'role') ?? '' }
            : { position: text(record.values, 'title', 'role') ?? '' }),
        start_time: chinaMonthTimestamp(text(record.values, 'startDate', 'start_date')),
        end_time: chinaMonthTimestamp(text(record.values, 'endDate', 'end_date'), record.values['current'] === true),
        description: recordDescription(record),
        customized_data: [],
    }));
}
function projectRows(input) {
    return input.projects.map((record) => {
        const name = text(record.values, 'name', 'label') ?? '';
        const explicitLink = text(record.values, 'projectLink', 'url');
        return compactObject({
            name: clipped(name, 200),
            role: clipped(text(record.values, 'role') ?? '', 200),
            start_time: chinaMonthTimestamp(text(record.values, 'startDate', 'start_date')),
            end_time: chinaMonthTimestamp(text(record.values, 'endDate', 'end_date'), record.values['current'] === true),
            description: recordDescription(record),
            link: explicitLink ?? '',
            customized_data: [],
        });
    });
}
function resolvedProjectValues(input) {
    return input.projects.map((record) => ({ ...record.values }));
}
function hasAwardYear(record) {
    const value = text(record.values, 'date');
    return value !== undefined && /^\d{4}$/.test(value);
}
function awardRows(input, requireAwardYear) {
    return input.awards
        .filter((record) => !requireAwardYear || hasAwardYear(record))
        .map((record) => compactObject({
        title: clipped(text(record.values, 'name', 'label') ?? '', 200),
        award_time: awardTimestamp(text(record.values, 'date')),
        desc: text(record.values, 'level', 'description') ?? '',
        customized_data: [],
    }));
}
function competitionRows(input, requireAwardYear) {
    if (!requireAwardYear)
        return [];
    return input.awards
        .filter((record) => !hasAwardYear(record))
        .map((record) => ({
        name: clipped(text(record.values, 'name', 'label') ?? '', 200),
        description: text(record.values, 'level', 'description') ?? '',
        customized_data: [],
    }));
}
function attachmentId(current) {
    const value = asRecord(current['resume_attachment'])['id'];
    return typeof value === 'string' && value !== '' ? value : undefined;
}
const LEGACY_CITY_CODES = {
    北京: 'CT_11',
    北京市: 'CT_11',
    广州: 'CT_45',
    广州市: 'CT_45',
    上海: 'CT_125',
    上海市: 'CT_125',
};
function normalizeCityName(value) {
    return value.replace(/\s+/g, '').replace(/市$/, '');
}
export function resolveCityCode(fields, fieldNames, city) {
    const wanted = normalizeCityName(city);
    for (const field of fields) {
        if (!fieldNames.includes(String(field['name'] ?? '')) &&
            !fieldNames.includes(String(field['label'] ?? ''))) {
            continue;
        }
        const option = asRows(field['options']).find((item) => normalizeCityName(String(item['label'] ?? '')) === wanted);
        const value = option?.['value'];
        if (typeof value === 'string' && value !== '')
            return value;
        if (typeof value === 'number')
            return String(value);
    }
    return LEGACY_CITY_CODES[city];
}
function ageFromBirthDate(value) {
    if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return undefined;
    const birth = new Date(`${value}T00:00:00+08:00`);
    if (Number.isNaN(birth.getTime()))
        return undefined;
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const birthdayPassed = now.getMonth() > birth.getMonth() ||
        (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
    if (!birthdayPassed)
        age -= 1;
    return age >= 0 ? age : undefined;
}
function genderCode(value) {
    if (value === undefined)
        return undefined;
    if (/^男|male$/i.test(value))
        return 1;
    if (/^女|female$/i.test(value))
        return 2;
    if (/保密|不公开/.test(value))
        return 3;
    return undefined;
}
function fieldFacts(facts) {
    return asRows(facts?.['formFields']);
}
function settingFacts(facts) {
    return asRecord(facts?.['commonSettings']);
}
function hasVisibleField(fields, name) {
    return fields.some((field) => field['visible'] === true &&
        (field['name'] === name || field['label'] === name));
}
function hasRequiredField(fields, name) {
    return fields.some((field) => field['visible'] === true &&
        field['required'] === true &&
        (field['name'] === name || field['label'] === name));
}
function distributeCustomValues(fields, values) {
    const fieldsById = new Map(fields.map((field) => [String(field['id'] ?? ''), field]));
    const basic = [];
    const sections = new Map();
    const grouped = new Map();
    for (const value of values) {
        const field = fieldsById.get(String(value['object_id'] ?? ''));
        const parent = fieldsById.get(String(field?.['parent'] ?? ''));
        const parentName = typeof parent?.['name'] === 'string' ? parent['name'] : undefined;
        if (parentName === 'basic_info') {
            basic.push(value);
            continue;
        }
        if (parentName?.endsWith('_list')) {
            const current = sections.get(parentName) ?? [];
            current.push(value);
            sections.set(parentName, current);
            continue;
        }
        if (parent?.['isCustomized'] === true) {
            const parentId = String(parent['id'] ?? '');
            const current = grouped.get(parentId) ?? [];
            current.push(value);
            grouped.set(parentId, current);
            continue;
        }
        basic.push(value);
    }
    return {
        basic,
        sections,
        topLevel: Object.fromEntries([...grouped].map(([parentId, children]) => [
            parentId,
            [{ object_id: parentId, children }],
        ])),
    };
}
function attachCustomValues(rows, values) {
    if (values === undefined || values.length === 0)
        return rows;
    return rows.map((row) => ({
        ...row,
        customized_data: [...asRows(row['customized_data']), ...values],
    }));
}
function normalizeCustomAnswer(value, options) {
    const textValue = typeof value === 'boolean'
        ? value
            ? '是'
            : '否'
        : typeof value === 'string'
            ? value.trim()
            : undefined;
    if (textValue === undefined || textValue === '')
        return undefined;
    if (options.length === 0)
        return textValue;
    const direct = options.find((option) => option['label'] === textValue ||
        option['value'] === textValue);
    if (direct !== undefined)
        return String(direct['value']);
    if (/^(有|是|true|yes)$/i.test(textValue)) {
        return String(options.find((option) => /^(有|是|yes)$/i.test(String(option['label'] ?? '')))
            ? options.find((option) => /^(有|是|yes)$/i.test(String(option['label'] ?? '')))['value']
            : '') || undefined;
    }
    if (/^(无|没有|否|false|no)$/i.test(textValue)) {
        return String(options.find((option) => /^(无|没有|否|no)$/i.test(String(option['label'] ?? '')))
            ? options.find((option) => /^(无|没有|否|no)$/i.test(String(option['label'] ?? '')))['value']
            : '') || undefined;
    }
    return undefined;
}
function resolveRequiredCustomFields(input, fields) {
    const values = [];
    const missing = [];
    let photoField;
    for (const field of fields) {
        if (field['visible'] !== true ||
            field['required'] !== true ||
            field['isCustomized'] !== true) {
            continue;
        }
        const id = String(field['id'] ?? '');
        const name = String(field['name'] ?? '');
        const label = String(field['label'] ?? '');
        const options = asRows(field['options']);
        const visibleChildren = fields.filter((candidate) => candidate['parent'] === id && candidate['visible'] === true);
        if (visibleChildren.length > 0 && !/个人形象/.test(label)) {
            continue;
        }
        const customKey = `site.custom.${id}`;
        const customValue = input.basic[customKey];
        if (customValue !== undefined) {
            const answer = normalizeCustomAnswer(customValue, options);
            if (answer !== undefined) {
                values.push({ object_id: id, value: answer });
                continue;
            }
            missing.push({
                key: customKey,
                reason: `已保存答案无法匹配飞书招聘自定义字段“${label || id}”的当前选项`,
            });
            continue;
        }
        if (/招聘信息获取渠道/.test(label)) {
            const official = options.find((option) => /官网/.test(String(option['label'] ?? '')));
            if (official !== undefined) {
                values.push({ object_id: id, value: String(official['value']) });
                continue;
            }
        }
        if (/毕业时间/.test(label)) {
            const latest = [...input.education]
                .map((record) => text(record.values, 'endDate', 'end_date'))
                .filter((value) => value !== undefined)
                .sort()
                .at(-1);
            if (latest !== undefined && /^\d{4}/.test(latest)) {
                values.push({ object_id: id, value: latest.slice(0, 4) });
                continue;
            }
        }
        if (/个人形象/.test(label)) {
            const child = fields.find((candidate) => candidate['parent'] === id &&
                /个人照片|person_picture/.test(`${String(candidate['label'] ?? '')}${String(candidate['name'] ?? '')}`));
            const photo = input.materials?.['attachment.photo']?.localPath;
            if (child !== undefined &&
                typeof child['id'] === 'string' &&
                photo !== undefined) {
                values.push({ object_id: id, value: [] });
                photoField = { parentId: id, childId: child['id'] };
                continue;
            }
            missing.push({
                key: 'attachment.photo',
                reason: '飞书招聘必填“个人形象”没有可上传的个人照片',
            });
            continue;
        }
        const canonicalKey = name === 'marital_status' || /婚姻/.test(label)
            ? 'person.identity.marital_status'
            : /驾驶证|驾照/.test(label)
                ? 'person.credential.has_driver_license'
                : /调配|调剂/.test(label)
                    ? 'application.preference.accept_transfer'
                    : /派遣|外派/.test(label)
                        ? 'application.preference.accept_assignment'
                        : undefined;
        if (canonicalKey === undefined) {
            missing.push({
                key: customKey,
                reason: `飞书招聘必填自定义字段“${label || id}”没有映射`,
            });
            continue;
        }
        const answer = normalizeCustomAnswer(input.basic[canonicalKey], options);
        if (answer === undefined) {
            missing.push({
                key: canonicalKey,
                reason: `飞书招聘必填“${label}”没有用户明确答案`,
            });
            continue;
        }
        values.push({ object_id: id, value: answer });
    }
    return { values, missing, ...(photoField === undefined ? {} : { photoField }) };
}
function materialPath(input) {
    return input.materials?.['attachment.resume']?.localPath;
}
function buildPayload(input, current, fields, settings, customValues, forceCreate = false, formRenderer = 'legacy') {
    const id = current['id'];
    const resumeId = !forceCreate && typeof id === 'string' && id !== '' ? id : undefined;
    const currentCustomized = current['customized_data'];
    const currentBasicCustomized = current['basic_info_customized_data'];
    const desiredCities = stringList(input.basic['application.preference.desired_city']);
    const currentCity = text(input.basic, 'person.location.current_city', 'person.contact.current_city') ?? desiredCities[0];
    const currentCityCode = currentCity === undefined
        ? undefined
        : resolveCityCode(fields, ['current_city'], currentCity);
    const preferredCityCodes = desiredCities
        .map((city) => resolveCityCode(fields, ['preferred_city_list', 'application_preferred_city_list'], city))
        .filter((code) => code !== undefined);
    const age = ageFromBirthDate(text(input.basic, 'person.identity.birth_date'));
    const gender = genderCode(text(input.basic, 'person.identity.gender'));
    const includeEducationType = hasVisibleField(fields, 'education_type');
    const includeAcademicRanking = hasVisibleField(fields, 'academic_ranking');
    const includeSns = hasVisibleField(fields, 'sns_type') || hasVisibleField(fields, 'link');
    const wechat = text(input.basic, 'person.contact.wechat');
    const wechatType = settingValue(settings, 'sns', '微信');
    const requireAwardYear = hasRequiredField(fields, 'date');
    const distributedCustomValues = distributeCustomValues(fields, customValues);
    const languageCustomValues = distributedCustomValues.sections.get('language_list');
    const snsCustomValues = distributedCustomValues.sections.get('sns_list');
    const basicCustomizedValues = formRenderer === 'formily'
        ? [
            { object_id: 'identification', value: {} },
            ...distributedCustomValues.basic.filter((value) => value['object_id'] !== 'identification'),
        ]
        : distributedCustomValues.basic;
    const currentTopLevelCustomized = asRecord(currentCustomized);
    const topLevelCustomized = {
        ...currentTopLevelCustomized,
        ...distributedCustomValues.topLevel,
    };
    const standardSns = includeSns && wechat !== undefined && wechatType !== undefined
        ? [{ sns_type: wechatType, link: wechat }]
        : [];
    const resume = compactObject({
        ...(resumeId === undefined ? {} : { id: resumeId }),
        name: text(input.basic, 'person.identity.full_name') ?? '',
        country_code: 'CN_1',
        mobile_number: text(input.basic, 'person.contact.phone') ?? '',
        email: text(input.basic, 'person.contact.email') ?? '',
        ...(hasVisibleField(fields, 'age') && age !== undefined ? { age } : {}),
        ...(hasVisibleField(fields, 'gender') && gender !== undefined ? { gender } : {}),
        nationality_id: 'CN_1',
        ...(formRenderer === 'formily' ? { hometown_city_code: null } : {}),
        ...(hasVisibleField(fields, 'current_city') && currentCityCode !== undefined
            ? { current_city_code: currentCityCode }
            : {}),
        ...(hasVisibleField(fields, 'preferred_city_list') &&
            preferredCityCodes.length > 0
            ? { preferred_city_list: preferredCityCodes }
            : {}),
        portal_attachment_id: attachmentId(current),
        identification: current['identification'] ?? {},
        education_list: attachCustomValues(educationRows(input, includeEducationType, includeAcademicRanking, settings), distributedCustomValues.sections.get('education_list')),
        career_list: attachCustomValues(careerRows(input, 'career'), distributedCustomValues.sections.get('career_list')),
        internship_list: attachCustomValues(careerRows(input, 'internship'), distributedCustomValues.sections.get('internship_list')),
        project_list: attachCustomValues(projectRows(input), distributedCustomValues.sections.get('project_list')),
        works_list: attachCustomValues([], distributedCustomValues.sections.get('works_list')),
        award_list: attachCustomValues(awardRows(input, requireAwardYear), distributedCustomValues.sections.get('award_list')),
        competition_list: attachCustomValues(competitionRows(input, requireAwardYear), distributedCustomValues.sections.get('competition_list')),
        certificate_list: [],
        language_skill_list: languageCustomValues === undefined || languageCustomValues.length === 0
            ? []
            : [{ customized_data: languageCustomValues }],
        sns_list: snsCustomValues === undefined || snsCustomValues.length === 0
            ? standardSns
            : attachCustomValues(standardSns.length === 0 ? [{}] : standardSns, snsCustomValues),
        ...(formRenderer === 'formily'
            ? { code_type: current['code_type'] ?? -1 }
            : {
                application_preferred_city_list: current['application_preferred_city_list'] ?? null,
                accept_transfer_preferred_city: current['accept_transfer_preferred_city'] ?? 2,
                formControlChangeFlag: '10',
                di_info_data: current['di_info_data'] ?? null,
            }),
        customized_data: Object.keys(topLevelCustomized).length > 0
            ? topLevelCustomized
            : formRenderer === 'formily'
                ? {}
                : currentCustomized,
        ...(basicCustomizedValues.length > 0
            ? { basic_info_customized_data: basicCustomizedValues }
            : currentBasicCustomized === undefined
                ? {}
                : { basic_info_customized_data: currentBasicCustomized }),
    });
    return {
        requestPath: resumeId === undefined
            ? CREATE_PATH
            : `${CREATE_PATH}${encodeURIComponent(resumeId)}`,
        body: {
            ...(resumeId === undefined ? {} : { resume_id: resumeId }),
            resume,
            portal_type: PORTAL_TYPE_CAMPUS,
            portal_entrance: PORTAL_ENTRANCE,
        },
    };
}
function resolvedPayload(payload) {
    const value = payload.resolved['apiPayload'];
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const body = asRecord(value['body']);
    const requestPath = value['requestPath'];
    return typeof requestPath === 'string' ? { requestPath, body } : undefined;
}
async function readResume(page) {
    const result = await page.evaluate(async (path) => {
        const response = await fetch(path, { credentials: 'include' });
        const body = await response.json();
        return {
            status: response.status,
            code: body?.code,
            message: body?.message,
            resume: body?.data?.resume_detail,
        };
    }, READ_PATH);
    if (result.status < 200 || result.status >= 300 || result.code !== 0) {
        throw new Error(`feishu_jobs_resume_read_failed: ${result.status}:${result.code ?? 'unknown'}:${result.message ?? ''}`);
    }
    return result.resume === null || result.resume === undefined
        ? undefined
        : asRecord(result.resume);
}
async function readCommonSettings(page) {
    const result = await page.evaluate(async () => {
        const response = await fetch('/api/v1/common/setting', {
            credentials: 'include',
        });
        const body = await response.json();
        return {
            status: response.status,
            code: body?.code,
            data: body?.data,
        };
    });
    if (result.status < 200 || result.status >= 300 || result.code !== 0) {
        throw new Error(`feishu_jobs_common_settings_failed:${result.status}:${result.code ?? 'unknown'}`);
    }
    return asRecord(result.data);
}
async function readFormFields(page) {
    return page.evaluate(() => {
        const script = document.querySelector('#js-websiteInfo')?.textContent;
        if (script === undefined || script.trim() === '')
            return [];
        let root;
        try {
            root = JSON.parse(script);
        }
        catch {
            return [];
        }
        const fields = new Map();
        const seen = new WeakSet();
        const walk = (value) => {
            if (value === null || typeof value !== 'object')
                return;
            if (seen.has(value))
                return;
            seen.add(value);
            if (Array.isArray(value)) {
                value.forEach(walk);
                return;
            }
            const record = value;
            const attributes = record['attributes'] !== null &&
                typeof record['attributes'] === 'object' &&
                !Array.isArray(record['attributes'])
                ? record['attributes']
                : undefined;
            const fieldType = attributes?.['field_type'] !== null &&
                typeof attributes?.['field_type'] === 'object' &&
                !Array.isArray(attributes?.['field_type'])
                ? attributes['field_type']
                : undefined;
            if (typeof record['id'] === 'string' && fieldType !== undefined) {
                const settings = fieldType['settings'] !== null &&
                    typeof fieldType['settings'] === 'object' &&
                    !Array.isArray(fieldType['settings'])
                    ? fieldType['settings']
                    : {};
                const options = Array.isArray(settings['options'])
                    ? settings['options']
                        .filter((option) => option !== null &&
                        typeof option === 'object' &&
                        !Array.isArray(option))
                        .map((option) => ({
                        label: option['i18n_name'] ??
                            (option['name'] !== null &&
                                typeof option['name'] === 'object' &&
                                !Array.isArray(option['name'])
                                ? option['name']['zh_cn']
                                : undefined),
                        value: option['value'],
                    }))
                    : [];
                const candidate = {
                    id: record['id'],
                    name: fieldType['name'],
                    label: attributes?.['i18n_name'],
                    parent: attributes?.['parent'],
                    required: attributes?.['required'] === true,
                    visible: attributes?.['visible'] === true,
                    repeatable: attributes?.['repeatable'] === true,
                    isCustomized: attributes?.['is_customized'] === true,
                    options,
                };
                const existing = fields.get(record['id']);
                const score = (field) => (field['visible'] === true ? 2 : 0) +
                    (field['required'] === true ? 1 : 0);
                if (existing === undefined || score(candidate) > score(existing)) {
                    fields.set(record['id'], candidate);
                }
            }
            Object.values(record).forEach(walk);
        };
        walk(root);
        return [...fields.values()];
    });
}
async function uploadResumeAttachment(page, localPath) {
    const input = page.locator('input[type=file]').first();
    if ((await input.count()) === 0) {
        throw new Error('feishu_jobs_resume_upload_not_found: 找不到附件简历上传控件');
    }
    const exchangeResponse = page.waitForResponse((response) => response.url().includes('/api/v1/attachment/exchange/tokens') &&
        response.request().method() === 'POST', { timeout: 120_000 });
    let resolveParse;
    let rejectParse;
    const parseCompleted = new Promise((resolve, reject) => {
        resolveParse = resolve;
        rejectParse = reject;
    });
    let parseSettled = false;
    const parseHandler = async (response) => {
        if (response.request().method() !== 'GET' ||
            !response.url().includes('/api/v1/attachment/resume/parse/tasks/')) {
            return;
        }
        try {
            const body = await response.json();
            if (body?.code !== 0) {
                parseSettled = true;
                rejectParse(new Error(`feishu_jobs_resume_parse_failed: ${body?.code ?? 'unknown'}`));
                return;
            }
            if (body?.data?.parse_result === 2) {
                parseSettled = true;
                resolveParse();
            }
        }
        catch {
            return;
        }
    };
    page.on('response', parseHandler);
    const parseTimer = setTimeout(() => {
        if (!parseSettled) {
            rejectParse(new Error('feishu_jobs_resume_parse_timeout'));
        }
    }, 120_000);
    await input.setInputFiles(localPath, { timeout: 30_000 });
    const response = await exchangeResponse;
    const parseAndReplace = page.getByText('解析并覆盖', { exact: true }).last();
    await parseAndReplace
        .waitFor({ state: 'visible', timeout: 8_000 })
        .catch(() => undefined);
    if ((await parseAndReplace.count()) > 0 &&
        (await parseAndReplace.isVisible().catch(() => false))) {
        await parseAndReplace.click();
    }
    try {
        await parseCompleted;
        const body = await response.json();
        const id = body?.data?.portal_attachment_id;
        if (response.status() < 200 ||
            response.status() >= 300 ||
            body?.code !== 0 ||
            typeof id !== 'string' ||
            id === '') {
            throw new Error(`feishu_jobs_attachment_exchange_failed: ${response.status()}:${body?.code ?? 'unknown'}`);
        }
        return id;
    }
    finally {
        clearTimeout(parseTimer);
        page.off('response', parseHandler);
    }
}
async function uploadCustomImage(page, localPath) {
    const input = page.locator('input[type=file][accept*="image"]').first();
    if ((await input.count()) === 0) {
        throw new Error('feishu_jobs_photo_upload_not_found: 找不到照片上传控件');
    }
    const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' &&
        response.url().includes('/hire/file/blob/') &&
        response.url().includes('scene=1060'), { timeout: 60_000 });
    await input.setInputFiles(localPath, { timeout: 30_000 });
    const response = await responsePromise;
    const body = await response.json();
    const data = asRecord(body?.data);
    const id = data['id'];
    if (response.status() < 200 ||
        response.status() >= 300 ||
        body?.code !== 0 ||
        typeof id !== 'string' ||
        id === '') {
        throw new Error(`feishu_jobs_photo_upload_failed:${response.status()}:${body?.code ?? 'unknown'}`);
    }
    await page
        .locator('.ud__upload-item--success')
        .first()
        .waitFor({ state: 'visible', timeout: 20_000 });
    return {
        id,
        file_id: id,
        url: data['url'],
        name: data['name'],
        token: data['token'],
    };
}
function dynamicHeaders(page) {
    return page.evaluate(() => {
        const cookieToken = document.cookie
            .split(';')
            .map((item) => item.trim())
            .find((item) => item.startsWith('atsx-csrf-token='))
            ?.slice('atsx-csrf-token='.length);
        const csrf = window.csrfToken ?? cookieToken;
        return {
            accept: 'application/json, text/plain, */*',
            'accept-language': 'zh-CN',
            'content-type': 'application/json',
            'portal-channel': 'saas-career',
            'portal-platform': 'pc',
            'website-path': window.location.pathname.split('/').filter(Boolean)[0] ?? 'campus',
            ...(csrf === undefined || csrf === '' ? {} : { 'x-csrf-token': csrf }),
        };
    });
}
function records(payload, key) {
    const value = payload.resolved[key];
    return Array.isArray(value)
        ? value.filter((item) => item !== null && typeof item === 'object' && !Array.isArray(item))
        : [];
}
function compareRows(actual, expected, spec, issues) {
    if (actual.length !== expected.length) {
        issues.push({
            key: spec.key,
            code: 'server_readback_count_mismatch',
            message: `${spec.key} 服务器数量为 ${actual.length}，预期 ${expected.length}`,
            severity: 'error',
        });
        return;
    }
    for (let index = 0; index < expected.length; index += 1) {
        const actualRow = actual[index] ?? {};
        const expectedRow = expected[index] ?? {};
        const expectedName = text(expectedRow, spec.expectedName) ?? '';
        if (String(actualRow[spec.actualName] ?? '') !== expectedName) {
            issues.push({
                key: `${spec.key}[${index}]`,
                code: 'server_readback_mismatch',
                message: `${spec.key}[${index}] 名称服务器读回不一致`,
                severity: 'error',
            });
            continue;
        }
        for (const extra of spec.extras ?? []) {
            const expectedValue = text(expectedRow, extra.expected) ?? '';
            if (String(actualRow[extra.actual] ?? '') !== expectedValue) {
                issues.push({
                    key: `${spec.key}[${index}].${extra.expected}`,
                    code: 'server_readback_mismatch',
                    message: `${spec.key}[${index}] 的 ${extra.expected} 服务器读回不一致`,
                    severity: 'error',
                });
            }
        }
    }
}
function fillResult(fields) {
    return {
        attemptedCount: fields.filter((field) => field.outcome !== 'skipped').length,
        filledCount: fields.filter((field) => field.outcome === 'filled').length,
        unchangedCount: fields.filter((field) => field.outcome === 'unchanged').length,
        skippedCount: fields.filter((field) => field.outcome === 'skipped').length,
        failed: fields.filter((field) => field.outcome === 'failed'),
        fields,
        requiresRescan: false,
    };
}
export const feishuJobsResumePage = {
    id: 'feishu.jobs.campus-resume',
    version: 1,
    host: HOST,
    customDomainCompatible: true,
    pageKind: 'resume_edit',
    status: 'verified',
    lastVerifiedAt: '2026-08-25T20:06:00.000Z',
    async match(page) {
        const url = new URL(page.url());
        const knownHost = url.hostname.endsWith('.jobs.feishu.cn');
        const pathMatched = /\/(?:[^/]+\/)?resume\/edit\/?$/.test(url.pathname);
        const customDomainMatched = !knownHost &&
            pathMatched &&
            (await page.locator('#js-websiteInfo').count()) > 0;
        const hostMatched = knownHost || customDomainMatched;
        const anchors = ['基本信息', '教育经历', '项目经历', '获奖'];
        const checks = await Promise.all(anchors.map(async (anchor) => ({
            anchor,
            found: (await page.getByText(anchor, { exact: true }).count()) > 0,
        })));
        const matchedAnchors = checks
            .filter((item) => item.found)
            .map((item) => item.anchor);
        const missingAnchors = checks
            .filter((item) => !item.found)
            .map((item) => item.anchor);
        const basicMatched = matchedAnchors.includes('基本信息');
        const matched = hostMatched && pathMatched && basicMatched;
        return {
            matched,
            confidence: matched ? (missingAnchors.length === 0 ? 1 : 0.8) : hostMatched && pathMatched ? 0.5 : 0,
            allowRun: matched,
            reasons: [
                knownHost
                    ? '飞书招聘域名匹配'
                    : customDomainMatched
                        ? '飞书招聘自定义域名页面标记匹配'
                        : '域名和页面标记不匹配',
                pathMatched ? '简历编辑路由匹配' : '简历编辑路由不匹配',
            ],
            matchedAnchors,
            missingAnchors,
            pageVersionChanged: hostMatched && pathMatched && !basicMatched,
        };
    },
    async inspect(page) {
        const [current, formFields, commonSettings] = await Promise.all([
            readResume(page),
            readFormFields(page),
            readCommonSettings(page),
        ]);
        const createMode = (await page.getByText('创建简历', { exact: true }).count()) > 0;
        const formRenderer = (await page.locator('[data-form-field-id]').count()) > 0
            ? 'formily'
            : 'legacy';
        return {
            url: page.url(),
            title: await page.title(),
            pageKind: 'resume_edit',
            anchors: ['基本信息', '教育经历', '工作经历', '实习经历', '项目经历', '获奖'],
            runtimeData: {
                serverResume: (current ?? null),
                formFields: formFields,
                commonSettings: commonSettings,
                createMode,
                formRenderer,
                educationCount: asRows(current?.['education_list']).length,
                careerCount: asRows(current?.['career_list']).length,
                internshipCount: asRows(current?.['internship_list']).length,
                projectCount: asRows(current?.['project_list']).length,
                awardCount: asRows(current?.['award_list']).length,
            },
        };
    },
    prepare(input, facts) {
        const current = serverResume(facts.runtimeData);
        const fields = fieldFacts(facts.runtimeData);
        const settings = settingFacts(facts.runtimeData);
        const requiredCustom = resolveRequiredCustomFields(input, fields);
        const forceCreate = facts.runtimeData?.['createMode'] === true;
        const requireAwardYear = hasRequiredField(fields, 'date');
        const formRenderer = facts.runtimeData?.['formRenderer'] === 'formily'
            ? 'formily'
            : 'legacy';
        const payloadCurrent = forceCreate ? {} : current;
        const missing = [];
        for (const key of [
            'person.identity.full_name',
            'person.contact.phone',
            'person.contact.email',
        ]) {
            if (input.basic[key] === undefined || input.basic[key] === '') {
                missing.push({ key, reason: '飞书招聘基础信息缺少已确定答案' });
            }
        }
        if (input.education.length === 0) {
            missing.push({ key: 'education', reason: '飞书招聘需要至少一段教育经历' });
        }
        if (hasRequiredField(fields, 'academic_ranking')) {
            input.education.forEach((record, index) => {
                const rank = text(record.values, 'rank', 'academic_ranking');
                if (rank === undefined ||
                    settingValue(settings, 'academic_ranking', rank) === undefined) {
                    missing.push({
                        key: `education.${index}.rank`,
                        reason: `${text(record.values, 'school') ?? `第 ${index + 1} 段教育`}缺少可匹配的成绩排名`,
                    });
                }
            });
        }
        if ((hasRequiredField(fields, 'sns_type') || hasRequiredField(fields, 'link')) &&
            (text(input.basic, 'person.contact.wechat') === undefined ||
                settingValue(settings, 'sns', '微信') === undefined)) {
            missing.push({
                key: 'person.contact.wechat',
                reason: '社交平台为飞书招聘必填项',
            });
        }
        if (hasRequiredField(fields, 'age') &&
            ageFromBirthDate(text(input.basic, 'person.identity.birth_date')) === undefined) {
            missing.push({ key: 'person.identity.birth_date', reason: '年龄必填但无法从出生日期计算' });
        }
        if (hasRequiredField(fields, 'gender') &&
            genderCode(text(input.basic, 'person.identity.gender')) === undefined) {
            missing.push({ key: 'person.identity.gender', reason: '性别为飞书招聘必填项' });
        }
        if (hasRequiredField(fields, 'current_city')) {
            const currentCity = text(input.basic, 'person.location.current_city', 'person.contact.current_city') ??
                stringList(input.basic['application.preference.desired_city'])[0];
            if (currentCity === undefined ||
                resolveCityCode(fields, ['current_city'], currentCity) === undefined) {
                missing.push({
                    key: 'person.contact.current_city',
                    reason: currentCity === undefined
                        ? '所在地点为飞书招聘必填项'
                        : `官网城市选项中没有“${currentCity}”`,
                });
            }
        }
        if (hasRequiredField(fields, 'preferred_city_list')) {
            const desiredCities = stringList(input.basic['application.preference.desired_city']);
            const unresolved = desiredCities.filter((city) => resolveCityCode(fields, ['preferred_city_list', 'application_preferred_city_list'], city) === undefined);
            if (desiredCities.length === 0 || unresolved.length > 0) {
                missing.push({
                    key: 'application.preference.desired_city',
                    reason: desiredCities.length === 0
                        ? '期望城市为飞书招聘必填项'
                        : `官网城市选项中没有：${unresolved.join('、')}`,
                });
            }
        }
        missing.push(...requiredCustom.missing);
        const resumeMaterial = materialPath(input);
        if (attachmentId(current) === undefined && resumeMaterial === undefined) {
            missing.push({ key: 'attachment.resume', reason: '飞书招聘缺少附件简历' });
        }
        return {
            resolved: {
                basic: input.basic,
                education: valuesOf(input.education),
                career: valuesOf(input.experience.filter((record) => !isInternship(record))),
                internship: valuesOf(input.experience.filter(isInternship)),
                projects: resolvedProjectValues(input),
                awards: valuesOf(input.awards.filter((record) => !requireAwardYear || hasAwardYear(record))),
                competitions: valuesOf(requireAwardYear
                    ? input.awards.filter((record) => !hasAwardYear(record))
                    : []),
                materials: input.materials ?? {},
                ...(requiredCustom.photoField === undefined
                    ? {}
                    : {
                        requiredCustomPhoto: requiredCustom.photoField,
                    }),
                apiPayload: buildPayload(input, payloadCurrent, fields, settings, requiredCustom.values, forceCreate, formRenderer),
            },
            missing,
            conflicts: [],
            skipped: [
                ...(input.skills === undefined || input.skills.length === 0
                    ? []
                    : [{ key: 'skills', reason: '官网没有独立技能栏目，保留在附件简历' }]),
                ...(input.languages === undefined || input.languages.length === 0
                    ? []
                    : [{ key: 'languages', reason: '本地没有可直接映射的语言熟练度答案' }]),
            ],
        };
    },
    async fill(page, payload) {
        const apiPayload = resolvedPayload(payload);
        if (apiPayload === undefined) {
            return fillResult([
                {
                    key: 'apiPayload',
                    outcome: 'failed',
                    code: 'feishu_jobs_payload_missing',
                    message: '没有生成飞书招聘保存数据',
                },
            ]);
        }
        const resume = asRecord(apiPayload.body['resume']);
        const fields = [
            { key: 'basic', outcome: 'filled' },
            { key: 'education', outcome: 'filled' },
            { key: 'career', outcome: 'filled' },
            { key: 'internship', outcome: 'filled' },
            { key: 'projects', outcome: 'filled' },
            { key: 'awards', outcome: 'filled' },
        ];
        const photoField = asRecord(payload.resolved['requiredCustomPhoto']);
        const photoParentId = photoField['parentId'];
        const photoChildId = photoField['childId'];
        if (typeof photoParentId === 'string' &&
            typeof photoChildId === 'string') {
            const materials = asRecord(payload.resolved['materials']);
            const photoMaterial = asRecord(materials['attachment.photo']);
            const photoPath = typeof photoMaterial['localPath'] === 'string'
                ? photoMaterial['localPath']
                : undefined;
            if (photoPath === undefined) {
                fields.push({
                    key: 'attachment.photo',
                    outcome: 'failed',
                    code: 'feishu_jobs_photo_upload_not_found',
                    message: '没有可上传的个人照片',
                });
            }
            else {
                try {
                    const image = await uploadCustomImage(page, photoPath);
                    const customized = asRows(resume['basic_info_customized_data']);
                    const parent = customized.find((item) => item['object_id'] === photoParentId);
                    if (parent === undefined) {
                        customized.push({
                            object_id: photoParentId,
                            value: [{ object_id: photoChildId, value: [image] }],
                        });
                    }
                    else {
                        parent['value'] = [
                            { object_id: photoChildId, value: [image] },
                        ];
                    }
                    resume['basic_info_customized_data'] = customized;
                    fields.push({ key: 'attachment.photo', outcome: 'filled' });
                }
                catch (error) {
                    fields.push({
                        key: 'attachment.photo',
                        outcome: 'failed',
                        code: 'feishu_jobs_photo_upload_failed',
                        message: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        }
        if (typeof resume['portal_attachment_id'] !== 'string' ||
            resume['portal_attachment_id'] === '') {
            const materials = asRecord(payload.resolved['materials']);
            const material = asRecord(materials['attachment.resume']);
            const localPath = typeof material['localPath'] === 'string' ? material['localPath'] : undefined;
            if (localPath === undefined) {
                fields.push({
                    key: 'attachment.resume',
                    outcome: 'failed',
                    code: 'feishu_jobs_resume_upload_not_found',
                    message: '没有可上传的附件简历',
                });
            }
            else {
                try {
                    resume['portal_attachment_id'] = await uploadResumeAttachment(page, localPath);
                    fields.push({ key: 'attachment.resume', outcome: 'filled' });
                }
                catch (error) {
                    fields.push({
                        key: 'attachment.resume',
                        outcome: 'failed',
                        code: 'feishu_jobs_resume_upload_failed',
                        message: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        }
        else {
            fields.push({ key: 'attachment.resume', outcome: 'unchanged' });
        }
        const stagedAttachmentId = typeof resume['portal_attachment_id'] === 'string'
            ? resume['portal_attachment_id']
            : undefined;
        await page.evaluate(({ key, portalAttachmentId }) => {
            window[key] = {
                portalAttachmentId,
            };
        }, { key: STAGED_KEY, portalAttachmentId: stagedAttachmentId });
        return fillResult(fields);
    },
    async validate(page, payload) {
        const issues = payload.missing.map((item) => ({
            key: item.key,
            code: 'required_missing',
            message: item.reason,
            severity: 'blocking',
        }));
        const staged = await page.evaluate((key) => window[key] !== undefined, STAGED_KEY);
        if (!staged) {
            const current = await readResume(page);
            if (current === undefined) {
                issues.push({
                    code: 'server_resume_missing',
                    message: '服务器没有返回站内简历',
                    severity: 'error',
                });
            }
            else {
                const basic = asRecord(payload.resolved['basic']);
                for (const [serverKey, canonicalKey] of [
                    ['name', 'person.identity.full_name'],
                    ['mobile_number', 'person.contact.phone'],
                    ['email', 'person.contact.email'],
                ]) {
                    if (typeof basic[canonicalKey] === 'string' &&
                        String(current[serverKey] ?? '') !== basic[canonicalKey]) {
                        issues.push({
                            key: canonicalKey,
                            code: 'server_readback_mismatch',
                            message: `${canonicalKey} 服务器读回不一致`,
                            severity: 'error',
                        });
                    }
                }
                compareRows(asRows(current['education_list']), records(payload, 'education'), {
                    key: 'education',
                    actualName: 'school',
                    expectedName: 'school',
                    extras: [{ actual: 'major', expected: 'major' }],
                }, issues);
                compareRows(asRows(current['career_list']), records(payload, 'career'), {
                    key: 'career',
                    actualName: 'company',
                    expectedName: 'company',
                    extras: [{ actual: 'title', expected: 'title' }],
                }, issues);
                compareRows(asRows(current['internship_list']), records(payload, 'internship'), {
                    key: 'internship',
                    actualName: 'company',
                    expectedName: 'company',
                    extras: [{ actual: 'position', expected: 'title' }],
                }, issues);
                compareRows(asRows(current['project_list']), records(payload, 'projects'), {
                    key: 'projects',
                    actualName: 'name',
                    expectedName: 'name',
                    extras: [
                        { actual: 'role', expected: 'role' },
                        { actual: 'link', expected: 'projectLink' },
                    ],
                }, issues);
                compareRows(asRows(current['award_list']), records(payload, 'awards'), {
                    key: 'awards',
                    actualName: 'title',
                    expectedName: 'name',
                    extras: [{ actual: 'desc', expected: 'level' }],
                }, issues);
                compareRows(asRows(current['competition_list']), records(payload, 'competitions'), {
                    key: 'competitions',
                    actualName: 'name',
                    expectedName: 'name',
                    extras: [{ actual: 'description', expected: 'level' }],
                }, issues);
                const materials = asRecord(payload.resolved['materials']);
                const resumeMaterial = asRecord(materials['attachment.resume']);
                const expectedFile = typeof resumeMaterial['localPath'] === 'string'
                    ? basename(resumeMaterial['localPath'])
                    : undefined;
                const actualFile = asRecord(current['resume_attachment'])['name'];
                if (expectedFile !== undefined && actualFile !== expectedFile) {
                    issues.push({
                        key: 'attachment.resume',
                        code: 'server_readback_mismatch',
                        message: '附件简历文件名服务器读回不一致',
                        severity: 'error',
                    });
                }
            }
        }
        return {
            valid: issues.length === 0,
            checkedCount: 3 +
                records(payload, 'education').length +
                records(payload, 'career').length +
                records(payload, 'internship').length +
                records(payload, 'projects').length +
                records(payload, 'awards').length +
                records(payload, 'competitions').length,
            issues,
        };
    },
    async saveDraft(page, payload) {
        if (payload.missing.length > 0) {
            return {
                attempted: false,
                saved: false,
                message: `仍有 ${payload.missing.length} 个必填答案缺失，未调用飞书招聘保存接口`,
                evidence: [],
                pageChanged: false,
            };
        }
        const apiPayload = resolvedPayload(payload);
        if (apiPayload === undefined) {
            return {
                attempted: false,
                saved: false,
                message: '没有生成飞书招聘保存数据',
                evidence: [],
                pageChanged: false,
            };
        }
        const stagedAttachmentId = await page.evaluate((key) => {
            const state = window[key];
            if (state === null || typeof state !== 'object' || Array.isArray(state)) {
                return undefined;
            }
            const value = state['portalAttachmentId'];
            return typeof value === 'string' && value !== '' ? value : undefined;
        }, STAGED_KEY);
        const resume = asRecord(apiPayload.body['resume']);
        if ((typeof resume['portal_attachment_id'] !== 'string' ||
            resume['portal_attachment_id'] === '') &&
            stagedAttachmentId !== undefined) {
            resume['portal_attachment_id'] = stagedAttachmentId;
        }
        const materials = asRecord(payload.resolved['materials']);
        const expectedResume = asRecord(materials['attachment.resume']);
        if (typeof expectedResume['localPath'] === 'string' &&
            (typeof resume['portal_attachment_id'] !== 'string' ||
                resume['portal_attachment_id'] === '')) {
            return {
                attempted: false,
                saved: false,
                message: '附件简历上传或解析尚未完成，未调用飞书招聘保存接口',
                evidence: [],
                pageChanged: false,
            };
        }
        const headers = await dynamicHeaders(page);
        const bodyJson = JSON.stringify(apiPayload.body);
        const resumeUrl = page.url();
        const result = await page.evaluate(async ({ requestPath, bodyJson, headers }) => {
            const response = await fetch(requestPath, {
                method: 'POST',
                credentials: 'include',
                headers,
                body: bodyJson,
            });
            const text = await response.text();
            let body;
            try {
                body = JSON.parse(text);
            }
            catch {
                body = { text: text.slice(0, 500) };
            }
            return {
                status: response.status,
                code: body?.code,
                message: body?.message ?? body?.msg ?? body?.text,
            };
        }, { requestPath: apiPayload.requestPath, bodyJson, headers });
        const saved = result.status >= 200 && result.status < 300 && result.code === 0;
        const evidence = [];
        if (saved) {
            evidence.push({
                kind: 'network_response',
                strength: 'strong',
                description: `飞书招聘保存接口返回 HTTP ${result.status}，站点码 0`,
            });
            await page.evaluate((key) => {
                delete window[key];
            }, STAGED_KEY);
            await page.goto(resumeUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 120_000,
            });
            await page.waitForTimeout(3_000);
            const readback = await readResume(page);
            if (readback !== undefined) {
                evidence.push({
                    kind: 'reload_readback',
                    strength: 'strong',
                    description: '保存后重新打开简历并读到服务器数据',
                });
            }
        }
        return {
            attempted: true,
            saved,
            httpStatus: result.status,
            siteCode: String(result.code ?? 'unknown'),
            message: saved ? '飞书招聘简历保存成功' : result.message,
            evidence,
            pageChanged: saved,
        };
    },
};
//# sourceMappingURL=resume-page.js.map