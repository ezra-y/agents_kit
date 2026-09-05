/**
 * 从用户已经提供的简历和材料里提取可验证事实。
 *
 * 规则文档：`docs/05_答案收集范围与复用规则.md §2.2、§2.3`
 *
 * 一条硬规则：**只提取官网这次问到的字段**（`docs/13 D02`、`R06`）。
 * 简历里有生日不代表要填生日；官网没问就不提取，更不生成。
 *
 * 简历不是唯一事实源，所以提取结果只是**候选**，
 * 写进 `extracted_answer_candidates`，不直接变成答案。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { openPrivateDatabase } from "../storage/open-private-database.js";
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
/** 只读纯文本类简历。PDF 和 Word 的解析留给后续阶段。 */
const READABLE_EXTENSIONS = new Set(['.txt', '.md', '.markdown']);
const MAX_TEXT_BYTES = 1024 * 1024;
/**
 * 文本抽取规则。
 *
 * 只写「结构明确、能自我验证」的几项。
 * 学历、经历这类需要结构化的内容走 `profile_records`，不靠正则猜。
 */
const TEXT_EXTRACTORS = [
    {
        canonicalKey: 'person.contact.email',
        pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
        confidence: 0.8,
        pick: (match) => match[0],
    },
    {
        canonicalKey: 'person.contact.phone',
        pattern: /(?<![\d-])1[3-9]\d{9}(?![\d-])/,
        confidence: 0.8,
        pick: (match) => match[0],
    },
];
/** 日志和证据里只保留脱敏形式（`docs/10 §13`）。 */
export function redactFactValue(canonicalKey, value) {
    const text = String(value);
    if (canonicalKey.includes('phone')) {
        return text.length >= 7 ? `${text.slice(0, 3)}****${text.slice(-4)}` : '***';
    }
    if (canonicalKey.includes('email')) {
        const [name = '', domain = ''] = text.split('@');
        return `${name.slice(0, 1)}***@${domain}`;
    }
    return text.length <= 2 ? '***' : `${text.slice(0, 1)}***`;
}
export function extractMaterialFacts(request) {
    const now = request.now ?? new Date().toISOString();
    const newId = request.idFactory ?? defaultIdFactory;
    const wanted = new Set(request.canonicalKeys);
    const facts = [];
    const scannedMaterialIds = [];
    const priv = openPrivateDatabase({ paths: request.paths });
    try {
        // 1. 履历记录：结构化，最可靠。
        const recordFilter = request.profileRecordIds ?? [];
        const records = recordFilter.length === 0
            ? []
            : priv.db
                .prepare(`SELECT id, record_type, label, values_json
                 FROM profile_records
                WHERE active = 1 AND id IN (${recordFilter.map(() => '?').join(', ')})`)
                .all(...recordFilter);
        for (const record of records) {
            let values;
            try {
                values = JSON.parse(String(record['values_json']));
            }
            catch {
                continue;
            }
            for (const [key, value] of Object.entries(values)) {
                if (!wanted.has(key)) {
                    continue;
                }
                facts.push({
                    canonicalKey: key,
                    value,
                    sourceType: 'attachment_metadata',
                    sourceRef: `profile_record:${String(record['id'])}`,
                    confidence: 0.9,
                    evidenceRedacted: `来自履历记录「${String(record['label'])}」`,
                });
            }
        }
        // 2. 材料文件：**只读这次任务绑定的那几份**。
        //
        // 以前这里是 `WHERE active = 1`，等于把用户所有简历一起扫。
        // 两份简历写了不同的联系方式时，答案会串（修复清单 P0-2）。
        // 现在改成按 id 精确取，绑了几份就读几份，一份没绑就一份不读。
        const materials = request.materialRefs.length === 0
            ? []
            : priv.db
                .prepare(`SELECT id, purpose, local_path, display_name
                 FROM material_files
                WHERE active = 1 AND id IN (${request.materialRefs.map(() => '?').join(', ')})`)
                .all(...request.materialRefs);
        for (const material of materials) {
            const id = String(material['id']);
            scannedMaterialIds.push(id);
            const localPath = resolveMaterialPath(request, String(material['local_path']));
            if (localPath === undefined || !READABLE_EXTENSIONS.has(path.extname(localPath).toLowerCase())) {
                continue;
            }
            if (!existsSync(localPath) || statSync(localPath).size > MAX_TEXT_BYTES) {
                continue;
            }
            const text = readFileSync(localPath, 'utf8');
            for (const extractor of TEXT_EXTRACTORS) {
                if (!wanted.has(extractor.canonicalKey)) {
                    continue;
                }
                const match = extractor.pattern.exec(text);
                if (match === null) {
                    continue;
                }
                const value = extractor.pick(match);
                if (value === undefined) {
                    continue;
                }
                facts.push({
                    canonicalKey: extractor.canonicalKey,
                    value,
                    sourceType: 'resume',
                    sourceRef: `material:${id}`,
                    confidence: extractor.confidence,
                    evidenceRedacted: `在「${String(material['display_name'])}」中命中 ${redactFactValue(extractor.canonicalKey, value)}`,
                });
            }
        }
        persistCandidates(priv, facts, now, newId);
    }
    finally {
        priv.close();
    }
    return { facts, scannedMaterialIds };
}
/**
 * 材料索引里存的是 `<skill-root>/.local/...` 这种相对写法。
 * 这里还原成本机绝对路径，并确认它没跑出 `.local/`。
 */
function resolveMaterialPath(request, storedPath) {
    const absolute = storedPath.startsWith('<skill-root>/.local/')
        ? path.join(request.paths.localRoot, storedPath.slice('<skill-root>/.local/'.length))
        : path.resolve(request.paths.materialsDir, storedPath);
    return absolute.startsWith(request.paths.localRoot + path.sep) ? absolute : undefined;
}
function persistCandidates(priv, facts, now, newId) {
    if (facts.length === 0) {
        return;
    }
    priv.db.exec('BEGIN');
    try {
        const insert = priv.db.prepare(`INSERT INTO extracted_answer_candidates
         (id, canonical_key, value_json, source_type, source_ref, confidence,
          evidence_redacted, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?)`);
        const exists = priv.db.prepare(`SELECT id FROM extracted_answer_candidates
       WHERE canonical_key = ? AND source_ref = ? AND value_json = ? AND status = 'candidate'`);
        for (const fact of facts) {
            const valueJson = JSON.stringify(fact.value);
            if (exists.get(fact.canonicalKey, fact.sourceRef, valueJson) !== undefined) {
                continue;
            }
            insert.run(newId('extracted'), fact.canonicalKey, valueJson, fact.sourceType, fact.sourceRef, fact.confidence, fact.evidenceRedacted ?? null, now, now);
        }
        priv.db.exec('COMMIT');
    }
    catch (error) {
        priv.db.exec('ROLLBACK');
        throw error;
    }
}
//# sourceMappingURL=extract-material-facts.js.map