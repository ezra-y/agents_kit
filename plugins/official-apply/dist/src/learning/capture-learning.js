/**
 * 汇总一次运行学到的东西。
 *
 * 规则文档：`docs/06_函数接口与执行循环.md §3.16`、`docs/14 §3`
 *
 * 学到的东西一律先进 `.local/learning/`，**不直接改公开知识**。
 * 提升路径是（`docs/10 §12.6`）：
 *
 * ```text
 * 真实运行 → .local/learning/ → 脱敏 → 人工 Review
 * → promoteKnowledgeProposal() → knowledge/ → Git
 * ```
 *
 * 汇总里只写结构和统计，不写用户答案。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { isInsideLocalRoot, toRepoRelative } from "../config/paths.js";
import { saveRecipeCandidate } from "../recipes/save-recipe-candidate.js";
import { createKnowledgeProposals } from "./create-knowledge-proposals.js";
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
export function captureLearning(request) {
    const now = request.now ?? new Date().toISOString();
    const newId = request.idFactory ?? defaultIdFactory;
    const dir = path.join(request.paths.learningDir, 'runs');
    if (!isInsideLocalRoot(request.paths, dir)) {
        throw new Error(`learning_outside_local: ${dir} 不在 ${request.paths.localRoot} 内`);
    }
    mkdirSync(dir, { recursive: true });
    // 配方候选走独立的检查（不含坐标、不含用户答案）。
    let recipeCandidatePath;
    if (request.recipeCandidate !== undefined) {
        const saved = saveRecipeCandidate({
            paths: request.paths,
            recipe: request.recipeCandidate,
            runId: request.runId,
            ...(request.siteId === undefined ? {} : { siteId: request.siteId }),
            ...(request.variantKey === undefined ? {} : { variantKey: request.variantKey }),
            now,
            idFactory: newId,
        });
        if (saved.rejected === undefined) {
            recipeCandidatePath = saved.candidatePath;
        }
    }
    const mappings = request.mappings ?? [];
    const newMappingCount = mappings.filter((mapping) => mapping.canonicalKey !== undefined && !mapping.requiresReview).length;
    const { proposals } = createKnowledgeProposals({
        runId: request.runId,
        ...(request.siteHost === undefined ? {} : { siteHost: request.siteHost }),
        ...(request.recipeCandidate === undefined ? {} : { recipeCandidate: request.recipeCandidate }),
        ...(request.familyDetection === undefined ? {} : { familyDetection: request.familyDetection }),
        now,
        idFactory: newId,
    });
    // 只写结构和统计。字段的 label 是官网原题，可以留；用户答案一个字都不写。
    const summary = {
        version: 1,
        runId: request.runId,
        capturedAt: now,
        site: request.siteHost ?? null,
        pageType: request.pageSchema.pageType,
        stepLabel: request.pageSchema.stepLabel ?? null,
        fields: request.pageSchema.fields.map((field) => ({
            sectionPath: field.sectionPath,
            rawLabel: field.rawLabel,
            controlKind: field.controlKind,
            required: field.required,
            optionLabels: field.options.map((option) => option.rawLabel),
            fieldFingerprint: field.fieldFingerprint,
        })),
        mappings: mappings.map((mapping) => ({
            runtimeRef: mapping.runtimeRef,
            canonicalKey: mapping.canonicalKey ?? null,
            status: mapping.status,
            confidence: mapping.confidence,
            requiresReview: mapping.requiresReview,
        })),
        networkCandidates: (request.networkCandidates ?? []).map((candidate) => ({
            requestUrlPattern: candidate.requestUrlPattern,
            detectedKeys: candidate.detectedKeys,
            confidence: candidate.confidence,
        })),
        familyDetection: request.familyDetection ?? null,
        recipeCandidatePath: recipeCandidatePath ?? null,
        proposals,
    };
    // 一次运行会走过好几页。不加区分的话后一页会把前一页的记录盖掉，
    // 排查「第 2 步为什么填错」时就没有证据了。
    const file = path.join(dir, request.variantKey === undefined
        ? `${request.runId}.json`
        : `${request.runId}-${request.variantKey.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
    writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return {
        summaryPath: toRepoRelative(request.paths, file),
        newFieldCount: request.pageSchema.fields.length,
        newMappingCount,
        networkCandidateCount: request.networkCandidates?.length ?? 0,
        proposalCount: proposals.length,
        ...(recipeCandidatePath === undefined ? {} : { recipeCandidatePath }),
        // 汇总里有官网原题，可能含公司专属信息；进公开目录前必须再脱敏一次。
        redactionRequired: true,
    };
}
//# sourceMappingURL=capture-learning.js.map