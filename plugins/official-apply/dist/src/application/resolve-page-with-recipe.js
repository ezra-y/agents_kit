/**
 * 「先查配方，再理解字段」这一步的唯一实现。
 *
 * 规则文档：`docs/08 §6`、`docs/06 §4`、修复清单 P1-6
 *
 * CLI 主循环和 MCP 工具都调这一个函数。
 * 两边各写一遍的话，迟早有一边忘记查配方——那正是这次修复要治的病。
 *
 * 顺序是硬规定，写在这里只写一次：
 *
 * ```text
 * 识别 SaaS 家族（扫描时已完成）
 *   → 站点配方 + 家族配方
 *   → 验证关键锚点
 *   → 对不上就退回全局语义扫描
 * ```
 */
import { decidePageRecipe } from "../recipes/decide-page-recipe.js";
import { resolveCurrentPage } from "./resolve-current-page.js";
export function resolvePageWithRecipe(request) {
    const decision = decidePageRecipe({
        paths: request.paths,
        host: request.siteHost,
        pageSchema: request.pageSchema,
        ...(request.pageSchema.saasFamily === undefined
            ? {}
            : { familyDetection: request.pageSchema.saasFamily }),
    });
    const resolved = resolveCurrentPage({
        ...request,
        ...(decision.hints.length === 0 ? {} : { recipeHints: decision.hints }),
    });
    return { decision, resolved };
}
//# sourceMappingURL=resolve-page-with-recipe.js.map