CREATE TABLE IF NOT EXISTS schedule_state (
    task_kind TEXT PRIMARY KEY CHECK (task_kind IN ('t30', 't0', 't14')),
    task_id TEXT,
    schedule TEXT NOT NULL DEFAULT '',
    timezone TEXT NOT NULL DEFAULT 'local',
    fingerprint TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (
        status IN ('pending_host_creation', 'pending_host_update', 'host_confirmed', 'disabled')
    ),
    updated_at TEXT NOT NULL,
    host_confirmed_at TEXT
);

CREATE TABLE IF NOT EXISTS cycle_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_cycle_review_id TEXT REFERENCES cycle_reviews(cycle_review_id),
    last_period_end TEXT,
    next_due_at TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS legacy_assessment_imports (
    legacy_cycle_id TEXT PRIMARY KEY,
    mapped_decision TEXT CHECK (mapped_decision IN ('keep', 'adjust', 'replan')),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS migration_runs (
    migration_run_id TEXT PRIMARY KEY,
    source_database TEXT NOT NULL,
    candidate_database TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
    report_json TEXT NOT NULL CHECK (json_valid(report_json))
);

CREATE INDEX IF NOT EXISTS idx_schedule_state_status
    ON schedule_state(status);
CREATE INDEX IF NOT EXISTS idx_legacy_assessment_decision
    ON legacy_assessment_imports(mapped_decision);
