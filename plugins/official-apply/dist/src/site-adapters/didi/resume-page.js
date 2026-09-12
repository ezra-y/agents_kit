import { fullProjectDescription } from "../../materials/record-description.js";
import { isEmptyWriteValue, mergeScopedRecord, normaliseWriteScope, parseWritePath, redactResumeValue, } from "../write-scope.js";
const HOST = 'campus.didiglobal.com';
const STAGED_KEY = '__officialApplyDidiResume';
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
function stringList(value) {
    if (Array.isArray(value)) {
        return value
            .filter((item) => typeof item === 'string')
            .map((item) => item.trim())
            .filter((item) => item !== '');
    }
    if (typeof value === 'string') {
        return value
            .split(/[,，、\n]/)
            .map((item) => item.trim())
            .filter((item) => item !== '');
    }
    return [];
}
function month(value) {
    return value !== undefined && /^\d{4}-\d{2}/.test(value)
        ? value.slice(0, 7)
        : undefined;
}
function calendarDate(value) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value))
        return value;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
        return value.slice(0, 10);
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(parsed);
}
function endMonth(values) {
    if (values['current'] === true)
        return '至今';
    return month(text(values, 'endDate', 'end_date'));
}
function description(record) {
    const base = text(record.values, 'description');
    const bullets = stringList(record.values['bullets']);
    return [base, ...bullets].filter((item) => item !== undefined).join('\n');
}
function sourceDescriptionParts(values) {
    return [
        text(values, 'description'),
        ...stringList(values['bullets']),
    ].filter((item) => item !== undefined);
}
function compact(record) {
    return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}
const MOKA_ROW_IDENTITY = {
    educationInfo: 'school',
    experienceInfo: 'company',
    practiceInfo: 'company',
    projectInfo: 'projectName',
    awardInfo: 'awardName',
    languageInfo: 'language',
};
const MOKA_ROW_SIGNALS = {
    educationInfo: ['startDate', 'endDate', 'academicDegree'],
    experienceInfo: ['startDate', 'endDate', 'title'],
    practiceInfo: ['startDate', 'endDate', 'title'],
    projectInfo: ['startDate', 'endDate', 'title'],
    awardInfo: ['awardDate'],
    languageInfo: ['level'],
};
function sameJson(left, right) {
    const canonical = (value, parentKey) => {
        if (Array.isArray(value)) {
            const items = value.map((item) => canonical(item, parentKey));
            const identityKey = parentKey === undefined ? undefined : MOKA_ROW_IDENTITY[parentKey];
            return identityKey !== undefined
                ? items.sort((a, b) => {
                    const leftIdentity = a !== null && typeof a === 'object' && !Array.isArray(a)
                        ? String(a[identityKey] ?? '') : '';
                    const rightIdentity = b !== null && typeof b === 'object' && !Array.isArray(b)
                        ? String(b[identityKey] ?? '') : '';
                    return `${leftIdentity}\u0000${JSON.stringify(a)}`.localeCompare(`${rightIdentity}\u0000${JSON.stringify(b)}`);
                })
                : items;
        }
        if (value !== null && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value)
                .filter(([key, item]) => {
                if (parentKey === undefined)
                    return !['createdAt', 'updatedAt', 'TP_USER_TYPE'].includes(key);
                if (MOKA_ROW_IDENTITY[parentKey] !== undefined && key === 'id')
                    return false;
                if (isEmptyWriteValue(item) &&
                    ((parentKey === 'projectInfo' && key === 'responsibilities') ||
                        (parentKey === 'languageInfo' && ['readAndWrite', 'listenAndSpeak'].includes(key))))
                    return false;
                return true;
            })
                .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
                .map(([key, item]) => [key, canonical(item, key)]));
        }
        return value;
    };
    return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
