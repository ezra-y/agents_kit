/**
 * 按「站点配方 → SaaS 家族配方 → 全局规则」加载。
 *
 * 规则文档：`docs/08_页面配方SaaS家族与跨公司复用.md §5`、`docs/13 D08`
 *
 * 优先级是硬规定：站点特例最优先，家族次之，通用兜底。
 * 找不到就返回空链，走通用扫描器，不硬套一份不适用的配方。
 *
 * 坏掉的配方文件**不静默吞掉**，进 `skipped` 并说明原因。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
export function parseRecipe(raw, sourcePath) {
    const data = raw;
    if (data === null || typeof data !== 'object') {
        throw new Error('recipe_file_invalid: 内容不是对象');
    }
    const kind = data.recipe_kind;
    if (kind !== 'family' && kind !== 'site' && kind !== 'global') {
        throw new Error(`recipe_file_invalid: recipe_kind=${String(kind)} 不合法`);
    }
    const key = data.recipe_key ?? data.host ?? data.site_key ?? data.family_key;
    if (typeof key !== 'string' || key === '') {
        throw new Error('recipe_file_invalid: 缺少 recipe_key / host / family_key');
    }
    return {
        version: data.version ?? 1,
        recipeKind: kind,
        recipeKey: key,
        status: (data.status ?? 'candidate'),
        ...(data.page_match === undefined
            ? {}
            : {
                pageMatch: {
                    ...(data.page_match.url_patterns === undefined
                        ? {}
                        : { urlPatterns: data.page_match.url_patterns }),
                    ...(data.page_match.required_anchors === undefined
                        ? {}
                        : { requiredAnchors: data.page_match.required_anchors }),
                },
            }),
        ...(data.field_mapping_hints === undefined
            ? {}
            : {
                fieldMappingHints: data.field_mapping_hints
                    .filter((hint) => typeof hint.raw_label === 'string' && typeof hint.canonical_key === 'string')
                    .map((hint) => ({
                    rawLabel: hint.raw_label,
                    canonicalKey: hint.canonical_key,
                    ...(hint.section_path_contains === undefined
                        ? {}
                        : { sectionPathContains: hint.section_path_contains }),
                    ...(hint.note === undefined ? {} : { note: hint.note }),
                })),
            }),
        ...(data.success_evidence === undefined
            ? {}
            : {
                successEvidence: {
                    ...(data.success_evidence.strong === undefined
                        ? {}
                        : {
                            strong: data.success_evidence.strong.map((item) => ({
                                kind: item.kind ?? 'unknown',
                                ...(item.value_any === undefined ? {} : { valueAny: item.value_any }),
                                ...(item.description === undefined ? {} : { description: item.description }),
                            })),
                        }),
                    ...(data.success_evidence.weak === undefined
                        ? {}
                        : {
                            weak: data.success_evidence.weak.map((item) => ({
                                kind: item.kind ?? 'unknown',
                                ...(item.pattern === undefined ? {} : { pattern: item.pattern }),
                                ...(item.description === undefined ? {} : { description: item.description }),
                            })),
                        }),
                    ...(data.success_evidence.decision_rule === undefined
                        ? {}
                        : { decisionRule: data.success_evidence.decision_rule }),
                },
            }),
        sourcePath,
    };
}
function readDirRecipes(dir, result, accept, rootForRelative) {
    if (!existsSync(dir)) {
        return [];
    }
    const found = [];
    for (const name of readdirSync(dir).sort()) {
        if (!name.endsWith('.yaml') && !name.endsWith('.yml')) {
            continue;
        }
        const full = path.join(dir, name);
        const relative = path.relative(rootForRelative, full).split(path.sep).join('/');
        try {
            const recipe = parseRecipe(parseYaml(readFileSync(full, 'utf8')), relative);
            if (accept(recipe)) {
                found.push(recipe);
            }
        }
        catch (error) {
            result.skipped.push({
                path: relative,
                reason: error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error),
            });
        }
    }
    return found;
}
export function loadRecipeChain(request) {
    const result = { chain: [], skipped: [] };
    const root = request.paths.root;
    // 1. 站点配方最优先。
    const siteRecipes = readDirRecipes(path.join(request.paths.publicKnowledgeDir, 'sites'), result, (recipe) => recipe.recipeKind === 'site' &&
        (request.host === undefined || recipe.recipeKey === request.host), root);
    // 2. 家族配方其次。
    const familyRecipes = readDirRecipes(path.join(request.paths.publicKnowledgeDir, 'families'), result, (recipe) => recipe.recipeKind === 'family' &&
        (request.familyKey === undefined || recipe.recipeKey === request.familyKey), root);
    // 3. 全局规则兜底。
    const globalRecipes = readDirRecipes(path.join(request.paths.publicKnowledgeDir, 'global'), result, (recipe) => recipe.recipeKind === 'global', root);
    result.chain = [...siteRecipes, ...familyRecipes, ...globalRecipes];
    return result;
}
//# sourceMappingURL=load-recipe-chain.js.map