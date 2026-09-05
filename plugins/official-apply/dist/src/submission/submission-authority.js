import { openRuntimeDatabase } from "../storage/open-runtime-database.js";
const EXPLICIT_JOB_SOURCES = new Set([
    'user_table',
    'user_link',
    'user_authorized_agent',
]);
function parseIds(value) {
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.filter((item) => typeof item === 'string' && item.trim() !== '')
            : [];
    }
    catch {
        return [];
    }
}
export function checkSubmissionAuthority(input) {
    const runtime = openRuntimeDatabase({ paths: input.paths });
    try {
        const task = runtime.db
            .prepare(`SELECT t.execute, t.task_kind, t.company_key, t.company_name, t.job_key, t.job_title,
                t.job_location,
                t.job_url, t.job_selection_source, t.job_selection_evidence,
                t.resume_material_id, t.additional_material_ids_json,
                t.profile_record_ids_json,
                a.approved_by
           FROM application_tasks t
           LEFT JOIN auto_submit_approvals a ON a.task_id = t.id
          WHERE t.id = ?`)
            .get(input.taskId);
        if (task === undefined) {
            return {
                allowed: false,
                blockers: [`submission_task_not_found: 找不到任务 ${input.taskId}`],
            };
        }
        const blockers = [];
        if (task.execute !== 1) {
            blockers.push('submission_execute_disabled: 任务已关闭执行，不能最终提交');
        }
        if (input.runId !== undefined) {
            const run = runtime.db
                .prepare('SELECT task_id FROM application_runs WHERE id = ?')
                .get(input.runId);
            if (run?.task_id !== input.taskId) {
                blockers.push('submission_run_task_mismatch: 当前运行不属于这条任务');
            }
        }
        if (task.task_kind !== 'job_application') {
            blockers.push('submission_task_kind_not_allowed: 公司简历任务不能执行最终提交');
        }
        if (task.company_name.trim() === '' ||
            task.job_title?.trim() === '' ||
            task.job_title === null ||
            task.job_url.trim() === '') {
            blockers.push('submission_job_facts_incomplete: 公司、岗位或岗位页面不完整');
        }
        const source = task.job_selection_source;
        const evidence = task.job_selection_evidence?.trim() ?? '';
        if (source === 'legacy_record') {
            blockers.push('submission_legacy_record_forbidden: 迁移记录缺少新的用户岗位证据，不能最终提交');
        }
        else if (!EXPLICIT_JOB_SOURCES.has(source) || evidence === '') {
            blockers.push('submission_job_evidence_incomplete: 岗位来源和证据不完整');
        }
        if (input.mode === 'auto' && task.approved_by === null) {
            blockers.push('submission_auto_approval_required: 自动提交尚未得到明确批准');
        }
        if (blockers.length > 0) {
            return { allowed: false, blockers };
        }
        const materialRefs = [
            ...(task.resume_material_id === null || task.resume_material_id.trim() === ''
                ? []
                : [task.resume_material_id]),
            ...parseIds(task.additional_material_ids_json),
        ].sort();
        const profileRecordIds = parseIds(task.profile_record_ids_json).sort();
        return {
            allowed: true,
            blockers: [],
            facts: {
                taskId: input.taskId,
                companyName: task.company_name,
                ...(task.company_key === null || task.company_key === ''
                    ? {}
                    : { companyKey: task.company_key }),
                jobTitle: task.job_title,
                jobLocation: task.job_location,
                ...(task.job_key === null || task.job_key === '' ? {} : { jobKey: task.job_key }),
                jobUrl: task.job_url,
                jobSelectionSource: source,
                jobSelectionEvidence: evidence,
                materialRefs,
                profileRecordIds,
                ...(task.approved_by === null ? {} : { autoApprovedBy: task.approved_by }),
            },
        };
    }
    finally {
        runtime.close();
    }
}
//# sourceMappingURL=submission-authority.js.map