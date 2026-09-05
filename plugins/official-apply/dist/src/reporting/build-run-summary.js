import { openRuntimeDatabase } from "../storage/open-runtime-database.js";
function submissionStatusOf(row) {
    switch (row?.outcome) {
        case 'confirmed':
            return 'submitted_confirmed';
        case 'uncertain':
        case 'in_progress':
            return 'submission_uncertain';
        case 'failed_before_commit':
            return 'failed_before_commit';
        case 'blocked':
            return 'blocked';
        default:
            return 'not_attempted';
    }
}
function durationMs(start, end) {
    const value = Date.parse(end) - Date.parse(start);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}
export function buildRunSummary(input) {
    const runtime = openRuntimeDatabase({ paths: input.paths });
    try {
        const run = runtime.db
            .prepare(`SELECT t.company_name, t.job_title, r.state, r.started_at, r.updated_at, r.finished_at
           FROM application_runs r
           JOIN application_tasks t ON t.id = r.task_id
          WHERE r.id = ?`)
            .get(input.runId);
        if (run === undefined) {
            throw new Error(`run_summary_missing_run: ${input.runId}`);
        }
        const count = (sql) => runtime.db.prepare(sql).get(input.runId)?.value ?? 0;
        const fullScanCount = count(`SELECT COUNT(*) AS value FROM page_snapshots WHERE run_id = ? AND capture_mode = 'full'`);
        const questionCount = count(`SELECT COUNT(*) AS value FROM missing_answer_requests WHERE run_id = ?`);
        const failedControlCount = count(`SELECT COUNT(*) AS value
         FROM action_attempts
        WHERE run_id = ? AND outcome NOT IN ('success', 'skipped')`);
        const actionDurationMs = count(`SELECT COALESCE(SUM(duration_ms), 0) AS value FROM action_attempts WHERE run_id = ?`);
        const submission = runtime.db
            .prepare(`SELECT outcome
           FROM submission_attempts
          WHERE run_id = ?
          ORDER BY started_at DESC
          LIMIT 1`)
            .get(input.runId);
        const facts = input.runtime ?? {};
        const candidate = facts.candidate;
        return {
            schemaVersion: 1,
            runId: input.runId,
            company: run.company_name,
            jobTitle: run.job_title,
            executionRoute: facts.executionRoute ?? 'unknown',
            pageScriptId: facts.pageScriptId ?? null,
            fullScanCount,
            questionCount,
            failedControlCount,
            visualAttemptCount: facts.visualAttemptCount ?? 0,
            fillDurationMs: facts.fillDurationMs ?? actionDurationMs,
            totalDurationMs: durationMs(run.started_at, run.finished_at ?? run.updated_at),
            saveStatus: facts.saveStatus ?? 'not_attempted',
            submissionStatus: submissionStatusOf(submission),
            finalRunState: run.state,
            candidate: {
                id: candidate?.id ?? null,
                validationStatus: candidate?.validationStatus ?? null,
            },
            evidencePath: facts.evidencePath ?? null,
            generatedAt: input.now ?? new Date().toISOString(),
        };
    }
    finally {
        runtime.close();
    }
}
//# sourceMappingURL=build-run-summary.js.map