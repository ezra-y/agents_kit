from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from _shared.cli_utils import emit, load_payload
from _shared.contracts import ArtifactRef, Handoff, LessonPlan, PersonaChangeEvent
from _shared.handoff_store import persist_handoff
from _shared.id_generator import make_id
from _shared.paths import SchoolPaths
from _shared.persona_service import apply_event, current_persona
from _shared.schedule_service import task_state
from _shared.state_store import (
    latest_ready_lesson,
    list_artifacts,
    migration_report,
    read_artifact,
    read_document,
    read_item_learning_state,
    save_artifact,
    write_document,
)


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def main() -> None:
    parser = argparse.ArgumentParser(description="Head teacher deterministic actions")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("context")
    save = sub.add_parser("save-document")
    save.add_argument(
        "--kind",
        choices=["learner_profile", "course_plan", "learner_curriculum"],
        required=True,
    )
    save.add_argument("--input", required=True)
    commit = sub.add_parser("commit-lesson")
    commit.add_argument("--input", required=True)
    sub.add_parser("complete-onboarding")
    persona = sub.add_parser("apply-persona-event")
    persona.add_argument("--input", required=True)
    args = parser.parse_args()

    paths = SchoolPaths.from_env(); paths.ensure()
    if args.command == "context":
        pending = [
            row
            for row in list_artifacts(paths.database, "class_run")
            if row.get("status") == "review_pending"
        ]
        item_state = read_item_learning_state(paths.database)
        due = sorted(
            [item_id for item_id, state in item_state.items() if state.get("next_review_at", "9999") <= now()],
        )
        emit({
            "database": str(paths.database),
            "learner_profile": read_document(paths.database, "learner_profile", {}),
            "course_plan": read_document(paths.database, "course_plan", {}),
            "learner_curriculum": read_document(paths.database, "learner_curriculum", {}),
            "legacy_course_reference": read_document(
                paths.database, "legacy_course_reference", None
            ),
            "teacher_persona": current_persona(paths.database),
            "current_lesson": latest_ready_lesson(paths.database),
            "pending_class_runs": pending,
            "due_item_ids": due,
            "latest_reviews": list_artifacts(
                paths.database, "lesson_review_delta"
            )[-3:],
            "latest_cycle_review": (
                list_artifacts(paths.database, "cycle_review") or [None]
            )[-1],
            "migration": migration_report(paths.database),
        })
        return
    if args.command == "save-document":
        payload = load_payload(args.input)
        version = write_document(paths.database, args.kind, payload)
        emit({
            "saved": f"sqlite:{args.kind}:v{version}",
            "kind": args.kind,
            "database": str(paths.database),
        })
        return
    if args.command == "apply-persona-event":
        payload = PersonaChangeEvent.model_validate(load_payload(args.input)).model_dump(mode="json")
        emit({
            "event": payload,
            "teacher_persona": apply_event(paths.database, payload),
        })
        return
    if args.command == "complete-onboarding":
        learner_profile = read_document(paths.database, "learner_profile", {})
        course_plan = read_document(paths.database, "course_plan", {})
        curriculum = read_document(paths.database, "learner_curriculum", {})
        first_lesson = read_artifact(
            paths.database,
            "lesson_plan",
            "L001",
        )
        missing = []
        if not learner_profile:
            missing.append("learner_profile")
        if not course_plan:
            missing.append("course_plan")
        if not curriculum:
            missing.append("learner_curriculum")
        if not first_lesson or first_lesson.get("status") != "ready":
            missing.append("L001_ready")
        if missing:
            emit({
                "status": "blocked",
                "missing": missing,
                "schedule_handoff_written": False,
            })
            return

        course_plan_id = str(
            course_plan.get("course_plan_id") or first_lesson["course_plan_id"]
        )
        handoff = Handoff(
            handoff_id=make_id("HO"),
            workflow_run_id=make_id("WF"),
            from_role="head_teacher",
            to_role="learning_analyst",
            action="setup_schedule",
            status="completed",
            artifacts=[
                ArtifactRef(
                    kind="course_plan",
                    artifact_id=course_plan_id,
                    version=course_plan.get("version"),
                )
            ],
            created_at=datetime.now(timezone.utc),
            idempotency_key=f"onboarding:{course_plan_id}:setup-schedule",
            note="First plan and L001 are ready; create T-30, T0, and T14.",
        )
        persisted = persist_handoff(
            paths.database,
            handoff.model_dump(mode="json"),
        )
        schedules = task_state(paths.database)
        missing_tasks = [
            kind
            for kind in ("t30", "t0", "t14")
            if schedules["tasks"].get(kind, {}).get("status") != "host_confirmed"
            or not schedules["tasks"].get(kind, {}).get("task_id")
        ]
        emit({
            "status": "complete" if not missing_tasks else "schedule_setup_required",
            "missing_tasks": missing_tasks,
            "schedule_handoff_written": persisted,
            "handoff": handoff.model_dump(mode="json"),
            "learner_profile": learner_profile,
            "learner_curriculum": curriculum,
            "course_plan": course_plan,
            "first_lesson": first_lesson,
            "schedule_state": schedules,
        })
        return
    if args.command == "commit-lesson":
        lesson = LessonPlan.model_validate(load_payload(args.input))
        if lesson.status != "ready":
            raise SystemExit("Only status=ready lessons can be committed")
        payload = lesson.model_dump(mode="json")
        location = save_artifact(
            paths.database,
            "lesson_plan",
            lesson.lesson_id,
            payload,
            version=lesson.plan_version,
        )
        handoff = Handoff(
            handoff_id=make_id("HO"), workflow_run_id=make_id("WF"),
            from_role="head_teacher", to_role="live_teacher", action="teach_lesson", status="completed",
            artifacts=[ArtifactRef(kind="lesson_plan", artifact_id=lesson.lesson_id, version=lesson.plan_version)],
            created_at=datetime.now(timezone.utc), idempotency_key=f"lesson:{lesson.lesson_id}:v{lesson.plan_version}:teach",
            note="Ready lesson committed by head teacher",
        )
        persisted = persist_handoff(paths.database, handoff.model_dump(mode="json"))
        emit({
            "status": "ready",
            "lesson_location": location,
            "database": str(paths.database),
            "handoff_written": persisted,
            "handoff": handoff.model_dump(mode="json"),
        })


if __name__ == "__main__":
    main()
