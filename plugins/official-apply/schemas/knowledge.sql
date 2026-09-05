-- 秋招企业官网自动投递：公共知识库 schema
-- SQLite。
--
-- 重要：knowledge/field-catalog.yaml 是公共字段目录的人工维护事实源。
-- catalog_fields_cache 和 catalog_aliases_cache 只是运行期查询缓存，
-- 应由导入脚本生成，不要手工同时维护两份。
--
-- 本数据库不得保存用户真实答案、简历内容、Cookie、Token 或验证码。

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_meta(key, value) VALUES
  ('schema_name', 'knowledge'),
  ('schema_version', '2');

-- 公共字段目录的运行期缓存。
CREATE TABLE IF NOT EXISTS catalog_fields_cache (
  canonical_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  value_type TEXT NOT NULL,
  common_controls_json TEXT NOT NULL DEFAULT '[]',
  answer_scope TEXT NOT NULL CHECK(answer_scope IN (
    'global', 'profile_record', 'company', 'job', 'application', 'session'
  )),
  answer_policy TEXT NOT NULL CHECK(answer_policy IN (
    'extract_or_ask', 'reuse_if_explicit', 'confirm_each_application', 'never_infer'
  )),
  sensitivity TEXT NOT NULL CHECK(sensitivity IN (
    'normal', 'personal', 'sensitive', 'highly_sensitive', 'credential'
  )),
  validation_rule TEXT,
  option_normalization_json TEXT,
  status TEXT NOT NULL CHECK(status IN ('candidate', 'verified', 'stable', 'deprecated')),
  superseded_by TEXT,
  source_catalog_hash TEXT NOT NULL,
  imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_aliases_cache (
  id TEXT PRIMARY KEY,
  canonical_key TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  language TEXT,
  source TEXT NOT NULL DEFAULT 'catalog',
  FOREIGN KEY(canonical_key) REFERENCES catalog_fields_cache(canonical_key),
  UNIQUE(canonical_key, normalized_alias)
);

CREATE INDEX IF NOT EXISTS idx_catalog_alias_normalized
  ON catalog_aliases_cache(normalized_alias);

-- 招聘 SaaS 家族。
CREATE TABLE IF NOT EXISTS saas_families (
  id TEXT PRIMARY KEY,
  family_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK(status IN ('candidate', 'verified', 'stable', 'deprecated')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 具体官网。公司和网站不是强制一对一。
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  host TEXT NOT NULL UNIQUE,
  company_key TEXT,
  company_name TEXT,
  detected_family_id TEXT,
  family_confidence REAL,
  detection_evidence_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active', 'inactive', 'blocked')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY(detected_family_id) REFERENCES saas_families(id)
);

CREATE INDEX IF NOT EXISTS idx_sites_company_key ON sites(company_key);
CREATE INDEX IF NOT EXISTS idx_sites_family ON sites(detected_family_id);

-- 每次官网真实出现的字段实例。
-- 同一个网站的同一个语义字段，可以因为步骤、重复组、页面实例不同而有多条观察。
CREATE TABLE IF NOT EXISTS site_field_observations (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  source_task_id TEXT,
  source_run_id TEXT,
  page_snapshot_id TEXT,
  page_url_pattern TEXT,
  page_type TEXT,
  step_key TEXT,
  step_label TEXT,
  frame_path_json TEXT NOT NULL DEFAULT '[]',
  section_path_json TEXT NOT NULL DEFAULT '[]',
  repeat_group_key TEXT,
  repeat_instance_index INTEGER,
  raw_label TEXT NOT NULL,
  accessible_name TEXT,
  label_evidence_json TEXT NOT NULL DEFAULT '[]',
  role TEXT,
  html_tag TEXT,
  input_type TEXT,
  html_name TEXT,
  html_id TEXT,
  autocomplete TEXT,
  control_kind TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0 CHECK(required IN (0, 1)),
  disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0, 1)),
  readonly INTEGER NOT NULL DEFAULT 0 CHECK(readonly IN (0, 1)),
  conditional_json TEXT,
  field_fingerprint TEXT NOT NULL,
  locator_candidates_json TEXT NOT NULL DEFAULT '[]',
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  observation_count INTEGER NOT NULL DEFAULT 1,
  last_fill_success INTEGER CHECK(last_fill_success IN (0, 1)),
  last_validation_success INTEGER CHECK(last_validation_success IN (0, 1)),
  FOREIGN KEY(site_id) REFERENCES sites(id)
);

