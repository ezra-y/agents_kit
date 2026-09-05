/**
 * 按顺序执行：保存官网字段 → 字段映射 → 答案解析。
 *
 * 规则文档：
 * - `docs/01_产品定义与完整运行流程.md` 阶段 D-F
 * - `docs/06_函数接口与执行循环.md §4`
 *
 * 顺序不能颠倒（`docs/13 D03`）：
 *
 * ```text
 * 发现字段 → 理解字段 → 查找答案 → 汇总缺失 → 填写
 * ```
 *
 * 阶段 6 只做到「理解字段」。答案解析是阶段 7 的 `resolveAnswers()`，
 * 接上之后从这里调用，不在别处复制一份流程。
 */
import { persistSiteFields } from "../fields/persist-site-fields.js";
import { mapSiteFields, importFieldCatalog } from "../fields/map-site-fields.js";
import { createFieldCandidate } from "../fields/create-field-candidate.js";
export function resolveCurrentPage(request) {
    const now = request.now ?? new Date().toISOString();
    // 公共目录是 YAML，运行期缓存要跟着它更新，映射的外键才有效。
    importFieldCatalog(request.paths, now);
    const persisted = persistSiteFields({
        paths: request.paths,
        runId: request.runId,
        ...(request.taskId === undefined ? {} : { taskId: request.taskId }),
        siteHost: request.siteHost,
        ...(request.companyKey === undefined ? {} : { companyKey: request.companyKey }),
        ...(request.companyName === undefined ? {} : { companyName: request.companyName }),
        pageSchema: request.pageSchema,
        now,
        ...(request.idFactory === undefined ? {} : { idFactory: request.idFactory }),
    });
    // 配方提示排在语义打分之前：查表比推理便宜，也比推理稳。
    // 提示对不上的字段照旧走全局语义扫描，不会因为有配方就不管了。
    const mapped = mapSiteFields({
        paths: request.paths,
        runId: request.runId,
        siteId: persisted.siteId,
        fields: request.pageSchema.fields,
        observationIdByRuntimeRef: persisted.observationIdByRuntimeRef,
        ...(request.recipeHints === undefined ? {} : { recipeHints: request.recipeHints }),
        now,
        ...(request.idFactory === undefined ? {} : { idFactory: request.idFactory }),
    });
    const { mappings, newCandidates } = mapped;
    // 认不出来的字段落成候选提案，等人工审核，不自动进公共目录。
    const savedCandidates = [];
    for (const mapping of mappings) {
        if (mapping.status !== 'unresolved') {
            continue;
        }
        const field = request.pageSchema.fields.find((item) => item.runtimeRef === mapping.runtimeRef);
        if (field === undefined) {
            continue;
        }
        const result = createFieldCandidate({
            paths: request.paths,
            siteField: field,
            ...(mapping.siteFieldId === undefined ? {} : { siteFieldId: mapping.siteFieldId }),
            siteHost: request.siteHost,
            reason: `映射置信度 ${mapping.confidence} 低于阈值，需要人工确认含义`,
            now,
            ...(request.idFactory === undefined ? {} : { idFactory: request.idFactory }),
        });
        savedCandidates.push(result.candidate);
    }
    void newCandidates;
    return {
        siteId: persisted.siteId,
        persisted,
        mappings,
        newCandidates: savedCandidates,
        requiresReviewRuntimeRefs: mappings
            .filter((mapping) => mapping.requiresReview)
            .map((mapping) => mapping.runtimeRef),
        recipeHintFieldCount: mapped.recipeHintFieldCount,
        scoredFieldCount: mapped.scoredFieldCount,
        scoreCallCount: mapped.scoreCallCount,
    };
}
//# sourceMappingURL=resolve-current-page.js.map