function currentMokaResume(account) {
    const basicKeys = [
        'name', 'phone', 'email', 'fullPhone', 'gender', 'experience',
        'academicDegree', 'location', 'lastSpeciality', 'lastCompany',
        'citizenId', 'certificateType', 'birthDate', 'nickname',
    ];
    const basicInfo = {
        ...asRecord(account['basicInfo']),
        ...Object.fromEntries(basicKeys
            .filter((key) => account[key] !== undefined)
            .map((key) => [key, account[key]])),
    };
    const jobKeys = ['salary', 'aimSalary', 'forwardLocation'];
    const jobIntention = {
        ...asRecord(account['jobIntention']),
        ...Object.fromEntries(jobKeys
            .filter((key) => account[key] !== undefined)
            .map((key) => [key, account[key]])),
    };
    const rootKeys = new Set([...basicKeys, ...jobKeys, 'personal']);
    return {
        ...Object.fromEntries(Object.entries(account).filter(([key]) => !rootKeys.has(key))),
        basicInfo,
        jobIntention,
        experienceInfo: account['experienceInfo'] ?? [],
        educationInfo: account['educationInfo'] ?? [],
        practiceInfo: account['practiceInfo'] ?? [],
        projectInfo: account['projectInfo'] ?? [],
        languageInfo: account['languageInfo'] ?? [],
        awardInfo: account['awardInfo'] ?? [],
        selfDescription: {
            ...asRecord(account['selfDescription']),
            ...(account['personal'] === undefined ? {} : { personal: account['personal'] }),
        },
    };
}
function expectedMokaAccount(account, resume, targetPaths) {
    const expected = JSON.parse(JSON.stringify(account));
    if (account['orgId'] === undefined && account['candidateAccountId'] === undefined &&
        account['id'] !== undefined && resume['orgId'] !== undefined) {
        expected['orgId'] = resume['orgId'];
        expected['candidateAccountId'] = account['id'];
    }
    for (const path of targetPaths) {
        const parsed = parseWritePath(path);
        if (parsed === undefined)
            continue;
        const sectionValue = asRecord(resume[parsed.section]);
        if (Object.keys(parsed.selectors).length > 0) {
            expected[parsed.section] = asRows(resume[parsed.section]);
            continue;
        }
        const value = parsed.field in sectionValue ? sectionValue[parsed.field] : resume[parsed.section];
        if (parsed.section === 'basicInfo' || parsed.section === 'jobIntention') {
            expected[parsed.field] = value;
            if (expected[parsed.section] !== undefined) {
                expected[parsed.section] = { ...asRecord(expected[parsed.section]), [parsed.field]: value };
            }
        }
        else if (parsed.section === 'selfDescription' && parsed.field === 'personal') {
            expected['personal'] = value;
            if (expected[parsed.section] !== undefined) {
                expected[parsed.section] = { ...asRecord(expected[parsed.section]), personal: value };
            }
        }
        else if (parsed.section === 'resume') {
            expected[parsed.field] = resume[parsed.field];
        }
        else {
            expected[parsed.section] = value;
        }
    }
    return expected;
}
function degreeLabel(value) {
    if (value?.includes('博士'))
        return '博士';
    if (value?.includes('硕士'))
        return '硕士';
    return value;
}
function degreeRank(value) {
    switch (degreeLabel(value)) {
        case '博士':
            return 5;
        case '硕士':
        case 'MBA':
            return 4;
        case '本科':
            return 3;
        case '大专':
            return 2;
        case '高中':
        case '中专':
            return 1;
        default:
            return 0;
    }
}
function highestEducation(input) {
    return [...input.education].sort((left, right) => degreeRank(text(right.values, 'degree')) -
        degreeRank(text(left.values, 'degree')))[0];
}
function educationRows(input) {
    return input.education.map((record) => compact({
        startDate: month(text(record.values, 'startDate', 'start_date')),
        endDate: endMonth(record.values),
        school: text(record.values, 'school'),
        speciality: text(record.values, 'major'),
        academicDegree: degreeLabel(text(record.values, 'degree')),
    }));
}
function experienceRows(input, kind) {
    return input.experience
        .filter((record) => {
        const title = text(record.values, 'title', 'role') ?? '';
        return kind === 'practice' ? /实习/.test(title) : !/实习/.test(title);
    })
        .map((record) => compact({
        startDate: month(text(record.values, 'startDate', 'start_date')),
        endDate: endMonth(record.values),
        company: text(record.values, 'company'),
        title: text(record.values, 'title', 'role'),
        summary: description(record),
    }));
}
function projectRows(input) {
    return input.projects.map((record) => {
        const role = text(record.values, 'role');
        const normalizedRole = role !== undefined && /solo builder/i.test(role) ? '独立开发者' : role;
        return compact({
            startDate: month(text(record.values, 'startDate', 'start_date')),
            endDate: endMonth(record.values),
            projectName: text(record.values, 'name', 'label'),
            title: normalizedRole,
            projectDescription: fullProjectDescription(record.values),
            responsibilities: '',
        });
    });
}
function awardRows(input) {
    return input.awards.map((record) => {
        const date = text(record.values, 'date');
        const label = text(record.values, 'label');
        const level = text(record.values, 'level');
        const name = label === undefined
            ? [text(record.values, 'name'), level]
                .filter((item) => item !== undefined)
                .join('｜')
            : level !== undefined && !label.includes(level)
                ? `${label}｜${level}`
                : label;
        return compact({
            awardDate: date === undefined
                ? undefined
                : /^\d{4}-\d{2}/.test(date)
                    ? date.slice(0, 7)
                    : /^\d{4}$/.test(date)
                        ? date
                        : undefined,
            awardName: name,
        });
    });
}
function languageRows(input) {
    return (input.languages ?? []).map((record) => compact({
        language: text(record.values, 'language', 'name'),
        level: text(record.values, 'proficiency', 'level'),
    }));
}
function resolvedResume(payload) {
    const value = payload.resolved['apiResume'];
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value
        : undefined;
}
function sourceFacts(payload) {
    return asRecord(payload.resolved['sourceFacts']);
}
function sourceValues(facts, key) {
    return asRows(facts[key]).map((record) => asRecord(record['values']));
}
function sourceDegreeCategory(value) {
    const label = typeof value === 'string' ? value : '';
    if (/博士|phd|doctor/i.test(label))
        return '博士';
    if (/硕士|master|mba/i.test(label))
        return '硕士';
    if (/本科|学士|bachelor/i.test(label))
        return '本科';
    if (/大专|专科|associate/i.test(label))
        return '大专';
    if (/高中|中专/.test(label))
        return '高中';
    return label === '' ? undefined : label;
}
function sourceDegreeRank(value) {
    switch (sourceDegreeCategory(value)) {
        case '博士': return 5;
        case '硕士': return 4;
        case '本科': return 3;
        case '大专': return 2;
        case '高中': return 1;
        default: return 0;
    }
}
function sourceDegreeMatches(actual, source) {
    const expected = sourceDegreeCategory(source);
    return expected === undefined
        ? String(actual ?? '') === String(source ?? '')
        : sourceDegreeCategory(actual) === expected;
}
function sourceIssue(issues, key, message) {
    issues.push({ key, code: 'source_fact_mismatch', message, severity: 'error' });
}
function validateSourceFacts(facts, account, issues) {
    let checked = 0;
    const basicInfo = asRecord(account['basicInfo']);
    const actualAcademicDegree = account['academicDegree'] ?? basicInfo['academicDegree'];
    const education = sourceValues(facts, 'education');
    const educationInfo = asRows(account['educationInfo']);
    const highest = education.reduce((best, row) => best === undefined || sourceDegreeRank(row['degree']) > sourceDegreeRank(best['degree']) ? row : best, undefined);
    if (highest !== undefined) {
        checked += 1;
        if (!sourceDegreeMatches(actualAcademicDegree, highest['degree'])) {
            sourceIssue(issues, 'basicInfo.academicDegree', '最高学历与原始教育记录不一致');
        }
    }
    const educationPairs = pairRows(education, educationInfo, (row) => text(row, 'school'), (row) => text(row, 'school'), (row) => ({
        startDate: month(text(row, 'startDate', 'start_date')) ?? '',
        endDate: month(text(row, 'endDate', 'end_date')) ?? '',
        academicDegree: sourceDegreeCategory(row['degree']) ?? '',
    }), (row) => ({
        startDate: text(row, 'startDate') ?? '',
        endDate: text(row, 'endDate') ?? '',
        academicDegree: sourceDegreeCategory(row['academicDegree']) ?? '',
    }));
    for (const pair of educationPairs) {
        const row = pair.expected;
        const school = text(row, 'school');
        if (school === undefined)
            continue;
        const actual = pair.actual;
        if (actual === undefined) {
            sourceIssue(issues, 'educationInfo', `服务器缺少或无法唯一配对原始教育记录：${school}`);
            continue;
        }
        for (const [key, actualKey, expected] of [
            ['major', 'speciality', text(row, 'major')],
            ['startDate', 'startDate', month(text(row, 'startDate', 'start_date'))],
            ['endDate', 'endDate', month(text(row, 'endDate', 'end_date'))],
        ]) {
            if (expected === undefined)
                continue;
            checked += 1;
            if (String(actual[actualKey] ?? '') !== expected) {
                sourceIssue(issues, `educationInfo.${key}`, `${school} 的 ${key} 与原始事实不一致`);
            }
        }
        if (row['degree'] !== undefined) {
            checked += 1;
            if (!sourceDegreeMatches(actual['academicDegree'], row['degree'])) {
                sourceIssue(issues, 'educationInfo.academicDegree', `${school} 的学历与原始事实不一致`);
            }
        }
    }
    for (const [sourceKey, accountKey] of [['experience', 'experienceInfo'], ['internship', 'practiceInfo']]) {
        const rows = sourceValues(facts, sourceKey);
        const actualRows = asRows(account[accountKey]);
        const pairs = pairRows(rows, actualRows, (row) => text(row, 'company'), (row) => text(row, 'company'), (row) => ({
            startDate: month(text(row, 'startDate', 'start_date')) ?? '',
            endDate: endMonth(row) ?? '',
            title: text(row, 'title', 'role') ?? '',
        }), (row) => ({
            startDate: text(row, 'startDate') ?? '',
            endDate: text(row, 'endDate') ?? '',
            title: text(row, 'title') ?? '',
        }));
        for (const pair of pairs) {
            const row = pair.expected;
            const company = text(row, 'company');
            if (company === undefined)
                continue;
            const actual = pair.actual;
            if (actual === undefined) {
                sourceIssue(issues, accountKey, `服务器缺少或无法唯一配对原始经历记录：${company}`);
                continue;
            }
            const title = text(row, 'title', 'role');
            for (const [key, actualKey, expected] of [
                ['title', 'title', title],
                ['startDate', 'startDate', month(text(row, 'startDate', 'start_date'))],
                ['endDate', 'endDate', endMonth(row)],
            ]) {
                if (expected === undefined)
                    continue;
                checked += 1;
                if (String(actual[actualKey] ?? '') !== expected) {
                    sourceIssue(issues, `${accountKey}.${key}`, `${company} 的 ${key} 与原始事实不一致`);
                }
            }
            for (const part of sourceDescriptionParts(row)) {
                checked += 1;
                if (!String(actual['summary'] ?? '').includes(part)) {
                    sourceIssue(issues, `${accountKey}.summary`, `${company} 的经历正文缺少原始段落`);
                }
            }
        }
    }
    const projects = sourceValues(facts, 'projects');
    const projectInfo = asRows(account['projectInfo']);
    const projectPairs = pairRows(projects, projectInfo, (row) => text(row, 'name', 'label'), (row) => text(row, 'projectName'), (row) => ({
        startDate: month(text(row, 'startDate', 'start_date')) ?? '',
        endDate: endMonth(row) ?? '',
        title: /solo builder/i.test(text(row, 'role') ?? '') ? '独立开发者' : text(row, 'role') ?? '',
    }), (row) => ({
        startDate: text(row, 'startDate') ?? '',
        endDate: text(row, 'endDate') ?? '',
        title: text(row, 'title') ?? '',
    }));
    for (const pair of projectPairs) {
        const row = pair.expected;
        const name = text(row, 'name', 'label');
        if (name === undefined)
            continue;
        const actual = pair.actual;
        if (actual === undefined) {
            sourceIssue(issues, 'projectInfo', `服务器缺少或无法唯一配对原始项目记录：${name}`);
            continue;
        }
        const role = text(row, 'role');
        const expectedRole = role !== undefined && /solo builder/i.test(role) ? '独立开发者' : role;
        for (const [key, actualKey, expected] of [
            ['role', 'title', expectedRole],
            ['startDate', 'startDate', month(text(row, 'startDate', 'start_date'))],
            ['endDate', 'endDate', endMonth(row)],
        ]) {
            if (expected === undefined)
                continue;
            checked += 1;
            if (String(actual[actualKey] ?? '') !== expected) {
                sourceIssue(issues, `projectInfo.${key}`, `${name} 的 ${key} 与原始事实不一致`);
            }
        }
        for (const part of fullProjectDescription(row).split('\n\n').filter(Boolean)) {
            checked += 1;
            if (!String(actual['projectDescription'] ?? '').includes(part)) {
                sourceIssue(issues, 'projectInfo.projectDescription', `${name} 的项目正文缺少原始段落`);
            }
        }
    }
    const selfEvaluation = text(asRecord(facts['basic']), 'open_question.self_evaluation', 'profile.summary', 'person.summary');
    const actualSelfEvaluation = account['personal'] ?? asRecord(account['selfDescription'])['personal'];
    if (selfEvaluation !== undefined) {
        checked += 1;
        if (actualSelfEvaluation !== selfEvaluation)
            sourceIssue(issues, 'basicInfo.personal', '自我评价与原始事实不一致');
    }
    const languages = sourceValues(facts, 'languages');
    const languageInfo = asRows(account['languageInfo']);
    for (const row of languages) {
        const language = text(row, 'language', 'name');
        if (language === undefined)
            continue;
        const actual = languageInfo.find((item) => text(item, 'language', 'name') === language);
        if (actual === undefined) {
            sourceIssue(issues, 'languageInfo', `服务器缺少原始语言记录：${language}`);
            continue;
        }
        const level = text(row, 'proficiency', 'level');
        if (level !== undefined) {
            checked += 1;
            if (text(actual, 'level', 'proficiency') !== level)
                sourceIssue(issues, 'languageInfo', `${language} 的熟练程度与原始事实不一致`);
        }
    }
    return checked;
}
function fillResult(fields) {
    return {
        attemptedCount: fields.length,
        filledCount: fields.filter((item) => item.outcome === 'filled').length,
        unchangedCount: fields.filter((item) => item.outcome === 'unchanged').length,
        skippedCount: fields.filter((item) => item.outcome === 'skipped').length,
        failed: fields.filter((item) => item.outcome === 'failed'),
        fields,
        requiresRescan: false,
    };
}
async function readAccount(page) {
    await page
        .waitForFunction(() => {
        const root = window;
        const account = root.TurboApply?.data?.candidateAccount;
        return account !== null && typeof account === 'object' &&
            !Array.isArray(account);
    }, undefined, { timeout: 20_000 });
    return page.evaluate(() => {
        const root = window;
        const value = root.TurboApply?.data?.candidateAccount;
        return value !== null && typeof value === 'object' && !Array.isArray(value)
            ? value
            : {};
    });
}
function expectedRows(resume, key) {
    return asRows(resume[key]);
}
function rowSignals(row, keys) {
    return Object.fromEntries(keys.flatMap((key) => {
        const value = row[key];
        return value === undefined || value === null || value === ''
            ? []
            : [[key, String(value)]];
    }));
}
function pairRows(expectedRows, actualRows, expectedIdentity, actualIdentity, expectedSignals, actualSignals) {
    const used = new Set();
    return expectedRows.map((expected) => {
        const identity = expectedIdentity(expected);
        const candidates = actualRows.flatMap((actual, index) => !used.has(index) && identity !== undefined && actualIdentity(actual) === identity
            ? [{ actual, index }]
            : []);
        if (candidates.length === 0)
            return { expected };
        const expectedSignalsValue = Object.fromEntries(Object.entries(expectedSignals(expected)).filter(([, value]) => value !== ''));
        const matches = (candidate) => {
            const actualSignalsValue = actualSignals(candidate.actual);
            return Object.entries(expectedSignalsValue).every(([key, value]) => actualSignalsValue[key] === value);
        };
        const exact = candidates.filter(matches);
        const selected = exact.length === 1
            ? exact[0]
            : candidates.length === 1
                ? candidates[0]
                : undefined;
        if (selected === undefined)
            return { expected };
        used.add(selected.index);
        return { expected, actual: selected.actual };
    });
}
function compareRows(issues, resume, account, section, identityKey, checkedKeys, matchKeys) {
    const expected = expectedRows(resume, section);
    const actual = asRows(account[section]);
    let checked = 0;
    const pairs = pairRows(expected, actual, (row) => String(row[identityKey] ?? '') || undefined, (row) => String(row[identityKey] ?? '') || undefined, (row) => rowSignals(row, matchKeys), (row) => rowSignals(row, matchKeys));
    for (const pair of pairs) {
        const identity = pair.expected[identityKey];
        if (pair.actual === undefined) {
            issues.push({
                key: section,
                code: 'server_readback_missing_record',
                message: `Moka 服务器缺少或无法唯一配对${String(identity ?? section)}`,
                severity: 'error',
            });
            continue;
        }
        for (const key of checkedKeys) {
            const expectedValue = pair.expected[key];
            if (expectedValue === undefined || expectedValue === '')
                continue;
            checked += 1;
            if (pair.actual[key] !== expectedValue) {
                issues.push({
                    key: `${section}.${key}`,
                    code: 'server_readback_mismatch',
                    message: `Moka 服务器读回的${String(identity ?? section)}字段不一致`,
                    severity: 'error',
                });
            }
        }
    }
    return checked;
}
async function validateServer(page, payload) {
    const resume = resolvedResume(payload);
    if (resume === undefined) {
        return {
            valid: false,
            checkedCount: 0,
            issues: [
                {
                    key: 'apiResume',
                    code: 'didi_payload_missing',
                    message: '没有生成 Moka 简历数据',
                    severity: 'blocking',
                },
            ],
        };
    }
    const account = await readAccount(page);
    const issues = payload.missing.map((item) => ({
        key: item.key,
        code: 'required_missing',
        message: item.reason,
        severity: 'blocking',
    }));
    let checkedCount = 0;
    const candidate = asRecord(payload.resolved['candidateResume']);
    checkedCount += validateSourceFacts(sourceFacts(payload), payload.writePlan === undefined ? account : candidate, issues);
    const basic = asRecord(resume['basicInfo']);
    for (const key of [
        'name',
        'email',
        'gender',
        'academicDegree',
        'location',
        'lastCompany',
        'citizenId',
        'birthDate',
    ]) {
        const expected = basic[key];
        if (expected === undefined || expected === '')
            continue;
        checkedCount += 1;
        const actual = account[key];
        const equal = key === 'birthDate' &&
            typeof actual === 'string' &&
            typeof expected === 'string'
            ? calendarDate(actual) === calendarDate(expected)
            : actual === expected;
        if (!equal) {
            issues.push({
                key: `basicInfo.${key}`,
                code: 'server_readback_mismatch',
                message: `Moka 服务器读回的基础字段 ${key} 不一致`,
                severity: 'error',
            });
        }
    }
    checkedCount += compareRows(issues, resume, account, 'educationInfo', 'school', ['startDate', 'endDate', 'speciality', 'academicDegree'], ['startDate', 'endDate', 'academicDegree']);
    checkedCount += compareRows(issues, resume, account, 'experienceInfo', 'company', ['startDate', 'endDate', 'title', 'summary'], ['startDate', 'endDate', 'title']);
    checkedCount += compareRows(issues, resume, account, 'practiceInfo', 'company', ['startDate', 'endDate', 'title', 'summary'], ['startDate', 'endDate', 'title']);
    checkedCount += compareRows(issues, resume, account, 'projectInfo', 'projectName', ['startDate', 'endDate', 'title', 'projectDescription', 'responsibilities'], ['startDate', 'endDate', 'title']);
    checkedCount += compareRows(issues, resume, account, 'awardInfo', 'awardName', ['awardDate'], ['awardDate']);
    const targetPaths = payload.writePlan?.targetPaths ?? [];
    const expectedBaseline = payload.writePlan === undefined
        ? account
        : asRecord(payload.writePlan.baseline);
    if (payload.writePlan !== undefined &&
        !sameJson(redactResumeValue(account), redactResumeValue(expectedMokaAccount(expectedBaseline, resume, targetPaths)))) {
        issues.push({
            key: 'writeScope',
            code: 'server_readback_scope_mismatch',
            message: 'Moka 保存后服务器简历与本轮写入计划不一致，包含目标外字段变化或未知字段丢失',
            severity: 'error',
        });
    }
    return { valid: issues.length === 0, checkedCount, issues };
}
export const didiResumePage = {
    id: 'didi.campus.personal-resume',
    version: 1,
    host: HOST,
    pageKind: 'resume_edit',
    status: 'verified',
    supportsWriteScope: true,
    lastVerifiedAt: '2026-08-28T20:00:00.000+08:00',
    async match(page) {
        const initialUrl = new URL(page.url());
        if (initialUrl.hostname === HOST) {
            await page
                .waitForFunction(() => /^\/campus_apply\/didiglobal\/\d+\/?$/.test(window.location.pathname) &&
                window.location.hash.startsWith('#/candidateHome/resume'), undefined, { timeout: 10_000 })
                .catch(() => undefined);
        }
        const url = new URL(page.url());
        const hostMatched = url.hostname === HOST;
        const pathMatched = /^\/campus_apply\/didiglobal\/\d+\/?$/.test(url.pathname) &&
            url.hash.startsWith('#/candidateHome/resume');
        const anchors = ['基础信息', '教育背景', '项目经验', '保存'];
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
        const matched = hostMatched && pathMatched;
        return {
            matched,
            confidence: matched && missingAnchors.length === 0 ? 1 : matched ? 0.8 : 0,
            allowRun: matched,
            reasons: [
                hostMatched ? '滴滴招聘域名匹配' : '域名不匹配',
                pathMatched ? '滴滴简历路由匹配' : '简历路由不匹配',
            ],
            matchedAnchors,
            missingAnchors,
            pageVersionChanged: hostMatched && pathMatched && missingAnchors.length > 0,
        };
    },
    async inspect(page) {
        const account = await readAccount(page);
        const org = await page.evaluate(() => {
            const root = window;
            return {
                orgId: root.TurboApply?.data?.org?.id,
                siteId: root.TurboApply?.data?.org?.siteId,
            };
        });
        return {
            url: page.url(),
            title: await page.title(),
            pageKind: 'resume_edit',
            anchors: ['基础信息', '教育背景', '项目经验', '保存'],
            runtimeData: {
                account: account,
                orgId: String(org.orgId ?? 'didiglobal'),
                siteId: Number(org.siteId ?? 96064),
            },
        };
    },
    prepare(input, facts, requestedScope) {
        const account = asRecord(facts.runtimeData?.['account']);
        const writeScope = normaliseWriteScope(requestedScope);
        const education = highestEducation(input);
        const desiredCities = stringList(input.basic['application.preference.desired_city']);
        const phone = text(input.basic, 'person.contact.phone');
        const name = text(input.basic, 'person.identity.full_name');
        const identificationNumber = text(input.basic, 'person.identity.identification_number', 'person.identity.id_number');
        const latestWork = input.experience.find((record) => !/实习/.test(text(record.values, 'title', 'role') ?? ''));
        const missing = [];
        for (const [key, value, reason] of [
            ['person.identity.full_name', name, 'Moka 简历缺少姓名'],
            ['person.contact.phone', phone, 'Moka 简历缺少手机号'],
            [
                'person.identity.identification_number',
                identificationNumber,
                'Moka 简历缺少证件号码',
            ],
        ]) {
            if (value === undefined)
                missing.push({ key, reason });
        }
        const personal = text(input.basic, 'open_question.self_evaluation', 'profile.summary', 'person.summary') ??
            text(account, 'personal');
        const resume = {
            uploadInfo: { resumeKey: '', attachments: [] },
            basicInfo: compact({
                name,
                phone: text(account, 'phone') ?? phone,
                email: text(input.basic, 'person.contact.email') ?? text(account, 'email'),
                fullPhone: text(account, 'fullPhone') ??
                    (phone === undefined ? undefined : `+86 ${phone}`),
                gender: text(input.basic, 'person.identity.gender') ??
                    text(account, 'gender'),
                experience: account['experience'],
                academicDegree: degreeLabel(text(education?.values ?? {}, 'degree')),
                location: text(input.basic, 'person.location.current_city') ??
                    text(account, 'location'),
                lastCompany: text(latestWork?.values ?? {}, 'company'),
                citizenId: identificationNumber,
                certificateType: text(account, 'certificateType') ?? '身份证',
                birthDate: text(input.basic, 'person.identity.birth_date') ??
                    text(account, 'birthDate'),
                nickname: name,
            }),
            jobIntention: compact({
                salary: account['salary'],
                aimSalary: text(input.basic, 'application.compensation.expected_salary') ?? account['aimSalary'],
                forwardLocation: desiredCities.length > 0
                    ? desiredCities.join('、')
                    : text(account, 'forwardLocation'),
            }),
            experienceInfo: experienceRows(input, 'work'),
            educationInfo: educationRows(input),
            practiceInfo: experienceRows(input, 'practice'),
            projectInfo: projectRows(input),
            languageInfo: languageRows(input),
            selfDescription: personal === undefined ? {} : { personal },
            awardInfo: awardRows(input),
            applyInfo: {},
            updateAccountResume: {},
            questionnaires: {},
            orgId: text(facts.runtimeData ?? {}, 'orgId') ?? 'didiglobal',
            siteId: Number(facts.runtimeData?.['siteId'] ?? 96064),
        };
        // Transport options are not candidate answers or readback targets.
        const { uploadInfo, applyInfo, updateAccountResume, questionnaires, orgId, siteId, ...content } = resume;
        const scoped = requestedScope === undefined
            ? { resume: content, targetPaths: [], conflicts: [], availableFields: [] }
            : mergeScopedRecord(currentMokaResume(account), content, writeScope, {
                identityKey: section => MOKA_ROW_IDENTITY[section],
                signalKeys: section => MOKA_ROW_SIGNALS[section] ?? [],
                mergeRowObjects: true,
            });
        return {
            resolved: {
                apiResume: (requestedScope === undefined ? resume
                    : { ...scoped.resume, uploadInfo, applyInfo, updateAccountResume, questionnaires, orgId, siteId }),
                candidateResume: resume,
                sourceFacts: {
                    basic: input.basic,
                    education: input.education.map((record) => ({ values: record.values })),
                    experience: input.experience
                        .filter((record) => !/实习/.test(text(record.values, 'title', 'role') ?? ''))
                        .map((record) => ({ values: record.values })),
                    internship: input.experience
                        .filter((record) => /实习/.test(text(record.values, 'title', 'role') ?? ''))
                        .map((record) => ({ values: record.values })),
                    projects: input.projects.map((record) => ({ values: record.values })),
                    languages: input.languages ?? [],
                },
            },
            missing,
            conflicts: scoped.conflicts,
            skipped: input.materials?.['attachment.resume'] === undefined
                ? []
                : [
                    {
                        key: 'attachment.resume',
                        reason: 'Moka 当前站内简历页没有附件上传栏',
                    },
                ],
            ...(requestedScope === undefined
                ? {}
                : {
                    writePlan: {
                        scope: writeScope,
                        baseline: redactResumeValue(account) ?? {},
                        targetPaths: scoped.targetPaths,
                        availableFields: scoped.availableFields,
                        siteContext: {
                            orgId: String(facts.runtimeData?.['orgId'] ?? 'didiglobal'),
                            siteId: Number(facts.runtimeData?.['siteId'] ?? 96064),
                        },
                    },
                }),
        };
    },
    async fill(page, payload) {
        const resume = resolvedResume(payload);
        if (resume === undefined) {
            return fillResult([
                {
                    key: 'apiResume',
                    outcome: 'failed',
                    code: 'didi_payload_missing',
                    message: '没有生成 Moka 简历数据',
                },
            ]);
        }
        await page.evaluate(({ key, value }) => {
            window[key] = value;
        }, { key: STAGED_KEY, value: resume });
        return fillResult([
            { key: 'basic', outcome: 'prepared' },
            { key: 'jobIntention', outcome: 'prepared' },
            { key: 'experience', outcome: 'prepared' },
            { key: 'education', outcome: 'prepared' },
            { key: 'projects', outcome: 'prepared' },
            { key: 'languages', outcome: 'prepared' },
            { key: 'awards', outcome: 'prepared' },
        ]);
    },
    async validate(page, payload) {
        const staged = await page.evaluate((key) => window[key] !== undefined, STAGED_KEY);
        const issues = payload.missing.map((item) => ({
            key: item.key,
            code: 'required_missing',
            message: item.reason,
            severity: 'blocking',
        }));
        const resume = resolvedResume(payload) ?? {};
        if (!staged)
            return validateServer(page, payload);
        const checkedCount = asRows(resume['educationInfo']).length +
            asRows(resume['experienceInfo']).length +
            asRows(resume['practiceInfo']).length +
            asRows(resume['projectInfo']).length +
            asRows(resume['awardInfo']).length +
            3;
        const sourceCheckedCount = validateSourceFacts(sourceFacts(payload), asRecord(payload.resolved['candidateResume']), issues);
        return { source: 'prepared', valid: issues.length === 0, checkedCount: checkedCount + sourceCheckedCount, issues };
    },
    async saveDraft(page, payload) {
        if (payload.conflicts.length > 0) {
            return {
                attempted: false,
                saved: false,
                message: `写入范围无法安全定位：${payload.conflicts.map((item) => item.reason).join('；')}`,
                evidence: [],
                pageChanged: false,
            };
        }
        const resume = resolvedResume(payload);
        if (resume === undefined) {
            return {
                attempted: false,
                saved: false,
                message: '没有生成 Moka 简历数据',
                evidence: [],
                pageChanged: false,
            };
        }
        const account = await readAccount(page);
        const basic = asRecord(resume['basicInfo']);
        const name = text(basic, 'name');
        if (name !== undefined &&
            text(account, 'name') === undefined) {
            const accountId = account['id'] ?? account['candidateAccountId'];
            const nameResponse = await page.evaluate(async ({ accountId: id, name: accountName, orgId, siteId }) => {
                const root = window;
                const result = await fetch('/api/outer/ats-apply/personal-center/updateName', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        accept: 'application/json',
                        'content-type': 'application/json',
                        'x-csrf-token': String(root.TurboApply?.data?.csrfToken ?? ''),
                    },
                    body: JSON.stringify({ orgId, siteId, name: accountName, accountId: id }),
                });
                let data;
                try {
                    data = await result.json();
                }
                catch {
                    data = undefined;
                }
                const record = data !== null && typeof data === 'object' && !Array.isArray(data)
                    ? data
                    : {};
                return {
                    ok: result.ok,
                    code: record['errorCode'] ?? record['code'],
                    success: record['success'],
                };
            }, { accountId, name, orgId: resume['orgId'], siteId: resume['siteId'] });
            const updated = nameResponse.ok &&
                (nameResponse.success === true ||
                    nameResponse.code === 0 ||
                    nameResponse.code === '0');
            if (!updated) {
                return {
                    attempted: true,
                    saved: false,
                    message: 'Moka 姓名更新接口没有返回成功结果',
                    evidence: [],
                    pageChanged: false,
                };
            }
        }
        const response = await page.evaluate(async (body) => {
            const root = window;
            const result = await fetch('/personal-center/resumeInfo', {
                method: 'PUT',
                credentials: 'include',
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                    'x-csrf-token': String(root.TurboApply?.data?.csrfToken ?? ''),
                },
                body: JSON.stringify(body),
            });
            let data;
            try {
                data = await result.json();
            }
            catch {
                data = undefined;
            }
            const record = data !== null && typeof data === 'object' && !Array.isArray(data)
                ? data
                : {};
            return {
                status: result.status,
                ok: result.ok,
                keys: Object.keys(record),
                code: record['errorCode'] ?? record['code'],
                message: record['message'],
            };
        }, resume);
        const encryptedSuccess = response.keys.includes('data') && response.keys.includes('necromancer');
        const saved = response.ok &&
            (encryptedSuccess ||
                response.code === 0 ||
                response.code === '0');
        if (saved) {
            await page.evaluate((key) => {
                delete window[key];
            }, STAGED_KEY);
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
            await readAccount(page);
        }
        return {
            attempted: true,
            saved,
            httpStatus: response.status,
            siteCode: response.code === undefined ? undefined : String(response.code),
            message: typeof response.message === 'string'
                ? response.message
                : saved
                    ? 'Moka 简历已保存'
                    : 'Moka 简历保存接口没有返回成功结果',
            evidence: saved
                ? [
                    {
                        kind: 'network_response',
                        strength: 'strong',
                        description: 'Moka 简历保存接口返回 HTTP 200 和加密成功数据',
                    },
                    {
                        kind: 'reload_readback',
                        strength: 'strong',
                        description: '刷新后从 Moka 服务器简历数据逐项读回',
                    },
                ]
                : [],
            pageChanged: saved,
        };
    },
};
//# sourceMappingURL=resume-page.js.map