/**
 * 读取本机自己学到的候选配方（`.local/learning/recipes/`）。
 *
 * 规则文档：`docs/08 §6`、`docs/14 §5`、修复清单 P1-6
 *
 * ## 为什么要和公共配方分开读
 *
 * 公共配方在 `knowledge/`，是进 Git、给所有人用的东西，所以必须人工审核过。
 * 本机候选在 `.local/learning/`，是**这台机器自己上一次跑出来的经验**，
 * 只服务这一个用户，不进 Git，也不影响别人。
 *
 * 两者都能用来省事，但可信度不一样，所以在决策时要分开算：
 *
 * ```text
 * 公共配方（人审过） > 本机候选（自己刚学的） > 什么都没有 → 全局语义扫描
 * ```
 *
 * 把候选直接塞进 `knowledge/` 是不行的——那等于跳过审核发布知识。
 * 但拿自己刚学的经验省掉自己下一次的重复劳动，是完全正当的。
 *
 * 坏掉的候选文件**不静默吞掉**，进 `skipped`。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
/** 候选文件是 `saveRecipeCandidate()` 写出去的 JSON，字段名已经是 camelCase。 */
function parseCandidate(raw, sourcePath) {
    const data = raw;
    if (data === null || typeof data !== 'object') {
        throw new Error('recipe_candidate_invalid: 内容不是对象');
    }
    const kind = data.recipeKind;
    if (kind !== 'family' && kind !== 'site' && kind !== 'global') {
        throw new Error(`recipe_candidate_invalid: recipeKind=${String(kind)} 不合法`);
    }
    if (typeof data.recipeKey !== 'string' || data.recipeKey === '') {
        throw new Error('recipe_candidate_invalid: 缺少 recipeKey');
    }
    return {
        ...data,
        version: data.version ?? 1,
        recipeKind: kind,
        recipeKey: data.recipeKey,
        // 本机候选永远是 candidate。文件里写别的一律不认——
        // 提升成 verified 只能走 promoteKnowledgeProposal()。
        status: 'candidate',
        sourcePath,
    };
}
export function loadLocalRecipeCandidates(request) {
    const result = { chain: [], skipped: [] };
    const dir = path.join(request.paths.learningDir, 'recipes');
    if (!existsSync(dir)) {
        return result;
    }
    const site = [];
    const family = [];
    for (const name of readdirSync(dir).sort()) {
        if (!name.endsWith('.json')) {
            continue;
        }
        const full = path.join(dir, name);
        const relative = `.local/learning/recipes/${name}`;
        let recipe;
        try {
            recipe = parseCandidate(JSON.parse(readFileSync(full, 'utf8')), relative);
        }
        catch (error) {
            result.skipped.push({
                path: relative,
                reason: error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error),
            });
            continue;
        }
        if (recipe.recipeKind === 'site') {
            // 站点候选只能用在同一个站点上。换一家公司就不算数。
            if (request.host === undefined || recipe.recipeKey === request.host) {
                site.push(recipe);
            }
            continue;
        }
        if (recipe.recipeKind === 'family') {
            // 家族候选是跨公司复用的关键：同一套招聘系统，问法通常一样。
            if (request.familyKey === undefined || recipe.recipeKey === request.familyKey) {
                family.push(recipe);
            }
        }
        // global 候选不参与。通用规则必须人工审核，不能靠一次运行推广到所有网站。
    }
    result.chain = [...site, ...family];
    return result;
}
//# sourceMappingURL=load-local-recipe-candidates.js.map