const HOST = 'xiaomi.jobs.f.mioffice.cn';
const PATH = '/campus/resume/edit';
const READ_PATH = '/api/v1/user/latest/resume';
const LOCATION_PATH = '/api/v1/config/location/nodes';
const SETTING_PATH = '/api/v1/common/setting';
const STAGED_KEY = '__officialApplyXiaomiResume';
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
function currentAttachmentId(current) {
    const direct = current['portal_attachment_id'];
    if (typeof direct === 'string' && direct !== '')
        return direct;
    const attachment = asRecord(current['resume_attachment']);
    const id = attachment['id'];
    return typeof id === 'string' && id !== '' ? id : undefined;
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
    return Array.isArray(value)
        ? value.filter((item) => typeof item === 'string')
        : [];
}
function timestamp(value, end = false) {
    if (value === undefined || !/^\d{4}-\d{2}/.test(value))
        return undefined;
    return Date.parse(`${value.slice(0, 7)}-${end ? '28' : '01'}T00:00:00+08:00`);
}
function ageFromBirthDate(value) {
    if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return undefined;
    const birth = new Date(`${value}T00:00:00+08:00`);
    if (Number.isNaN(birth.getTime()))
        return undefined;
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const beforeBirthday = now.getMonth() < birth.getMonth() ||
        (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
    if (beforeBirthday)
        age -= 1;
    return age;
}
function description(record) {
    const base = text(record.values, 'description') ?? '';
    const bullets = stringList(record.values['bullets'])
        .map((item) => item.trim())
        .filter((item) => item !== '');
    return [base, ...bullets].filter((item) => item !== '').join('\n');
}
function degreeLabel(record) {
    return text(record.values, 'degree');
}
function optionKey(settings, key, label) {
    if (label === undefined)
        return undefined;
    const options = asRows(settings[key]);
    const match = options.find((option) => option['val'] === label);
    const value = match?.['key'];
    return typeof value === 'string' || typeof value === 'number'
        ? value
        : undefined;
}
function locationCode(root, name) {
    if (name === undefined)
        return undefined;
    const normalizedName = name.replace(/[省市区县\s]/g, '');
    const matches = [];
    const walk = (value) => {
        if (Array.isArray(value)) {
            value.forEach(walk);
            return;
        }
        if (value === null || typeof value !== 'object')
            return;
        const record = value;
        const location = asRecord(record['location']);
        const label = [
            location['name'],
            location['i18n_name'],
            record['name'],
            record['i18n_name'],
        ].find((item) => typeof item === 'string');
        const code = location['code'] ?? record['code'];
        if (typeof label === 'string' &&
            typeof code === 'string' &&
            (() => {
                const normalizedLabel = label.replace(/[省市区县\s]/g, '');
                return (normalizedLabel === normalizedName ||
                    normalizedName.endsWith(normalizedLabel));
            })()) {
            matches.push({ code, city: code.startsWith('CT_') });
        }
        Object.values(record).forEach(walk);
    };
    walk(root);
    return matches.find((item) => item.city)?.code ?? matches[0]?.code;
}
function educationRows(input, settings) {
    return input.education.map((record) => ({
        start_time: timestamp(text(record.values, 'startDate', 'start_date')),
        end_time: timestamp(text(record.values, 'endDate', 'end_date'), true),
        school: text(record.values, 'school') ?? '',
        degree: optionKey(settings, 'degree', degreeLabel(record)) ??
            degreeLabel(record),
        education_type: optionKey(settings, 'education_type', '统招全日制'),
        major: text(record.values, 'major') ?? '',
    }));
}
function experienceRows(input, kind) {
    return input.experience
        .filter((record) => {
        const title = text(record.values, 'title', 'role') ?? '';
        return kind === 'internship' ? /实习/.test(title) : !/实习/.test(title);
    })
        .map((record) => ({
        start_time: timestamp(text(record.values, 'startDate', 'start_date')),
        end_time: timestamp(text(record.values, 'endDate', 'end_date'), true),
        company: text(record.values, 'company') ?? '',
        title: text(record.values, 'title', 'role') ?? '',
        description: description(record),
    }));
}
function projectRows(input) {
    return input.projects.map((record) => {
        const role = text(record.values, 'role');
        return {
            start_time: timestamp(text(record.values, 'startDate', 'start_date')),
            end_time: record.values['current'] === true
                ? -1
                : timestamp(text(record.values, 'endDate', 'end_date'), true),
            name: text(record.values, 'name', 'label') ?? '',
            role: role === undefined || /solo builder/i.test(role)
                ? '独立开发者'
                : role,
            link: text(record.values, 'projectLink', 'link', 'url'),
            description: description(record),
        };
    });
}
function awardRows(input) {
    return input.awards.map((record) => ({
        award_time: timestamp(text(record.values, 'date') === undefined
            ? undefined
            : `${text(record.values, 'date')}-01`),
        title: text(record.values, 'label') ??
            [
                text(record.values, 'name'),
                text(record.values, 'level'),
            ]
                .filter((item) => item !== undefined)
                .join('｜'),
        desc: text(record.values, 'level') ?? '',
    }));
}
function resolvedResume(payload) {
    const value = payload.resolved['apiResume'];
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value
        : undefined;
}
async function readResume(page) {
    const response = await page.evaluate(async (path) => {
        const result = await fetch(path, { credentials: 'include' });
        const body = await result.json();
        return {
            status: result.status,
            code: body?.code,
            message: body?.message,
            resume: body?.data?.resume_detail,
        };
    }, READ_PATH);
    if (response.status < 200 ||
        response.status >= 300 ||
        response.code !== 0) {
        throw new Error(`xiaomi_resume_read_failed: ${response.status}:${response.code ?? 'unknown'}:${response.message ?? ''}`);
    }
    return response.resume === null || response.resume === undefined
        ? undefined
        : asRecord(response.resume);
}
async function readRuntimeData(page) {
    const [current, data] = await Promise.all([
        readResume(page),
        page.evaluate(async ({ locationPath, settingPath }) => {
            const [locations, settings] = await Promise.all([
                fetch(locationPath, { credentials: 'include' }).then((result) => result.json()),
                fetch(settingPath, { credentials: 'include' }).then((result) => result.json()),
            ]);
            return {
                locations: locations?.data ?? {},
                settings: settings?.data ?? {},
            };
        }, { locationPath: LOCATION_PATH, settingPath: SETTING_PATH }),
    ]);
    return {
        current,
        locations: asRecord(data.locations),
        settings: asRecord(data.settings),
    };
}
async function uploadResumeAttachment(page, localPath) {
    const input = page.locator('input[type=file]').first();
    if ((await input.count()) === 0) {
        throw new Error('xiaomi_resume_upload_not_found: 找不到附件简历上传控件');
    }
    const exchangeResponse = page.waitForResponse((response) => response.request().method() === 'POST' &&
        response.url().includes('/api/v1/attachment/exchange/tokens'), { timeout: 120_000 });
    await input.setInputFiles(localPath, { timeout: 30_000 });
    const response = await exchangeResponse;
    const body = await response.json();
    const id = body?.data?.portal_attachment_id;
    if (response.status() < 200 ||
        response.status() >= 300 ||
        body?.code !== 0 ||
        typeof id !== 'string' ||
        id === '') {
        throw new Error(`xiaomi_resume_upload_failed: ${response.status()}:${body?.code ?? 'unknown'}`);
    }
    const replaceOnly = page.getByText('仅替换简历', { exact: true }).last();
    await replaceOnly
        .waitFor({ state: 'visible', timeout: 8_000 })
        .catch(() => undefined);
    if ((await replaceOnly.count()) > 0 &&
        (await replaceOnly.isVisible().catch(() => false))) {
        await replaceOnly.click();
    }
    return id;
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
function expectedNames(resume, key) {
    const field = key === 'education_list' ? 'school' : key === 'project_list' ? 'name' : 'title';
    return asRows(resume[key])
        .map((row) => String(row[field] ?? ''))
        .filter((value) => value !== '');
}
async function validateServer(page, payload) {
    const expected = resolvedResume(payload);
    if (expected === undefined) {
        return {
            valid: false,
            checkedCount: 0,
            issues: [
                {
                    key: 'apiResume',
                    code: 'xiaomi_payload_missing',
                    message: '没有生成小米简历数据',
                    severity: 'blocking',
                },
            ],
        };
    }
    const current = (await readResume(page)) ?? {};
    const issues = payload.missing.map((item) => ({
        key: item.key,
        code: 'required_missing',
        message: item.reason,
        severity: 'blocking',
    }));
    for (const key of [
        'education_list',
        'project_list',
        'award_list',
    ]) {
        const actualField = key === 'education_list' ? 'school' : key === 'project_list' ? 'name' : 'title';
        const actual = new Set(asRows(current[key]).map((row) => String(row[actualField] ?? '')));
        for (const name of expectedNames(expected, key)) {
            if (!actual.has(name)) {
                issues.push({
                    key,
                    code: 'server_readback_mismatch',
                    message: `小米服务器缺少：${name}`,
                    severity: 'error',
                });
            }
        }
    }
    if (currentAttachmentId(current) === undefined) {
        issues.push({
            key: 'attachment.resume',
            code: payload.missing.length > 0
                ? 'attachment_pending_required_fields'
                : 'server_readback_mismatch',
            message: payload.missing.length > 0
                ? '小米草稿在必填项完成前不绑定附件简历'
                : '小米服务器缺少附件简历',
            severity: 'blocking',
        });
    }
    for (const [key, label] of [
        ['current_city_code', '现居城市'],
        ['hometown_city_code', '家乡'],
    ]) {
        const expectedValue = expected[key];
        if (typeof expectedValue === 'string' &&
            current[key] !== expectedValue) {
            issues.push({
                key,
                code: 'server_readback_mismatch',
                message: `小米服务器${label}读回不一致`,
                severity: 'error',
            });
        }
    }
    const checkedCount = expectedNames(expected, 'education_list').length +
        expectedNames(expected, 'project_list').length +
        expectedNames(expected, 'award_list').length +
        3;
    return { valid: issues.length === 0, checkedCount, issues };
}
export const xiaomiResumePage = {
    id: 'xiaomi.mioffice.campus-resume',
    version: 1,
    host: HOST,
    pageKind: 'resume_edit',
    status: 'verified',
    lastVerifiedAt: '2026-08-28T16:34:00.000+08:00',
    async match(page) {
        const url = new URL(page.url());
        const hostMatched = url.hostname === HOST;
        const pathMatched = url.pathname === PATH;
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
        const matched = hostMatched && pathMatched && missingAnchors.length === 0;
        return {
            matched,
            confidence: matched ? 1 : hostMatched && pathMatched ? 0.5 : 0,
            allowRun: matched,
            reasons: [
                hostMatched ? '小米招聘域名匹配' : '域名不匹配',
                pathMatched ? '小米简历编辑路由匹配' : '简历路由不匹配',
            ],
            matchedAnchors,
            missingAnchors,
            pageVersionChanged: hostMatched && pathMatched && missingAnchors.length > 0,
        };
    },
    async inspect(page) {
        const runtime = await readRuntimeData(page);
        return {
            url: page.url(),
            title: await page.title(),
            pageKind: 'resume_edit',
            anchors: ['基本信息', '教育经历', '项目经历', '获奖'],
            runtimeData: {
                current: (runtime.current ?? null),
                locations: runtime.locations,
                settings: runtime.settings,
            },
        };
    },
    prepare(input, facts) {
        const current = asRecord(facts.runtimeData?.['current']);
        const locations = asRecord(facts.runtimeData?.['locations']);
        const settings = asRecord(facts.runtimeData?.['settings']);
        const desiredCities = stringList(input.basic['application.preference.desired_city']);
        const currentCity = text(input.basic, 'person.location.current_city', 'person.contact.current_city') ?? desiredCities[0];
        const hometown = text(input.basic, 'person.location.hometown_city', 'person.identity.hometown_city');
        const identificationNumber = text(input.basic, 'person.identity.identification_number', 'person.identity.id_number');
        const missing = [];
        if (hometown === undefined) {
            missing.push({
                key: 'person.location.hometown_city',
                reason: '小米简历必填家乡，本地资料没有该信息',
            });
        }
        if (identificationNumber === undefined) {
            missing.push({
                key: 'person.identity.identification_number',
                reason: '小米简历必填身份证号，本地资料没有该信息',
            });
        }
        const currentCityCode = locationCode(locations, currentCity);
        if (currentCityCode === undefined) {
            missing.push({
                key: 'person.location.current_city',
                reason: `小米位置树找不到现居城市“${currentCity ?? ''}”`,
            });
        }
        const resume = {
            ...(typeof current['id'] === 'string' &&
                current['id'] !== '' &&
                current['id'] !== '0'
                ? { id: current['id'] }
                : {}),
            name: text(input.basic, 'person.identity.full_name') ?? '',
            country_code: 'CN_1',
            mobile_number: text(input.basic, 'person.contact.phone') ?? '',
            email: text(input.basic, 'person.contact.email') ?? '',
            gender: optionKey(settings, 'gender', text(input.basic, 'person.identity.gender')),
            age: ageFromBirthDate(text(input.basic, 'person.identity.birth_date')),
            current_city_code: currentCityCode,
            hometown_city_code: locationCode(locations, hometown),
            preferred_city_list: desiredCities
                .map((city) => locationCode(locations, city))
                .filter((value) => value !== undefined),
            identification: identificationNumber === undefined
                ? {}
                : { identification_type: 1, code: identificationNumber },
            portal_attachment_id: currentAttachmentId(current),
            education_list: educationRows(input, settings),
            career_list: experienceRows(input, 'career'),
            internship_list: experienceRows(input, 'internship'),
            project_list: projectRows(input),
            works_list: [],
            award_list: awardRows(input),
            competition_list: [],
            certificate_list: [],
            language_skill_list: [],
            sns_list: [],
            customized_data: current['customized_data'] ?? {},
            basic_info_customized_data: current['basic_info_customized_data'] ?? [],
        };
        return {
            resolved: {
                apiResume: resume,
                materials: (input.materials ?? {}),
            },
            missing,
            conflicts: [],
            skipped: [
                ...(input.skills === undefined || input.skills.length === 0
                    ? []
                    : [{ key: 'skills', reason: '小米官网没有独立技能栏目，保留在附件简历' }]),
                ...(input.languages === undefined || input.languages.length === 0
                    ? []
                    : [{ key: 'languages', reason: '本地没有语言熟练度答案，未生成空记录' }]),
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
                    code: 'xiaomi_payload_missing',
                    message: '没有生成小米简历数据',
                },
            ]);
        }
        const fields = [
            { key: 'basic', outcome: 'filled' },
            { key: 'education', outcome: 'filled' },
            { key: 'experience', outcome: 'filled' },
            { key: 'projects', outcome: 'filled' },
            { key: 'awards', outcome: 'filled' },
        ];
        if (typeof resume['portal_attachment_id'] !== 'string' ||
            resume['portal_attachment_id'] === '') {
            if (payload.missing.length > 0) {
                fields.push({
                    key: 'attachment.resume',
                    outcome: 'skipped',
                    code: 'attachment_pending_required_fields',
                    message: '小米草稿在必填项完成前不绑定附件，暂不重复上传',
                });
                await page.evaluate(({ key, value }) => {
                    window[key] = value;
                }, { key: STAGED_KEY, value: resume });
                return fillResult(fields);
            }
            const materials = asRecord(payload.resolved['materials']);
            const material = asRecord(materials['attachment.resume']);
            const localPath = typeof material['localPath'] === 'string'
                ? material['localPath']
                : undefined;
            if (localPath === undefined) {
                fields.push({
                    key: 'attachment.resume',
                    outcome: 'failed',
                    code: 'xiaomi_resume_upload_not_found',
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
                        code: 'xiaomi_resume_upload_failed',
                        message: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        }
        else {
            fields.push({ key: 'attachment.resume', outcome: 'unchanged' });
        }
        await page.evaluate(({ key, value }) => {
            window[key] = value;
        }, { key: STAGED_KEY, value: resume });
        return fillResult(fields);
    },
    async validate(page, payload) {
        const staged = await page.evaluate((key) => window[key] !== undefined, STAGED_KEY);
        if (!staged)
            return validateServer(page, payload);
        const resume = resolvedResume(payload) ?? {};
        const issues = payload.missing.map((item) => ({
            key: item.key,
            code: 'required_missing',
            message: item.reason,
            severity: 'blocking',
        }));
        if (payload.missing.length > 0 &&
            (typeof resume['portal_attachment_id'] !== 'string' ||
                resume['portal_attachment_id'] === '')) {
            issues.push({
                key: 'attachment.resume',
                code: 'attachment_pending_required_fields',
                message: '小米草稿在必填项完成前不绑定附件简历',
                severity: 'blocking',
            });
        }
        return {
            valid: issues.length === 0,
            checkedCount: expectedNames(resume, 'education_list').length +
                expectedNames(resume, 'project_list').length +
                expectedNames(resume, 'award_list').length +
                3,
            issues,
        };
    },
    async saveDraft(page, payload) {
        const resume = resolvedResume(payload);
        if (resume === undefined) {
            return {
                attempted: false,
                saved: false,
                message: '没有生成小米简历数据',
                evidence: [],
                pageChanged: false,
            };
        }
        const response = await page.evaluate(async ({ resume, savePartial }) => {
            let webpackRequire;
            const chunk = window.webpackChunkportal_;
            chunk.push([
                [Math.floor(Math.random() * 1_000_000_000)],
                {},
                (runtime) => {
                    webpackRequire = runtime;
                },
            ]);
            if (webpackRequire === undefined) {
                throw new Error('xiaomi_webpack_runtime_not_found');
            }
            const api = webpackRequire(690);
            const id = resume['id'];
            const primary = typeof id === 'string' && id !== ''
                ? await api.FD(id, resume)
                : await api.Ls({ resume });
            if (!savePartial || primary['code'] === 0)
                return primary;
            const draft = await api.XD(resume);
            return {
                ...draft,
                primaryCode: primary['code'],
                primaryMessage: primary['message'],
            };
        }, { resume, savePartial: payload.missing.length > 0 });
        await page.evaluate((key) => {
            delete window[key];
        }, STAGED_KEY);
        const code = response['code'];
        const saved = code === 0;
        return {
            attempted: true,
            saved,
            httpStatus: 200,
            siteCode: String(code ?? ''),
            message: typeof response['message'] === 'string'
                ? response['message']
                : payload.missing.length > 0
                    ? `草稿已保存，仍缺 ${payload.missing.length} 个必填项`
                    : '小米简历已保存',
            evidence: saved
                ? [
                    {
                        kind: 'network_response',
                        strength: 'strong',
                        description: payload.missing.length > 0
                            ? `小米正式保存返回业务码 ${String(response['primaryCode'] ?? 'unknown')}，随后草稿接口返回业务码 0`
                            : '小米简历接口返回业务码 0',
                    },
                ]
                : [],
            pageChanged: false,
        };
    },
};
//# sourceMappingURL=resume-page.js.map