/**
 * 把当前页面缺的问题一次汇总给用户。
 *
 * 规则文档：`docs/05_答案收集范围与复用规则.md §9`
 *
 * 要避免的交互是：
 *
 * ```text
 * 问一个 → 填一个 → 又问一个 → 又填一个
 * ```
 *
 * 每个问题都要告诉用户四件事：
 * 官网原文、是否必填、官网可选项、**为什么没有自动填**。
 */
import { randomUUID } from 'node:crypto';
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
/** 每种原因都写成用户能看懂的一句话。 */
const REASON_TEXT = {
    no_mapping: '系统看不懂这道题的含义',
    no_answer: '答案库里没有可用的答案',
    scope_mismatch: '已有答案属于别的公司或岗位，不能跨范围复用',
    multiple_answers: '找到多个不一致的值，需要你选一个',
    policy_requires_confirmation: '这类问题每次申请都要你确认',
    format_conflict: '官网选项里没有与已有答案对应的项',
    sensitive_requires_confirmation: '这是敏感信息，必须你本人确认',
};
const SCOPE_TEXT = {
    global: '全局保存，以后各公司都能复用',
    company: '只按这家公司保存',
    job: '只按这个岗位保存',
    application: '只用于本次申请',
    profile_record: '绑定到某一段履历',
    session: '只在本次会话有效，不长期保存',
};
export function buildMissingAnswerBundle(input) {
    const newId = input.idFactory ?? defaultIdFactory;
    const requests = input.entries.map((entry) => ({
        id: newId('missing'),
        runtimeRef: entry.field.runtimeRef,
        ...(entry.siteFieldId === undefined ? {} : { siteFieldId: entry.siteFieldId }),
        ...(entry.canonicalKey === undefined ? {} : { canonicalKey: entry.canonicalKey }),
        rawQuestion: entry.field.rawLabel,
        sectionPath: entry.field.sectionPath,
        required: entry.field.required,
        controlKind: entry.field.controlKind,
        options: entry.field.options,
        reason: entry.reason,
        ...(entry.suggestedScope === undefined ? {} : { suggestedScope: entry.suggestedScope }),
        // 同一个公共字段的多个实例归一组，方便用户一次回答。
        ...(entry.canonicalKey === undefined ? {} : { groupedQuestionKey: entry.canonicalKey }),
    }));
    return { runId: input.runId, requests, promptText: renderPrompt(input, requests) };
}
function renderPrompt(input, requests) {
    if (requests.length === 0) {
        return '当前页面没有缺失的答案。';
    }
    const header = [input.companyName ?? '当前公司', input.stepLabel ?? '当前步骤'].join('｜');
    const lines = [`${header}`, `以下 ${requests.length} 个问题需要你补充：`, ''];
    requests.forEach((request, index) => {
        lines.push(`${index + 1}. ${request.rawQuestion || '（官网未给出题目文字）'}`);
        if (request.sectionPath.length > 0) {
            lines.push(`   位置：${request.sectionPath.join(' > ')}`);
        }
        lines.push(`   必填：${request.required ? '是' : '否'}`);
        if (request.options.length > 0) {
            lines.push(`   官网选项：${request.options.map((option) => option.rawLabel).join(' / ')}`);
        }
        lines.push(`   没自动填的原因：${REASON_TEXT[request.reason]}`);
        if (request.suggestedScope !== undefined) {
            lines.push(`   建议保存范围：${SCOPE_TEXT[request.suggestedScope.type] ?? request.suggestedScope.type}`);
        }
        lines.push('');
    });
    return lines.join('\n').trimEnd();
}
export { REASON_TEXT, SCOPE_TEXT };
//# sourceMappingURL=build-missing-answer-bundle.js.map