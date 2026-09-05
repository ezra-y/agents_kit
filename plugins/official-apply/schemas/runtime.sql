-- 秋招企业官网自动投递：运行状态数据库 schema
-- SQLite。
--
-- 运行日志默认只保存脱敏值、哈希或引用。
-- 真实答案在 private.sqlite；公共知识在 knowledge.sqlite。

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_meta(key, value) VALUES
  ('schema_name', 'runtime'),
  ('schema_version', '9');

CREATE TABLE IF NOT EXISTS task_batches (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS application_tasks (
  id TEXT PRIMARY KEY,
  batch_id TEXT,
  execute INTEGER NOT NULL DEFAULT 0 CHECK(execute IN (0, 1)),
  task_kind TEXT NOT NULL CHECK(task_kind IN ('company_resume', 'job_application')),
  company_key TEXT,
  company_name TEXT NOT NULL,
  job_key TEXT,
  job_title TEXT,
  job_location TEXT,
  job_url TEXT NOT NULL CHECK(length(trim(job_url)) > 0),
  job_selection_source TEXT
    CHECK(job_selection_source IN (
      'user_table', 'user_link', 'user_authorized_agent', 'legacy_record'
    )),
  job_selection_evidence TEXT,
  mode TEXT NOT NULL DEFAULT 'review' CHECK(mode IN ('review', 'auto')),
  resume_material_id TEXT,
  additional_material_ids_json TEXT NOT NULL DEFAULT '[]',
  profile_record_ids_json TEXT NOT NULL DEFAULT '[]',
  answer_set_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK(source IN ('user_table', 'qiuzhao_skill', 'manual', 'other')),
  external_row_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK(status IN (
      'queued', 'in_progress', 'completed', 'submitted', 'submission_uncertain',
      'needs_user', 'failed', 'skipped'
    )),
  result_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(batch_id) REFERENCES task_batches(id),
  CHECK(
    (
      task_kind = 'company_resume'
      AND job_selection_source IS NULL
      AND job_selection_evidence IS NULL
    )
    OR (
      task_kind = 'job_application'
      AND job_title IS NOT NULL
      AND length(trim(job_title)) > 0
      AND job_selection_source IS NOT NULL
      AND job_selection_evidence IS NOT NULL
      AND length(trim(job_selection_evidence)) > 0
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_tasks_execute_status
  ON application_tasks(execute, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_external_row
  ON application_tasks(source, external_row_id)
  WHERE external_row_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS browser_sessions (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK(mode IN ('persistent', 'attach_existing', 'isolated_test')),
  browser_name TEXT NOT NULL,
  profile_name TEXT,
  status TEXT NOT NULL CHECK(status IN ('starting', 'active', 'disconnected', 'closed', 'failed')),
  active_page_id TEXT,
  owner_pid INTEGER,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS application_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  browser_session_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN (
    'queued', 'opening', 'discovering', 'collecting_answers', 'waiting_for_user',
    'filling', 'validating', 'ready_for_review', 'ready_to_submit', 'submitting',
    'submitted_confirmed', 'submission_uncertain', 'failed_recoverable',
    'failed_terminal', 'cancelled'
  )),
  current_url_redacted TEXT,
  current_page_type TEXT,
  current_step_key TEXT,
  current_snapshot_id TEXT,
  profile_record_ids_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  error_code TEXT,
  error_message_redacted TEXT,
  FOREIGN KEY(task_id) REFERENCES application_tasks(id),
  FOREIGN KEY(browser_session_id) REFERENCES browser_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_runs_task ON application_runs(task_id, started_at);
CREATE INDEX IF NOT EXISTS idx_runs_state ON application_runs(state, updated_at);

-- 状态变化必须追加记录，不只覆盖当前状态。
CREATE TABLE IF NOT EXISTS state_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  reason_code TEXT,
  note_redacted TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES application_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_state_events_run
  ON state_events(run_id, created_at);

CREATE TABLE IF NOT EXISTS page_snapshots (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  page_type TEXT NOT NULL,
  url_redacted TEXT NOT NULL,
  title_redacted TEXT,
  step_key TEXT,
  capture_mode TEXT NOT NULL CHECK(capture_mode IN ('full', 'region', 'diff')),
  region_ref_json TEXT,
  aria_snapshot_path TEXT,
  page_schema_path TEXT NOT NULL,
  screenshot_path_redacted TEXT,
  content_hash TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES application_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_page_snapshots_run
  ON page_snapshots(run_id, captured_at);

-- 当前运行中每个字段的状态。
CREATE TABLE IF NOT EXISTS run_field_states (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  page_snapshot_id TEXT NOT NULL,
  runtime_ref TEXT NOT NULL,
  site_field_id TEXT,
  canonical_key TEXT,
  mapping_status TEXT,
  answer_status TEXT,
  field_status TEXT NOT NULL,
  answer_id_ref TEXT,
  expected_value_hash TEXT,
  current_value_hash TEXT,
  error_code TEXT,
  error_message_redacted TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES application_runs(id) ON DELETE CASCADE,
  FOREIGN KEY(page_snapshot_id) REFERENCES page_snapshots(id) ON DELETE CASCADE,
  UNIQUE(run_id, page_snapshot_id, runtime_ref)
);

CREATE INDEX IF NOT EXISTS idx_run_fields_status
  ON run_field_states(run_id, field_status);

CREATE TABLE IF NOT EXISTS missing_answer_requests (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  runtime_ref TEXT NOT NULL,
  site_field_id TEXT,
  canonical_key TEXT,
  raw_question TEXT NOT NULL,
  section_path_json TEXT NOT NULL DEFAULT '[]',
  required INTEGER NOT NULL DEFAULT 0 CHECK(required IN (0, 1)),
  control_kind TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '[]',
  reason TEXT NOT NULL,
  suggested_scope_type TEXT,
  suggested_scope_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'answered', 'skipped', 'cancelled')),
  answer_id_ref TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY(run_id) REFERENCES application_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_missing_answers_run_status
  ON missing_answer_requests(run_id, status);

CREATE TABLE IF NOT EXISTS action_plans (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  page_snapshot_id TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  unresolved_refs_json TEXT NOT NULL DEFAULT '[]',
  plan_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK(status IN ('created', 'executing', 'completed', 'cancelled', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES application_runs(id) ON DELETE CASCADE,
  FOREIGN KEY(page_snapshot_id) REFERENCES page_snapshots(id)
);

CREATE TABLE IF NOT EXISTS action_attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  action_plan_id TEXT,
  action_item_id TEXT,
  runtime_ref TEXT,
  action_kind TEXT NOT NULL,
  strategy TEXT,
  outcome TEXT NOT NULL,
  before_value_hash TEXT,
  after_value_hash TEXT,
  candidate_count INTEGER,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  page_changed INTEGER NOT NULL DEFAULT 0 CHECK(page_changed IN (0, 1)),
  new_snapshot_id TEXT,
  error_code TEXT,
  error_message_redacted TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES application_runs(id) ON DELETE CASCADE,
  FOREIGN KEY(action_plan_id) REFERENCES action_plans(id),
  FOREIGN KEY(new_snapshot_id) REFERENCES page_snapshots(id)
);

CREATE INDEX IF NOT EXISTS idx_action_attempts_run
  ON action_attempts(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_action_attempts_strategy
  ON action_attempts(strategy, outcome);

CREATE TABLE IF NOT EXISTS validation_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  page_snapshot_id TEXT NOT NULL,
  valid INTEGER NOT NULL CHECK(valid IN (0, 1)),
  ready_for_review INTEGER NOT NULL CHECK(ready_for_review IN (0, 1)),
  ready_to_submit INTEGER NOT NULL CHECK(ready_to_submit IN (0, 1)),
  checked_field_count INTEGER NOT NULL DEFAULT 0,
  issues_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES application_runs(id) ON DELETE CASCADE,
  FOREIGN KEY(page_snapshot_id) REFERENCES page_snapshots(id)
);

CREATE INDEX IF NOT EXISTS idx_validation_run
  ON validation_results(run_id, created_at);

CREATE TABLE IF NOT EXISTS human_takeover_requests (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  message TEXT NOT NULL,
  resume_condition TEXT NOT NULL,
  current_url_redacted TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'resolved', 'cancelled')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY(run_id) REFERENCES application_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_takeover_run_status
  ON human_takeover_requests(run_id, status);

-- 每个 run 最多一条 pending 人工卡点。pending 是「当前正在等什么」，
-- 历史变化保留为 status='resolved'。唯一约束兜住写入路径的漏删（v9）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_takeover_run_pending
  ON human_takeover_requests(run_id)
  WHERE status = 'pending';

-- 最终提交前的一次性批准令牌。
--
-- 令牌绑定任务、运行、页面 URL、控件数量和值摘要。页面或填写内容变化后，
-- 旧令牌不能继续使用；令牌只保存 SHA-256 摘要，不保存可重放原文。
CREATE TABLE IF NOT EXISTS submission_approval_tokens (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL,
  page_url TEXT NOT NULL,
  page_control_count INTEGER NOT NULL,
  page_value_hash TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'consumed', 'invalidated', 'expired')),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  FOREIGN KEY(run_id) REFERENCES application_runs(id) ON DELETE CASCADE,
  FOREIGN KEY(task_id) REFERENCES application_tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_submission_approvals_run
  ON submission_approval_tokens(run_id, status);

-- 每次最终提交只有一条尝试记录。
-- idempotency_key 必须唯一，防止相同任务重复提交。
CREATE TABLE IF NOT EXISTS submission_attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  approval_source TEXT,
  approval_token_hash TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  outcome TEXT NOT NULL CHECK(outcome IN (
    'in_progress', 'confirmed', 'uncertain', 'failed_before_commit', 'blocked'
  )),
  success_evidence_json TEXT NOT NULL DEFAULT '[]',
  error_code TEXT,
  error_message_redacted TEXT,
  FOREIGN KEY(run_id) REFERENCES application_runs(id),
  FOREIGN KEY(task_id) REFERENCES application_tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_submission_task
  ON submission_attempts(task_id, started_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_submission_task_active
  ON submission_attempts(task_id)
  WHERE outcome IN ('in_progress', 'confirmed', 'uncertain');

-- 回写用户投递队列的事件，避免直接改表失败后没有记录。
CREATE TABLE IF NOT EXISTS task_update_outbox (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  target_status TEXT NOT NULL,
  result_note_redacted TEXT,
  payload_json TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(delivery_status IN ('pending', 'delivered', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(task_id) REFERENCES application_tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_outbox_delivery
  ON task_update_outbox(delivery_status, created_at);

-- 一条任务最多一条待导出记录。pending 是「下一次要写出的最新事实」，
-- 不是历史日志；历史由任务、运行和提交记录保存。
-- 唯一约束兜底：写入路径漏删时，数据库本身拒绝重复 pending（v8）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_task_pending
  ON task_update_outbox(task_id)
  WHERE delivery_status = 'pending';

-- ============================================================
-- auto 模式的显式批准（修复清单 P1-11）
--
-- 「在队列里写 mode=auto」不等于批准无人值守提交——那只是一个字段。
-- 真正让系统自己点提交，必须有一次**单独的、可撤销的、留痕的**批准动作。
--
-- 一条任务一条记录。撤销就是删掉它。
-- ============================================================
CREATE TABLE IF NOT EXISTS auto_submit_approvals (
  task_id TEXT PRIMARY KEY,
  approved_by TEXT NOT NULL,
  note TEXT,
  approved_at TEXT NOT NULL,
  FOREIGN KEY(task_id) REFERENCES application_tasks(id) ON DELETE CASCADE
);

-- 任务级域名放行（修复清单 P2-7）。
--
-- 投递过程里跳到别的域名是常态：登录走 sso.example.com，
-- 表单挂在招聘 SaaS 上，验证码图片在 CDN 上。全都拦住没法用，
-- 全都放开等于没有边界。
--
-- 所以放行是**一条一条**加的，而且绑死在一个 task 上：
-- 给 A 公司放行过的域名，到 B 公司不算数。
--
-- 绝不支持通配符。`*.example.com` 看着方便，但一个子域被人拿下
-- 就等于整片放开，而且事后查不出当初到底放了什么。
CREATE TABLE IF NOT EXISTS host_approvals (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  -- 从哪次运行里批的。用来回答「当时为什么放这个域名」。
  run_id TEXT,
  host TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(task_id, host),
  FOREIGN KEY(task_id) REFERENCES application_tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_host_approvals_task ON host_approvals(task_id);
