/** 学历高低。网页卡片按时间倒序还是正序都有，靠这个对齐更稳。 */
const DEGREE_RANK = [
    ['博士', 4],
    ['phd', 4],
    ['doctor', 4],
    ['硕士', 3],
    ['研究生', 3],
    ['master', 3],
    ['本科', 2],
    ['学士', 2],
    ['bachelor', 2],
    ['专科', 1],
    ['大专', 1],
];
function normalize(text) {
    return text.replace(/\s+/g, '').toLowerCase();
}
export function degreeRankOf(text) {
    const normalized = normalize(text);
    for (const [keyword, rank] of DEGREE_RANK) {
        if (normalized.includes(normalize(keyword))) {
            return rank;
        }
    }
    return undefined;
}
/**
 * 把一条履历记录里所有能表明学历的文字拼起来。
 *
 * 学历可能写在好几个地方，取决于记录是怎么进来的：
 * - `profile.json` 直接导入 → 键名就是用户写的 `degree`
 * - 映射过公共字段目录 → 键名是 `profile.education[].degree`
 * - 有些人写在 `label` 或 `学历` 里
 *
 * 只认死一种键名的话，从 `profile.json` 导进来的记录会**完全匹配不上**，
 * 于是全部退化成按时间排序——本科硕士就填反了。
 */
function recordLabelOf(record) {
    const parts = [record.label];
    for (const [key, value] of Object.entries(record.values)) {
        if (typeof value !== 'string') {
            continue;
        }
        const normalizedKey = key.toLowerCase();
        if (normalizedKey.endsWith('degree') || key.includes('学历') || key.includes('学位')) {
            parts.push(value);
        }
    }
    return parts.join(' ');
}
/** 结束时间越晚越新。用于「网页按时间排」的情况。 */
function endDateOf(record) {
    return record.endDate ?? record.startDate ?? '';
}
export function bindPageGroupToProfileRecord(input) {
    const bindings = [];
    const usedRecords = new Set();
    const usedInstances = new Set();
    // 第一轮：按学历对齐。网页写「硕士」，就绑硕士那条记录。
    input.instanceLabels.forEach((label, instanceIndex) => {
        const pageRank = degreeRankOf(label);
        if (pageRank === undefined) {
            return;
        }
        const match = input.records.find((record) => !usedRecords.has(record.id) && degreeRankOf(recordLabelOf(record)) === pageRank);
        if (match === undefined) {
            return;
        }
        usedRecords.add(match.id);
        usedInstances.add(instanceIndex);
        bindings.push({
            profileRecordId: match.id,
            instanceIndex,
            reason: `网页第 ${instanceIndex + 1} 张卡片写着「${label}」，与履历「${match.label}」的学历一致`,
            confidence: 0.9,
        });
    });
    // 第二轮：剩下的按时间从新到旧对齐剩余卡片。
    const remainingRecords = input.records
        .filter((record) => !usedRecords.has(record.id))
        .sort((a, b) => endDateOf(b).localeCompare(endDateOf(a)));
    const remainingInstances = input.instanceLabels
        .map((_, index) => index)
        .filter((index) => !usedInstances.has(index));
    remainingRecords.forEach((record, order) => {
        const instanceIndex = remainingInstances[order];
        if (instanceIndex === undefined) {
            return;
        }
        usedRecords.add(record.id);
        bindings.push({
            profileRecordId: record.id,
            instanceIndex,
            reason: `学历对不上，按结束时间从新到旧排到第 ${instanceIndex + 1} 张卡片`,
            // 置信度明显更低：这只是顺序推断，不是语义匹配。
            confidence: 0.5,
        });
    });
    const unboundRecordIds = input.records
        .filter((record) => !usedRecords.has(record.id))
        .map((record) => record.id);
    return {
        bindings: bindings.sort((a, b) => a.instanceIndex - b.instanceIndex),
        missingInstances: Math.max(0, input.records.length - input.instanceLabels.length),
        unboundRecordIds,
    };
}
//# sourceMappingURL=bind-page-group-to-profile-record.js.map