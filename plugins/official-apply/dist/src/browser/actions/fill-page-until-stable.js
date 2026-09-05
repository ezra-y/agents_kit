import { fillPage } from "./fill-page.js";
import { buildActionPlan } from "./build-action-plan.js";
/**
 * 同一页最多重扫几轮。
 *
 * 条件字段可能一层套一层，但真实表单不会深到哪里去。
 * 配合状态哈希去重，足够防住死循环。
 */
export const MAX_FILL_ROUNDS = 6;
/**
 * 页面状态指纹：有哪些可见字段、各自当前值是什么。
 *
 * 用来判断上一轮填写有没有真的让页面变化。没变还接着填就是死循环。
 */
export function pageStateKey(schema) {
    return schema.fields
        .filter((field) => field.visible)
        .map((field) => `${field.runtimeRef}=${String(field.currentValue ?? '')}`)
        .sort()
        .join('|');
}
export async function fillPageUntilStable(request) {
    const now = request.now ?? new Date().toISOString();
    let schema = request.pageSchema;
    let resolved = request.resolved;
    let unresolved = request.unresolvedRuntimeRefs ?? [];
    const results = [];
    const requiresVisualFallback = [];
    let toolRoundTrips = 0;
    let rounds = 0;
    let stoppedForQuestions = false;
    // 记住每一轮之后的页面状态。重复出现说明填不动了。
    const seenStates = new Set([pageStateKey(schema)]);
    for (let round = 0; round < MAX_FILL_ROUNDS; round += 1) {
        rounds = round + 1;
        const filled = await fillPage({
            page: request.page,
            ...(request.stats === undefined ? {} : { stats: request.stats }),
            ...(request.recordAttempts === undefined
                ? {}
                : { recordAttempts: request.recordAttempts }),
        }, {
            runId: request.runId,
            plan: buildActionPlan({
                runId: request.runId,
                snapshotId: schema.snapshotId,
                resolved,
                pageSchema: schema,
                unresolvedRuntimeRefs: unresolved,
                now,
            }),
            pageSchema: schema,
        });
        results.push(...filled.results);
        requiresVisualFallback.push(...filled.requiresVisualFallback);
        toolRoundTrips += filled.toolRoundTrips;
        if (!filled.requiresRescan) {
            break;
        }
        // 页面结构变了：重扫，看看是不是真的出现了新东西。
        const rescanned = await request.rescan();
        const stateKey = pageStateKey(rescanned);
        schema = rescanned;
        if (seenStates.has(stateKey)) {
            // 页面其实没变。再填一轮也是同样结果。
            break;
        }
        seenStates.add(stateKey);
        const next = await request.reresolve(rescanned);
        if (next.missingCount > 0) {
            // 条件字段带出了新问题。先问人，不硬填。
            stoppedForQuestions = true;
            break;
        }
        resolved = next.resolved;
        unresolved = next.unresolvedRuntimeRefs;
    }
    return {
        results,
        succeeded: results.filter((item) => item.outcome === 'success'),
        failed: results.filter((item) => item.outcome !== 'success'),
        finalSchema: schema,
        rounds,
        stoppedForQuestions,
        requiresVisualFallback,
        toolRoundTrips,
    };
}
//# sourceMappingURL=fill-page-until-stable.js.map