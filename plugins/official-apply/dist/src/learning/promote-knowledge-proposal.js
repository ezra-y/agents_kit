/**
 * 人工审核后把候选提升到 knowledge 或 fixtures。
 *
 * 规则文档：`docs/14_个人使用到开源的渐进成长流程.md §5-§8`
 *
 * 这是**唯一**一个把学到的东西写进 Git 跟踪目录的函数，
 * 所以它是隐私边界上最后一道闸门。四条硬规则：
 *
 * 1. **必须有人审核。** `reviewedBy` 和 `decision` 都是必填，
 *    没有默认值。自动提升等于自动泄漏。
 * 2. **只能写 `knowledge/` 和 `fixtures/`。** 目标路径超出范围就拒绝。
 * 3. **写之前先扫一遍内容。** 命中个人信息就拒绝，不是警告。
 * 4. **无论通过还是拒绝都留痕。** 审核记录写进 `.local/`。
 *
 * 配方的成长节奏（`docs/14 §8`）：
 * 第一次成功 → `candidate`；再次独立成功 → `verified`；
 * 跨另一家公司仍成功 → 家族规则才能到 `stable`。
 * **站点专用规则不能因为另一家公司成功就升级。**
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { isInsideSkillRoot, toRepoRelative } from "../config/paths.js";
import { scanTextForPersonalData } from "../privacy/run-sanitation-audit.js";
/** 只允许写进这两个目录。 */
const ALLOWED_TARGET_ROOTS = ['knowledge', 'fixtures'];
function growthError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
/** 目标路径必须落在允许的 tracked 目录内，而且不能往上跳。 */
export function assertTargetAllowed(paths, targetPath) {
    if (path.isAbsolute(targetPath)) {
        throw growthError('proposal_target_outside_tracked', `${targetPath} 是绝对路径`);
    }
    const absolute = path.resolve(paths.root, targetPath);
    if (!isInsideSkillRoot(paths, absolute)) {
        throw growthError('proposal_target_outside_tracked', `${targetPath} 跑到 Skill 之外了`);
    }
    const relative = toRepoRelative(paths, absolute);
    const top = relative.split('/')[0] ?? '';
    if (!ALLOWED_TARGET_ROOTS.includes(top)) {
        throw growthError('proposal_target_outside_tracked', `只允许写 ${ALLOWED_TARGET_ROOTS.join(' / ')}，收到 ${relative}`);
    }
    return absolute;
}
/**
 * 写之前先看内容里有没有个人信息。
 *
 * 走的是 `runSanitationAudit()` 同一套规则，但对着**内存里的待写内容**扫。
 * 绝不能先把内容写到临时文件再扫——那本身就是一次泄漏。
 */
export function findPersonalDataInContent(content, label) {
    return scanTextForPersonalData(content, label)
        .filter((finding) => finding.severity === 'blocking')
        .map((finding) => `第 ${finding.line} 行 ${finding.rule}`);
}
/** 把审核结论追加到 `.local/`。通过与否都要留痕。 */
function writeAuditLog(paths, request, outcome, now) {
    const dir = path.join(paths.learningDir, 'promotions');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'review-log.jsonl');
    appendFileSync(file, `${JSON.stringify({
        at: now,
        proposalId: request.proposal.id,
        kind: request.proposal.kind,
        title: request.proposal.title,
        targetPath: request.proposal.targetPath,
        reviewedBy: request.reviewedBy,
        decision: request.decision,
        note: request.note ?? null,
        writtenFiles: outcome.written,
        blockedReason: outcome.blockedReason ?? null,
    })}\n`, { encoding: 'utf8', mode: 0o600 });
    return file;
}
/** 新字段以 `candidate` 状态追加到目录末尾，保留文件里原有的注释和顺序。 */
function appendCatalogField(absolute, payload, now) {
    const key = String(payload['proposedKey'] ?? payload['key'] ?? '');
    if (key === '') {
        throw growthError('proposal_payload_unsafe', '字段候选没有 key，无法写入目录');
    }
    const existing = existsSync(absolute) ? readFileSync(absolute, 'utf8') : '';
    if (existing.includes(`- key: ${key}\n`)) {
        throw growthError('proposal_payload_unsafe', `目录里已经有 ${key}，请人工合并而不是追加`);
    }
    const block = [
        `# 由 promoteKnowledgeProposal() 于 ${now} 追加，状态先给 candidate。`,
        `- key: ${key}`,
        `  name: ${String(payload['proposedName'] ?? key)}`,
        '  status: candidate',
        '',
    ].join('\n');
    writeFileSync(absolute, `${existing.replace(/\n+$/, '\n')}${block}`, {
        encoding: 'utf8',
        mode: 0o644,
    });
}
export function promoteKnowledgeProposal(request) {
    const now = request.now ?? new Date().toISOString();
    const { paths, proposal } = request;
    // 1. 必须有人签字。空字符串不算。
    if (request.reviewedBy.trim() === '') {
        throw growthError('proposal_not_reviewed', '必须写明是谁审核的');
    }
    // 2. 拒绝：只留痕，不写任何 tracked 文件。
    if (request.decision === 'reject') {
        const auditLogPath = writeAuditLog(paths, request, { written: [] }, now);
        return { proposalId: proposal.id, decision: 'reject', writtenFiles: [], auditLogPath };
    }
    const blocked = (reason) => ({
        proposalId: proposal.id,
        decision: 'approve',
        writtenFiles: [],
        blockedReason: reason,
        auditLogPath: writeAuditLog(paths, request, { written: [], blockedReason: reason }, now),
    });
    // 3. 目标路径必须在允许范围内。
    let absolute;
    try {
        absolute = assertTargetAllowed(paths, proposal.targetPath);
    }
    catch (error) {
        return blocked(error instanceof Error ? error.message : String(error));
    }
    // 4. 内容必须先过隐私扫描。命中就拒绝，不是警告。
    const serialized = JSON.stringify(proposal.payload, null, 2);
    const hits = findPersonalDataInContent(serialized, `${proposal.id}.json`);
    if (hits.length > 0) {
        return blocked(`候选内容里有疑似个人信息：${hits.join('、')}`);
    }
    mkdirSync(path.dirname(absolute), { recursive: true });
    try {
        if (proposal.kind === 'canonical_field') {
            appendCatalogField(absolute, proposal.payload, now);
        }
        else {
            // 配方和夹具是整文件写入，比改 YAML 片段安全。
            writeFileSync(absolute, `${serialized}\n`, { encoding: 'utf8', mode: 0o644 });
        }
    }
    catch (error) {
        return blocked(error instanceof Error ? error.message : String(error));
    }
    const written = [toRepoRelative(paths, absolute)];
    return {
        proposalId: proposal.id,
        decision: 'approve',
        writtenFiles: written,
        auditLogPath: writeAuditLog(paths, request, { written }, now),
    };
}
//# sourceMappingURL=promote-knowledge-proposal.js.map