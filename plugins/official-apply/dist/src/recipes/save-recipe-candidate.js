/**
 * 把新经验先保存到 `.local/learning/`，**不直接改公共配方**。
 *
 * 规则文档：`docs/08 §6`、`docs/14 §8`、`docs/13 D05`
 *
 * 两道闸：
 * 1. **配方里不允许出现坐标、运行期 ref、长 XPath。** 出现就拒绝保存。
 * 2. **配方里不允许出现用户答案。** 配方回答「怎么找、怎么操作」，
 *    不回答「填什么」。
 *
 * 通过检查的候选只进 `.local/learning/recipes/`，
 * 等人工审核后由阶段 15 的 `promoteKnowledgeProposal()` 提升到 `knowledge/`。
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isInsideLocalRoot, toRepoRelative } from "../config/paths.js";
import { openKnowledgeDatabase } from "../storage/open-knowledge-database.js";
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
/** 明确禁止出现在长期配方里的东西（`docs/13 D09`、`R12`）。 */
const FORBIDDEN_LOCATOR_PATTERNS = [
    // 序列化之后引号会被转义成 \"，所以两种写法都要认。
    // 键名两侧的引号必须存在，否则 `basePriority": 130` 里的 y 也会被误判。
    ['fixed_coordinates', /\\?"(?:x|y|left|top)\\?"\s*:\s*-?\d/],
    ['coordinate_words', /(?:固定坐标|clientX|clientY|pageX|pageY|offsetX|offsetY)/i],
    ['runtime_ref', /\b(?:e\d{1,4}|ref_\d+|main#\d+)\b/],
    ['long_xpath', /\/html\/|\/\/\*\[|(?:\/[a-z]+\[\d+\]){3,}/i],
    ['nth_child_chain', /nth-child\(\d+\)[^"]*nth-child\(\d+\)/],
];
/** 用户答案的特征。配方里出现这些就说明混进了个人内容。 */
const PERSONAL_VALUE_PATTERNS = [
    ['mainland_mobile', /(?<![\d*])1[3-9]\d{9}(?![\d*])/],
    ['email_value', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
    ['id_number', /(?<![\dXx])\d{17}[\dXx](?![\dXx])/],
    ['cookie_or_token', /(?:set-)?cookie\s*[:=]|authorization\s*[:=]\s*(?:bearer|basic)/i],
];
/** 检查一份配方能不能保存。返回拒绝原因，或 undefined 表示通过。 */
export function inspectRecipeForForbiddenContent(recipe) {
    const serialized = JSON.stringify(recipe);
    for (const [name, pattern] of FORBIDDEN_LOCATOR_PATTERNS) {
        if (pattern.test(serialized)) {
            return `recipe_contains_forbidden_locator: 命中 ${name}，配方不保存脆弱定位`;
        }
    }
    for (const [name, pattern] of PERSONAL_VALUE_PATTERNS) {
        if (pattern.test(serialized)) {
            return `recipe_contains_personal_value: 命中 ${name}，配方不保存用户答案`;
        }
    }
    return undefined;
}
export function saveRecipeCandidate(request) {
    const now = request.now ?? new Date().toISOString();
    const newId = request.idFactory ?? defaultIdFactory;
    const rejected = inspectRecipeForForbiddenContent(request.recipe);
    if (rejected !== undefined) {
        return { candidatePath: '', rejected };
    }
    const dir = path.join(request.paths.learningDir, 'recipes');
    if (!isInsideLocalRoot(request.paths, dir)) {
        throw new Error(`learning_outside_local: ${dir} 不在 ${request.paths.localRoot} 内`);
    }
    mkdirSync(dir, { recursive: true });
    const safeKey = request.recipe.recipeKey.replace(/[^A-Za-z0-9._-]/g, '_');
    // 多步骤表单的每一步是一份独立配方。没有 variantKey 的话，
    // 第 2 步会把第 1 步整份覆盖掉，学到的东西越跑越少。
    const variant = request.variantKey === undefined
        ? ''
        : `-${request.variantKey.replace(/[^A-Za-z0-9._-]/g, '_')}`;
    const file = path.join(dir, `${request.recipe.recipeKind}-${safeKey}${variant}.json`);
    const body = {
        ...request.recipe,
        status: 'candidate',
        capturedAt: now,
        ...(request.runId === undefined ? {} : { sourceRunId: request.runId }),
    };
    writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    const candidatePath = toRepoRelative(request.paths, file);
    const registryId = registerRecipe(request, candidatePath, body, now, newId);
    return { candidatePath, ...(registryId === undefined ? {} : { registryId }) };
}
/** 在 knowledge 库里登记一条候选，方便统计成功率。 */
function registerRecipe(request, candidatePath, body, now, newId) {
    let handle;
    try {
        handle = openKnowledgeDatabase({ paths: request.paths });
    }
    catch (error) {
        if (error instanceof Error && error.message.startsWith('database_not_migrated')) {
            return undefined;
        }
        throw error;
    }
    try {
        const id = newId('recipe');
        const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 32);
        // 唯一键是 (kind, key, version)，而多步骤表单的每一步都是同一个 key。
        // 把 variantKey 挂在版本号后面，每一步才有自己的一行统计。
        const version = request.variantKey === undefined
            ? String(request.recipe.version)
            : `${request.recipe.version}#${request.variantKey}`;
        const kind = request.recipe.recipeKind === 'global' ? 'site' : request.recipe.recipeKind;
        // 重复保存同一份配方时**只更新内容，不动成功失败计数**。
        // 原来的 INSERT OR REPLACE 每存一次就把统计清零，
        // 于是「这份配方到底好不好用」永远没有数据。
        handle.db
            .prepare(`INSERT INTO recipe_registry
           (id, recipe_kind, recipe_key, version, file_path, content_hash, status,
            site_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?)
         ON CONFLICT(recipe_kind, recipe_key, version) DO UPDATE SET
           file_path = excluded.file_path,
           content_hash = excluded.content_hash,
           site_id = COALESCE(excluded.site_id, recipe_registry.site_id),
           updated_at = excluded.updated_at`)
            .run(id, kind, request.recipe.recipeKey, version, candidatePath, hash, request.siteId ?? null, now, now);
        // 冲突时保留的是原来那一行，id 不是刚生成的那个。要如实返回。
        const row = handle.db
            .prepare('SELECT id FROM recipe_registry WHERE recipe_kind = ? AND recipe_key = ? AND version = ?')
            .get(kind, request.recipe.recipeKey, version);
        return row?.id ?? id;
    }
    finally {
        handle.close();
    }
}
//# sourceMappingURL=save-recipe-candidate.js.map