const DEFAULT_MIN_SAMPLES = 5;
/** 历史成功率最多只能加这么多分。 */
const MAX_HISTORY_BONUS = 15;
/** 这些策略语义清晰，永远排在脆弱策略前面。 */
const CLEAR_SEMANTIC_STRATEGIES = new Set([
    'site_recipe',
    'family_recipe',
    'region_role_name',
    'role_name',
    'label',
    'aria_labelledby',
    'aria_label',
    'autocomplete',
]);
const FRAGILE_STRATEGIES = new Set([
    'css_fallback',
    'xpath_fallback',
    'nearby_text',
]);
export function rankLocatorCandidates(input) {
    const minSamples = input.minSamples ?? DEFAULT_MIN_SAMPLES;
    const statByStrategy = new Map((input.stats ?? []).map((stat) => [stat.strategy, stat]));
    const ranked = input.candidates.map((descriptor) => {
        const stat = statByStrategy.get(descriptor.strategy);
        const reasons = [`基础可靠度 ${descriptor.basePriority}`];
        let bonus = 0;
        if (stat !== undefined && stat.attempts >= minSamples) {
            const rate = stat.successes / stat.attempts;
            bonus = Math.round((rate - 0.5) * 2 * MAX_HISTORY_BONUS);
            reasons.push(`历史成功率 ${(rate * 100).toFixed(0)}%（${stat.attempts} 次样本）`);
        }
        else if (stat !== undefined) {
            reasons.push(`历史样本只有 ${stat.attempts} 次，不足 ${minSamples} 次，不参与调序`);
        }
        return {
            descriptor,
            score: descriptor.basePriority + bonus,
            explanation: reasons.join('；'),
        };
    });
    ranked.sort((a, b) => {
        // 硬规则：语义清晰的永远排在脆弱策略前面，历史数据改不了这一点。
        const aClear = CLEAR_SEMANTIC_STRATEGIES.has(a.descriptor.strategy);
        const bClear = CLEAR_SEMANTIC_STRATEGIES.has(b.descriptor.strategy);
        const aFragile = FRAGILE_STRATEGIES.has(a.descriptor.strategy);
        const bFragile = FRAGILE_STRATEGIES.has(b.descriptor.strategy);
        if (aClear && bFragile)
            return -1;
        if (bClear && aFragile)
            return 1;
        if (a.score !== b.score)
            return b.score - a.score;
        return b.descriptor.confidence - a.descriptor.confidence;
    });
    return ranked;
}
//# sourceMappingURL=rank-locator-candidates.js.map