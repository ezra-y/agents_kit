import { fullProjectDescription } from "../../materials/record-description.js";
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
function compact(record) {
    return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}
function degreeRank(value) {
    switch (value) {
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
        academicDegree: text(record.values, 'degree'),
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
        return root.TurboApply?.data?.candidateAccount !== undefined;
    }, undefined, { timeout: 20_000 })
        .catch(() => undefined);
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
function compareRows(issues, resume, account, section, identityKey, checkedKeys) {
    const expected = expectedRows(resume, section);
    const actual = asRows(account[section]);
    let checked = 0;
    for (const row of expected) {
        const identity = row[identityKey];
        const found = actual.find((candidate) => candidate[identityKey] === identity);
        if (found === undefined) {
            issues.push({
                key: section,
                code: 'server_readback_missing_record',
                message: `Moka 服务器缺少${String(identity ?? section)}`,
                severity: 'error',
            });
            continue;
        }
        for (const key of checkedKeys) {
            const expectedValue = row[key];
            if (expectedValue === undefined)
                continue;
            checked += 1;
            if (found[key] !== expectedValue) {
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
    checkedCount += compareRows(issues, resume, account, 'educationInfo', 'school', ['startDate', 'endDate', 'speciality', 'academicDegree']);
    checkedCount += compareRows(issues, resume, account, 'experienceInfo', 'company', ['startDate', 'endDate', 'title', 'summary']);
    checkedCount += compareRows(issues, resume, account, 'practiceInfo', 'company', ['startDate', 'endDate', 'title', 'summary']);
    checkedCount += compareRows(issues, resume, account, 'projectInfo', 'projectName', ['startDate', 'endDate', 'title', 'projectDescription', 'responsibilities']);
    checkedCount += compareRows(issues, resume, account, 'awardInfo', 'awardName', ['awardDate']);
    return { valid: issues.length === 0, checkedCount, issues };
}
export const didiResumePage = {
    id: 'didi.campus.personal-resume',
    version: 1,
    host: HOST,
    pageKind: 'resume_edit',
    status: 'verified',
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
    prepare(input, facts) {
        const account = asRecord(facts.runtimeData?.['account']);
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
                academicDegree: text(education?.values ?? {}, 'degree'),
                location: text(input.basic, 'person.location.current_city') ??
                    text(account, 'location'),
                lastSpeciality: text(education?.values ?? {}, 'major'),
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
        return {
            resolved: { apiResume: resume },
            missing,
            conflicts: [],
            skipped: input.materials?.['attachment.resume'] === undefined
                ? []
                : [
                    {
                        key: 'attachment.resume',
                        reason: 'Moka 当前站内简历页没有附件上传栏',
                    },
                ],
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
            { key: 'basic', outcome: 'filled' },
            { key: 'jobIntention', outcome: 'filled' },
            { key: 'experience', outcome: 'filled' },
            { key: 'education', outcome: 'filled' },
            { key: 'projects', outcome: 'filled' },
            { key: 'languages', outcome: 'filled' },
            { key: 'awards', outcome: 'filled' },
        ]);
    },
    async validate(page, payload) {
        const staged = await page.evaluate((key) => window[key] !== undefined, STAGED_KEY);
        if (!staged)
            return validateServer(page, payload);
        const issues = payload.missing.map((item) => ({
            key: item.key,
            code: 'required_missing',
            message: item.reason,
            severity: 'blocking',
        }));
        const resume = resolvedResume(payload) ?? {};
        const checkedCount = asRows(resume['educationInfo']).length +
            asRows(resume['experienceInfo']).length +
            asRows(resume['practiceInfo']).length +
            asRows(resume['projectInfo']).length +
            asRows(resume['awardInfo']).length +
            3;
        return { valid: issues.length === 0, checkedCount, issues };
    },
    async saveDraft(page, payload) {
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