CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    filename TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
);

CREATE TABLE learner_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    preferred_name TEXT,
    english_name TEXT,
    coach_name TEXT,
    goals TEXT,
    interests_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(interests_json)),
    preferred_topics_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(preferred_topics_json)),
    language_mode TEXT NOT NULL DEFAULT 'mostly_english',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE content_items (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('expression', 'pattern', 'screen_line')),
    group_id TEXT,
    text TEXT NOT NULL CHECK (length(trim(text)) > 0),
    meaning TEXT NOT NULL DEFAULT '',
    topics_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(topics_json)),
    examples_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(examples_json)),
    usage_note TEXT NOT NULL DEFAULT '',
    context TEXT NOT NULL DEFAULT '',
    source_file TEXT NOT NULL,
    source_order INTEGER NOT NULL CHECK (source_order > 0),
    media_ref_json TEXT CHECK (media_ref_json IS NULL OR json_valid(media_ref_json)),
    content_hash TEXT NOT NULL,
    approved INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (source_file, source_order)
);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    topic TEXT NOT NULL DEFAULT '',
    lesson_path TEXT,
    summary_path TEXT,
    notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE session_items (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE RESTRICT,
    studied_at TEXT NOT NULL,
    activity TEXT NOT NULL CHECK (activity IN ('new', 'review')),
    grade TEXT NOT NULL CHECK (grade IN ('forgot', 'hard', 'good', 'easy')),
    status_after TEXT NOT NULL CHECK (status_after IN ('learning', 'usable', 'fluent')),
    correction_count INTEGER NOT NULL DEFAULT 0 CHECK (correction_count >= 0),
    PRIMARY KEY (session_id, item_id)
);

CREATE TABLE review_state (
    item_id TEXT PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('learning', 'usable', 'fluent')),
    first_learned_at TEXT NOT NULL,
    last_reviewed_at TEXT NOT NULL,
    stability REAL NOT NULL CHECK (stability > 0),
    target_retention REAL NOT NULL CHECK (target_retention > 0 AND target_retention < 1),
    next_due_at TEXT NOT NULL,
    review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
    lapse_count INTEGER NOT NULL DEFAULT 0 CHECK (lapse_count >= 0),
    scheduler_version TEXT NOT NULL
);

CREATE TABLE errors (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    item_id TEXT REFERENCES content_items(id) ON DELETE SET NULL,
    occurred_at TEXT NOT NULL,
    user_said TEXT NOT NULL,
    natural_version TEXT NOT NULL,
    error_type TEXT NOT NULL CHECK (
        error_type IN (
            'chinglish',
            'awkward',
            'grammar',
            'collocation',
            'pronunciation',
            'prosody',
            'pragmatics'
        )
    ),
    note TEXT NOT NULL DEFAULT '',
    resolved_at TEXT,
    next_due_at TEXT NOT NULL
);

CREATE INDEX idx_content_type_approved
    ON content_items(type, approved);
CREATE INDEX idx_session_items_item_time
    ON session_items(item_id, studied_at);
CREATE INDEX idx_review_state_due
    ON review_state(next_due_at);
CREATE INDEX idx_review_state_status_due
    ON review_state(status, next_due_at);
CREATE INDEX idx_errors_due
    ON errors(resolved_at, next_due_at);
CREATE INDEX idx_errors_item
    ON errors(item_id, occurred_at);

