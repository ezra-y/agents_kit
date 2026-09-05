import { classifyEndpointCandidates } from "../site-adapters/discovery/classify-endpoints.js";
export function collectSubmissionNetworkEvidence(observations) {
    const candidates = classifyEndpointCandidates(observations);
    const finalPatterns = new Set(candidates
        .filter((candidate) => candidate.role === 'final_submit')
        .map((candidate) => `${candidate.method} ${candidate.requestUrlPattern}`));
    const evidence = [];
    for (const observation of observations) {
        const key = `${observation.method.toUpperCase()} ${observation.requestUrlPattern}`;
        if (!finalPatterns.has(key) ||
            observation.status < 200 ||
            observation.status >= 300) {
            continue;
        }
        evidence.push({
            kind: 'network_response',
            valueRedacted: observation.responseIndicatesSuccess === true
                ? `提交接口 HTTP ${observation.status}，响应明确成功`
                : `提交接口 HTTP ${observation.status}`,
            confidence: observation.responseIndicatesSuccess === true ? 0.92 : 0.65,
        });
    }
    return evidence;
}
//# sourceMappingURL=collect-submission-network-evidence.js.map