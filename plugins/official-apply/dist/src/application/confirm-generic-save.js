import { classifyEndpointCandidates } from "../site-adapters/discovery/classify-endpoints.js";
export function confirmGenericSave(observations) {
    const candidates = classifyEndpointCandidates(observations);
    const savePatterns = new Set(candidates
        .filter((candidate) => candidate.role === 'save_draft')
        .map((candidate) => `${candidate.method} ${candidate.requestUrlPattern}`));
    const confirmed = observations.filter((observation) => {
        const key = `${observation.method.toUpperCase()} ${observation.requestUrlPattern}`;
        return (savePatterns.has(key) &&
            observation.status >= 200 &&
            observation.status < 300 &&
            observation.responseIndicatesSuccess === true);
    });
    return {
        confirmed: confirmed.length > 0,
        responseUrlPatterns: [...new Set(confirmed.map((item) => item.requestUrlPattern))],
        statuses: [...new Set(confirmed.map((item) => item.status))],
    };
}
//# sourceMappingURL=confirm-generic-save.js.map