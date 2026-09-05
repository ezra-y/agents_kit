/**
 * 幂等写入任务。
 *
 * 规则文档：`docs/10 §9`
 *
 * 幂等靠 `application_tasks` 上的 `UNIQUE(source, external_row_id)` 索引。
 *
 * 三种结果分开报：
 * - `inserted`：新建
 * - `updated`：已存在但值变了
 * - `unchanged`：完全没变（重复导入应该全落在这里）
 *
 * **已经投出去的任务不会被导入覆盖状态。** 只更新描述性字段，
 * `status` 和 `result_note` 由运行流程负责，导入不碰。
 */
import { randomUUID } from 'node:crypto';
import { openRuntimeDatabase } from "../storage/open-runtime-database.js";
import { assertApplicationTaskRules } from "./validate-application-task-input.js";
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
function changedIdentityFields(row, input) {
    const fields = [
        ['batch_id', row.batch_id ?? '', input.batchId ?? ''],
        ['task_kind', row.task_kind, input.taskKind],
        ['company_key', row.company_key ?? '', input.companyKey ?? ''],
        ['company_name', row.company_name, input.companyName],
        ['job_key', row.job_key ?? '', input.jobKey ?? ''],
        ['job_title', row.job_title ?? '', input.jobTitle ?? ''],
        ['job_location', row.job_location ?? '', input.jobLocation ?? ''],
        ['job_url', row.job_url, input.jobUrl],
        ['job_selection_source', row.job_selection_source ?? '', input.jobSelectionSource ?? ''],
        ['job_selection_evidence', row.job_selection_evidence ?? '', input.jobSelectionEvidence ?? ''],
        ['source', row.source, input.source],
        ['external_row_id', row.external_row_id ?? '', input.externalRowId],
    ];
    return fields.filter(([, current, next]) => current !== next).map(([name]) => name);
}
/** 只比较导入会写的字段。状态、结果备注这些运行期字段不参与比较。 */
function sameAsExisting(row, input) {
    return ((row.batch_id ?? '') === (input.batchId ?? '') &&
        row.execute === (input.execute ? 1 : 0) &&
        row.task_kind === input.taskKind &&
        (row.company_key ?? '') === (input.companyKey ?? '') &&
        row.company_name === input.companyName &&
        (row.job_key ?? '') === (input.jobKey ?? '') &&
        (row.job_title ?? '') === (input.jobTitle ?? '') &&
        (row.job_location ?? '') === (input.jobLocation ?? '') &&
        row.job_url === input.jobUrl &&
        (row.job_selection_source ?? '') === (input.jobSelectionSource ?? '') &&
        (row.job_selection_evidence ?? '') === (input.jobSelectionEvidence ?? '') &&
        row.mode === input.mode &&
        (row.resume_material_id ?? '') === (input.resumeMaterialId ?? '') &&
        row.additional_material_ids_json === JSON.stringify(input.additionalMaterialIds) &&
        row.profile_record_ids_json === JSON.stringify(input.profileRecordIds ?? []) &&
        (row.answer_set_id ?? '') === (input.answerSetId ?? '') &&
        row.source === input.source &&
        (row.external_row_id ?? '') === input.externalRowId);
}
export function upsertApplicationTasks(input) {
    const now = input.now ?? new Date().toISOString();
    const newId = input.idFactory ?? defaultIdFactory;
    const inserted = [];
    const updated = [];
    const unchanged = [];
    for (const task of input.tasks) {
        assertApplicationTaskRules(task);
    }
    const runtime = openRuntimeDatabase({ paths: input.paths });
    try {
        const findStatement = runtime.db.prepare(`SELECT id, batch_id, execute, task_kind, company_key, company_name, job_key, job_title,
              job_location, job_url, job_selection_source, job_selection_evidence, mode, resume_material_id,
              additional_material_ids_json, profile_record_ids_json, answer_set_id, source,
              external_row_id
         FROM application_tasks WHERE source = ? AND external_row_id = ?`);
        const hasHistoryStatement = runtime.db.prepare(`SELECT (
         EXISTS(SELECT 1 FROM application_runs WHERE task_id = ?)
         OR EXISTS(SELECT 1 FROM submission_attempts WHERE task_id = ?)
       ) AS value`);
        const deleteAutoApprovalStatement = runtime.db.prepare('DELETE FROM auto_submit_approvals WHERE task_id = ?');
        const invalidateSubmissionApprovalsStatement = runtime.db.prepare(`UPDATE submission_approval_tokens
          SET status = 'invalidated'
        WHERE task_id = ? AND status = 'pending'`);
        const insertBatchStatement = runtime.db.prepare('INSERT OR IGNORE INTO task_batches(id, created_at) VALUES (?, ?)');
        const insertStatement = runtime.db.prepare(`INSERT INTO application_tasks
         (id, batch_id, execute, task_kind, company_key, company_name, job_key, job_title,
          job_location, job_url, job_selection_source, job_selection_evidence, mode, resume_material_id,
          additional_material_ids_json, profile_record_ids_json, answer_set_id, source,
          external_row_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`);
        const updateStatement = runtime.db.prepare(`UPDATE application_tasks
          SET batch_id = ?, execute = ?, task_kind = ?, company_key = ?, company_name = ?,
              job_key = ?, job_title = ?, job_location = ?, job_url = ?, job_selection_source = ?,
              job_selection_evidence = ?, mode = ?, resume_material_id = ?,
              additional_material_ids_json = ?, profile_record_ids_json = ?, answer_set_id = ?,
              updated_at = ?
        WHERE id = ?`);
        runtime.db.exec('BEGIN');
        try {
            for (const task of input.tasks) {
                if (task.batchId !== undefined) {
                    insertBatchStatement.run(task.batchId, now);
                }
                const existing = findStatement.get(task.source, task.externalRowId);
                if (existing === undefined) {
                    const id = newId('task');
                    insertStatement.run(id, task.batchId ?? null, task.execute ? 1 : 0, task.taskKind, task.companyKey ?? null, task.companyName, task.jobKey ?? null, task.jobTitle ?? null, task.jobLocation ?? null, task.jobUrl, task.jobSelectionSource ?? null, task.jobSelectionEvidence ?? null, task.mode, task.resumeMaterialId ?? null, JSON.stringify(task.additionalMaterialIds), JSON.stringify(task.profileRecordIds ?? []), task.answerSetId ?? null, task.source, task.externalRowId, now, now);
                    inserted.push(id);
                    continue;
                }
                if (sameAsExisting(existing, task)) {
                    unchanged.push(existing.id);
                    continue;
                }
                const changedIdentity = changedIdentityFields(existing, task);
                const history = hasHistoryStatement.get(existing.id, existing.id);
                if (history.value === 1 && changedIdentity.length > 0) {
                    throw new Error(`task_identity_locked: 任务 ${existing.id} 已有运行或提交记录，不能修改` +
                        ` ${changedIdentity.join('、')}；请使用新的 externalRowId 创建新任务`);
                }
                deleteAutoApprovalStatement.run(existing.id);
                invalidateSubmissionApprovalsStatement.run(existing.id);
                updateStatement.run(task.batchId ?? null, task.execute ? 1 : 0, task.taskKind, task.companyKey ?? null, task.companyName, task.jobKey ?? null, task.jobTitle ?? null, task.jobLocation ?? null, task.jobUrl, task.jobSelectionSource ?? null, task.jobSelectionEvidence ?? null, task.mode, task.resumeMaterialId ?? null, JSON.stringify(task.additionalMaterialIds), JSON.stringify(task.profileRecordIds ?? []), task.answerSetId ?? null, now, existing.id);
                updated.push(existing.id);
            }
            runtime.db.exec('COMMIT');
        }
        catch (error) {
            runtime.db.exec('ROLLBACK');
            throw error;
        }
    }
    finally {
        runtime.close();
    }
    return { inserted, updated, unchanged };
}
//# sourceMappingURL=upsert-application-tasks.js.map