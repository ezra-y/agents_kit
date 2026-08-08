CREATE TABLE IF NOT EXISTS coach_mode_state (
    thread_id TEXT PRIMARY KEY,
    active INTEGER NOT NULL CHECK (active IN (0, 1)),
    phase TEXT NOT NULL CHECK (phase IN ('onboarding', 'teaching', 'after_class')),
    lesson_date TEXT,
    activated_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deactivated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_coach_mode_active
    ON coach_mode_state(active, updated_at);
