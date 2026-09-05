import { createHash } from 'node:crypto';
export function computeSubmissionIdempotencyKey(input) {
    const digest = createHash('sha256')
        .update(JSON.stringify({
        taskId: input.taskId,
        runId: input.runId,
        pageSchema: input.pageSchema,
        commitAction: input.commitAction ?? null,
    }))
        .digest('hex');
    return `${input.taskId}|${input.runId}|${digest}`;
}
//# sourceMappingURL=compute-submission-idempotency-key.js.map