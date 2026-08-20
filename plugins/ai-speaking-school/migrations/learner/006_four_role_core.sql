CREATE TABLE IF NOT EXISTS school_documents (
    kind TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    created_at TEXT NOT NULL,
    PRIMARY KEY (kind, version)
);

CREATE TABLE IF NOT EXISTS lesson_plans (
    lesson_id TEXT NOT NULL,
    plan_version INTEGER NOT NULL CHECK (plan_version > 0),
    learner_id TEXT NOT NULL,
    course_plan_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'ready', 'superseded')),
    created_at TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    PRIMARY KEY (lesson_id, plan_version)
);

CREATE TABLE IF NOT EXISTS class_runs (
    class_run_id TEXT PRIMARY KEY,
    lesson_id TEXT NOT NULL,
    lesson_plan_version INTEGER NOT NULL CHECK (lesson_plan_version > 0),
    voice_session_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN ('review_pending', 'reviewed', 'unreadable', 'abandoned')
    ),
    note TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    UNIQUE (voice_session_id),
    FOREIGN KEY (lesson_id, lesson_plan_version)
        REFERENCES lesson_plans(lesson_id, plan_version)
);

CREATE TABLE IF NOT EXISTS lesson_review_deltas (
    review_id TEXT PRIMARY KEY,
    class_run_id TEXT NOT NULL UNIQUE REFERENCES class_runs(class_run_id),
    lesson_id TEXT NOT NULL,
    reviewed_at TEXT NOT NULL,
    completion TEXT NOT NULL CHECK (completion IN ('completed', 'partial', 'unreadable')),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE TABLE IF NOT EXISTS cycle_reviews (
    cycle_review_id TEXT PRIMARY KEY,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('keep', 'adjust', 'replan', 'defer')),
    created_at TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE TABLE IF NOT EXISTS handoffs (
    handoff_id TEXT PRIMARY KEY,
    workflow_run_id TEXT NOT NULL,
    from_role TEXT NOT NULL,
    to_role TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('completed', 'skipped', 'failed')),
    created_at TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE INDEX IF NOT EXISTS idx_school_documents_kind_version
    ON school_documents(kind, version DESC);
CREATE INDEX IF NOT EXISTS idx_lesson_plans_status_time
    ON lesson_plans(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_class_runs_status_time
    ON class_runs(status, started_at);
CREATE INDEX IF NOT EXISTS idx_lesson_reviews_time
    ON lesson_review_deltas(reviewed_at);
CREATE INDEX IF NOT EXISTS idx_cycle_reviews_period
    ON cycle_reviews(period_end);
CREATE INDEX IF NOT EXISTS idx_handoffs_route_time
    ON handoffs(to_role, status, created_at);
