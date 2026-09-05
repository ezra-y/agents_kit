/**
 * 把用户的履历记录填进网页上的重复卡片。
 *
 * 规则文档：`docs/03`、`docs/06 §4`、修复清单 P1-3
 *
 * 这一层负责三件事的串联：
 *
 * ```text
 * 读履历记录 → bindPageGroupToProfileRecord() 决定哪条填哪张卡
 *            → fillRepeatableGroup() 真的去填
 * ```
 *
 * **最贵的错误是把本科和硕士填反。** 所以绑定不按「第 1 条填第 1 张」，
 * 而是综合学历层级、时间顺序和卡片上已有的文字来判断——那部分逻辑在
 * `bindPageGroupToProfileRecord()` 里，这里不重复实现，也不绕过它。
 *
 * 绑不上的记录**不硬塞**。宁可少填一条让人补，也不要填错位置。
 */
import { openPrivateDatabase } from "../storage/open-private-database.js";
import { bindPageGroupToProfileRecord } from "../browser/actions/bind-page-group-to-profile-record.js";
import { fillRepeatableGroup } from "../browser/actions/fill-repeatable-group.js";
/** 读出用户的履历记录。 */
export function readProfileRecords(paths, recordIds) {
    const selected = recordIds ?? [];
    if (selected.length === 0) {
        return [];
    }
    const priv = openPrivateDatabase({ paths });
    try {
        const rows = priv.db
            .prepare(`SELECT id, record_type, label, start_date, end_date, values_json, source_refs_json
           FROM profile_records
          WHERE active = 1 AND id IN (${selected.map(() => '?').join(', ')})
          ORDER BY start_date, rowid`)
            .all(...selected);
        const records = rows
            .map((row) => {
            let values = {};
            let sourceRefs = [];
            try {
                values = JSON.parse(String(row['values_json']));
            }
            catch {
                // 坏掉的记录当成空值，不让它把整个流程带崩。
            }
            try {
                sourceRefs = JSON.parse(String(row['source_refs_json']));
            }
            catch {
                sourceRefs = [];
            }
            return {
                id: String(row['id']),
                recordType: String(row['record_type']),
                label: String(row['label']),
                ...(row['start_date'] === null ? {} : { startDate: String(row['start_date']) }),
                ...(row['end_date'] === null ? {} : { endDate: String(row['end_date']) }),
                values,
                sourceRefs,
                active: true,
            };
        });
        const typePriority = {
            education: 0,
            experience: 1,
            project: 2,
            award: 3,
            family_member: 4,
            other: 5,
        };
        return records.sort((left, right) => {
            const typeDelta = typePriority[left.recordType] - typePriority[right.recordType];
            if (typeDelta !== 0)
                return typeDelta;
            const leftOrder = left.values['profileOrder'];
            const rightOrder = right.values['profileOrder'];
            if (typeof leftOrder === 'number' && typeof rightOrder === 'number') {
                return leftOrder - rightOrder;
            }
            return 0;
        });
    }
    finally {
        priv.close();
    }
}
/**
 * 读出每张卡片上的可读标题。
 *
 * 「本科」「硕士」这类文字是绑定的主要依据。取不到就给空串，
 * 让 `bindPageGroupToProfileRecord()` 退回按时间顺序判断。
 */
export function instanceLabelsOf(schema, group) {
    const labels = [];
    for (let index = 0; index < Math.max(group.currentCount, 1); index += 1) {
        // 这张卡片里的字段，它们的当前值往往就写着「本科」「硕士」。
        const inThisInstance = schema.fields.filter((field) => field.repeatGroupKey === group.groupKey && field.repeatInstanceIndex === index);
        const fromValues = inThisInstance
            .map((field) => String(field.currentValue ?? ''))
            .filter((value) => value !== '')
            .join(' ');
        // 值里没有就退回卡片所在区域的标题。
        const fromSection = inThisInstance[0]?.sectionPath.at(-1) ?? '';
        labels.push(fromValues !== '' ? fromValues : fromSection);
    }
    return labels;
}
/** 公共字段 key → 网页上的标签。重复组里靠标签定位具体输入框。 */
function labelByCanonicalKey(mappings, schema) {
    const fieldByRef = new Map(schema.fields.map((field) => [field.runtimeRef, field]));
    const table = {};
    for (const mapping of mappings) {
        if (mapping.canonicalKey === undefined) {
            continue;
        }
        const label = fieldByRef.get(mapping.runtimeRef)?.rawLabel;
        if (label !== undefined && label !== '' && table[mapping.canonicalKey] === undefined) {
            table[mapping.canonicalKey] = label;
        }
    }
    return table;
}
export async function fillProfileGroups(request) {
    const results = [];
    const bindings = [];
    const unbound = [];
    const missingInstances = [];
    let addedInstances = 0;
    const groups = request.pageSchema.repeatableGroups;
    if (groups.length === 0) {
        return { results, bindings, addedInstances, unbound, missingInstances };
    }
    const allRecords = readProfileRecords(request.paths, request.profileRecordIds)
        .filter(record => record.values['includeInApplications'] !== false);
    const fieldLabels = labelByCanonicalKey(request.mappings, request.pageSchema);
    for (const group of groups) {
        // 只拿这个组要的那一类记录。教育卡片不该被实习记录填进去。
        const wantedType = group.canonicalRecordType;
        const records = wantedType === undefined
            ? allRecords
            : allRecords.filter((record) => record.recordType === wantedType);
        if (records.length === 0) {
            continue;
        }
        const bound = bindPageGroupToProfileRecord({
            group,
            instanceLabels: instanceLabelsOf(request.pageSchema, group),
            records,
        });
        for (const item of bound.bindings) {
            bindings.push({ groupKey: group.groupKey, ...item });
        }
        for (const recordId of bound.unboundRecordIds) {
            unbound.push({ groupKey: group.groupKey, profileRecordId: recordId });
        }
        if (bound.missingInstances > 0) {
            missingInstances.push({ groupKey: group.groupKey, count: bound.missingInstances });
        }
        if (bound.bindings.length === 0) {
            continue;
        }
        const recordById = new Map(records.map((record) => [record.id, record]));
        const assignments = bound.bindings.map((item) => ({
            profileRecordId: item.profileRecordId,
            instanceIndex: item.instanceIndex,
            values: recordById.get(item.profileRecordId)?.values ?? {},
        }));
        const filled = await fillRepeatableGroup(request.page, {
            runId: request.runId,
            group,
            assignments,
            pageSchema: request.pageSchema,
            fieldLabelByCanonicalKey: fieldLabels,
            paths: request.paths,
            ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
        });
        results.push(...filled.results);
        addedInstances += filled.addedInstances;
    }
    return { results, bindings, addedInstances, unbound, missingInstances };
}
//# sourceMappingURL=fill-profile-groups.js.map