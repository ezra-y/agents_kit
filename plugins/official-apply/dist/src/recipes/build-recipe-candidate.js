/**
 * 把一页跑通之后学到的东西整理成一份候选配方。
 *
 * 规则文档：`docs/08 §6`、`docs/14 §5`、修复清单 P1-6
 *
 * ## 配方里放什么
 *
 * 只放两样：
 *
 * 1. **怎么认出这一页**（`pageMatch`）——URL 模式和关键锚点文字。
 * 2. **这一页的问题分别是什么意思**（`fieldMappingHints`）。
 *
 * 不放「填了什么」，不放坐标，不放这次运行才有效的 `runtimeRef`。
 * 这条不是建议：`saveRecipeCandidate()` 会再检查一次，命中就整份拒绝保存。
 *
 * ## 站点配方还是家族配方
 *
 * 认出了招聘 SaaS 家族就生成**家族配方**——同一套系统的不同公司，
 * 问法通常一模一样，这是跨公司复用真正省事的地方。
 *
 * 家族配方**不带 URL 模式**：每家公司的网址都不同，带上只会让别的公司匹配不上。
 * 站点配方才带 URL 模式。
 *
 * 认不出家族就只生成站点配方，不硬推广。
 */
import { createHash } from 'node:crypto';
/** 锚点最多取几条。取太多会让配方对页面的小改动过于敏感。 */
const MAX_ANCHORS = 6;
/** 锚点文字太长多半带了动态内容（日期、编号），不稳定。 */
const MAX_ANCHOR_LENGTH = 30;
/**
 * 家族置信度低于这个数就只当站点经验，不推广到整个家族。
 *
 * 0.4 对应「一条强证据，或者两条独立的弱证据」：
 * 域名命中一条就够（0.5）；DOM 标记 + 接口路径这样两条独立信号也够（0.2+0.2）。
 * 单独一条 DOM 标记（0.2）不够——那可能只是巧合。
 *
 * 门槛太高的后果不是「更安全」，是**家族配方永远生不出来**：
 * 用自己域名部署 SaaS 的公司拿不到域名信号，就永远只能是站点经验，
 * 跨公司复用这条路等于关死。
 */
const FAMILY_PROMOTION_THRESHOLD = 0.4;
function pathnameOf(rawUrl) {
    try {
        const pathname = new URL(rawUrl).pathname;
        return pathname === '' || pathname === '/' ? undefined : pathname;
    }
    catch {
        return undefined;
    }
}
/** 锚点要挑**稳定**的文字：必填字段的题干、步骤名。 */
function collectAnchors(fields, stepLabel) {
    const anchors = [];
    const seen = new Set();
    const push = (text) => {
        const trimmed = (text ?? '').trim();
        if (trimmed === '' || trimmed.length > MAX_ANCHOR_LENGTH || seen.has(trimmed)) {
            return;
        }
        // 纯数字多半是编号，换一次页就变了。
        if (/^\d+$/.test(trimmed)) {
            return;
        }
        seen.add(trimmed);
        anchors.push(trimmed);
    };
    push(stepLabel);
    // 必填字段优先：它们最不可能因为一次改版就消失。
    for (const field of fields.filter((item) => item.required)) {
        push(field.rawLabel);
    }
    for (const field of fields.filter((item) => !item.required)) {
        push(field.rawLabel);
    }
    return anchors.slice(0, MAX_ANCHORS);
}
export function buildRecipeCandidate(request) {
    const fieldByRef = new Map(request.pageSchema.fields.map((field) => [field.runtimeRef, field]));
    // 只有**已经确定含义**的字段才配进配方。
    // 拿不准的映射进配方等于把一次猜测固化成长期知识。
    const hints = [];
    const seenLabels = new Set();
    for (const mapping of request.mappings) {
        if (mapping.canonicalKey === undefined || mapping.requiresReview) {
            continue;
        }
        const field = fieldByRef.get(mapping.runtimeRef);
        if (field === undefined || field.rawLabel.trim() === '') {
            continue;
        }
        const dedupeKey = `${field.sectionPath.join('>')}|${field.rawLabel}`;
        if (seenLabels.has(dedupeKey)) {
            continue;
        }
        seenLabels.add(dedupeKey);
        hints.push({
            rawLabel: field.rawLabel,
            canonicalKey: mapping.canonicalKey,
            ...(field.sectionPath.length === 0 ? {} : { sectionPathContains: field.sectionPath }),
            note: `来自运行时的映射，置信度 ${mapping.confidence}`,
        });
    }
    if (hints.length === 0) {
        return { skippedReason: 'recipe_candidate_empty: 这一页没有确定含义的字段，不生成配方' };
    }
    const family = request.familyDetection;
    const promoteToFamily = request.preferKind === 'family' ||
        (request.preferKind === undefined &&
            family !== undefined &&
            family.familyKey !== 'unknown' &&
            family.confidence >= FAMILY_PROMOTION_THRESHOLD);
    const kind = promoteToFamily ? 'family' : 'site';
    const key = promoteToFamily ? (family?.familyKey ?? request.host) : request.host;
    const anchors = collectAnchors(request.pageSchema.fields, request.pageSchema.stepLabel);
    // 家族配方不带 URL：每家公司网址都不一样，带上反而匹配不上。
    const urlPattern = promoteToFamily ? undefined : pathnameOf(request.pageSchema.url);
    const recipe = {
        version: 1,
        recipeKind: kind,
        recipeKey: key,
        status: 'candidate',
        pageMatch: {
            ...(urlPattern === undefined ? {} : { urlPatterns: [urlPattern] }),
            ...(anchors.length === 0 ? {} : { requiredAnchors: anchors.map((text) => ({ text })) }),
        },
        fieldMappingHints: hints,
    };
    return { recipe };
}
/**
 * 同一个站点的多步骤表单，每一步要存成独立的一份配方。
 *
 * 用锚点算一个短指纹当文件名后缀。不用页码——用户可能从第 3 步续跑，
 * 页码对不上，锚点对得上。
 */
export function recipeVariantKey(recipe) {
    const anchors = (recipe.pageMatch?.requiredAnchors ?? [])
        .map((anchor) => anchor.text ?? anchor.name ?? '')
        .join('|');
    return createHash('sha256').update(anchors).digest('hex').slice(0, 8);
}
//# sourceMappingURL=build-recipe-candidate.js.map