CREATE INDEX IF NOT EXISTS idx_site_fields_site ON site_field_observations(site_id);
CREATE INDEX IF NOT EXISTS idx_site_fields_fingerprint
  ON site_field_observations(site_id, field_fingerprint);
CREATE INDEX IF NOT EXISTS idx_site_fields_raw_label
  ON site_field_observations(raw_label);
CREATE INDEX IF NOT EXISTS idx_site_fields_html_name
  ON site_field_observations(html_name);

-- 某个官网字段当时给出的选项。
-- 例如腾讯事业群和阿里业务线各自保存，不能塞进公共字段概念。
CREATE TABLE IF NOT EXISTS site_field_options (
  id TEXT PRIMARY KEY,
  site_field_id TEXT NOT NULL,
  raw_label TEXT NOT NULL,
  raw_value TEXT,
  normalized_value_json TEXT,
  source TEXT NOT NULL CHECK(source IN (
    'dom', 'aria', 'network_schema', 'opened_overlay', 'recipe'
  )),
  sort_order INTEGER,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0, 1)),
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  FOREIGN KEY(site_field_id) REFERENCES site_field_observations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_site_field_options_field
  ON site_field_options(site_field_id);

-- 官网字段实例到公共字段概念的映射。
CREATE TABLE IF NOT EXISTS field_mappings (
  id TEXT PRIMARY KEY,
  site_field_id TEXT NOT NULL,
  canonical_key TEXT,
  status TEXT NOT NULL CHECK(status IN (
    'verified', 'candidate', 'unresolved', 'conflict', 'rejected'
  )),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  evidence_json TEXT NOT NULL DEFAULT '[]',
  alternative_candidates_json TEXT NOT NULL DEFAULT '[]',
  verified_by TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(site_field_id) REFERENCES site_field_observations(id) ON DELETE CASCADE,
  FOREIGN KEY(canonical_key) REFERENCES catalog_fields_cache(canonical_key)
);

CREATE INDEX IF NOT EXISTS idx_field_mappings_site_field
  ON field_mappings(site_field_id);
CREATE INDEX IF NOT EXISTS idx_field_mappings_canonical
  ON field_mappings(canonical_key, status);

-- 新出现、还没决定是否进入公共字段目录的候选。
CREATE TABLE IF NOT EXISTS field_candidates (
  id TEXT PRIMARY KEY,
  proposed_key TEXT,
  proposed_name TEXT NOT NULL,
  meaning_summary TEXT,
  proposed_answer_scope TEXT CHECK(proposed_answer_scope IN (
    'global', 'profile_record', 'company', 'job', 'application', 'session'
  )),
  proposed_answer_policy TEXT CHECK(proposed_answer_policy IN (
    'extract_or_ask', 'reuse_if_explicit', 'confirm_each_application', 'never_infer'
  )),
  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK(status IN ('candidate', 'approved', 'merged', 'rejected')),
  approved_canonical_key TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(approved_canonical_key) REFERENCES catalog_fields_cache(canonical_key)
);

CREATE TABLE IF NOT EXISTS field_candidate_sources (
  candidate_id TEXT NOT NULL,
  site_field_id TEXT NOT NULL,
  PRIMARY KEY(candidate_id, site_field_id),
  FOREIGN KEY(candidate_id) REFERENCES field_candidates(id) ON DELETE CASCADE,
  FOREIGN KEY(site_field_id) REFERENCES site_field_observations(id) ON DELETE CASCADE
);

