import { basename } from 'node:path';
const HOST = 'hr.4399om.com';
const RESUME_TYPE = '1';
const READ_URL = '/main/?r=userCenter/myResume&type=1';
const DICT_URL = '/main/?r=resumeV2/dict';
const MODULE_URL = '/main/?r=resumeV2/module&type=1&jobID=&resumeKey=';
const SAVE_URL = '/main/?r=userCenter/saveMyResume';
const UPLOAD_URL_PART = 'r=resumeV2/uploadResume';
const STAGED_KEY = '__officialApply4399Resume';
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
function strings(value) {
    if (Array.isArray(value)) {
        return value
            .filter((item) => typeof item === 'string')
            .map((item) => item.trim())
            .filter((item) => item !== '');
    }
    return [];
}
function month(value) {
    return value !== undefined && /^\d{4}-\d{2}/.test(value)
        ? value.slice(0, 7)
        : '';
}
function endMonth(values) {
    if (values['current'] === true)
        return '至今';
    return month(text(values, 'endDate', 'end_date'));
}
function description(record) {
    return [
        text(record.values, 'description'),
        ...strings(record.values['bullets']),
    ]
        .filter((item) => item !== undefined && item !== '')
        .join('\n');
}
function optionValue(dictionary, key, label) {
    if (label === undefined)
        return '';
    const match = asRows(dictionary[key]).find((item) => String(item['label'] ?? '') === label);
    return match === undefined ? '' : String(match['value'] ?? '');
}
function nativePlacePath(dictionary, value) {
    if (value === undefined)
        return [];
    for (const country of asRows(dictionary['nativePlace'])) {
        for (const province of asRows(country['children'])) {
            for (const city of asRows(province['children'])) {
                const provinceLabel = String(province['label'] ?? '');
                const cityLabel = String(city['label'] ?? '');
                if (provinceLabel !== '' &&
                    cityLabel !== '' &&
                    value.includes(provinceLabel) &&
                    value.includes(cityLabel)) {
                    return [
                        String(country['value'] ?? country['label'] ?? ''),
                        String(province['value'] ?? provinceLabel),
                        String(city['value'] ?? cityLabel),
                    ];
                }
            }
        }
    }
    return [];
}
function genderValue(value) {
    if (value === '男')
        return '1';
    if (value === '女')
        return '2';
    return '';
}
function educationRows(input, dictionary) {
    return input.education.map((record) => ({
        startDate: month(text(record.values, 'startDate', 'start_date')),
        endDate: endMonth(record.values),
        degree: optionValue(dictionary, 'degree', text(record.values, 'degree')),
        educationTypeID: optionValue(dictionary, 'educationTypeID', '统招'),
        school: text(record.values, 'school') ?? '',
        college: text(record.values, 'college') ?? '',
        profession: text(record.values, 'major') ?? '',
    }));
}
function experienceRows(input) {
    return input.experience.map((record) => ({
        startDate: month(text(record.values, 'startDate', 'start_date')),
        endDate: endMonth(record.values),
        company: text(record.values, 'company') ?? '',
        department: text(record.values, 'department') ?? '',
        post: text(record.values, 'title', 'role') ?? '',
        reterce: '',
        retercePhone: '',
        workDesc: description(record),
    }));
}
function projectRows(input) {
    return input.projects.map((record) => ({
        startDate: month(text(record.values, 'startDate', 'start_date')),
        endDate: endMonth(record.values),
        projectName: text(record.values, 'name', 'label') ?? '',
        position: text(record.values, 'role') ?? '独立开发者',
        content: text(record.values, 'description') ?? '',
        projectDuty: strings(record.values['bullets']).join('\n'),
        projectAchievement: '',
    }));
}
function languageRows(input, dictionary) {
    const certificate = text(input.basic, 'qualification.english.certificate') ?? '无';
    const postgraduateScore = text(input.basic, 'qualification.exam.postgraduate_english_score');
    return [
        {
            languages: '英语',
            level: optionValue(dictionary, 'englishLevel', certificate),
            score: '',
            remarks: postgraduateScore === undefined
                ? ''
                : `考研英语${postgraduateScore}分`,
        },
    ];
}
function resumeMaterialPath(input) {
    return input.materials?.['attachment.resume']?.localPath;
}
function photoMaterialPath(input) {
    return input.materials?.['attachment.photo']?.localPath;
}
function buildResume(input, dictionary) {
    return {
        base: {
            name: text(input.basic, 'person.identity.full_name') ?? '',
            sex: genderValue(text(input.basic, 'person.identity.gender')),
            avatar: '',
            birthday: text(input.basic, 'person.identity.birth_date') ?? '',
            height: text(input.basic, 'person.physical.height_cm') ?? '',
            mobile: text(input.basic, 'person.contact.phone') ?? '',
            wechat: text(input.basic, 'person.contact.wechat') ?? '',
            personalEmail: text(input.basic, 'person.contact.email') ?? '',
            nation: optionValue(dictionary, 'nation', text(input.basic, 'person.identity.ethnicity')),
            nativePlace: nativePlacePath(dictionary, text(input.basic, 'person.location.hometown_city', 'person.location.native_place')),
            nativePlaceDetail: '',
            respectPay: '',
        },
        education: educationRows(input, dictionary),
        language: languageRows(input, dictionary),
        internship: experienceRows(input),
        project: projectRows(input),
        moreInfo: [],
        game: [],
        gameAnalysis: [],
        attach: [],
        artWork: [],
    };
}
async function readJson(page, url) {
    const result = await page.evaluate(async (target) => {
        const response = await fetch(target, { credentials: 'include' });
        return {
            httpStatus: response.status,
            body: await response.json(),
        };
    }, url);
    const body = asRecord(result.body);
    if (result.httpStatus < 200 || result.httpStatus >= 300 || body['code'] !== 200) {
        throw new Error(`game_4399_read_failed:${result.httpStatus}:${String(body['code'] ?? '')}:${String(body['msg'] ?? '')}`);
    }
    return body;
}
function resumeData(body) {
    const data = body['data'];
    if (Array.isArray(data))
        return asRecord(data[0]);
    return asRecord(data);
}
function preparedResume(payload) {
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
function uploadResponsePath(response) {
    return response
        .json()
        .then((body) => {
        const data = asRecord(asRecord(body)['data']);
        const value = data['path'];
        return typeof value === 'string' && value !== '' ? value : undefined;
    })
        .catch(() => undefined);
}
async function uploadResume(page, localPath) {
    const pathPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            page.off('response', listener);
            reject(new Error('game_4399_resume_upload_timeout'));
        }, 120_000);
        const listener = (response) => {
            if (!response.url().includes(UPLOAD_URL_PART))
                return;
            void uploadResponsePath(response).then((path) => {
                if (path === undefined)
                    return;
                clearTimeout(timeout);
                page.off('response', listener);
                resolve(path);
            });
        };
        page.on('response', listener);
    });
    const input = page.locator('.resume-file-module input[type=file]').first();
    await input.setInputFiles(localPath, { timeout: 30_000 });
    const attachUploadDir = await pathPromise;
    const keepOnly = page.getByRole('button', {
        name: '否，仅上传简历附件',
        exact: true,
    });
    await keepOnly
        .waitFor({ state: 'visible', timeout: 5_000 })
        .catch(() => undefined);
    if ((await keepOnly.count()) > 0 && await keepOnly.isVisible().catch(() => false)) {
        await keepOnly.click();
    }
    return { attachFileName: basename(localPath), attachUploadDir };
}
async function uploadAvatar(page, localPath) {
    const restoreDialog = page
        .getByRole('dialog', { name: '提示' })
        .filter({ hasText: /还原|填写的简历信息/ })
        .first();
    if ((await restoreDialog.count()) > 0 &&
        await restoreDialog.isVisible().catch(() => false)) {
        await restoreDialog
            .getByRole('button', { name: '取消', exact: true })
            .click();
        await restoreDialog
            .waitFor({ state: 'hidden', timeout: 10_000 })
            .catch(() => undefined);
    }
    await page.locator('.upload-container').first().click();
    const dialog = page.getByRole('dialog', { name: '图片上传' }).first();
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 10_000 });
    await dialog.getByText('上传图片', { exact: true }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(localPath);
    await dialog
        .locator('.cropper-container')
        .first()
        .waitFor({ state: 'visible', timeout: 20_000 });
    const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' &&
        response.url().includes('r=resumeV2/uploadAvatar'), { timeout: 60_000 });
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    const response = await responsePromise;
    const body = asRecord(await response.json().catch(() => undefined));
    const data = asRecord(body['data']);
    const filePath = data['filePath'];
    if (response.status() < 200 ||
        response.status() >= 300 ||
        body['code'] !== 200 ||
        typeof filePath !== 'string' ||
        filePath === '') {
        throw new Error(`game_4399_avatar_upload_failed:${response.status()}:${String(body['code'] ?? '')}:${String(body['msg'] ?? '')}`);
    }
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);
    return filePath;
}
async function validateServer(page, payload) {
    const expected = preparedResume(payload) ?? {};
    const current = resumeData(await readJson(page, READ_URL));
    const issues = [];
    const expectedBasic = asRecord(expected['base']);
    const currentBasic = asRecord(current['base']);
    if (String(currentBasic['name'] ?? '') !== String(expectedBasic['name'] ?? '')) {
        issues.push({
            key: 'basic.name',
            code: 'server_readback_mismatch',
            message: '服务器姓名与待保存资料不一致',
            severity: 'error',
        });
    }
    for (const key of ['education', 'internship', 'project']) {
        if (asRows(current[key]).length !== asRows(expected[key]).length) {
            issues.push({
                key,
                code: 'server_readback_mismatch',
                message: `服务器 ${key} 数量与待保存资料不一致`,
                severity: 'error',
            });
        }
    }
    const expectedUpload = asRecord(expected['uploadResume']);
    const currentUpload = asRecord(current['uploadResume']);
    if (String(expectedUpload['attachFileName'] ?? '') !== '' &&
        String(currentUpload['attachFileName'] ?? '') !==
            String(expectedUpload['attachFileName'] ?? '')) {
        issues.push({
            key: 'attachment.resume',
            code: 'server_readback_mismatch',
            message: '服务器缺少刚上传的附件简历',
            severity: 'error',
        });
    }
    return {
        valid: !issues.some((issue) => issue.severity === 'error' || issue.severity === 'blocking'),
        checkedCount: 1 +
            asRows(expected['education']).length +
            asRows(expected['internship']).length +
            asRows(expected['project']).length +
            (String(expectedUpload['attachFileName'] ?? '') === '' ? 0 : 1),
        issues,
    };
}
export const game4399ResumePage = {
    id: 'game-4399.campus-resume',
    version: 1,
    host: HOST,
    pageKind: 'resume_edit',
    status: 'candidate',
    async match(page) {
        const url = new URL(page.url());
        const hostMatched = url.hostname === HOST;
        const pathMatched = url.pathname === '/uc/person-center/resume-full-edit/1';
        const anchors = ['校招简历', '简历附件', '基础信息', '教育情况'];
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
            confidence: matched ? 1 : hostMatched && pathMatched ? 0.6 : 0,
            allowRun: matched,
            reasons: [
                hostMatched ? '招聘域名匹配' : '域名不匹配',
                pathMatched ? '校招简历编辑路由匹配' : '简历路由不匹配',
            ],
            matchedAnchors,
            missingAnchors,
            pageVersionChanged: hostMatched && pathMatched && missingAnchors.length > 0,
        };
    },
    async inspect(page) {
        const [resume, dictionary, modules] = await Promise.all([
            readJson(page, READ_URL),
            readJson(page, DICT_URL),
            readJson(page, MODULE_URL),
        ]);
        return {
            url: page.url(),
            title: await page.title(),
            pageKind: 'resume_edit',
            anchors: ['校招简历', '简历附件', '基础信息', '教育情况'],
            runtimeData: {
                serverResume: resumeData(resume),
                dictionary: asRecord(dictionary['data']),
                modules: asRecord(modules['data']),
            },
        };
    },
    prepare(input, facts) {
        const dictionary = asRecord(facts.runtimeData?.['dictionary']);
        const apiResume = buildResume(input, dictionary);
        const missing = [];
        for (const [key, reason, value] of [
            [
                'person.physical.height_cm',
                '官网要求身高，本地资料没有',
                text(input.basic, 'person.physical.height_cm'),
            ],
            [
                'person.contact.wechat',
                '官网要求微信号，本地资料没有',
                text(input.basic, 'person.contact.wechat'),
            ],
            [
                'person.identity.ethnicity',
                '官网要求民族，用户没有明确提供',
                text(input.basic, 'person.identity.ethnicity'),
            ],
        ]) {
            if (value === undefined)
                missing.push({ key, reason });
        }
        input.education.forEach((record, index) => {
            if (text(record.values, 'college') === undefined) {
                missing.push({
                    key: `education.${index}.college`,
                    reason: `${text(record.values, 'school') ?? `第 ${index + 1} 段教育`}缺少学院`,
                });
            }
        });
        const material = resumeMaterialPath(input);
        if (material === undefined) {
            missing.push({ key: 'attachment.resume', reason: '没有可上传的附件简历' });
        }
        const photo = photoMaterialPath(input);
        if (photo === undefined) {
            missing.push({ key: 'attachment.photo', reason: '没有可上传的个人照片' });
        }
        return {
            resolved: {
                apiResume: apiResume,
                ...(material === undefined ? {} : { resumeLocalPath: material }),
                ...(photo === undefined ? {} : { photoLocalPath: photo }),
            },
            missing,
            conflicts: [],
            skipped: [
                { key: 'awards', reason: '官网没有独立奖项栏，保留在附件简历' },
                { key: 'skills', reason: '官网没有独立技能栏，保留在附件简历' },
            ],
        };
    },
    async fill(page, payload) {
        const apiResume = preparedResume(payload);
        if (apiResume === undefined) {
            return fillResult([
                {
                    key: 'apiResume',
                    outcome: 'failed',
                    code: 'game_4399_payload_missing',
                    message: '没有生成 4399 简历保存数据',
                },
            ]);
        }
        const fields = [
            { key: 'basic', outcome: 'filled' },
            { key: 'education', outcome: 'filled' },
            { key: 'internship', outcome: 'filled' },
            { key: 'projects', outcome: 'filled' },
        ];
        const photoLocalPath = payload.resolved['photoLocalPath'];
        if (typeof photoLocalPath === 'string' && photoLocalPath !== '') {
            try {
                asRecord(apiResume['base'])['avatar'] = await uploadAvatar(page, photoLocalPath);
                fields.push({ key: 'attachment.photo', outcome: 'filled' });
            }
            catch (error) {
                fields.push({
                    key: 'attachment.photo',
                    outcome: 'failed',
                    code: 'game_4399_avatar_upload_failed',
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        }
        else {
            fields.push({
                key: 'attachment.photo',
                outcome: 'skipped',
                code: 'no_resolved_value',
            });
        }
        const localPath = payload.resolved['resumeLocalPath'];
        let uploadResumeValue = {};
        if (typeof localPath === 'string' && localPath !== '') {
            try {
                uploadResumeValue = await uploadResume(page, localPath);
                fields.push({ key: 'attachment.resume', outcome: 'filled' });
            }
            catch (error) {
                fields.push({
                    key: 'attachment.resume',
                    outcome: 'failed',
                    code: 'game_4399_resume_upload_failed',
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        }
        else {
            fields.push({
                key: 'attachment.resume',
                outcome: 'skipped',
                code: 'no_resolved_value',
            });
        }
        const staged = {
            resumeType: RESUME_TYPE,
            ...apiResume,
            uploadResume: uploadResumeValue,
        };
        await page.evaluate(({ key, value }) => {
            window[key] = value;
        }, { key: STAGED_KEY, value: staged });
        payload.resolved['apiResume'] = staged;
        return fillResult(fields);
    },
    async validate(page, payload) {
        return validateServer(page, payload);
    },
    async saveDraft(page) {
        const response = await page.evaluate(async ({ key, url }) => {
            const staged = window[key];
            const configResponse = await fetch('/main/?r=userV2/configIndex', {
                credentials: 'include',
            });
            const configBody = await configResponse.json();
            const csrfToken = typeof configBody?.data?.token === 'string'
                ? configBody.data.token
                : '';
            const result = await fetch(url, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'content-type': 'application/json',
                    'x-requested-with': 'XMLHttpRequest',
                    'x-csrf-token': csrfToken,
                    'x-token': window.localStorage.getItem('RECRUIT_HELPER_TOKEN') ?? '',
                },
                body: JSON.stringify(staged),
            });
            return {
                httpStatus: result.status,
                body: await result.json(),
            };
        }, { key: STAGED_KEY, url: SAVE_URL });
        const body = asRecord(response.body);
        const saved = response.httpStatus >= 200 &&
            response.httpStatus < 300 &&
            body['code'] === 200;
        return {
            attempted: true,
            saved,
            httpStatus: response.httpStatus,
            siteCode: String(body['code'] ?? ''),
            message: String(body['msg'] ?? body['message'] ?? ''),
            evidence: [
                {
                    kind: 'network_response',
                    strength: 'strong',
                    description: saved
                        ? '4399 保存接口返回业务码 200'
                        : `4399 保存接口返回业务码 ${String(body['code'] ?? '')}`,
                },
            ],
            pageChanged: false,
        };
    },
};
//# sourceMappingURL=resume-page.js.map