/**
 * 三个 SQLite 的建库与迁移。
 *
 * 规则文档：
 * - `docs/02_系统架构与代码落点.md §8`
 * - `docs/03_字段答案与保存模型.md §10`
 *
 * 硬规则：
 * 1. 数据库文件只能是 `.local/db/{knowledge,private,runtime}.sqlite`。
 * 2. 三个库各自只存自己的事实，不互相混。
 * 3. 建表脚本用 `CREATE TABLE IF NOT EXISTS`，重复迁移不会破坏已有数据。
 *
 * 用 Node 内置的 `node:sqlite`，不额外引入原生依赖。
 */
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isInsideLocalRoot, toRepoRelative } from "../config/paths.js";
import { readTaskSubmissionTruth } from "../submission/task-submission-truth.js";
export const DATABASE_NAMES = ['knowledge', 'private', 'runtime'];
const DB_FILE_MODE = 0o600;
function storageError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
/** 数据库文件位置的唯一来源。业务代码不得自己拼 `.local/db/...`。 */
export function databaseFile(paths, name) {
    switch (name) {
        case 'knowledge':
            return paths.knowledgeDb;
        case 'private':
            return paths.privateDb;
        case 'runtime':
            return paths.runtimeDb;
    }
}
/** 建表脚本位置：`<skill-root>/schemas/<name>.sql`。 */
export function schemaFile(paths, name) {
    return path.join(paths.root, 'schemas', `${name}.sql`);
}
function assertInsideLocal(paths, filePath) {
    if (!isInsideLocalRoot(paths, filePath)) {
        throw storageError('database_outside_local', `${filePath} 不在 ${paths.localRoot} 内；数据库只能放 .local/db/`);
    }
}
function countTables(db) {
    const row = db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .get();
    return row.n;
}
function readSchemaMeta(db, key) {
    const row = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get(key);
    return row?.value;
}
function hasColumn(db, table, column) {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((row) => row.name === column);
}
function hasTable(db, table) {
    return db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table) !== undefined;
}
function migrateRuntimeProfileBindings(db) {
    if (!hasColumn(db, 'application_tasks', 'profile_record_ids_json')) {
        db.exec("ALTER TABLE application_tasks ADD COLUMN profile_record_ids_json TEXT NOT NULL DEFAULT '[]'");
    }
    if (!hasColumn(db, 'application_runs', 'profile_record_ids_json')) {
        db.exec("ALTER TABLE application_runs ADD COLUMN profile_record_ids_json TEXT NOT NULL DEFAULT '[]'");
    }
}
const LEGACY_TASK_STATUSES = {
    queued: 'queued',
    in_progress: 'in_progress',
    completed: 'completed',
    submitted: 'submitted',
    submission_uncertain: 'submission_uncertain',
    needs_user: 'needs_user',
    failed: 'failed',
    skipped: 'skipped',
    opening: 'in_progress',
    discovering: 'in_progress',
    collecting_answers: 'in_progress',
    waiting_for_user: 'needs_user',
    filling: 'in_progress',
    validating: 'in_progress',
    ready_for_review: 'needs_user',
    ready_to_submit: 'needs_user',
    submitting: 'in_progress',
    submitted_confirmed: 'submitted',
    failed_recoverable: 'needs_user',
    failed_terminal: 'failed',
    cancelled: 'skipped',
};
function migratedTaskStatus(db, task) {
    const submissionTruth = readTaskSubmissionTruth(db, task.id);
    if (submissionTruth === 'submitted' || submissionTruth === 'submission_uncertain') {
        return submissionTruth;
    }
    const legacyStatus = LEGACY_TASK_STATUSES[task.status];
    if (submissionTruth === 'retryable' &&
        (legacyStatus === 'submitted' || legacyStatus === 'submission_uncertain')) {
        return 'needs_user';
    }
    return legacyStatus;
}
const RUN_STATE_SQL = [
    'queued',
    'opening',
    'discovering',
    'collecting_answers',
    'waiting_for_user',
    'filling',
    'validating',
    'ready_for_review',
    'ready_to_submit',
    'submitting',
    'submitted_confirmed',
    'submission_uncertain',
    'failed_recoverable',
    'failed_terminal',
    'cancelled',
].map((state) => `'${state}'`).join(', ');
function currentTableSql(schemaSql, table, temporaryName) {
    const marker = `CREATE TABLE IF NOT EXISTS ${table} (`;
    const start = schemaSql.indexOf(marker);
    if (start < 0) {
        throw storageError('database_schema_invalid', `建表脚本缺少 ${table}`);
    }
    let depth = 0;
    const bodyStart = schemaSql.indexOf('(', start);
    for (let index = bodyStart; index < schemaSql.length; index += 1) {
        const character = schemaSql[index];
        if (character === '(') {
            depth += 1;
        }
        else if (character === ')') {
            depth -= 1;
            if (depth === 0) {
                return schemaSql
                    .slice(start, index + 1)
                    .replace(`CREATE TABLE IF NOT EXISTS ${table}`, `CREATE TABLE ${temporaryName}`);
            }
        }
    }
    throw storageError('database_schema_invalid', `${table} 建表语句没有结束`);
}
function migrateRuntimeToV5(db, schemaSql) {
    const transactionalSchemaSql = schemaSql
        .replace(/^PRAGMA\s+[^;]+;\s*$/gim, '')
        .replace('  job_location TEXT,\n', '')
        .replace('  owner_pid INTEGER,\n', '')
        .replace("CREATE UNIQUE INDEX IF NOT EXISTS idx_submission_task_active\n" +
        "  ON submission_attempts(task_id)\n" +
        "  WHERE outcome IN ('in_progress', 'confirmed', 'uncertain');\n", '');
    db.exec('PRAGMA foreign_keys = OFF');
    try {
        db.exec('BEGIN IMMEDIATE');
        try {
            migrateRuntimeProfileBindings(db);
            db.exec(transactionalSchemaSql);
            const tasks = db
                .prepare('SELECT id, status FROM application_tasks')
                .all();
            const migratedStatuses = new Map();
            for (const task of tasks) {
                const status = migratedTaskStatus(db, task);
                if (status === undefined) {
                    throw storageError('runtime_task_status_invalid', `任务 ${task.id} 使用未知状态 ${task.status}，未修改数据库`);
                }
                migratedStatuses.set(task.id, status);
            }
            const invalidRun = db
                .prepare(`SELECT id, state FROM application_runs
            WHERE state NOT IN (${RUN_STATE_SQL})
            LIMIT 1`)
                .get();
            if (invalidRun !== undefined) {
                throw storageError('runtime_run_state_invalid', `运行 ${invalidRun.id} 使用未知状态 ${invalidRun.state}，未修改数据库`);
            }
            const missingJobTitle = db
                .prepare(`SELECT t.id
             FROM application_tasks t
            WHERE trim(t.job_title) = ''
              AND (
                NULLIF(trim(t.job_key), '') IS NOT NULL
                OR EXISTS (SELECT 1 FROM submission_attempts s WHERE s.task_id = t.id)
              )
            LIMIT 1`)
                .get();
            if (missingJobTitle !== undefined) {
                throw storageError('runtime_job_title_missing', `岗位任务 ${missingJobTitle.id} 没有岗位名称，未修改数据库`);
            }
            db.exec(currentTableSql(transactionalSchemaSql, 'application_tasks', 'application_tasks_v5'));
            db.exec(currentTableSql(transactionalSchemaSql, 'application_runs', 'application_runs_v5'));
            db.exec(`INSERT INTO application_tasks_v5
           (id, batch_id, execute, task_kind, company_key, company_name, job_key, job_title,
            job_url, job_selection_source, job_selection_evidence, mode, resume_material_id,
            additional_material_ids_json, profile_record_ids_json, answer_set_id, source,
            external_row_id, status, result_note, created_at, updated_at)
         SELECT t.id, NULL, t.execute,
                -- 旧行没有岗位键和提交证据时，只能保留“公司级简历”权限。
                -- 这是安全动作范围，不是断言旧 URL 一定是独立简历页。
                CASE WHEN NULLIF(trim(t.job_key), '') IS NOT NULL OR EXISTS (
                  SELECT 1 FROM submission_attempts s WHERE s.task_id = t.id
                ) THEN 'job_application' ELSE 'company_resume' END,
                t.company_key, t.company_name, t.job_key, t.job_title, t.job_url,
                CASE WHEN NULLIF(trim(t.job_key), '') IS NOT NULL OR EXISTS (
                  SELECT 1 FROM submission_attempts s WHERE s.task_id = t.id
                ) THEN 'legacy_record' ELSE NULL END,
                CASE WHEN EXISTS (
                  SELECT 1 FROM submission_attempts s WHERE s.task_id = t.id
                ) THEN 'legacy_submission_attempt'
                WHEN NULLIF(trim(t.job_key), '') IS NOT NULL THEN 'legacy_job_key'
                ELSE NULL END,
                t.mode, t.resume_material_id, t.additional_material_ids_json,
                t.profile_record_ids_json, t.answer_set_id, t.source, t.external_row_id,
                'queued', t.result_note, t.created_at, t.updated_at
           FROM application_tasks t;

         INSERT INTO application_runs_v5
           (id, task_id, browser_session_id, state, current_url_redacted, current_page_type,
            current_step_key, current_snapshot_id, profile_record_ids_json, started_at, updated_at,
            finished_at, error_code, error_message_redacted)
         SELECT id, task_id, browser_session_id, state, current_url_redacted, current_page_type,
                current_step_key, current_snapshot_id, profile_record_ids_json, started_at,
                updated_at, finished_at, error_code, error_message_redacted
           FROM application_runs;`);
            const updateTaskStatus = db.prepare('UPDATE application_tasks_v5 SET status = ? WHERE id = ?');
            for (const [taskId, status] of migratedStatuses) {
                updateTaskStatus.run(status, taskId);
            }
            db.exec('DROP TABLE application_runs');
            db.exec('DROP TABLE application_tasks');
            db.exec('ALTER TABLE application_tasks_v5 RENAME TO application_tasks');
            db.exec('ALTER TABLE application_runs_v5 RENAME TO application_runs');
            db.exec(transactionalSchemaSql);
            db.prepare("UPDATE schema_meta SET value = '5' WHERE key = 'schema_version'").run();
            const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all();
            if (foreignKeyViolations.length > 0) {
                throw storageError('runtime_foreign_key_invalid', `迁移后发现 ${foreignKeyViolations.length} 条外键错误，未修改数据库`);
            }
            db.exec('COMMIT');
        }
        catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    }
    finally {
        db.exec('PRAGMA foreign_keys = ON');
    }
}
function migrateRuntimeToV6(db) {
    db.exec('BEGIN IMMEDIATE');
    try {
        if (!hasColumn(db, 'browser_sessions', 'owner_pid')) {
            db.exec('ALTER TABLE browser_sessions ADD COLUMN owner_pid INTEGER');
        }
        const conflict = db
            .prepare(`SELECT task_id
           FROM submission_attempts
          WHERE outcome IN ('in_progress', 'confirmed', 'uncertain')
          GROUP BY task_id
         HAVING COUNT(*) > 1
          LIMIT 1`)
            .get();
        if (conflict !== undefined) {
            throw storageError('runtime_submission_attempts_conflict', `任务 ${conflict.task_id} 有多条有效提交记录，请先人工确认结果`);
        }
        db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_submission_task_active
         ON submission_attempts(task_id)
         WHERE outcome IN ('in_progress', 'confirmed', 'uncertain')`);
        db.prepare("UPDATE schema_meta SET value = '6' WHERE key = 'schema_version'").run();
        db.exec('COMMIT');
    }
    catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}
function migrateRuntimeToV7(db) {
    db.exec('BEGIN IMMEDIATE');
    try {
        if (!hasColumn(db, 'application_tasks', 'job_location')) {
            db.exec('ALTER TABLE application_tasks ADD COLUMN job_location TEXT');
        }
        db.prepare("UPDATE schema_meta SET value = '7' WHERE key = 'schema_version'").run();
        db.exec('COMMIT');
    }
    catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}
function migrateRuntimeToV8(db) {
    db.exec('BEGIN IMMEDIATE');
    try {
        // pending 是「下一次要写出的最新事实」，不是历史日志。
        // 同一任务的历史重复 pending 在这里去重：每条任务只保留最新一条，
        // 决胜顺序 updated_at DESC → created_at DESC → rowid DESC。
        // delivered/failed 是已发生的交付记录，原样保留。
        db.exec(`DELETE FROM task_update_outbox
        WHERE delivery_status = 'pending'
          AND rowid NOT IN (
            SELECT rowid FROM (
              SELECT rowid,
                     ROW_NUMBER() OVER (
                       PARTITION BY task_id
                       ORDER BY updated_at DESC, created_at DESC, rowid DESC
                     ) AS rank
                FROM task_update_outbox
               WHERE delivery_status = 'pending'
            ) WHERE rank = 1
          )`);
        // 唯一约束兜底：今后写入路径漏删时，数据库本身拒绝同任务第二条 pending。
        db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_task_pending
         ON task_update_outbox(task_id)
         WHERE delivery_status = 'pending'`);
        db.prepare("UPDATE schema_meta SET value = '8' WHERE key = 'schema_version'").run();
        db.exec('COMMIT');
    }
    catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}
