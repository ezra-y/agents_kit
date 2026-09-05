import { fullRecordDescription } from "../../materials/record-description.js";
const HOST = 'zhaopin.kuaishou.cn';
const RESUME_HASH = '#/official/resume-preview/';
const READ_PATH = '/recruit/e/api/v1/user/resume/info';
const SAVE_PATH = '/recruit/e/api/v1/user/resume/save';
const STAGED_KEY = '__officialApplyKuaishouResume';
function text(record, ...keys) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim() !== '')
            return value.trim();
    }
    return undefined;
}
function records(input, key) {
    const value = input.resolved[key];
    return Array.isArray(value)
        ? value.filter((item) => item !== null && typeof item === 'object' && !Array.isArray(item))
        : [];
}
function valuesOf(rows) {
    return rows.map((row) => row.values);
}
function apiDate(value) {
    if (value === undefined || value === '')
        return '';
    if (/^\d{4}$/.test(value))
        return `${value}-01-01`;
    if (/^\d{4}-\d{2}$/.test(value))
        return `${value}-01`;
    return value.slice(0, 10);
}
function currentDate(record) {
    const end = text(record, 'endDate', 'end_date');
    if (end !== undefined)
        return apiDate(end);
    return record['current'] === true ? new Date().toISOString().slice(0, 10) : '';
}
function lines(record) {
    const bullets = record['bullets'];
    if (Array.isArray(bullets)) {
        const joined = bullets
            .filter((item) => typeof item === 'string' && item.trim() !== '')
            .join('\n');
        if (joined !== '')
            return joined;
    }
    return text(record, 'description') ?? '';
}
async function readResume(page) {
    return page.evaluate(async (path) => {
        const response = await fetch(path, { credentials: 'include' });
        const body = await response.json();
        if (!response.ok || body?.code !== 0 || body?.result === undefined) {
            throw new Error(`kuaishou_resume_read_failed:${response.status}:${body?.code ?? 'unknown'}`);
        }
        return body.result;
    }, READ_PATH);
}
function serverRecord(facts) {
    const value = facts?.['serverResume'];
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}
function asRows(value) {
    return Array.isArray(value)
        ? value.filter((item) => item !== null && typeof item === 'object' && !Array.isArray(item))
        : [];
}
function buildEducation(input, current) {
    const existing = asRows(current['canEducationExperiences']);
    return input.education.map((row, index) => {
        const values = row.values;
        const prior = existing[index] ?? {};
        return {
            ...prior,
            startDate: apiDate(text(values, 'startDate', 'start_date')),
            endDate: currentDate(values),
            toPresent: values['current'] === true,
            profession: text(values, 'major') ?? String(prior['profession'] ?? ''),
            professionNameByWrite: text(values, 'major') ?? String(prior['professionNameByWrite'] ?? ''),
        };
    });
}
function buildExperience(input) {
    return input.experience.map((row) => ({
        startDate: apiDate(text(row.values, 'startDate', 'start_date')),
        endDate: currentDate(row.values),
        toPresent: row.values['current'] === true,
        workTimeBucket: '',
        companyName: text(row.values, 'company') ?? '',
        positionName: text(row.values, 'title') ?? '',
        responsibilityDescription: fullRecordDescription(row.values),
        desc: lines(row.values),
    }));
}
function buildProjects(input) {
    return input.projects.map((row) => ({
        startDate: apiDate(text(row.values, 'startDate', 'start_date')),
        endDate: currentDate(row.values),
        toPresent: row.values['current'] === true,
        projectName: text(row.values, 'name') ?? '',
        projectDuty: text(row.values, 'role') ?? '',
        projectDescription: text(row.values, 'description') ?? '',
        projectResponsibility: lines(row.values),
    }));
}
function buildAwards(input, current) {
    const existing = asRows(current['canAwards']);
    return input.awards.map((row) => {
        const name = text(row.values, 'name') ?? '';
        const level = text(row.values, 'level');
        const prior = existing.find((item) => String(item['awardsName'] ?? '').includes(name));
        return {
            id: null,
            resumeId: null,
            resumeCode: null,
            awardsDate: apiDate(text(row.values, 'date')) ||
                String(prior?.['awardsDate'] ?? ''),
            awardsName: level === undefined ? name : `${name}｜${level}`,
            awardsType: null,
        };
    });
}
function buildPayload(input, current) {
    const currentBase = current['candidateBase'] !== null && typeof current['candidateBase'] === 'object'
        ? current['candidateBase']
        : {};
    const currentBackground = current['candidateBackground'] !== null &&
        typeof current['candidateBackground'] === 'object'
        ? current['candidateBackground']
        : {};
    const basic = input.basic;
    const latestExperience = input.experience[0]?.values;
    const skills = input.skills?.map((item) => text(item.values, 'name')).filter(Boolean) ?? [];
    return {
        candidateBackground: {
            ...currentBackground,
            latelyWorkCompany: (latestExperience && text(latestExperience, 'company')) ??
                currentBackground['latelyWorkCompany'] ??
                '',
            latelyWorkDepartment: (latestExperience && text(latestExperience, 'department')) ??
                currentBackground['latelyWorkDepartment'] ??
                '',
            latelyPosition: (latestExperience && text(latestExperience, 'title')) ??
                currentBackground['latelyPosition'] ??
                '',
        },
        canAttachments: current['canAttachments'] ?? [],
        canAwards: buildAwards(input, current),
        canEducationExperiences: buildEducation(input, current),
        canProjectExperiences: buildProjects(input),
        canWorkExperiences: buildExperience(input),
        candidateBase: {
            ...currentBase,
            name: typeof basic['person.identity.full_name'] === 'string'
                ? basic['person.identity.full_name']
                : currentBase['name'],
            phone: typeof basic['person.contact.phone'] === 'string'
                ? basic['person.contact.phone']
                : currentBase['phone'],
            email: typeof basic['person.contact.email'] === 'string'
                ? basic['person.contact.email']
                : currentBase['email'],
            birthdate: typeof basic['person.identity.birth_date'] === 'string'
                ? apiDate(basic['person.identity.birth_date'])
                : currentBase['birthdate'],
            presentAddress: typeof basic['person.location.current_city'] === 'string'
                ? basic['person.location.current_city']
                : currentBase['presentAddress'],
            skillOrCertificate: skills.length > 0
                ? skills.join('\n')
                : currentBase['skillOrCertificate'],
        },
    };
}
function expectedNames(payload, key, nameKey) {
    return records(payload, key)
        .map((record) => text(record, nameKey) ?? '')
        .filter((item) => item !== '');
}
function compareNames(actual, expected, key, issues) {
    if (actual.length !== expected.length ||
        expected.some((name) => !actual.includes(name))) {
        issues.push({
            key,
            code: 'server_readback_mismatch',
            message: `${key} 服务器读回不一致`,
            severity: 'error',
        });
    }
}
export const kuaishouResumePage = {
    id: 'kuaishou.recruit.official-resume',
    version: 1,
    host: HOST,
    pageKind: 'resume_edit',
    status: 'verified',
    lastVerifiedAt: '2026-08-25T18:23:36.000Z',
    async match(page) {
        const url = new URL(page.url());
        const hostMatched = url.hostname === HOST;
        const pathMatched = url.hash.startsWith(RESUME_HASH);
        const anchors = ['我的简历', '工作经历', '项目经历', '教育经历'];
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
                pathMatched ? '简历路由匹配' : '简历路由不匹配',
            ],
            matchedAnchors,
            missingAnchors,
            pageVersionChanged: hostMatched && pathMatched && missingAnchors.length > 0,
        };
    },
    async inspect(page) {
        const serverResume = await readResume(page);
        return {
            url: page.url(),
            title: await page.title(),
            pageKind: 'resume_edit',
            anchors: ['我的简历', '工作经历', '项目经历', '教育经历', '获奖经历'],
            runtimeData: {
                serverResume: serverResume,
                educationCount: asRows(serverResume['canEducationExperiences']).length,
                experienceCount: asRows(serverResume['canWorkExperiences']).length,
                projectCount: asRows(serverResume['canProjectExperiences']).length,
                awardCount: asRows(serverResume['canAwards']).length,
            },
        };
    },
    prepare(input, facts) {
        const missing = [];
        for (const key of [
            'person.identity.full_name',
            'person.contact.phone',
            'person.contact.email',
        ]) {
            if (input.basic[key] === undefined || input.basic[key] === '') {
                missing.push({ key, reason: '快手简历基础信息缺少已确定答案' });
            }
        }
        if (input.education.length === 0) {
            missing.push({ key: 'education', reason: '快手简历需要教育经历' });
        }
        return {
            resolved: {
                basic: input.basic,
                education: valuesOf(input.education),
                experience: valuesOf(input.experience),
                projects: valuesOf(input.projects),
                awards: valuesOf(input.awards),
                apiPayload: buildPayload(input, serverRecord(facts.runtimeData)),
            },
            missing,
            conflicts: [],
            skipped: [],
        };
    },
    async fill(page, payload) {
        await page.evaluate((key) => {
            window[key] = true;
        }, STAGED_KEY);
        const fields = [
            { key: 'basic', outcome: 'filled' },
            { key: 'education', outcome: 'filled' },
            { key: 'experience', outcome: 'filled' },
            { key: 'projects', outcome: 'filled' },
            { key: 'awards', outcome: 'filled' },
        ];
        return {
            attemptedCount: fields.length,
            filledCount: fields.length,
            unchangedCount: 0,
            skippedCount: 0,
            failed: [],
            fields,
            requiresRescan: false,
        };
    },
    async validate(page, payload) {
        const staged = await page.evaluate((key) => window[key] !== undefined, STAGED_KEY);
        const issues = [];
        if (payload.missing.length > 0) {
            issues.push(...payload.missing.map((item) => ({
                key: item.key,
                code: 'required_missing',
                message: item.reason,
                severity: 'blocking',
            })));
        }
        if (!staged) {
            const server = await readResume(page);
            const base = server['candidateBase'];
            const basic = payload.resolved['basic'];
            for (const [serverKey, canonicalKey] of [
                ['name', 'person.identity.full_name'],
                ['phone', 'person.contact.phone'],
                ['email', 'person.contact.email'],
            ]) {
                if (typeof basic[canonicalKey] === 'string' &&
                    String(base?.[serverKey] ?? '') !== basic[canonicalKey]) {
                    issues.push({
                        key: canonicalKey,
                        code: 'server_readback_mismatch',
                        message: `${canonicalKey} 服务器读回不一致`,
                        severity: 'error',
                    });
                }
            }
            compareNames(asRows(server['canEducationExperiences']).map((item) => String(item['schoolNameByWrite'] ?? item['schoolCode'] ?? '')), asRows(payload.resolved['apiPayload']['canEducationExperiences'])
                .map((item) => String(item['schoolNameByWrite'] ?? item['schoolCode'] ?? '')), 'education', issues);
            compareNames(asRows(server['canWorkExperiences']).map((item) => String(item['companyName'] ?? '')), expectedNames(payload, 'experience', 'company'), 'experience', issues);
            compareNames(asRows(server['canProjectExperiences']).map((item) => String(item['projectName'] ?? '')), expectedNames(payload, 'projects', 'name'), 'projects', issues);
            const expectedAwardNames = asRows(payload.resolved['apiPayload']['canAwards']).map((item) => String(item['awardsName'] ?? ''));
            compareNames(asRows(server['canAwards']).map((item) => String(item['awardsName'] ?? '')), expectedAwardNames, 'awards', issues);
        }
        return {
            valid: issues.length === 0,
            checkedCount: 3 + records(payload, 'education').length +
                records(payload, 'experience').length +
                records(payload, 'projects').length +
                records(payload, 'awards').length,
            issues,
        };
    },
    async saveDraft(page, payload) {
        const apiPayload = payload.resolved['apiPayload'];
        const bodyJson = JSON.stringify(apiPayload);
        const result = await page.evaluate(async ({ path, bodyJson }) => {
            const response = await fetch(path, {
                method: 'POST',
                credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: bodyJson,
            });
            const data = await response.json();
            return {
                httpStatus: response.status,
                code: data?.code,
                message: data?.message,
            };
        }, { path: SAVE_PATH, bodyJson });
        const saved = result.httpStatus >= 200 && result.httpStatus < 300 && result.code === 0;
        return {
            attempted: true,
            saved,
            httpStatus: result.httpStatus,
            siteCode: String(result.code ?? 'unknown'),
            message: saved ? '快手保存接口返回成功' : result.message,
            evidence: saved
                ? [{
                        kind: 'network_response',
                        strength: 'strong',
                        description: `快手保存接口返回 HTTP ${result.httpStatus}，站点码 0`,
                    }]
                : [],
            pageChanged: false,
        };
    },
};
//# sourceMappingURL=resume-page.js.map