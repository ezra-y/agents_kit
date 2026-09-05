/**
 * `applyctl knowledge`：查看可公开的知识资产，以及人工审核那道闸。
 *
 * 规则文档：`docs/08 §2`、`docs/14 §3 §5`
 *
 * `knowledge recipes` 只读 `knowledge/`，不碰还没脱敏的候选。
 *
 * `knowledge proposals` / `knowledge promote` 是**人工审核这一步的入口**。
 * 系统跑通一页会自动生成提案，但提案只躺在 `.local/learning/` 里；
 * 没有这两条命令，「审核后才能提升」保护的就只是「永远不提升」。
 *
 * 提升是唯一往 Git 跟踪目录写东西的路径，所以要求显式的审核人和结论，
 * 而且写之前还会再扫一遍个人信息。
 */
import { loadRecipeChain } from "../../recipes/load-recipe-chain.js";
import { loadLocalRecipeCandidates } from "../../recipes/load-local-recipe-candidates.js";
import { findPendingProposal, listPendingProposals, } from "../../learning/list-pending-proposals.js";
import { promoteKnowledgeProposal } from "../../learning/promote-knowledge-proposal.js";
import { describeError, failed, ok, readString, usageError } from "./shared.js";
export const knowledgeCommands = [
    {
        name: 'knowledge recipes',
        summary: '按站点和家族列出已生效的页面配方链。',
        usage: 'applyctl knowledge recipes [--host <host>] [--family <key>] [--json]',
        handler(context) {
            const host = readString(context.args.options, 'host');
            const familyKey = readString(context.args.options, 'family');
            const result = loadRecipeChain({
                paths: context.paths,
                ...(host === undefined ? {} : { host }),
                ...(familyKey === undefined ? {} : { familyKey }),
            });
            return ok({
                chain: result.chain.map((recipe) => ({
                    recipeKey: recipe.recipeKey,
                    recipeKind: recipe.recipeKind,
                    status: recipe.status,
                })),
                skipped: result.skipped,
            }, `配方链 ${result.chain.length} 条；跳过 ${result.skipped.length} 个文件。`);
        },
    },
    {
        name: 'knowledge candidates',
        summary: '列出本机自己学到、还没审核的候选配方。这些只在本机生效。',
        usage: 'applyctl knowledge candidates [--host <host>] [--family <key>] [--json]',
        handler(context) {
            const host = readString(context.args.options, 'host');
            const familyKey = readString(context.args.options, 'family');
            const result = loadLocalRecipeCandidates({
                paths: context.paths,
                ...(host === undefined ? {} : { host }),
                ...(familyKey === undefined ? {} : { familyKey }),
            });
            return ok({
                candidates: result.chain.map((recipe) => ({
                    recipeKey: recipe.recipeKey,
                    recipeKind: recipe.recipeKind,
                    hintCount: recipe.fieldMappingHints?.length ?? 0,
                    sourcePath: recipe.sourcePath ?? null,
                })),
                skipped: result.skipped,
            }, `本机候选配方 ${result.chain.length} 份；跳过 ${result.skipped.length} 个文件。` +
                '这些只在本机生效，进 knowledge/ 要走 knowledge promote。');
        },
    },
    {
        name: 'knowledge proposals',
        summary: '列出等人工审核的公共知识提案。只读，不改任何文件。',
        usage: 'applyctl knowledge proposals [--json]',
        handler(context) {
            const result = listPendingProposals(context.paths);
            return ok({
                proposals: result.proposals.map((item) => ({
                    id: item.proposal.id,
                    kind: item.proposal.kind,
                    title: item.proposal.title,
                    targetPath: item.proposal.targetPath,
                    rationale: item.proposal.rationale,
                    runId: item.runId,
                    summaryPath: item.summaryPath,
                })),
                skipped: result.skipped,
            }, result.proposals.length === 0
                ? '没有等审核的提案。'
                : `有 ${result.proposals.length} 条提案等你看。` +
                    '看完用 applyctl knowledge promote --proposal <id> --by <你的名字> --decision approve|reject。');
        },
    },
    {
        name: 'knowledge promote',
        summary: '审核一条提案。approve 才会写 knowledge/，而且写之前再扫一遍个人信息。',
        usage: 'applyctl knowledge promote --proposal <id> --by <审核人> ' +
            '--decision approve|reject [--note <备注>] [--json]',
        requiredOptions: ['proposal', 'by', 'decision'],
        handler(context) {
            const proposalId = readString(context.args.options, 'proposal');
            const reviewedBy = readString(context.args.options, 'by');
            const decision = readString(context.args.options, 'decision');
            const note = readString(context.args.options, 'note');
            if (proposalId === undefined || reviewedBy === undefined || decision === undefined) {
                return usageError('缺少 --proposal / --by / --decision。审核人和结论都不能省。');
            }
            if (decision !== 'approve' && decision !== 'reject') {
                return usageError(`--decision 只能是 approve 或 reject，收到 ${decision}。`);
            }
            // 拒绝也要留下原因，否则半年后没人记得当初为什么不通过。
            if (decision === 'reject' && (note === undefined || note.trim() === '')) {
                return failed('cli_command_failed', '拒绝时必须用 --note 写清楚原因。');
            }
            const found = findPendingProposal(context.paths, proposalId);
            if (found === undefined) {
                return failed('cli_command_failed', `找不到待审核提案 ${proposalId}。先跑 applyctl knowledge proposals 看看有哪些。`);
            }
            try {
                const result = promoteKnowledgeProposal({
                    paths: context.paths,
                    proposal: found.proposal,
                    reviewedBy,
                    decision,
                    ...(note === undefined ? {} : { note }),
                    now: context.now,
                });
                const message = result.blockedReason !== undefined
                    ? `提案 ${proposalId} 被拦下了：${result.blockedReason}。审核记录在 ${result.auditLogPath}。`
                    : decision === 'approve'
                        ? `已通过提案 ${proposalId}，写了 ${result.writtenFiles.length} 个文件：` +
                            `${result.writtenFiles.join('、')}。记得 git diff 看一眼再提交。`
                        : `已拒绝提案 ${proposalId}。审核记录在 ${result.auditLogPath}。`;
                return ok(result, message);
            }
            catch (error) {
                return failed('cli_command_failed', describeError(error));
            }
        },
    },
];
//# sourceMappingURL=knowledge.js.map