function migrateRuntimeToV9(db) {
    db.exec('BEGIN IMMEDIATE');
    try {
        // 每个 run 只保留最新一条 pending 人工卡点；其余历史卡点改 resolved。
        // 决胜顺序 created_at DESC → rowid DESC；resolved_at 用 COALESCE 稳定回填。
        db.exec(`UPDATE human_takeover_requests
          SET status = 'resolved',
              resolved_at = COALESCE(resolved_at, created_at)
        WHERE status = 'pending'
          AND id IN (
            SELECT id FROM (
              SELECT id,
                     ROW_NUMBER() OVER (
                       PARTITION BY run_id
                       ORDER BY created_at DESC, rowid DESC
                     ) AS rank
                FROM human_takeover_requests
               WHERE status = 'pending'
            ) WHERE rank > 1
          )`);
        db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_takeover_run_pending
         ON human_takeover_requests(run_id)
         WHERE status = 'pending'`);
        db.prepare("UPDATE schema_meta SET value = '9' WHERE key = 'schema_version'").run();
        db.exec('COMMIT');
    }
    catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}
/**
 * 打开一个已迁移的数据库。
 *
 * 会顺手确认三件事：文件在 `.local/` 内、已经迁移过、库的身份和期望一致。
 * 身份检查能挡住「用 knowledge 的函数去开 private 库」这种串库错误。
 */
export function openMigratedDatabase(paths, name) {
    const filePath = databaseFile(paths, name);
    assertInsideLocal(paths, filePath);
    if (!existsSync(filePath)) {
        throw storageError('database_not_migrated', `${filePath} 不存在；先运行 migrateDatabases()`);
    }
    const db = new DatabaseSync(filePath);
    try {
        db.exec('PRAGMA foreign_keys = ON');
        const schemaName = readSchemaMeta(db, 'schema_name');
        if (schemaName !== name) {
            throw storageError('database_schema_mismatch', `${filePath} 的 schema_name 是 ${schemaName ?? '未知'}，期望 ${name}`);
        }
        const version = Number(readSchemaMeta(db, 'schema_version') ?? '0');
        assertSchemaCurrent(db, paths, name, filePath);
        return { db, filePath, schemaVersion: version };
    }
    catch (error) {
        db.close();
        throw error;
    }
}
/**
 * 建表脚本里声明了哪些表。
 *
 * 只认 `CREATE TABLE IF NOT EXISTS <名字>` 这一种写法——
 * 全部建表语句都是这个形状，认得多了反而容易误判。
 */
export function tablesDeclaredIn(sql) {
    return [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)].map((match) => match[1]);
}
/**
 * 库里的表是不是跟得上建表脚本。
 *
 * ## 为什么要在打开时查
 *
 * 升级 Skill 之后，`.local/` 里那三个库还是旧的。少一张表时报出来的是
 * SQLite 的原话——`no such table: host_approvals`。
 * 那句话对用户毫无指导意义：他不知道这是哪来的表，更不知道该做什么，
 * 只会觉得东西坏了。
 *
 * 这里把它翻译成「跑 applyctl init」。检查本身是一次
 * `sqlite_master` 查询，可以忽略不计。
 */
function assertSchemaCurrent(db, paths, name, filePath) {
    const sqlPath = schemaFile(paths, name);
    if (!existsSync(sqlPath)) {
        // 建表脚本都没有就不是「库旧了」的问题，交给别的检查去报。
        return;
    }
    const schemaSql = readFileSync(sqlPath, 'utf8');
    const expected = tablesDeclaredIn(schemaSql);
    const expectedVersion = Number(/\('schema_version',\s*'(\d+)'\)/.exec(schemaSql)?.[1] ?? '0');
    const actualVersion = Number(readSchemaMeta(db, 'schema_version') ?? '0');
    if (expectedVersion > actualVersion) {
        throw storageError('database_schema_outdated', `${filePath} 的 schema v${actualVersion} 低于当前 v${expectedVersion}。` +
            '跑一次 `applyctl init` 完成迁移，已有数据不会丢。');
    }
    const rows = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all();
    const actual = new Set(rows.map((row) => row.name));
    const missing = expected.filter((table) => !actual.has(table));
    if (missing.length > 0) {
        throw storageError('database_schema_outdated', `${filePath} 缺少 ${missing.length} 张表（${missing.join('、')}）。` +
            '这通常是升级之后没有重新迁移。跑一次 `applyctl init` 就会补上——' +
            '建表脚本是 IF NOT EXISTS 的，已有数据不会丢。');
    }
}
export function migrateDatabases(input) {
    const { paths } = input;
    const names = input.only ?? DATABASE_NAMES;
    // 先把所有位置检查做完，避免只建了一半库就失败。
    for (const name of names) {
        assertInsideLocal(paths, databaseFile(paths, name));
        const sqlPath = schemaFile(paths, name);
        if (!existsSync(sqlPath)) {
            throw storageError('database_schema_missing', `找不到建表脚本 ${sqlPath}`);
        }
    }
    const results = [];
    for (const name of names) {
        const filePath = databaseFile(paths, name);
        const createdFile = !existsSync(filePath);
        mkdirSync(path.dirname(filePath), { recursive: true });
        const sql = readFileSync(schemaFile(paths, name), 'utf8');
        const db = new DatabaseSync(filePath);
        try {
            db.exec('PRAGMA foreign_keys = ON');
            const hasSchemaMeta = hasTable(db, 'schema_meta');
            const existingSchemaName = hasSchemaMeta ? readSchemaMeta(db, 'schema_name') : undefined;
            if (existingSchemaName !== undefined && existingSchemaName !== name) {
                throw storageError('database_schema_mismatch', `${filePath} 的 schema_name 是 ${existingSchemaName}，期望 ${name}`);
            }
            let version = hasSchemaMeta ? Number(readSchemaMeta(db, 'schema_version') ?? '0') : 0;
            if (name === 'runtime' && hasSchemaMeta) {
                if (version < 5) {
                    migrateRuntimeToV5(db, sql);
                    version = 5;
                }
                if (version < 6) {
                    migrateRuntimeToV6(db);
                    version = 6;
                }
                if (version < 7) {
                    migrateRuntimeToV7(db);
                }
                if (version < 8) {
                    migrateRuntimeToV8(db);
                }
                if (version < 9) {
                    migrateRuntimeToV9(db);
                }
            }
            else {
                db.exec(sql);
            }
            const schemaName = readSchemaMeta(db, 'schema_name');
            if (schemaName !== name) {
                throw storageError('database_schema_mismatch', `${filePath} 的 schema_name 是 ${schemaName ?? '未知'}，期望 ${name}`);
            }
            results.push({
                name,
                filePath: toRepoRelative(paths, filePath),
                schemaVersion: Number(readSchemaMeta(db, 'schema_version') ?? '0'),
                tableCount: countTables(db),
                createdFile,
            });
        }
        finally {
            db.close();
        }
        if (process.platform !== 'win32') {
            chmodSync(filePath, DB_FILE_MODE);
        }
    }
    return { results };
}
export function openSkillDatabase(paths, name) {
    const { db, filePath, schemaVersion } = openMigratedDatabase(paths, name);
    let closed = false;
    return {
        name,
        filePath,
        schemaVersion,
        db,
        hasTable(table) {
            const row = db
                .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
                .get(table);
            return row !== undefined;
        },
        close() {
            if (!closed) {
                closed = true;
                db.close();
            }
        },
    };
}
//# sourceMappingURL=migrate-databases.js.map