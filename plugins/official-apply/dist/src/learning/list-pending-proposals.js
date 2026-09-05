/**
 * 列出还没人审核过的公共知识提案。
 *
 * 规则文档：`docs/14 §5`、修复清单 P1-6
 *
 * ## 为什么需要它
 *
 * `captureLearning()` 每跑通一页就生成提案，写进 `.local/learning/runs/`。
 * 但提案写在那儿没人看得见，等于没有——「只有审核后才提升」这条规则
 * 如果没有一条能让人真的审核的路，它保护的就只是「永远不提升」。
 *
 * 这个函数只**读** `.local/`，一个字都不往 tracked 目录写。
 * 真正的写入是 `promoteKnowledgeProposal()`，那里需要显式的审核结论。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
export function listPendingProposals(paths) {
    const result = { proposals: [], skipped: [] };
    const dir = path.join(paths.learningDir, 'runs');
    if (!existsSync(dir)) {
        return result;
    }
    const seen = new Set();
    for (const name of readdirSync(dir).sort()) {
        if (!name.endsWith('.json')) {
            continue;
        }
        const relative = `.local/learning/runs/${name}`;
        try {
            const parsed = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
            for (const proposal of parsed.proposals ?? []) {
                if (proposal.status !== 'pending_review' || seen.has(proposal.id)) {
                    continue;
                }
                seen.add(proposal.id);
                result.proposals.push({
                    proposal,
                    runId: parsed.runId ?? '未知运行',
                    summaryPath: relative,
                });
            }
        }
        catch (error) {
            result.skipped.push({
                path: relative,
                reason: error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error),
            });
        }
    }
    return result;
}
/** 按 id 精确找一条。找不到就返回 undefined，不模糊匹配。 */
export function findPendingProposal(paths, proposalId) {
    return listPendingProposals(paths).proposals.find((item) => item.proposal.id === proposalId);
}
//# sourceMappingURL=list-pending-proposals.js.map