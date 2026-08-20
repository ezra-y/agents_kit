from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "tests" / "fixtures"


def run(skill: str, script: str, *args: str) -> dict:
    path = ROOT / "skills" / skill / "scripts" / script
    result = subprocess.run([sys.executable, str(path), *args], text=True, capture_output=True, check=True, env=os.environ.copy())
    return json.loads(result.stdout)


def test_s1_s2_s3_s4_flow(school_home: Path, tmp_path: Path):
    profile_path = tmp_path / "profile.json"
    profile_path.write_text(
        json.dumps(
            {
                "preferred_name": "Test Learner",
                "goals": "Use English in group conversations",
                "interests": ["travel"],
                "preferred_topics": ["work"],
                "language_mode": "mostly_english",
            }
        ),
        encoding="utf-8",
    )
    saved_profile = run(
        "speaking-head-teacher",
        "head_teacher.py",
        "save-document",
        "--kind",
        "learner_profile",
        "--input",
        str(profile_path),
    )
    assert saved_profile["saved"] == "sqlite:learner_profile:v1"

    for kind, payload in (
        (
            "learner_curriculum",
            {
                "curriculum_id": "CUR01",
                "stages": [
                    {
                        "title": "Conversation repair",
                        "chapters": ["Ask for repetition", "Ask for slower speech"],
                    }
                ],
            },
        ),
        (
            "course_plan",
            {
                "course_plan_id": "CP01",
                "version": 1,
                    "goal": "Handle missed information in group conversations",
                "estimated_lessons": 6,
            },
        ),
    ):
        path = tmp_path / f"{kind}.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        run(
            "speaking-head-teacher",
            "head_teacher.py",
            "save-document",
            "--kind",
            kind,
            "--input",
            str(path),
        )

    blocked = run(
        "speaking-head-teacher",
        "head_teacher.py",
        "complete-onboarding",
    )
    assert blocked["status"] == "blocked"
    assert blocked["missing"] == ["L001_ready"]

    lesson = json.loads((EXAMPLES / "lesson_plan.example.json").read_text(encoding="utf-8"))
    lesson_path = tmp_path / "lesson.json"; lesson_path.write_text(json.dumps(lesson), encoding="utf-8")
    committed = run("speaking-head-teacher", "head_teacher.py", "commit-lesson", "--input", str(lesson_path))
    assert committed["status"] == "ready"

    pending_schedule = run(
        "speaking-head-teacher",
        "head_teacher.py",
        "complete-onboarding",
    )
    assert pending_schedule["status"] == "schedule_setup_required"
    assert pending_schedule["missing_tasks"] == ["t30", "t0", "t14"]
    for kind in ("t30", "t0", "t14"):
        run(
            "speaking-learning-analyst",
            "learning_analyst.py",
            "register-task",
            "--kind",
            kind,
            "--task-id",
            f"host-{kind}-001",
        )
    completed_onboarding = run(
        "speaking-head-teacher",
        "head_teacher.py",
        "complete-onboarding",
    )
    assert completed_onboarding["status"] == "complete"
    assert completed_onboarding["missing_tasks"] == []

    live_context = run(
        "speaking-live-teacher",
        "live_teacher.py",
        "context",
    )
    assert live_context["execution_contract"]["auto_advance"] is True
    assert live_context["execution_contract"]["delivery_pace"] == "slow"
    assert live_context["execution_contract"]["required_modules"] == lesson["required_modules"]

    registered = run("speaking-live-teacher", "live_teacher.py", "register-class", "--session-id", "voice-test-001")
    class_run_id = registered["class_run"]["class_run_id"]
    assert registered["class_run"]["voice_session_id"] == "voice-test-001"
    repeated = run(
        "speaking-live-teacher",
        "live_teacher.py",
        "register-class",
        "--session-id",
        "voice-test-001",
    )
    assert repeated["class_run"]["class_run_id"] == class_run_id
    assert repeated["idempotent_replay"] is True

    pending = run("speaking-teaching-assistant", "teaching_assistant.py", "next-pending")
    assert pending["class_run"]["class_run_id"] == class_run_id

    review = json.loads((EXAMPLES / "lesson_review_delta.example.json").read_text(encoding="utf-8"))
    review["class_run_id"] = class_run_id
    review["lesson_id"] = lesson["lesson_id"]
    review_path = tmp_path / "review.json"; review_path.write_text(json.dumps(review), encoding="utf-8")
    applied = run("speaking-teaching-assistant", "teaching_assistant.py", "apply-review", "--input", str(review_path))
    assert applied["class_run_status"] == "reviewed"
    assert applied["review"]["item_updates"][0]["next_review_at"]

    cycle = json.loads((EXAMPLES / "cycle_review.example.json").read_text(encoding="utf-8"))
    cycle["reviewed_class_run_ids"] = [class_run_id]
    cycle_path = tmp_path / "cycle.json"; cycle_path.write_text(json.dumps(cycle), encoding="utf-8")
    result = run("speaking-learning-analyst", "learning_analyst.py", "commit-cycle", "--input", str(cycle_path))
    assert result["cycle_review"]["decision"] in {"adjust", "replan"}
    assert result["handoff_written"] is True

    database = school_home / "learner" / "state" / "coach.sqlite"
    assert database.is_file()
    assert list(school_home.rglob("*.json")) == []
    with sqlite3.connect(database) as connection:
        seeded_ids = {
            row[0]
            for row in connection.execute(
                "SELECT id FROM content_items WHERE id LIKE 'supplement-repair-%'"
            )
        }
        assert {
            "supplement-repair-0001",
            "supplement-repair-0002",
        }.issubset(seeded_ids)
        assert connection.execute("SELECT COUNT(*) FROM learner_profile").fetchone()[0] == 0
        assert connection.execute(
            "SELECT COUNT(*) FROM school_documents WHERE kind = 'learner_profile'"
        ).fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM class_runs").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM item_evidence").fetchone()[0] == 2


def test_task_prompt_and_registration(school_home: Path):
    spec = run("speaking-learning-analyst", "learning_analyst.py", "task-spec", "--kind", "t30")
    assert "speaking-teaching-assistant" in spec["prompt"]
    state = run("speaking-learning-analyst", "learning_analyst.py", "register-task", "--kind", "t30", "--task-id", "task-real-001")
    assert state["tasks"]["t30"]["task_id"] == "task-real-001"
