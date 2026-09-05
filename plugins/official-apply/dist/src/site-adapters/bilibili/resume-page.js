const HOST = 'jobs.bilibili.com';
const PATH = '/campus/resume';
const SAVE_PATH = '/api/campus/resume/saveOrUpdate';
const UPLOAD_PATH = '/api/campus/resume/asyncUpload';
function text(values, ...keys) {
    for (const key of keys) {
        const value = values[key];
        if (typeof value === 'string' && value.trim() !== '') {
            return value.trim();
        }
        if (typeof value === 'number') {
            return String(value);
        }
    }
    return undefined;
}
function strings(value) {
    if (typeof value === 'string' && value.trim() !== '') {
        return [value.trim()];
    }
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((item) => {
        if (typeof item === 'string')
            return item.trim();
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
            return text(item, 'name', 'label', 'title') ?? '';
        }
        return '';
    })
        .filter((item) => item !== '');
}
function siteDate(value) {
    if (value === undefined)
        return undefined;
    if (/^\d{4}-\d{2}$/.test(value))
        return `${value}-01 00:00:00`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value))
        return `${value} 00:00:00`;
    return value;
}
function siteRangeEndDate(startValue, endValue) {
    if (startValue !== undefined &&
        endValue !== undefined &&
        startValue === endValue &&
        /^\d{4}-\d{2}$/.test(endValue)) {
        const [year, month] = endValue.split('-').map(Number);
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
        return `${endValue}-${String(lastDay).padStart(2, '0')} 23:59:59`;
    }
    return siteDate(endValue);
}
function degreeKey(value) {
    if (value === undefined)
        return undefined;
    if (/博士|phd|doctor/i.test(value))
        return '4';
    if (/硕士|master/i.test(value))
        return '3';
    if (/本科|bachelor/i.test(value))
        return '2';
    if (/大专|associate/i.test(value))
        return '1';
    if (/高中/.test(value))
        return '0';
    return undefined;
}
function clipped(parts, max = 1_000) {
    const joined = parts
        .filter((part) => part !== undefined && part.trim() !== '')
        .map((part) => part.trim())
        .join('\n');
    if (joined === '')
        return undefined;
    return joined.length <= max ? joined : joined.slice(0, max - 1).trimEnd() + '…';
}
function recordDescription(record, max = 1_000) {
    const values = record.values;
    const bullets = Array.isArray(values['bullets'])
        ? values['bullets'].filter((item) => typeof item === 'string')
        : [];
    return clipped([text(values, 'description'), ...bullets], max);
}
function fullName(input) {
    return text(input.basic, 'person.identity.full_name');
}
function latestEducation(input) {
    return [...input.education].sort((left, right) => (text(right.values, 'endDate', 'end_date') ?? '').localeCompare(text(left.values, 'endDate', 'end_date') ?? ''))[0];
}
function summaryText(input) {
    const explicit = text(input.basic, 'profile.summary', 'person.summary');
    if (explicit !== undefined)
        return clipped([explicit]);
    const experience = input.experience
        .map((record) => recordDescription(record, 500))
        .filter((value) => value !== undefined);
    const skills = input.skills?.flatMap((record) => strings(record.values['name'])) ?? [];
    return clipped([...experience, ...skills]);
}
function portfolioUrl(input) {
    return text(input.basic, 'profile.portfolio_url') ?? '';
}
function educationRows(input) {
    return input.education.map((record) => {
        const values = record.values;
        const startValue = text(values, 'startDate', 'start_date');
        const endValue = text(values, 'endDate', 'end_date');
        const startDate = siteDate(startValue) ?? '';
        const endDate = siteRangeEndDate(startValue, endValue) ?? '';
        return {
            schoolName: text(values, 'school', 'schoolName') ?? '',
            startDate,
            endDate,
            'startDate,endDate': [startDate, endDate],
            major: text(values, 'major') ?? '',
            degree: degreeKey(text(values, 'degree')) ?? '',
            fullTime: '1',
            labName: text(values, 'labName') ?? '',
            tutor: text(values, 'tutor') ?? '',
            researchArea: text(values, 'researchArea') ?? '',
        };
    });
}
function experienceRows(input) {
    return input.experience.map((record) => {
        const values = record.values;
        const current = values['current'] === true;
        const startValue = text(values, 'startDate', 'start_date');
        const endValue = text(values, 'endDate', 'end_date');
        const startDate = siteDate(startValue) ?? '';
        const endDate = current ? '' : siteRangeEndDate(startValue, endValue) ?? '';
        const toNow = current ? 1 : 0;
        return {
            companyName: text(values, 'company', 'companyName') ?? '',
            startDate,
            endDate,
            toNow,
            'startDate,endDate,toNow': [startDate, endDate, toNow],
            title: text(values, 'title', 'role') ?? '',
            description: recordDescription(record) ?? '',
        };
    });
}
function projectRows(input) {
    return input.projects.map((record) => {
        const values = record.values;
        const startValue = text(values, 'startDate', 'start_date');
        const endValue = text(values, 'endDate', 'end_date');
        const startDate = siteDate(startValue) ?? '';
        const current = values['current'] === true;
        const name = text(values, 'name', 'label') ?? '';
        const endDate = current ? '' : siteRangeEndDate(startValue, endValue) ?? '';
        const toNow = current ? 1 : 0;
        return {
            projectName: name,
            startDate,
            endDate,
            toNow,
            'startDate,endDate,toNow': [startDate, endDate, toNow],
            role: text(values, 'role') ?? '',
            description: recordDescription(record) ?? '',
            projectLink: text(values, 'projectLink', 'url') ?? '',
        };
    });
}
function languageRows(input) {
    const typeKeys = {
        英语: '0',
        法语: '1',
        德语: '2',
        日语: '3',
        普通话: '4',
        韩语: '5',
    };
    const abilityKeys = {
        入门: '0',
        日常会话: '1',
        商务会话: '2',
        无障碍沟通: '3',
        母语: '4',
    };
    return (input.languages ?? []).flatMap((record) => {
        const name = text(record.values, 'name', 'language', 'type');
        const ability = text(record.values, 'ability', 'level');
        if (name === undefined || ability === undefined)
            return [];
        return [
            {
                languageTypeKey: typeKeys[name] ?? '99',
                languageAbilityKey: abilityKeys[ability] ?? '0',
                otherLanguage: typeKeys[name] === undefined ? name : '',
            },
        ];
    });
}
function buildSiteResume(input) {
    const latest = latestEducation(input);
    const desiredCities = strings(input.basic['application.preference.desired_city']);
    const birthday = siteDate(text(input.basic, 'person.identity.birth_date'));
    const gender = text(input.basic, 'person.identity.gender');
    return {
        annex: [],
        batchIdList: [],
        bases: {
            name: fullName(input),
            gender: gender === '男' ? '0' : gender === '女' ? '1' : undefined,
            ...(birthday === undefined ? {} : { birthday }),
            currentLocation: text(input.basic, 'person.location.current_city') ?? desiredCities[0],
            nativePlace: text(input.basic, 'person.location.native_place'),
            phone: text(input.basic, 'person.contact.phone') === undefined
                ? undefined
                : `86#$${text(input.basic, 'person.contact.phone')}`,
            email: text(input.basic, 'person.contact.email'),
            graduateYear: siteDate(text(latest?.values ?? {}, 'endDate', 'end_date')),
            projectUrl: portfolioUrl(input),
            github: text(input.basic, 'profile.github') ?? '',
            avatar: '',
        },
        summary: { summary: summaryText(input) },
        edus: educationRows(input),
        workInfos: experienceRows(input),
        projectInfos: projectRows(input),
        languageAbility: languageRows(input),
        gameRank: [],
    };
}
function resolvedResume(payload) {
    const value = payload.resolved['siteResume'];
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value
        : undefined;
}
function materialPath(payload) {
    const materials = payload.resolved['materials'];
    if (materials === null || typeof materials !== 'object' || Array.isArray(materials)) {
        return undefined;
    }
    const resume = materials['attachment.resume'];
    if (resume === null || typeof resume !== 'object' || Array.isArray(resume)) {
        return undefined;
    }
    return typeof resume['localPath'] === 'string' ? resume['localPath'] : undefined;
}
async function resumeViewData(page) {
    const value = await page.evaluate(() => {
        let component = document.querySelector('.bili-resume-edit, .bili-resume-container')?.__vue__;
        for (let depth = 0; component !== undefined && depth < 12; depth += 1) {
            if (component.data !== null &&
                typeof component.data === 'object' &&
                !Array.isArray(component.data)) {
                return component.data;
            }
            component = component.$parent;
        }
        return undefined;
    });
    return value === undefined ? undefined : value;
}
async function applyResumeToView(page, resume) {
    const serialized = JSON.stringify(resume);
    await page.evaluate(async (json) => {
        const next = JSON.parse(json);
        let component = document.querySelector('.bili-resume-edit')?.__vue__;
        for (let depth = 0; component !== undefined && depth < 12; depth += 1) {
            if (typeof component.$nextTick === 'function' && component.data !== undefined) {
                const uploaded = component.data['resume'];
                component.data = {
                    ...next,
                    ...(uploaded === undefined ? {} : { resume: uploaded }),
                };
                await component.$nextTick();
                return;
            }
            component = component.$parent;
        }
        throw new Error('bilibili_resume_component_not_found');
    }, serialized);
}
async function uploadResume(page, localPath) {
    if (localPath === undefined) {
        return { key: 'attachment.resume', outcome: 'skipped', code: 'no_resolved_value' };
    }
    const input = page.locator('.bili-resume-analysis input[type=file]').first();
    if ((await input.count()) === 0) {
        return {
            key: 'attachment.resume',
            outcome: 'failed',
            code: 'bilibili_resume_upload_not_found',
            message: '找不到 B 站简历解析上传控件',
        };
    }
    const pending = page.waitForResponse((response) => response.url().includes(UPLOAD_PATH) && response.request().method() === 'POST', { timeout: 90_000 });
    await input.setInputFiles(localPath, { timeout: 30_000 });
    const response = await pending.catch(() => undefined);
    if (response === undefined || !response.ok()) {
        return {
            key: 'attachment.resume',
            outcome: 'failed',
            code: 'bilibili_resume_upload_failed',
            message: 'B 站简历附件上传失败',
        };
    }
    const body = (await response.json().catch(() => undefined));
    const replaceOnly = page
        .locator('button:visible')
        .filter({ hasText: /否，仅替换附件/ })
        .first();
    const uploadChoiceShown = await replaceOnly
        .waitFor({ state: 'visible', timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
    if (uploadChoiceShown) {
        await replaceOnly.click();
    }
    return body?.code === 0
        ? { key: 'attachment.resume', outcome: 'filled' }
        : {
            key: 'attachment.resume',
            outcome: 'failed',
            code: 'bilibili_resume_upload_rejected',
            message: body?.message ?? 'B 站拒绝简历附件',
        };
}
function expectedCounts(resume) {
    return [
        ['education', resume.edus.length],
        ['experience', resume.workInfos.length],
        ['projects', resume.projectInfos.length],
        ['languages', resume.languageAbility.length],
    ];
}
function validationIssues(actual, expected) {
    if (actual === undefined) {
        return [
            {
                code: 'bilibili_resume_readback_missing',
                message: '无法从 B 站页面读回简历数据',
                severity: 'blocking',
            },
        ];
    }
    const issues = [];
    const required = [
        ['person.identity.full_name', actual.bases?.name],
        ['person.identity.gender', actual.bases?.gender],
        ['person.identity.birth_date', actual.bases?.birthday],
        ['person.contact.phone', actual.bases?.phone],
        ['person.contact.email', actual.bases?.email],
    ];
    for (const [key, value] of required) {
        if (value === undefined || value === '') {
            issues.push({
                key,
                code: 'required_missing',
                message: `${key} 是 B 站必填项，但仍为空`,
                severity: 'blocking',
            });
        }
    }
    for (const [key, count] of expectedCounts(expected)) {
        const actualCount = key === 'education'
            ? actual.edus?.length
            : key === 'experience'
                ? actual.workInfos?.length
                : key === 'projects'
                    ? actual.projectInfos?.length
                    : actual.languageAbility?.length;
        if ((actualCount ?? 0) !== count) {
            issues.push({
                key,
                code: 'record_count_mismatch',
                message: `${key} 预期 ${count} 条，读回 ${actualCount ?? 0} 条`,
                severity: 'blocking',
            });
        }
    }
    if (actual.bases?.name !== expected.bases.name) {
        issues.push({
            key: 'person.identity.full_name',
            code: 'value_mismatch',
            message: '姓名读回值不一致',
            severity: 'blocking',
        });
    }
    const actualPortfolio = actual.bases?.projectUrl?.trim() ?? '';
    if (actualPortfolio !== (expected.bases.projectUrl ?? '')) {
        issues.push({
            key: 'profile.portfolio_url',
            code: 'value_mismatch',
            message: '作品链接读回值不一致',
            severity: 'blocking',
        });
    }
    if (actualPortfolio !== '' &&
        actualPortfolio.split(/\r?\n/).some((line) => !/^https?:\/\//i.test(line.trim()))) {
        issues.push({
            key: 'profile.portfolio_url',
            code: 'portfolio_non_url_content',
            message: '作品链接栏目出现了非 URL 内容',
            severity: 'blocking',
        });
    }
    const recordChecks = [
        {
            key: 'education',
            rows: actual.edus ?? [],
            required: ['schoolName', 'startDate', 'endDate', 'major', 'degree', 'fullTime'],
        },
        {
            key: 'experience',
            rows: actual.workInfos ?? [],
            required: ['companyName', 'startDate', 'title', 'description'],
            currentAllowed: true,
        },
        {
            key: 'projects',
            rows: actual.projectInfos ?? [],
            required: ['projectName', 'startDate', 'role', 'description'],
            currentAllowed: true,
        },
    ];
    for (const check of recordChecks) {
        check.rows.forEach((row, index) => {
            for (const field of check.required) {
                if (row[field] === undefined || row[field] === '') {
                    issues.push({
                        key: `${check.key}[${index}].${field}`,
                        code: 'required_missing',
                        message: `${check.key}[${index}].${field} 仍为空`,
                        severity: 'blocking',
                    });
                }
            }
            if (check.currentAllowed === true &&
                row['endDate'] === '' &&
                row['toNow'] !== 1 &&
                row['toNow'] !== true) {
                issues.push({
                    key: `${check.key}[${index}].endDate`,
                    code: 'required_missing',
                    message: `${check.key}[${index}] 缺少结束日期，也没有选择“至今”`,
                    severity: 'blocking',
                });
            }
        });
    }
    for (const expectedProject of expected.projectInfos) {
        const name = String(expectedProject['projectName'] ?? '');
        const actualProject = actual.projectInfos?.find((project) => String(project['projectName'] ?? '') === name);
        if (actualProject === undefined) {
            issues.push({
                key: `projects.${name}`,
                code: 'project_missing',
                message: `项目经历缺少“${name}”`,
                severity: 'blocking',
            });
            continue;
        }
        for (const key of ['role', 'startDate', 'endDate', 'projectLink']) {
            if (String(actualProject[key] ?? '') !== String(expectedProject[key] ?? '')) {
                issues.push({
                    key: `projects.${name}.${key}`,
                    code: 'value_mismatch',
                    message: `项目“${name}”的 ${key} 读回值不一致`,
                    severity: 'blocking',
                });
            }
        }
    }
    return issues;
}
function waitForSave(page) {
    return page
        .waitForResponse((response) => response.url().includes(SAVE_PATH) && response.request().method() === 'POST', { timeout: 30_000 })
        .catch(() => undefined);
}
function saveRequest(page) {
    return page
        .waitForRequest((request) => request.url().includes(SAVE_PATH) && request.method() === 'POST', { timeout: 30_000 })
        .catch(() => undefined);
}
export const bilibiliResumePage = {
    id: 'bilibili.jobs.campus-resume',
    version: 2,
    host: HOST,
    pageKind: 'resume_edit',
    status: 'verified',
    lastVerifiedAt: '2026-08-25T16:05:49.608Z',
    async match(page) {
        const url = new URL(page.url());
        const hostMatched = url.hostname === HOST;
        const pathMatched = url.pathname === PATH;
        if (hostMatched && pathMatched) {
            await page
                .getByText('编辑简历', { exact: true })
                .waitFor({ state: 'visible', timeout: 15_000 })
                .catch(() => undefined);
        }
        const anchors = ['编辑简历', '简历解析', '基本信息', '教育经历', '项目经历'];
        const checks = await Promise.all(anchors.map(async (anchor) => ({
            anchor,
            found: (await page.getByText(anchor, { exact: true }).count()) > 0,
        })));
        const matchedAnchors = checks.filter((item) => item.found).map((item) => item.anchor);
        const missingAnchors = checks.filter((item) => !item.found).map((item) => item.anchor);
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
        const current = await resumeViewData(page);
        return {
            url: page.url(),
            title: await page.title(),
            pageKind: 'resume_edit',
            anchors: ['编辑简历', '简历解析', '基本信息', '教育经历', '项目经历'],
            runtimeData: {
                hasResumeId: current !== undefined &&
                    typeof current['resumeId'] === 'string',
                educationCount: current?.edus?.length ?? 0,
                experienceCount: current?.workInfos?.length ?? 0,
                projectCount: current?.projectInfos?.length ?? 0,
            },
        };
    },
    prepare(input) {
        const siteResume = buildSiteResume(input);
        const missing = [];
        if (siteResume.bases.name === undefined) {
            missing.push({ key: 'person.identity.full_name', reason: 'B 站必填，但资料中没有姓名' });
        }
        if (siteResume.bases.gender === undefined) {
            missing.push({ key: 'person.identity.gender', reason: 'B 站必填，但资料中没有性别' });
        }
        if (siteResume.bases.birthday === undefined) {
            missing.push({
                key: 'person.identity.birth_date',
                reason: 'B 站把出生日期设为必填，现有简历和私有资料都没有',
            });
        }
        if (siteResume.bases.phone === undefined) {
            missing.push({ key: 'person.contact.phone', reason: 'B 站必填，但资料中没有手机号' });
        }
        if (siteResume.bases.email === undefined) {
            missing.push({ key: 'person.contact.email', reason: 'B 站必填，但资料中没有邮箱' });
        }
        if (siteResume.edus.length === 0) {
            missing.push({ key: 'education', reason: 'B 站要求至少一段教育经历' });
        }
        input.projects.forEach((record, index) => {
            const values = record.values;
            const name = text(values, 'name', 'label') ?? `项目 ${index + 1}`;
            if (text(values, 'startDate', 'start_date') === undefined) {
                missing.push({
                    key: `projects[${index}].startDate`,
                    reason: `项目“${name}”缺少开始日期，不能换到其他栏目`,
                });
            }
            if (values['current'] !== true &&
                text(values, 'endDate', 'end_date') === undefined) {
                missing.push({
                    key: `projects[${index}].endDate`,
                    reason: `项目“${name}”缺少结束日期，不能换到其他栏目`,
                });
            }
            if (text(values, 'role') === undefined) {
                missing.push({
                    key: `projects[${index}].role`,
                    reason: `项目“${name}”缺少项目角色`,
                });
            }
        });
        return {
            resolved: {
                siteResume: siteResume,
                materials: input.materials ?? {},
            },
            missing,
            conflicts: [],
            skipped: input.awards.length === 0
                ? []
                : [
                    {
                        key: 'awards',
                        reason: 'B 站没有奖项栏目；奖项保留在附件简历，不跨栏目填写',
                    },
                ],
        };
    },
    async fill(page, payload) {
        const siteResume = resolvedResume(payload);
        if (siteResume === undefined) {
            throw new Error('bilibili_resume_payload_missing: 没有准备好的 B 站简历数据');
        }
        const fields = [];
        fields.push(await uploadResume(page, materialPath(payload)));
        await applyResumeToView(page, siteResume);
        fields.push({ key: 'basic', outcome: 'filled' }, { key: 'summary', outcome: 'filled' }, { key: 'education', outcome: 'filled' }, { key: 'experience', outcome: 'filled' }, { key: 'projects', outcome: 'filled' }, { key: 'languages', outcome: siteResume.languageAbility.length > 0 ? 'filled' : 'skipped' }, {
            key: 'portfolio_url',
            outcome: 'filled',
        }, {
            key: 'awards',
            outcome: 'skipped',
            code: 'site_section_unavailable',
            message: 'B 站没有奖项栏目；奖项只保留在附件简历',
        });
        const failed = fields.filter((field) => field.outcome === 'failed');
        return {
            attemptedCount: fields.filter((field) => field.outcome !== 'skipped').length,
            filledCount: fields.filter((field) => field.outcome === 'filled').length,
            unchangedCount: 0,
            skippedCount: fields.filter((field) => field.outcome === 'skipped').length,
            failed,
            fields,
            requiresRescan: true,
        };
    },
    async validate(page, payload) {
        const expected = resolvedResume(payload);
        if (expected === undefined) {
            return {
                valid: false,
                checkedCount: 0,
                issues: [
                    {
                        code: 'bilibili_resume_payload_missing',
                        message: '没有准备好的 B 站简历数据',
                        severity: 'blocking',
                    },
                ],
            };
        }
        const actual = await resumeViewData(page);
        const issues = validationIssues(actual, expected);
        issues.push(...payload.missing.map((item) => ({
            key: item.key,
            code: 'prepared_value_missing',
            message: item.reason,
            severity: 'blocking',
        })));
        return {
            valid: issues.length === 0,
            checkedCount: 6 + expectedCounts(expected).length + expected.projectInfos.length,
            issues,
        };
    },
    async saveDraft(page, payload) {
        const expected = resolvedResume(payload);
        if (expected === undefined) {
            return {
                attempted: false,
                saved: false,
                message: '没有准备好的 B 站简历数据',
                evidence: [],
                pageChanged: false,
            };
        }
        if (payload.missing.length > 0) {
            return {
                attempted: false,
                saved: false,
                message: `还有 ${payload.missing.length} 个必填资料缺失，未点击保存`,
                evidence: [],
                pageChanged: false,
            };
        }
        if (expected.bases.birthday === undefined) {
            return {
                attempted: false,
                saved: false,
                message: 'B 站出生日期必填；现有资料没有，未点击保存',
                evidence: [],
                pageChanged: false,
            };
        }
        const save = page.getByRole('button', { name: '保存', exact: true });
        if ((await save.count()) === 0) {
            return {
                attempted: false,
                saved: false,
                message: '找不到 B 站保存按钮',
                evidence: [],
                pageChanged: false,
            };
        }
        const beforeUrl = page.url();
        const pendingResponse = waitForSave(page);
        const pendingRequest = saveRequest(page);
        await save.click();
        const emailModal = page.getByText('验证邮箱', { exact: true });
        if (await emailModal
            .waitFor({ state: 'visible', timeout: 5_000 })
            .then(() => true)
            .catch(() => false)) {
            return {
                attempted: true,
                saved: false,
                message: 'B 站要求先完成邮箱验证码，页面已保留',
                evidence: [
                    {
                        kind: 'dom_marker',
                        strength: 'strong',
                        description: '页面出现“验证邮箱”弹窗',
                    },
                ],
                pageChanged: false,
            };
        }
        const [request, response] = await Promise.all([pendingRequest, pendingResponse]);
        const evidence = [];
        let body;
        if (response !== undefined) {
            body = (await response.json().catch(() => undefined));
            if (response.ok() && body?.code === 0) {
                evidence.push({
                    kind: 'network_response',
                    strength: 'strong',
                    description: `saveOrUpdate 返回 HTTP ${response.status()} / code 0`,
                });
            }
        }
        await page.waitForTimeout(1_500);
        if (page.url() !== beforeUrl) {
            evidence.push({
                kind: 'dom_marker',
                strength: 'weak',
                description: `保存后页面跳转到 ${new URL(page.url()).pathname}`,
            });
        }
        return {
            attempted: request !== undefined,
            saved: evidence.some((item) => item.kind === 'network_response' && item.strength === 'strong'),
            ...(response === undefined ? {} : { httpStatus: response.status() }),
            ...(body?.code === undefined ? {} : { siteCode: String(body.code) }),
            message: body?.message ?? (response === undefined ? '没有观察到保存接口响应' : undefined),
            evidence,
            pageChanged: page.url() !== beforeUrl,
        };
    },
};
//# sourceMappingURL=resume-page.js.map