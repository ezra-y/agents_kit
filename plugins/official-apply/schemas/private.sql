-- 秋招企业官网自动投递：用户私有数据 schema
-- SQLite。
--
-- 这个数据库永远不应提交到 Git，也不能进入公开测试夹具。
-- 建议文件权限仅当前用户可读写。

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_meta(key, value) VALUES
  ('schema_name', 'private'),
  ('schema_version', '2');

-- 用户履历中的一条记录，例如一段教育、一段实习或一个项目。
CREATE TABLE IF NOT EXISTS profile_records (
  id TEXT PRIMARY KEY,
  record_type TEXT NOT NULL CHECK(record_type IN (
    'education', 'experience', 'project', 'award', 'family_member', 'other'
  )),
  label TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  values_json TEXT NOT NULL,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profile_records_type_active
  ON profile_records(record_type, active);

-- 用户对公共字段概念的具体答案。
-- scope_type + scope_key 决定答案在哪些场景有效。
CREATE TABLE IF NOT EXISTS answer_values (
  id TEXT PRIMARY KEY,
  canonical_key TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK(scope_type IN (
    'global', 'profile_record', 'company', 'job', 'application', 'session'
  )),
  scope_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN (
    'private_answer', 'profile_record', 'resume', 'attachment_metadata',
    'current_user_input', 'application_history', 'derived_format', 'none'
  )),
  source_ref TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active', 'superseded', 'revoked')),
  user_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(user_confirmed IN (0, 1)),
  confidence REAL NOT NULL DEFAULT 1 CHECK(confidence >= 0 AND confidence <= 1),
  valid_from TEXT,
  valid_until TEXT,
  last_confirmed_at TEXT,
  supersedes_answer_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(supersedes_answer_id) REFERENCES answer_values(id)
);

CREATE INDEX IF NOT EXISTS idx_answers_lookup
  ON answer_values(canonical_key, scope_type, scope_key, status);
CREATE INDEX IF NOT EXISTS idx_answers_validity
  ON answer_values(status, valid_until);

-- 一条答案可明确绑定某条履历记录。
CREATE TABLE IF NOT EXISTS answer_profile_links (
  answer_id TEXT NOT NULL,
  profile_record_id TEXT NOT NULL,
  PRIMARY KEY(answer_id, profile_record_id),
  FOREIGN KEY(answer_id) REFERENCES answer_values(id) ON DELETE CASCADE,
  FOREIGN KEY(profile_record_id) REFERENCES profile_records(id) ON DELETE CASCADE
);

-- 私有材料只保存本地索引，不把文件内容塞进数据库。
CREATE TABLE IF NOT EXISTS material_files (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK(purpose IN (
    'resume', 'portfolio', 'transcript', 'photo', 'certificate', 'other'
  )),
  local_path TEXT NOT NULL,
  display_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  scope_type TEXT CHECK(scope_type IN (
    'global', 'profile_record', 'company', 'job', 'application', 'session'
  )),
  scope_key TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(local_path, sha256)
);

CREATE INDEX IF NOT EXISTS idx_materials_purpose_active
  ON material_files(purpose, active);
CREATE INDEX IF NOT EXISTS idx_materials_scope
  ON material_files(scope_type, scope_key, active);

-- 从简历或附件提取出来、但还未确认的候选答案。
CREATE TABLE IF NOT EXISTS extracted_answer_candidates (
  id TEXT PRIMARY KEY,
  canonical_key TEXT NOT NULL,
  proposed_scope_type TEXT CHECK(proposed_scope_type IN (
    'global', 'profile_record', 'company', 'job', 'application', 'session'
  )),
  proposed_scope_key TEXT,
  value_json TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('resume', 'attachment_metadata')),
  source_ref TEXT NOT NULL,
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  evidence_redacted TEXT,
  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK(status IN ('candidate', 'accepted', 'rejected', 'superseded')),
  accepted_answer_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(accepted_answer_id) REFERENCES answer_values(id)
);

-- 用户更正记录。只保存必要说明，不保存公开日志。
CREATE TABLE IF NOT EXISTS private_change_log (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('answer_value', 'profile_record', 'material_file')),
  entity_id TEXT NOT NULL,
  change_kind TEXT NOT NULL CHECK(change_kind IN ('create', 'update', 'supersede', 'revoke', 'delete')),
  note TEXT,
  created_at TEXT NOT NULL
);
