/**
 * 校验一行任务输入。
 *
 * 规则文档：`docs/01_产品定义与完整运行流程.md`、`docs/10 §9`
 *
 * 校验必须**具体**：错在哪一列、为什么错，用户看完就能改。
 * 只说「格式不对」等于没说。
 *
 * 幂等键：优先用用户自己给的 `externalRowId`；
 * 没给就用「公司 + 岗位 + URL」算一个稳定哈希。
 * 这样同一份表格导入两次，第二次不会重复建任务。
 */
import { createHash } from 'node:crypto';
const TRUE_WORDS = new Set(['1', 'true', 'yes', 'y', '是', '投', '投递', 'on']);
const FALSE_WORDS = new Set(['0', 'false', 'no', 'n', '否', '不投', '', 'off']);
const VALID_SOURCES = new Set(['user_table', 'qiuzhao_skill', 'manual', 'other']);
const VALID_TASK_KINDS = new Set(['company_resume', 'job_application']);
const VALID_JOB_SELECTION_SOURCES = new Set([
    'user_table',
    'user_link',
    'user_authorized_agent',
]);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
/** 稳定哈希：同样的公司、岗位和链接永远算出同一个键。 */
export function computeTaskFingerprint(input) {
    const normalizedUrl = input.jobUrl.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
    const material = [input.companyName.trim(), input.jobTitle?.trim() ?? '', normalizedUrl].join('|');
    return `auto_${createHash('sha256').update(material).digest('hex').slice(0, 16)}`;
}
function parseBoolean(raw) {
    if (raw === undefined) {
        return false;
    }
    const value = raw.trim().toLowerCase();
    if (TRUE_WORDS.has(value)) {
        return true;
    }
    if (FALSE_WORDS.has(value)) {
        return false;
    }
    return undefined;
}
export function validateApplicationTaskRules(input, options = {}) {
    const violations = [];
    const companyName = input.companyName?.trim() ?? '';
    const taskKind = input.taskKind?.trim() ?? '';
    const jobTitle = input.jobTitle?.trim() ?? '';
    const jobUrl = input.jobUrl?.trim() ?? '';
    const selectionSource = input.jobSelectionSource?.trim() ?? '';
    const selectionEvidence = input.jobSelectionEvidence?.trim() ?? '';
    if (companyName === '') {
        violations.push({
            code: 'task_company_name_missing',
            message: '缺少公司名称（列名可以是 companyName / company / 公司）',
        });
    }
    if (!VALID_TASK_KINDS.has(taskKind)) {
        violations.push({
            code: 'task_kind_invalid',
            message: `taskKind 只能是 company_resume 或 job_application，收到「${taskKind}」`,
        });
    }
    if (jobUrl === '') {
        violations.push({
            code: 'task_url_missing',
            message: '缺少投递链接（列名可以是 jobUrl / url / 链接）',
        });
    }
    else {
        let parsed;
        try {
            parsed = new URL(jobUrl);
        }
        catch {
            violations.push({
                code: 'task_url_protocol_not_allowed',
                message: `投递链接不合法：无法解析的 URL：${jobUrl}`,
            });
        }
        if (parsed !== undefined &&
            parsed.protocol !== 'https:' &&
            !(parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname))) {
            violations.push({
                code: 'task_url_protocol_not_allowed',
                message: '投递链接不合法：只允许 https，或指向本机回环的 http；' +
                    `当前是 ${parsed.protocol}//${parsed.hostname}`,
            });
        }
    }
    if (selectionSource !== '' &&
        !VALID_JOB_SELECTION_SOURCES.has(selectionSource) &&
        !(options.allowLegacyRecord === true && selectionSource === 'legacy_record')) {
        violations.push({
            code: 'task_job_selection_source_invalid',
            message: 'jobSelectionSource 只能是 user_table / user_link / user_authorized_agent，' +
                `收到「${selectionSource}」`,
        });
    }
    if (taskKind === 'job_application') {
        if (jobTitle === '') {
            violations.push({
                code: 'task_job_title_missing',
                message: '缺少岗位名称（列名可以是 jobTitle / job / 岗位）',
            });
        }
        if (selectionSource === '') {
            violations.push({
                code: 'task_job_selection_source_missing',
                message: '岗位申请缺少岗位来源 jobSelectionSource',
            });
        }
        if (selectionEvidence === '') {
            violations.push({
                code: 'task_job_selection_evidence_missing',
                message: '岗位申请缺少岗位来源证据 jobSelectionEvidence',
            });
        }
    }
    else if (taskKind === 'company_resume' &&
        (selectionSource !== '' || selectionEvidence !== '')) {
        violations.push({
            code: 'task_company_resume_has_job_selection',
            message: '公司简历任务不能填写岗位来源或岗位来源证据',
        });
    }
    return violations;
}
export function assertApplicationTaskRules(input) {
    const violation = validateApplicationTaskRules(input)[0];
    if (violation !== undefined) {
        throw new Error(`${violation.code}: ${violation.message}`);
    }
    return input.jobUrl?.trim() ?? '';
}
export function assertStoredApplicationTaskRules(input) {
    const violation = validateApplicationTaskRules(input, { allowLegacyRecord: true })[0];
    if (violation !== undefined) {
        throw new Error(`${violation.code}: ${violation.message}`);
    }
    return input.jobUrl?.trim() ?? '';
}
export function validateApplicationTaskInput(row, defaults = {}) {
    const errors = [];
    const get = (key) => (row.values[key] ?? '').trim();
    const companyName = get('companyName');
    const jobTitle = get('jobTitle');
    const jobLocation = get('jobLocation');
    const jobUrl = get('jobUrl');
    const taskKind = get('taskKind');
    const jobSelectionSource = get('jobSelectionSource');
    const jobSelectionEvidence = get('jobSelectionEvidence');
    const batchId = get('batchId');
    errors.push(...validateApplicationTaskRules({
        companyName,
        taskKind,
        jobTitle,
        jobUrl,
        jobSelectionSource,
        jobSelectionEvidence,
    }).map((violation) => violation.message));
    const execute = parseBoolean(row.values['execute']);
    if (execute === undefined) {
        errors.push(`execute 只认 1/0、true/false、是/否，收到「${get('execute')}」`);
    }
    const rawMode = get('mode').toLowerCase();
    const mode = rawMode === '' ? 'review' : rawMode;
    if (mode !== 'review' && mode !== 'auto') {
        errors.push(`mode 只能是 review 或 auto，收到「${get('mode')}」`);
    }
    const source = defaults.source ?? (get('source') || 'user_table');
    if (!VALID_SOURCES.has(source)) {
        errors.push(`source 只能是 ${[...VALID_SOURCES].join(' / ')}，收到「${source}」`);
    }
    if (errors.length > 0) {
        return { ok: false, errors };
    }
    const additional = get('additionalMaterialIds')
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '');
    const profileRecordIds = get('profileRecordIds')
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '');
    const externalRowId = get('externalRowId') || computeTaskFingerprint({ companyName, jobTitle, jobUrl });
    const companyKey = get('companyKey');
    const jobKey = get('jobKey');
    const resumeMaterialId = get('resumeMaterialId');
    const answerSetId = get('answerSetId');
    return {
        ok: true,
        errors: [],
        input: {
            ...(batchId === '' ? {} : { batchId }),
            companyName,
            taskKind: taskKind,
            jobUrl,
            execute: execute === true,
            mode: mode,
            source: source,
            externalRowId,
            additionalMaterialIds: additional,
            profileRecordIds,
            ...(companyKey === '' ? {} : { companyKey }),
            ...(jobKey === '' ? {} : { jobKey }),
            ...(jobTitle === '' ? {} : { jobTitle }),
            ...(jobLocation === '' ? {} : { jobLocation }),
            ...(jobSelectionSource === ''
                ? {}
                : { jobSelectionSource: jobSelectionSource }),
            ...(jobSelectionEvidence === '' ? {} : { jobSelectionEvidence }),
            ...(resumeMaterialId === '' ? {} : { resumeMaterialId }),
            ...(answerSetId === '' ? {} : { answerSetId }),
        },
    };
}
//# sourceMappingURL=validate-application-task-input.js.map