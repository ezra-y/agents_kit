/**
 * 生成提交指纹，用于防重复投递。
 *
 * 规则文档：`docs/10_状态提交安全隐私与错误恢复.md §4`
 *
 * 指纹要回答一个问题：**这次提交和之前那次，是不是同一件事？**
 *
 * 所以它由「公司 + 岗位 + 申请入口 + 用户」组成。
 * URL 里的 query 会被去掉：同一个岗位换个来源参数，仍然是同一次投递。
 * 用户标识只存哈希，不存原值。
 */
import { createHash } from 'node:crypto';
import { normalizePathShape } from "../browser/scan/compute-page-fingerprint.js";
/** 去掉 query，只留 origin + 路径形状。 */
export function normalizeApplicationUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        return `${parsed.origin}${normalizePathShape(rawUrl)}`;
    }
    catch {
        return '';
    }
}
export function computeSubmissionFingerprint(input) {
    const parts = [
        input.companyKey ?? '',
        input.jobKey ?? '',
        normalizeApplicationUrl(input.applicationUrl),
        // 用户标识只进哈希，不出现在指纹的可读部分。
        input.userKey === undefined
            ? ''
            : createHash('sha256').update(input.userKey).digest('hex').slice(0, 16),
    ];
    const digest = createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
    // 前缀保留可读部分，方便人一眼看出这是哪家公司哪个岗位。
    return `${input.companyKey ?? 'unknown'}:${input.jobKey ?? 'unknown'}:${digest}`;
}
/**
 * 幂等键。
 *
 * 比指纹多带一个 taskId：同一个岗位如果用户真的建了两条任务，
 * 那是两次明确的意图，不该被指纹拦住；但同一条任务只能提交一次。
 */
export function computeIdempotencyKey(input) {
    return `${input.taskId}|${computeSubmissionFingerprint(input)}`;
}
//# sourceMappingURL=compute-submission-fingerprint.js.map