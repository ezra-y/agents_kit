/**
 * 来源优先级（`docs/05 §6`）。
 *
 * 数字越小越优先。这不是「数据库永远赢」，
 * 而是「用户刚确认的 > 已验证答案 > 履历 > 附件 > 简历文本」。
 */
const SOURCE_PRIORITY = {
    current_user_input: 1,
    private_answer: 2,
    profile_record: 3,
    attachment_metadata: 4,
    resume: 5,
    application_history: 6,
    derived_format: 7,
    none: 99,
};
function sameValue(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}
export function detectAnswerConflicts(input) {
    const candidates = input.candidates.filter((candidate) => candidate.sourceType !== 'none');
    if (candidates.length === 0) {
        return { conflicting: [] };
    }
    const first = candidates[0];
    const distinct = candidates.filter((candidate) => !sameValue(candidate.value, first.value));
    if (distinct.length === 0) {
        // 所有来源给出同一个值，直接采用优先级最高的那条记录。
        return { chosen: pickByPriority(candidates), conflicting: [] };
    }
    // 用户刚刚亲口确认的值可以直接压过其他来源，这不算冲突。
    const userConfirmedNow = candidates.filter((candidate) => candidate.sourceType === 'current_user_input');
    if (userConfirmedNow.length === 1) {
        return { chosen: userConfirmedNow[0], conflicting: [] };
    }
    return {
        conflicting: candidates,
        reason: `同一字段出现 ${new Set(candidates.map((candidate) => JSON.stringify(candidate.value))).size} 个不同取值，需要用户确认`,
    };
}
function pickByPriority(candidates) {
    return [...candidates].sort((a, b) => {
        const bySource = SOURCE_PRIORITY[a.sourceType] - SOURCE_PRIORITY[b.sourceType];
        if (bySource !== 0) {
            return bySource;
        }
        if (a.userConfirmed !== b.userConfirmed) {
            return a.userConfirmed ? -1 : 1;
        }
        return b.confidence - a.confidence;
    })[0];
}
export { SOURCE_PRIORITY };
//# sourceMappingURL=detect-answer-conflicts.js.map