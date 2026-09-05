const HIGH_THRESHOLD = 0.8;
const PARTIAL_THRESHOLD = 0.4;
function pageText(schema) {
    return [
        schema.title ?? '',
        schema.stepLabel ?? '',
        ...schema.regions.map((region) => region.textAnchor ?? ''),
        ...schema.fields.map((field) => field.rawLabel),
        ...schema.actions.map((action) => action.label),
    ].join(' ');
}
function urlMatches(recipe, url) {
    const patterns = recipe.pageMatch?.urlPatterns;
    if (patterns === undefined || patterns.length === 0) {
        return undefined;
    }
    return patterns.some((pattern) => url.includes(pattern));
}
export function scoreRecipeAgainstPage(recipe, schema) {
    const text = pageText(schema);
    const anchors = recipe.pageMatch?.requiredAnchors ?? [];
    const matchedAnchors = [];
    const missingAnchors = [];
    for (const anchor of anchors) {
        const needle = anchor.text ?? anchor.name ?? '';
        if (needle === '') {
            continue;
        }
        if (text.includes(needle)) {
            matchedAnchors.push(needle);
        }
        else {
            missingAnchors.push(needle);
        }
    }
    const urlHit = urlMatches(recipe, schema.url);
    // 锚点是主要依据；URL 只做加减分。没有锚点时只能靠 URL。
    const anchorTotal = matchedAnchors.length + missingAnchors.length;
    let score = anchorTotal === 0 ? 0 : matchedAnchors.length / anchorTotal;
    if (urlHit === true) {
        score = anchorTotal === 0 ? 0.6 : Math.min(1, score + 0.2);
    }
    else if (urlHit === false) {
        score = Math.max(0, score - 0.3);
    }
    return { score: Number(score.toFixed(3)), matchedAnchors, missingAnchors };
}
/** 站点特例最贴近当前网站，家族次之，全局兜底。 */
function kindPriority(recipe) {
    switch (recipe.recipeKind) {
        case 'site':
            return 3;
        case 'family':
            return 2;
        default:
            return 1;
    }
}
export function matchPageRecipe(input) {
    let best;
    for (const recipe of input.chain) {
        const scored = scoreRecipeAgainstPage(recipe, input.pageSchema);
        if (best === undefined) {
            best = { recipe, ...scored };
            continue;
        }
        // 分数优先；同分时按「站点 → 家族 → 全局」的固定优先级选（`docs/13 D08`）。
        if (scored.score > best.score ||
            (scored.score === best.score && kindPriority(recipe) > kindPriority(best.recipe))) {
            best = { recipe, ...scored };
        }
    }
    if (best === undefined || best.score < PARTIAL_THRESHOLD) {
        return {
            matchLevel: 'none',
            score: best?.score ?? 0,
            matchedAnchors: best?.matchedAnchors ?? [],
            missingAnchors: best?.missingAnchors ?? [],
        };
    }
    return {
        recipe: best.recipe,
        matchLevel: best.score >= HIGH_THRESHOLD ? 'high' : 'partial',
        score: best.score,
        matchedAnchors: best.matchedAnchors,
        missingAnchors: best.missingAnchors,
    };
}
//# sourceMappingURL=match-page-recipe.js.map