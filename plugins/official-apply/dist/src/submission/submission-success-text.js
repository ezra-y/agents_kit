/** 可直接表达“这次申请已经完成”的结果文字。 */
export const SUBMISSION_SUCCESS_PATTERNS = [
    '投递成功',
    '申请已提交',
    '提交成功',
    '已成功提交',
    '已投递',
    '已申请',
    'application submitted',
    'successfully submitted',
];
/**
 * 从标题、状态区等短语义文本中找成功结果。
 *
 * “提交成功后如何修改资料”是在讲流程，不是当前结果。
 */
export function findSubmissionSuccessText(texts) {
    for (const rawText of texts) {
        const text = rawText.replace(/\s+/g, ' ').trim();
        const lower = text.toLowerCase();
        for (const pattern of SUBMISSION_SUCCESS_PATTERNS) {
            const index = lower.indexOf(pattern.toLowerCase());
            if (index < 0) {
                continue;
            }
            const before = lower.slice(0, index).trim();
            const after = lower.slice(index + pattern.length).trim();
            if (/(?:如果|若|当|待|只有|请在|if|when|after)\s*$/.test(before) ||
                /^(?:后|之后|以前|前|时|如何|怎么|即可|可以|可在|将会|will(?:\s|$)|when(?:\s|$)|after(?:\s|$))/.test(after)) {
                continue;
            }
            return pattern;
        }
    }
    return undefined;
}
//# sourceMappingURL=submission-success-text.js.map