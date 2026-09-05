/**
 * 生成待审核的公共知识变更。
 *
 * 规则文档：`docs/14_个人使用到开源的渐进成长流程.md §5`、`docs/10 §12.6`
 *
 * **这个函数绝不修改任何 tracked 文件。**
 * 它只产出「建议改哪个文件、改成什么、为什么」，
 * 由人看过之后再由阶段 15 的 `promoteKnowledgeProposal()` 执行。
 *
 * 这是纯函数：不写盘、不碰数据库，便于单独测。
 */
import { randomUUID } from 'node:crypto';
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
export function createKnowledgeProposals(input) {
    const now = input.now ?? new Date().toISOString();
    const newId = input.idFactory ?? defaultIdFactory;
    const proposals = [];
    // 1. 新字段候选 → 建议加进公共字段目录。
    for (const candidate of input.newCandidates ?? []) {
        proposals.push({
            id: newId('proposal'),
            kind: 'canonical_field',
            title: `新增公共字段候选：${candidate.proposedName}`,
            rationale: [
                `站点 ${input.siteHost ?? '未知'} 上出现了系统看不懂的问题。`,
                candidate.meaningSummary ?? '',
                '审核要点：这是这家公司特有的问题，还是多数公司都会问？',
                '答案应该属于哪个 scope？可以从简历推断，还是必须每次确认？',
            ]
                .filter((line) => line !== '')
                .join('\n'),
            targetPath: 'knowledge/field-catalog.yaml',
            payload: {
                proposedName: candidate.proposedName,
                proposedKey: candidate.proposedKey ?? null,
                sourceSiteFieldIds: candidate.sourceSiteFieldIds,
            },
            status: 'pending_review',
            createdAt: now,
        });
    }
    // 2. 配方候选 → 建议加进家族或站点配方。
    const recipe = input.recipeCandidate;
    if (recipe !== undefined) {
        const isFamily = recipe.recipeKind === 'family';
        proposals.push({
            id: newId('proposal'),
            kind: isFamily ? 'family_recipe' : 'site_recipe',
            title: `新增${isFamily ? '家族' : '站点'}配方候选：${recipe.recipeKey}`,
            rationale: [
                '这份配方来自真实投递中学到的操作经验。',
                '审核要点：里面只有「怎么找、怎么操作」，没有坐标、没有临时 ref、没有用户答案。',
                isFamily
                    ? '家族配方会影响所有使用同一招聘系统的公司，需要更谨慎。'
                    : '站点配方只影响这一个网站。',
            ].join('\n'),
            targetPath: isFamily
                ? `knowledge/families/${recipe.recipeKey}.yaml`
                : `knowledge/sites/${recipe.recipeKey}.yaml`,
            payload: recipe,
            status: 'pending_review',
            createdAt: now,
        });
    }
    // 3. 新识别出的 SaaS 家族 → 建议登记。
    const family = input.familyDetection;
    if (family !== undefined && family.familyKey !== 'unknown') {
        proposals.push({
            id: newId('proposal'),
            kind: 'family_recipe',
            title: `确认招聘 SaaS 家族：${family.familyKey}`,
            rationale: [
                `识别置信度 ${family.confidence}。`,
                '证据：',
                ...family.signals.map((signal) => `- ${signal.value}`),
                '审核要点：这些信号是技术特征，不是公司名。',
            ].join('\n'),
            targetPath: `knowledge/families/${family.familyKey}.yaml`,
            payload: { familyKey: family.familyKey, confidence: family.confidence },
            status: 'pending_review',
            createdAt: now,
        });
    }
    return { proposals };
}
//# sourceMappingURL=create-knowledge-proposals.js.map