-- 网络响应中疑似表单 schema 的脱敏候选。
CREATE TABLE IF NOT EXISTS network_schema_candidates (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  source_run_id TEXT,
  request_url_pattern TEXT NOT NULL,
  http_method TEXT,
  response_content_type TEXT,
  detected_keys_json TEXT NOT NULL DEFAULT '[]',
  field_count_estimate INTEGER,
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  redacted_sample_json TEXT,
  parser_family_key TEXT,
  parse_status TEXT NOT NULL DEFAULT 'candidate'
    CHECK(parse_status IN ('candidate', 'parsed', 'ignored', 'failed')),
  discovered_at TEXT NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id)
);

CREATE INDEX IF NOT EXISTS idx_network_schema_site
  ON network_schema_candidates(site_id, parse_status);

-- 配方文件登记表。配方正文仍然放 YAML，方便 Review 和 Git diff。
CREATE TABLE IF NOT EXISTS recipe_registry (
  id TEXT PRIMARY KEY,
  recipe_kind TEXT NOT NULL CHECK(recipe_kind IN ('family', 'site')),
  recipe_key TEXT NOT NULL,
  version TEXT NOT NULL,
  file_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('candidate', 'verified', 'stable', 'deprecated')),
  family_id TEXT,
  site_id TEXT,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  last_failure_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(family_id) REFERENCES saas_families(id),
  FOREIGN KEY(site_id) REFERENCES sites(id),
  UNIQUE(recipe_kind, recipe_key, version)
);

-- 每次 locator 尝试。后续统计哪种策略真的更稳。
CREATE TABLE IF NOT EXISTS locator_attempts (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  family_id TEXT,
  source_run_id TEXT,
  site_field_id TEXT,
  action_kind TEXT,
  strategy TEXT NOT NULL,
  locator_description_redacted TEXT NOT NULL,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL CHECK(outcome IN (
    'success', 'not_found', 'ambiguous', 'not_actionable',
    'rejected_by_site', 'page_changed', 'timeout',
    'human_required', 'failed'
  )),
  duration_ms INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  recipe_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id),
  FOREIGN KEY(family_id) REFERENCES saas_families(id),
  FOREIGN KEY(site_field_id) REFERENCES site_field_observations(id),
  FOREIGN KEY(recipe_id) REFERENCES recipe_registry(id)
);

CREATE INDEX IF NOT EXISTS idx_locator_attempts_site_strategy
  ON locator_attempts(site_id, strategy, outcome);
CREATE INDEX IF NOT EXISTS idx_locator_attempts_family_strategy
  ON locator_attempts(family_id, strategy, outcome);
CREATE INDEX IF NOT EXISTS idx_locator_attempts_field
  ON locator_attempts(site_field_id);

-- 脱敏测试夹具登记。
CREATE TABLE IF NOT EXISTS fixture_registry (
  id TEXT PRIMARY KEY,
  fixture_key TEXT NOT NULL UNIQUE,
  site_id TEXT,
  family_id TEXT,
  directory_path TEXT NOT NULL,
  manifest_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  contains_dom INTEGER NOT NULL DEFAULT 0 CHECK(contains_dom IN (0, 1)),
  contains_aria INTEGER NOT NULL DEFAULT 0 CHECK(contains_aria IN (0, 1)),
  contains_network_schema INTEGER NOT NULL DEFAULT 0 CHECK(contains_network_schema IN (0, 1)),
  contains_screenshot INTEGER NOT NULL DEFAULT 0 CHECK(contains_screenshot IN (0, 1)),
  redaction_status TEXT NOT NULL CHECK(redaction_status IN (
    'pending', 'automatic_passed', 'human_reviewed', 'rejected'
  )),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id),
  FOREIGN KEY(family_id) REFERENCES saas_families(id)
);
