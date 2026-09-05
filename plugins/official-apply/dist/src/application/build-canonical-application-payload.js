import { existsSync } from 'node:fs';
import { readProfileRecords } from "./fill-profile-groups.js";
import { resolveStoredMaterialPath } from "../materials/list-materials.js";
import { openPrivateDatabase } from "../storage/open-private-database.js";
function applicationRecord(id, values) {
    return { recordId: id, values };
}
function readMaterials(paths, materialIds) {
    if (materialIds.length === 0) {
        return { materials: [], missingIds: [] };
    }
    const priv = openPrivateDatabase({ paths });
    try {
        const rows = priv.db
            .prepare(`SELECT id, purpose, local_path, display_name, mime_type, size_bytes
           FROM material_files
          WHERE active = 1 AND id IN (${materialIds.map(() => '?').join(', ')})`)
            .all(...materialIds);
        const materials = [];
        for (const row of rows) {
            const localPath = resolveStoredMaterialPath(paths, String(row['local_path']));
            if (localPath === undefined || !existsSync(localPath)) {
                continue;
            }
            materials.push({
                id: String(row['id']),
                purpose: String(row['purpose']),
                localPath,
                displayName: String(row['display_name']),
                ...(row['mime_type'] === null ? {} : { mimeType: String(row['mime_type']) }),
                ...(row['size_bytes'] === null ? {} : { sizeBytes: Number(row['size_bytes']) }),
                active: true,
            });
        }
        const found = new Set(materials.map((material) => material.id));
        return {
            materials,
            missingIds: materialIds.filter((id) => !found.has(id)),
        };
    }
    finally {
        priv.close();
    }
}
function materialKey(purpose) {
    return `attachment.${purpose}`;
}
function readApplicationAnswers(paths, taskId) {
    if (taskId === undefined || taskId === '')
        return {};
    const priv = openPrivateDatabase({ paths });
    try {
        const rows = priv.db
            .prepare(`SELECT canonical_key, value_json
           FROM answer_values
          WHERE scope_type = 'application'
            AND scope_key = ?
            AND status = 'active'`)
            .all(`application:${taskId}`);
        const answers = {};
        for (const row of rows) {
            try {
                answers[row.canonical_key] = JSON.parse(row.value_json);
            }
            catch {
                // 损坏的私有答案保持忽略，后续仍会按正常缺失字段报告。
            }
        }
        return answers;
    }
    finally {
        priv.close();
    }
}
function readScopedAnswers(paths, scopeType, scopeKeys) {
    if (scopeKeys.length === 0)
        return new Map();
    const priv = openPrivateDatabase({ paths });
    try {
        const rows = priv.db
            .prepare(`SELECT canonical_key, scope_key, value_json
           FROM answer_values
          WHERE scope_type = ?
            AND scope_key IN (${scopeKeys.map(() => '?').join(', ')})
            AND status = 'active'
          ORDER BY updated_at`)
            .all(scopeType, ...scopeKeys);
        const answers = new Map();
        for (const row of rows) {
            try {
                const scoped = answers.get(row.scope_key) ?? {};
                scoped[row.canonical_key] = JSON.parse(row.value_json);
                answers.set(row.scope_key, scoped);
            }
            catch {
                // 损坏的私有答案保持忽略，后续仍会按正常缺失字段报告。
            }
        }
        return answers;
    }
    finally {
        priv.close();
    }
}
function profileAnswerValues(answers) {
    if (answers === undefined)
        return {};
    const values = { ...answers };
    for (const [key, value] of Object.entries(answers)) {
        const separator = key.indexOf('].');
        if (separator >= 0) {
            values[key.slice(separator + 2)] = value;
        }
    }
    return values;
}
function textRecords(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((item, index) => {
        if (typeof item === 'string' && item.trim() !== '') {
            return [{ values: { name: item.trim(), order: index } }];
        }
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
            return [{ values: item }];
        }
        return [];
    });
}
export function buildCanonicalApplicationPayload(request) {
    const records = readProfileRecords(request.paths, request.profileRecordIds);
    const foundRecordIds = new Set(records.map((record) => record.id));
    const materials = readMaterials(request.paths, request.materialIds);
    const globalAnswers = readScopedAnswers(request.paths, 'global', ['user']).get('user') ?? {};
    const profileAnswers = readScopedAnswers(request.paths, 'profile_record', request.profileRecordIds.map((id) => `profile_record:${id}`));
    const payload = {
        basic: {},
        education: [],
        experience: [],
        projects: [],
        awards: [],
        skills: [],
        languages: [],
        materials: {},
    };
    for (const record of records) {
        if (record.values['includeInApplications'] === false)
            continue;
        const converted = applicationRecord(record.id, {
            ...record.values,
            ...profileAnswerValues(profileAnswers.get(`profile_record:${record.id}`)),
        });
        switch (record.recordType) {
            case 'education':
                payload.education.push(converted);
                break;
            case 'experience':
                payload.experience.push(converted);
                break;
            case 'project':
                payload.projects.push(converted);
                break;
            case 'award':
                payload.awards.push(converted);
                break;
            case 'other':
                Object.assign(payload.basic, record.values);
                payload.skills.push(...textRecords(record.values['profile.skills']));
                payload.languages.push(...textRecords(record.values['profile.languages']));
                break;
            default:
                break;
        }
    }
    Object.assign(payload.basic, globalAnswers);
    Object.assign(payload.basic, readApplicationAnswers(request.paths, request.taskId));
    for (const material of materials.materials) {
        payload.materials[materialKey(material.purpose)] = {
            materialId: material.id,
            localPath: material.localPath,
        };
    }
    return {
        payload,
        missingProfileRecordIds: request.profileRecordIds.filter((id) => !foundRecordIds.has(id)),
        missingMaterialIds: materials.missingIds,
    };
}
//# sourceMappingURL=build-canonical-application-payload.js.map