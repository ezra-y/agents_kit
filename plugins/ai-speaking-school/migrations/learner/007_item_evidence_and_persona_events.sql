CREATE TABLE IF NOT EXISTS item_learning_state (
    item_id TEXT PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('learning', 'usable', 'fluent')),
    first_learned_at TEXT NOT NULL,
    last_reviewed_at TEXT NOT NULL,
    stability REAL NOT NULL CHECK (stability > 0),
    target_retention REAL NOT NULL CHECK (target_retention > 0 AND target_retention < 1),
    next_review_at TEXT NOT NULL,
    review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
    lapse_count INTEGER NOT NULL DEFAULT 0 CHECK (lapse_count >= 0),
    scheduler_version TEXT NOT NULL,
    last_review_id TEXT,
    last_reason TEXT NOT NULL DEFAULT '',
    last_observations_json TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(last_observations_json))
);

INSERT OR IGNORE INTO item_learning_state (
    item_id,
    status,
    first_learned_at,
    last_reviewed_at,
    stability,
    target_retention,
    next_review_at,
    review_count,
    lapse_count,
    scheduler_version
)
SELECT
    item_id,
    status,
    first_learned_at,
    last_reviewed_at,
    stability,
    target_retention,
    next_due_at,
    review_count,
    lapse_count,
    scheduler_version
FROM review_state;

CREATE TABLE IF NOT EXISTS item_evidence (
    evidence_id TEXT PRIMARY KEY,
    source TEXT NOT NULL CHECK (source IN ('legacy_session_item', 'lesson_review')),
    review_id TEXT REFERENCES lesson_review_deltas(review_id),
    class_run_id TEXT REFERENCES class_runs(class_run_id),
    legacy_session_id TEXT,
    item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE RESTRICT,
    observed_at TEXT NOT NULL,
    evidence_type TEXT NOT NULL,
    support_level TEXT NOT NULL DEFAULT 'unknown',
    outcome TEXT NOT NULL DEFAULT 'not_judged',
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE TABLE IF NOT EXISTS learning_error_evidence (
    error_id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES lesson_review_deltas(review_id),
    class_run_id TEXT NOT NULL REFERENCES class_runs(class_run_id),
    item_id TEXT REFERENCES content_items(id) ON DELETE SET NULL,
    observed_at TEXT NOT NULL,
    learner_version TEXT NOT NULL,
    corrected_version TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS persona_events (
    event_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('temporary', 'persistent')),
    instruction TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('proposed', 'confirmed', 'applied', 'rejected')),
    effective_from TEXT,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE INDEX IF NOT EXISTS idx_item_learning_due
    ON item_learning_state(next_review_at);
CREATE INDEX IF NOT EXISTS idx_item_evidence_item_time
    ON item_evidence(item_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_item_evidence_review
    ON item_evidence(review_id);
CREATE INDEX IF NOT EXISTS idx_error_evidence_item_time
    ON learning_error_evidence(item_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_persona_events_status_time
    ON persona_events(status, requested_at);
