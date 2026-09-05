/**
 * 每一页开头的一次决策：这一页该走配方，还是老老实实全局扫描。
 *
 * 规则文档：`docs/08 §5 §6`、`docs/13 D08`、修复清单 P1-6
 *
 * ## 固定顺序，不能跳级
 *
 * ```text
 * 识别 SaaS 家族
 *   → 加载站点配方 + 家族配方（公共的在前，本机候选在后）
 *   → 用关键锚点验证配方还适不适用
 *   → 配方对不上 → 全局语义扫描
 *   → 语义扫描也解决不了 → 才允许局部视觉兜底
 * ```
 *
 * 这个顺序的道理是**便宜且可解释的手段先上**。
 * 配方是查表，语义扫描是推理，视觉兜底是猜。反过来做既慢又不可审计。
 *
 * ## 三档结果各自意味着什么（`docs/08 §6`）
 *
 * | matchLevel | strategy | 含义 |
 * | --- | --- | --- |
 * | high | recipe_fast_path | 页面和配方对得上，字段含义直接查表 |
 * | partial | recipe_assisted_scan | 部分对得上，配方能帮忙但仍要扫描 |
 * | none | semantic_scan | 对不上，当成全新页面处理，顺便生成新候选 |
 *
 * **网站改版是常态。** 配方对不上就退回通用扫描，绝不硬套——
 * 硬套的后果是把答案填进错的框里，比多扫一次贵得多。
 */
import { loadRecipeChain } from "./load-recipe-chain.js";
import { loadLocalRecipeCandidates } from "./load-local-recipe-candidates.js";
import { matchPageRecipe } from "./match-page-recipe.js";
function hintsOf(recipe) {
    if (recipe === undefined) {
        return [];
    }
    return (recipe.fieldMappingHints ?? []).map((hint) => ({
        rawLabel: hint.rawLabel,
        canonicalKey: hint.canonicalKey,
        ...(hint.sectionPathContains === undefined
            ? {}
            : { sectionPathContains: hint.sectionPathContains }),
        ...(hint.note === undefined ? {} : { note: hint.note }),
        recipeKind: recipe.recipeKind,
        recipeKey: recipe.recipeKey,
        recipeStatus: recipe.status,
    }));
}
export function decidePageRecipe(request) {
    const family = request.familyDetection ?? request.pageSchema.saasFamily;
    const familyKey = family?.familyKey ?? 'unknown';
    // 1. 公共配方链：站点 → 家族 → 全局。人工审核过，最可信。
    const publicChain = loadRecipeChain({
        paths: request.paths,
        host: request.host,
        ...(familyKey === 'unknown' ? {} : { familyKey }),
    });
    // 2. 本机候选：这台机器自己上一次学到的，只服务这一个用户。
    const local = request.useLocalCandidates === false
        ? { chain: [], skipped: [] }
        : loadLocalRecipeCandidates({
            paths: request.paths,
            host: request.host,
            ...(familyKey === 'unknown' ? {} : { familyKey }),
        });
    // 公共的排在前面。`matchPageRecipe()` 同分时保留先出现的那一份，
    // 所以「人审过的胜过自己刚学的」是靠顺序保证的，不需要额外规则。
    const chain = [...publicChain.chain, ...local.chain];
    const skipped = [...publicChain.skipped, ...local.skipped];
    const matched = chain.length === 0
        ? { matchLevel: 'none', score: 0, matchedAnchors: [], missingAnchors: [] }
        : matchPageRecipe({ chain, pageSchema: request.pageSchema });
    const recipe = 'recipe' in matched ? matched.recipe : undefined;
    const hints = matched.matchLevel === 'none' ? [] : hintsOf(recipe);
    const strategy = matched.matchLevel === 'high'
        ? 'recipe_fast_path'
        : matched.matchLevel === 'partial'
            ? 'recipe_assisted_scan'
            : 'semantic_scan';
    const reason = chain.length === 0
        ? `没有可用配方（站点 ${request.host}，家族 ${familyKey}），走全局语义扫描`
        : matched.matchLevel === 'none'
            ? `${chain.length} 份配方都对不上这一页（最高分 ${matched.score}），走全局语义扫描`
            : `命中${recipe?.recipeKind === 'family' ? '家族' : recipe?.recipeKind === 'site' ? '站点' : '全局'}配方 ${recipe?.recipeKey ?? ''}` +
                `（${matched.matchLevel}，分数 ${matched.score}，锚点 ${matched.matchedAnchors.length}/${matched.matchedAnchors.length + matched.missingAnchors.length}）` +
                `，可用字段提示 ${hints.length} 条`;
    return {
        familyKey,
        familyConfidence: family?.confidence ?? 0,
        matchLevel: matched.matchLevel,
        strategy,
        ...(recipe === undefined ? {} : { recipe }),
        score: matched.score,
        matchedAnchors: matched.matchedAnchors,
        missingAnchors: matched.missingAnchors,
        hints,
        chainSize: publicChain.chain.length,
        localCandidateCount: local.chain.length,
        skipped,
        // 视觉兜底是最后一招。这里只表明「配方这一层没解决」，
        // 真正放行还要等全局语义扫描也失败——那一步在 fillPage 之后判断。
        visualFallbackAllowed: hints.length === 0,
        reason,
    };
}
//# sourceMappingURL=decide-page-recipe.js.map