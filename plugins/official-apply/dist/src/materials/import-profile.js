/**
 * 导入结构化履历 `profile.json`。
 *
 * 规则文档：`docs/03_字段答案与保存模型.md`、修复清单 P0-2
 *
 * 履历记录（教育、实习、项目）是**结构化**的，比从简历文本里猜可靠得多，
 * 所以它们是答案的首选来源。
 *
 * 一条重要的边界：**这里只登记「用户有什么」，不制造「官网要问什么」**
 * （`docs/13 D02`）。导进来的记录只有在官网真的问到时才会被读。
 *
 * 幂等：同一条记录（类型 + 标签 + 起止时间）重复导入只会更新，不会变成两条。
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { openPrivateDatabase } from "../storage/open-private-database.js";
function profileError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
/** `profile.json` 里的段落名 → 数据库里的 record_type。 */
const SECTION_TO_RECORD_TYPE = {
    education: 'education',
    educations: 'education',
    experience: 'experience',
    experiences: 'experience',
    internships: 'experience',
    work: 'experience',
    project: 'project',
    projects: 'project',
    award: 'award',
    awards: 'award',
};
/** 基本资料段落名 → 公共字段 key。只认明确对得上的，不猜。 */
const BASIC_TO_CANONICAL = {
    fullName: 'person.identity.full_name',
    name: 'person.identity.full_name',
    phone: 'person.contact.phone',
    mobile: 'person.contact.phone',
    email: 'person.contact.email',
    selfEvaluation: 'open_question.self_evaluation',
    wechat: 'person.contact.wechat',
    heightCm: 'person.physical.height_cm',
    gender: 'person.identity.gender',
    maritalStatus: 'person.identity.marital_status',
    hasDriverLicense: 'person.credential.has_driver_license',
    birthDate: 'person.identity.birth_date',
    birthday: 'person.identity.birth_date',
    currentCity: 'person.location.current_city',
    currentLocation: 'person.location.current_city',
    hometownCity: 'person.location.hometown_city',
    nativePlace: 'person.location.native_place',
    identificationNumber: 'person.identity.identification_number',
    englishProficiency: 'qualification.english.proficiency',
    englishTierPreference: 'qualification.english.tier_preference',
    englishCertificate: 'qualification.english.certificate',
    postgraduateEnglishScore: 'qualification.exam.postgraduate_english_score',
    expectedSalary: 'application.compensation.expected_salary',
    desiredCities: 'application.preference.desired_city',
    desiredRole: 'application.preference.desired_role',
    interviewAccepted: 'application.interview.method',
    interviewPreferred: 'application.interview.preferred_method',
    acceptTransfer: 'application.preference.accept_transfer',
    acceptAssignment: 'application.preference.accept_assignment',
    privacyAgreement: 'privacy.agreement',
    portfolioUrl: 'profile.portfolio_url',
    github: 'profile.github',
};
function asRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value
        : undefined;
}
/** 记录标签：优先用用户写的，否则拼一个人能认出来的。 */
function labelOf(entry, fallback) {
    for (const key of ['label', 'school', 'organization', 'company', 'name', 'title']) {
        const value = entry[key];
        if (typeof value === 'string' && value.trim() !== '') {
            return value.trim();
        }
    }
    return fallback;
}
export function importProfile(request) {
    const now = request.now ?? new Date().toISOString();
    const newId = request.idFactory ?? defaultIdFactory;
    const profilePath = path.resolve(request.filePath);
    let raw;
    try {
        raw = readFileSync(profilePath, 'utf8');
    }
    catch (error) {
        throw profileError('profile_file_unreadable', `${profilePath}：${error instanceof Error ? error.message : String(error)}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        throw profileError('profile_shape_invalid', `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
    const root = asRecord(parsed);
    if (root === undefined) {
        throw profileError('profile_shape_invalid', '顶层必须是一个对象');
    }
    const countsByType = {};
    const insertedRecordIds = [];
    const updatedRecordIds = [];
    const savedAnswerKeys = [];
    const rejected = [];
    const priv = openPrivateDatabase({ paths: request.paths });
    try {
        const findStatement = priv.db.prepare(`SELECT id FROM profile_records
        WHERE record_type = ? AND label = ? AND source_refs_json = ?
        ORDER BY active DESC, updated_at DESC
        LIMIT 1`);
        const insertStatement = priv.db.prepare(`INSERT INTO profile_records
         (id, record_type, label, start_date, end_date, values_json,
          source_refs_json, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);
        const updateStatement = priv.db.prepare(`UPDATE profile_records
          SET start_date = ?, end_date = ?, values_json = ?, source_refs_json = ?, updated_at = ?
        WHERE id = ?`);
        priv.db.exec('BEGIN');
        try {
            // 1. 履历段落。
            for (const [section, value] of Object.entries(root)) {
                const recordType = SECTION_TO_RECORD_TYPE[section];
                if (recordType === undefined) {
                    continue;
                }
                if (!Array.isArray(value)) {
                    rejected.push({ pointer: `/${section}`, reason: '这个段落必须是数组' });
                    continue;
                }
                for (let index = 0; index < value.length; index += 1) {
                    const pointer = `/${section}/${index}`;
                    const entry = asRecord(value[index]);
                    if (entry === undefined) {
                        rejected.push({ pointer, reason: '这一条不是对象' });
                        continue;
                    }
                    const label = labelOf(entry, `${recordType}-${index + 1}`);
                    const startDate = typeof entry['startDate'] === 'string' ? entry['startDate'] : null;
                    const endDate = typeof entry['endDate'] === 'string' ? entry['endDate'] : null;
                    // 保留原数组顺序。站点限制卡片数量时，这个顺序就是选择优先级。
                    // 业务字段仍按用户原文保存，profileOrder 只供运行时编排使用。
                    const valuesJson = JSON.stringify({
                        ...entry,
                        profileOrder: index,
                    });
                    const sourceRefs = JSON.stringify([`profile_import:${profilePath}`]);
                    const existing = findStatement.get(recordType, label, sourceRefs);
                    if (existing === undefined) {
                        const id = newId('profile');
                        insertStatement.run(id, recordType, label, startDate, endDate, valuesJson, sourceRefs, now, now);
                        insertedRecordIds.push(id);
                    }
                    else {
                        updateStatement.run(startDate, endDate, valuesJson, sourceRefs, now, existing.id);
                        updatedRecordIds.push(existing.id);
                    }
                    countsByType[recordType] = (countsByType[recordType] ?? 0) + 1;
                }
            }
            // 2. 基本资料 → 公共字段答案。
            //
            // 存成 `extracted_answer_candidates`，不是直接存成用户确认过的答案。
            // 用户导入一份 JSON，不等于他确认了每个字段都能拿去投递（`docs/05`）。
            const basic = asRecord(root['basic']) ?? asRecord(root['profile']) ?? {};
            const basicValues = {};
            const candidateStatement = priv.db.prepare(`INSERT INTO extracted_answer_candidates
           (id, canonical_key, value_json, source_type, source_ref, confidence,
            evidence_redacted, created_at, updated_at)
         VALUES (?, ?, ?, 'attachment_metadata', ?, 0.9, ?, ?, ?)`);
            const deletePreviousCandidate = priv.db.prepare(`DELETE FROM extracted_answer_candidates
          WHERE canonical_key = ?
            AND source_type = 'attachment_metadata'
            AND source_ref = ?`);
            for (const [key, value] of Object.entries(basic)) {
                const canonicalKey = BASIC_TO_CANONICAL[key];
                if (canonicalKey === undefined || value === null || value === undefined) {
                    continue;
                }
                basicValues[canonicalKey] = value;
                const sourceRef = `profile_import:${profilePath}`;
                deletePreviousCandidate.run(canonicalKey, sourceRef);
                candidateStatement.run(newId('candidate'), canonicalKey, JSON.stringify(value), sourceRef, `来自 profile.json 的 basic.${key}`, now, now);
                savedAnswerKeys.push(canonicalKey);
            }
            if (Array.isArray(root['skills'])) {
                basicValues['profile.skills'] = root['skills'];
            }
            if (Array.isArray(root['languages'])) {
                basicValues['profile.languages'] = root['languages'];
            }
            if (Object.keys(basicValues).length > 0) {
                const label = '基本资料';
                const sourceRefs = JSON.stringify([`profile_import:${profilePath}`]);
                const valuesJson = JSON.stringify(basicValues);
                const existing = findStatement.get('other', label, sourceRefs);
                if (existing === undefined) {
                    const id = newId('profile');
                    insertStatement.run(id, 'other', label, null, null, valuesJson, sourceRefs, now, now);
                    insertedRecordIds.push(id);
                }
                else {
                    updateStatement.run(null, null, valuesJson, sourceRefs, now, existing.id);
                    updatedRecordIds.push(existing.id);
                }
                countsByType['other'] = 1;
            }
            priv.db.exec('COMMIT');
        }
        catch (error) {
            priv.db.exec('ROLLBACK');
            throw error;
        }
    }
    finally {
        priv.close();
    }
    if (insertedRecordIds.length === 0 && updatedRecordIds.length === 0 && savedAnswerKeys.length === 0) {
        rejected.push({
            pointer: '/',
            reason: '没有识别到任何履历段落或基本资料。支持的段落：education / experience / project / award / basic',
        });
    }
    return {
        filePath: profilePath,
        countsByType,
        insertedRecordIds,
        updatedRecordIds,
        profileRecordIds: [...insertedRecordIds, ...updatedRecordIds],
        savedAnswerKeys,
        rejected,
    };
}
//# sourceMappingURL=import-profile.js.map