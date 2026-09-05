const HOST = 'jobs.mihoyo.com';
const READ_URL = 'https://ats.openout.mihoyo.com/ats-portal/v2/resume/info';
const SAVE_URL = 'https://ats.openout.mihoyo.com/ats-portal/v1/resume/add/or/update';
const STAGED_KEY = '__officialApplyMihoyoResume';
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
function stringRows(value) {
    return Array.isArray(value)
        ? value.filter((item) => typeof item === 'string')
        : [];
}
function siteMonth(value, end = false) {
    if (value === undefined || !/^\d{4}-\d{2}/.test(value))
        return null;
    return `${value.slice(0, 7)}-01 ${end ? '23:59:59' : '00:00:00'}`;
}
function projectRow(record) {
    const values = record.values;
    const role = text(values, 'role');
    const description = text(values, 'description') ?? '';
    const bullets = stringRows(values['bullets'])
        .map((item) => item.trim())
        .filter((item) => item !== '');
    const current = values['current'] === true;
    return {
        projectName: text(values, 'name', 'label') ?? '',
        projectDuty: role !== undefined && /solo builder/i.test(role)
            ? '独立开发者'
            : role ?? '',
        description,
        responsibility: bullets.length === 0 ? description : bullets.join('\n'),
        startDate: siteMonth(text(values, 'startDate', 'start_date')),
        endDate: current
            ? null
            : siteMonth(text(values, 'endDate', 'end_date'), true),
        now: current ? 1 : null,
    };
}
function awardRow(record) {
    const values = record.values;
    const name = text(values, 'name', 'label') ?? '';
    const level = text(values, 'level');
    const year = text(values, 'date');
    return {
        getDate: year !== undefined && /^\d{4}$/.test(year)
            ? `${year}-01-01 00:00:00`
            : null,
        name: level === undefined ? name : `${name}｜${level}`,
    };
}
function hasAwardYear(record) {
    const year = text(record.values, 'date');
    return year !== undefined && /^\d{4}$/.test(year);
}
async function readResume(page) {
    const response = await page.evaluate(async ({ url }) => {
        const token = window.localStorage.getItem('Jobs-Token') ?? '';
        const result = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'content-type': 'application/json',
                ...(token === '' ? {} : { authorization: token }),
            },
            body: JSON.stringify({ channelDetailIds: [1], hireType: 1 }),
        });
        const body = await result.json();
        return {
            status: result.status,
            code: body?.code,
            success: body?.success,
            message: body?.message,
            data: body?.data,
        };
    }, { url: READ_URL });
    if (response.status < 200 ||
        response.status >= 300 ||
        response.code !== 0 ||
        response.success !== true) {
        throw new Error(`mihoyo_resume_read_failed: ${response.status}:${response.code ?? 'unknown'}:${response.message ?? ''}`);
    }
    return asRecord(response.data);
}
function buildSavePayload(current, input) {
    return {
        resumeAppendix: current['resumeAppendix'] ?? null,
        workAppendixList: current['workAppendixList'] ?? [],
        portfolioList: current['portfolioList'] ?? [],
        resumeInfo: current['resumeInfo'] ?? {},
        educations: current['educations'] ?? [],
        practices: current['practices'] ?? [],
        works: current['works'] ?? [],
        projects: input.projects.map(projectRow),
        awards: input.awards.filter(hasAwardYear).map(awardRow),
        languages: current['languages'] ?? [],
        hireType: 1,
    };
}
function resolvedPayload(payload) {
    const value = payload.resolved['apiPayload'];
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value
        : undefined;
}
function expectedNames(payload, key) {
    const rows = asRows(resolvedPayload(payload)?.[key]);
    return rows
        .map((row) => String(key === 'projects'
        ? row['projectName'] ?? ''
        : row['name'] ?? ''))
        .filter((value) => value !== '');
}
async function validateServer(page, payload) {
    const current = await readResume(page);
    const projectNames = new Set(asRows(current['projects']).map((row) => String(row['projectName'] ?? '')));
    const awardNames = new Set(asRows(current['awards']).map((row) => String(row['name'] ?? '')));
    const issues = [];
    const expectedProjects = expectedNames(payload, 'projects');
    const expectedAwards = expectedNames(payload, 'awards');
    for (const name of expectedProjects) {
        if (!projectNames.has(name)) {
            issues.push({
                key: 'projects',
                code: 'server_readback_mismatch',
                message: `服务器项目缺少：${name}`,
                severity: 'error',
            });
        }
    }
    for (const name of expectedAwards) {
        if (!awardNames.has(name)) {
            issues.push({
                key: 'awards',
                code: 'server_readback_mismatch',
                message: `服务器奖项缺少：${name}`,
                severity: 'error',
            });
        }
    }
    if (current['resumeAppendix'] === null || current['resumeAppendix'] === undefined) {
        issues.push({
            key: 'attachment.resume',
            code: 'server_readback_mismatch',
            message: '服务器缺少附件简历',
            severity: 'error',
        });
    }
    return {
        valid: issues.length === 0,
        checkedCount: expectedProjects.length + expectedAwards.length + 1,
        issues,
    };
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
export const mihoyoResumePage = {
    id: 'mihoyo.jobs.campus-resume',
    version: 1,
    host: HOST,
    pageKind: 'resume_edit',
    status: 'verified',
    lastVerifiedAt: '2026-08-28T00:00:00.000+08:00',
    async match(page) {
        const url = new URL(page.url());
        const hostMatched = url.hostname === HOST;
        const pathMatched = url.hash.startsWith('#/campus/resume/edit');
        const anchors = ['个人信息', '项目经历', '获奖经历'];
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
                hostMatched ? '米哈游招聘域名匹配' : '域名不匹配',
                pathMatched ? '校招简历路由匹配' : '简历路由不匹配',
            ],
            matchedAnchors,
            missingAnchors,
            pageVersionChanged: hostMatched && pathMatched && missingAnchors.length > 0,
        };
    },
    async inspect(page) {
        const current = await readResume(page);
        return {
            url: page.url(),
            title: await page.title(),
            pageKind: 'resume_edit',
            anchors: ['个人信息', '项目经历', '获奖经历'],
            runtimeData: {
                serverResume: current,
            },
        };
    },
    prepare(input, facts) {
        const current = asRecord(facts.runtimeData?.['serverResume']);
        const missing = [];
        if (Object.keys(current).length === 0) {
            missing.push({ key: 'serverResume', reason: '没有读到米哈游服务器简历' });
        }
        if (current['resumeAppendix'] === null || current['resumeAppendix'] === undefined) {
            missing.push({ key: 'attachment.resume', reason: '米哈游服务器缺少附件简历' });
        }
        if (input.projects.length === 0) {
            missing.push({ key: 'projects', reason: '本地没有项目经历' });
        }
        if (!input.awards.some(hasAwardYear)) {
            missing.push({ key: 'awards', reason: '本地没有获奖经历' });
        }
        return {
            resolved: {
                projects: input.projects.map((record) => record.values),
                awards: input.awards.filter(hasAwardYear).map((record) => record.values),
                apiPayload: buildSavePayload(current, input),
            },
            missing,
            conflicts: [],
            skipped: input.awards
                .filter((record) => !hasAwardYear(record))
                .map((record) => ({
                key: text(record.values, 'name', 'label') ?? 'award',
                reason: '米哈游获奖时间必填，原始资料没有年份；保留在附件简历',
            })),
        };
    },
    async fill(page, payload) {
        const apiPayload = resolvedPayload(payload);
        if (apiPayload === undefined) {
            return fillResult([
                {
                    key: 'apiPayload',
                    outcome: 'failed',
                    code: 'mihoyo_payload_missing',
                    message: '没有生成米哈游保存数据',
                },
            ]);
        }
        await page.evaluate(({ key, value }) => {
            window[key] = value;
        }, { key: STAGED_KEY, value: apiPayload });
        return fillResult([
            { key: 'projects', outcome: 'filled' },
            { key: 'awards', outcome: 'filled' },
            { key: 'preservedSections', outcome: 'unchanged' },
        ]);
    },
    async validate(page, payload) {
        const staged = await page.evaluate((key) => window[key] !== undefined, STAGED_KEY);
        if (staged) {
            return {
                valid: payload.missing.length === 0,
                checkedCount: expectedNames(payload, 'projects').length +
                    expectedNames(payload, 'awards').length,
                issues: payload.missing.map((item) => ({
                    key: item.key,
                    code: 'required_missing',
                    message: item.reason,
                    severity: 'blocking',
                })),
            };
        }
        return validateServer(page, payload);
    },
    async saveDraft(page, payload) {
        const apiPayload = resolvedPayload(payload);
        if (apiPayload === undefined || payload.missing.length > 0) {
            return {
                attempted: false,
                saved: false,
                message: '米哈游保存数据不完整',
                evidence: [],
                pageChanged: false,
            };
        }
        const response = await page.evaluate(async ({ url, body }) => {
            const token = window.localStorage.getItem('Jobs-Token') ?? '';
            const result = await fetch(url, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'content-type': 'application/json',
                    ...(token === '' ? {} : { authorization: token }),
                },
                body: JSON.stringify(body),
            });
            const data = await result.json();
            return {
                status: result.status,
                code: data?.code,
                success: data?.success,
                message: data?.message,
            };
        }, { url: SAVE_URL, body: apiPayload });
        await page.evaluate((key) => {
            delete window[key];
        }, STAGED_KEY);
        const saved = response.status >= 200 &&
            response.status < 300 &&
            response.code === 0 &&
            response.success === true;
        return {
            attempted: true,
            saved,
            httpStatus: response.status,
            siteCode: String(response.code ?? ''),
            message: response.message,
            evidence: saved
                ? [
                    {
                        kind: 'network_response',
                        strength: 'strong',
                        description: `米哈游保存接口返回 HTTP ${response.status}，业务码 0`,
                    },
                ]
                : [],
            pageChanged: false,
        };
    },
};
//# sourceMappingURL=resume-page.js.map