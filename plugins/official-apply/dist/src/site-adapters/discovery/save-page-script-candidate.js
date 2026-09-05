import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isInsideLocalRoot, toRepoRelative } from "../../config/paths.js";
import { createConfiguredPageScript } from "../generated/create-configured-page-script.js";
const PERSONAL_VALUE_PATTERNS = [
    ['mainland_mobile', /(?<![\d*])1[3-9]\d{9}(?![\d*])/],
    ['email_value', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
    ['id_number', /(?<![\dXx])\d{17}[\dXx](?![\dXx])/],
    ['cookie_or_token', /(?:set-)?cookie\s*[:=]|authorization\s*[:=]\s*(?:bearer|basic)/i],
];
function safeHost(host) {
    return host.toLowerCase().replace(/[^a-z0-9.-]/g, '_');
}
function candidateDirectory(paths, host) {
    return path.join(paths.learningDir, 'page-scripts', safeHost(host));
}
function inspectCandidate(spec) {
    const serialized = JSON.stringify(spec);
    for (const [name, pattern] of PERSONAL_VALUE_PATTERNS) {
        if (pattern.test(serialized)) {
            return `page_script_contains_personal_value: 命中 ${name}`;
        }
    }
    if (/"(?:x|y|left|top|nth)"\s*:\s*\d/.test(serialized)) {
        return 'page_script_contains_unstable_locator: 候选包含坐标或临时序号';
    }
    return undefined;
}
export function savePageScriptCandidate(paths, spec) {
    const rejected = inspectCandidate(spec);
    if (rejected !== undefined) {
        return { candidatePath: '', rejected };
    }
    const dir = candidateDirectory(paths, spec.host);
    if (!isInsideLocalRoot(paths, dir)) {
        throw new Error(`page_script_candidate_outside_local: ${dir} 不在 .local 内`);
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${spec.id.replace(/[^A-Za-z0-9._-]/g, '_')}.page-script.json`);
    writeFileSync(file, `${JSON.stringify(spec, null, 2)}\n`, { mode: 0o600 });
    return { candidatePath: toRepoRelative(paths, file) };
}
export function validatePageScriptCandidate(paths, input) {
    const dir = candidateDirectory(paths, input.host);
    const file = path.join(dir, `${input.candidateId.replace(/[^A-Za-z0-9._-]/g, '_')}.page-script.json`);
    if (!isInsideLocalRoot(paths, file) || !existsSync(file)) {
        throw new Error(`page_script_candidate_missing: ${input.candidateId}`);
    }
    const spec = parseSpec(JSON.parse(readFileSync(file, 'utf8')));
    if (spec.host !== input.host || spec.id !== input.candidateId) {
        throw new Error('page_script_candidate_identity_mismatch: 候选身份不一致');
    }
    if (spec.sourceRunId !== undefined && spec.sourceRunId !== input.runId) {
        throw new Error('page_script_candidate_run_mismatch: 不能用另一轮运行验证候选');
    }
    const alreadyValidated = spec.validationStatus === 'validated';
    const validated = {
        ...spec,
        validationStatus: 'validated',
        validatedRunId: input.runId,
        validatedAt: input.now ?? new Date().toISOString(),
    };
    writeFileSync(file, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 });
    return {
        candidatePath: toRepoRelative(paths, file),
        candidateId: validated.id,
        validationStatus: 'validated',
        alreadyValidated,
    };
}
export function validatePageScriptSaveAction(paths, input) {
    const dir = candidateDirectory(paths, input.host);
    const file = path.join(dir, `${input.candidateId.replace(/[^A-Za-z0-9._-]/g, '_')}.page-script.json`);
    if (!isInsideLocalRoot(paths, file) || !existsSync(file)) {
        throw new Error(`page_script_candidate_missing: ${input.candidateId}`);
    }
    const spec = parseSpec(JSON.parse(readFileSync(file, 'utf8')));
    if (spec.id !== input.candidateId ||
        spec.host !== input.host ||
        spec.sourceRunId !== input.runId) {
        throw new Error('page_script_candidate_identity_mismatch: 保存动作与候选身份不一致');
    }
    if (spec.validationStatus !== 'validated' || spec.saveAction === undefined) {
        throw new Error('page_script_candidate_save_not_ready: 填写候选尚未验证或没有保存动作');
    }
    const responseUrlPatterns = [
        ...new Set([
            ...spec.saveAction.responseUrlPatterns,
            ...input.responseUrlPatterns,
        ]),
    ];
    const validated = {
        ...spec,
        saveValidationStatus: 'validated',
        saveAction: {
            ...spec.saveAction,
            responseUrlPatterns,
        },
    };
    writeFileSync(file, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 });
    return {
        candidatePath: toRepoRelative(paths, file),
        candidateId: validated.id,
        saveValidationStatus: 'validated',
        responseUrlPatterns,
    };
}
function parseSpec(raw) {
    const spec = raw;
    if (spec === null ||
        typeof spec !== 'object' ||
        spec.schemaVersion !== 1 ||
        typeof spec.id !== 'string' ||
        typeof spec.host !== 'string' ||
        typeof spec.pathPattern !== 'string' ||
        (spec.validationStatus !== 'unverified' && spec.validationStatus !== 'validated') ||
        !Array.isArray(spec.fields) ||
        !Array.isArray(spec.anchors) ||
        !Array.isArray(spec.endpoints)) {
        throw new Error('page_script_candidate_invalid: 候选结构不完整');
    }
    return spec;
}
export function loadPageScriptCandidates(paths, host) {
    const dir = candidateDirectory(paths, host);
    if (!existsSync(dir)) {
        return { scripts: [], skipped: [] };
    }
    const scripts = [];
    const skipped = [];
    for (const name of readdirSync(dir).sort()) {
        if (!name.endsWith('.page-script.json')) {
            continue;
        }
        const file = path.join(dir, name);
        try {
            const spec = parseSpec(JSON.parse(readFileSync(file, 'utf8')));
            if (spec.host !== host) {
                throw new Error(`page_script_candidate_host_mismatch: ${spec.host} != ${host}`);
            }
            if (spec.validationStatus !== 'validated') {
                throw new Error('page_script_candidate_unverified: 候选还没有通过真实站填写和读回');
            }
            scripts.push(createConfiguredPageScript(spec));
        }
        catch (error) {
            skipped.push({
                path: toRepoRelative(paths, file),
                reason: error instanceof Error ? (error.message.split('\n')[0] ?? error.name) : String(error),
            });
        }
    }
    return { scripts, skipped };
}
//# sourceMappingURL=save-page-script-candidate.js.map