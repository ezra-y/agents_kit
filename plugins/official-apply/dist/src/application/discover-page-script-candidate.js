import { buildPageScriptCandidate } from "../site-adapters/discovery/build-page-script-candidate.js";
import { classifyEndpointCandidates } from "../site-adapters/discovery/classify-endpoints.js";
import { savePageScriptCandidate } from "../site-adapters/discovery/save-page-script-candidate.js";
/**
 * 未知页面解析完成后生成本机 PageScript 草稿。
 *
 * 草稿只保存结构和字段 key，状态固定为 unverified。它不会在当前运行或下一次
 * 打开时自动执行；真实站填写、读回和保存全部通过后才能提升。
 */
export function discoverPageScriptCandidate(request) {
    const endpoints = classifyEndpointCandidates(request.observations);
    const built = buildPageScriptCandidate({
        host: request.host,
        pageSchema: request.pageSchema,
        mappings: request.mappings,
        endpoints,
        sourceRunId: request.runId,
        now: request.now,
    });
    if (built.spec === undefined) {
        return {
            generated: false,
            validationStatus: 'unverified',
            endpointCandidates: endpoints,
            skippedFields: built.skipped,
            reason: built.skippedReason ?? '没有生成候选',
        };
    }
    const saved = savePageScriptCandidate(request.paths, built.spec);
    return {
        generated: saved.rejected === undefined,
        validationStatus: built.spec.validationStatus,
        candidateId: built.spec.id,
        candidatePath: saved.candidatePath,
        endpointCandidates: endpoints,
        skippedFields: built.skipped,
        ...(saved.rejected === undefined ? {} : { reason: saved.rejected }),
    };
}
//# sourceMappingURL=discover-page-script-candidate.js.map