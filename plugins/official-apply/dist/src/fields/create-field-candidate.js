/**
 * 新含义先进候选池，不自动污染公共字段目录。
 *
 * 规则文档：
 * - `docs/03_字段答案与保存模型.md §9`
 * - `docs/14_个人使用到开源的渐进成长流程.md §4`
 *
 * 硬规则：这个函数**绝不写** `knowledge/field-catalog.yaml`。
 * 提案只落在 `.local/learning/`，等人工审核后才由
 * `promoteKnowledgeProposal()`（阶段 15）提升到公共目录。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { openKnowledgeDatabase } from "../storage/open-knowledge-database.js";
import { isInsideLocalRoot, toRepoRelative } from "../config/paths.js";
import { normalizeForMatch } from "./score-field-mapping.js";
function fieldsError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
/** 同一含义只留一条候选，靠归一化后的名字去重。 */
function candidateKeyOf(name) {
    return createHash('sha1').update(normalizeForMatch(name)).digest('hex').slice(0, 16);
}
export function createFieldCandidate(request) {
    const now = request.now ?? new Date().toISOString();
    const newId = request.idFactory ?? defaultIdFactory;
    const { siteField } = request;
    const proposedName = siteField.rawLabel !== '' ? siteField.rawLabel : (siteField.htmlName ?? '未命名字段');
    const dedupeKey = candidateKeyOf(proposedName);
    const handle = openKnowledgeDatabase({ paths: request.paths });
    let candidate;
    let reused = false;
    try {
        const existing = handle.db
            .prepare("SELECT * FROM field_candidates WHERE proposed_key = ? AND status = 'candidate'")
            .get(dedupeKey);
        const candidateId = existing === undefined ? newId('candidate') : String(existing['id']);
        reused = existing !== undefined;
        handle.db.exec('BEGIN');
        try {
            if (existing === undefined) {
                handle.db
                    .prepare(`INSERT INTO field_candidates
               (id, proposed_key, proposed_name, meaning_summary, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'candidate', ?, ?)`)
                    .run(candidateId, dedupeKey, proposedName, request.reason, now, now);
            }
            else {
                handle.db
                    .prepare('UPDATE field_candidates SET updated_at = ? WHERE id = ?')
                    .run(now, candidateId);
            }
            if (request.siteFieldId !== undefined) {
                handle.db
                    .prepare('INSERT OR IGNORE INTO field_candidate_sources(candidate_id, site_field_id) VALUES (?, ?)')
                    .run(candidateId, request.siteFieldId);
            }
            handle.db.exec('COMMIT');
        }
        catch (error) {
            handle.db.exec('ROLLBACK');
            throw error;
        }
        candidate = {
            id: candidateId,
            proposedKey: dedupeKey,
            proposedName,
            meaningSummary: request.reason,
            sourceSiteFieldIds: request.siteFieldId === undefined ? [] : [request.siteFieldId],
            status: 'candidate',
        };
    }
    finally {
        handle.close();
    }
    const proposalPath = writeProposal(request, candidate, now);
    return { candidate, proposalPath, reused };
}
/**
 * 写一份人可读的提案。
 *
 * 只写官网原题和结构，不写任何用户答案。
 */
function writeProposal(request, candidate, now) {
    const dir = path.join(request.paths.learningDir, 'field-candidates');
    if (!isInsideLocalRoot(request.paths, dir)) {
        throw fieldsError('field_candidate_outside_local', `${dir} 不在 ${request.paths.localRoot} 内`);
    }
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${candidate.id}.json`);
    const body = {
        version: 1,
        createdAt: now,
        status: candidate.status,
        proposedName: candidate.proposedName,
        reason: request.reason,
        site: request.siteHost,
        observedField: {
            sectionPath: request.siteField.sectionPath,
            rawLabel: request.siteField.rawLabel,
            controlKind: request.siteField.controlKind,
            required: request.siteField.required,
            htmlName: request.siteField.htmlName,
            optionLabels: request.siteField.options.map((option) => option.rawLabel),
        },
        reviewChecklist: [
            '这个问题是这家公司特有的，还是多数公司都会问？',
            '答案应该属于哪个 scope（global / company / job / application）？',
            '答案可以从简历推断，还是必须每次确认？',
        ],
    };
    writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return toRepoRelative(request.paths, file);
}
//# sourceMappingURL=create-field-candidate.js.map