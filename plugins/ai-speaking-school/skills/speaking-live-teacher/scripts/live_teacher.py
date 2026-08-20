from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from _shared.cli_utils import emit
from _shared.contracts import ArtifactRef, ClassRun, Handoff, LessonPlan
from _shared.handoff_store import persist_handoff
from _shared.id_generator import make_id
from _shared.material_service import search
from _shared.paths import SchoolPaths
from _shared.persona_service import current_persona
from _shared.state_store import (
    class_run_for_session,
    latest_ready_lesson,
    read_document,
    save_artifact,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Live teacher deterministic actions")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("context")
    register = sub.add_parser("register-class")
    register.add_argument("--session-id", required=True)
    register.add_argument("--note", default="")
    query = sub.add_parser("query-material")
    query.add_argument("--query", required=True)
    query.add_argument("--limit", type=int, default=6)
    args = parser.parse_args()

    paths = SchoolPaths.from_env(); paths.ensure()
    lesson_payload = latest_ready_lesson(paths.database)
    if args.command == "query-material":
        emit(
            search(
                paths.database,
                args.query,
                max(1, min(args.limit, 20)),
                lancedb_path=paths.lancedb,
                manifest_path=paths.embedding_manifest,
                model_cache=paths.model_cache,
            )
        )
        return
    if lesson_payload is None:
        raise SystemExit("No current lesson is prepared")
    lesson = LessonPlan.model_validate(lesson_payload)
    if lesson.status != "ready":
        raise SystemExit("Current lesson is not ready")
    if args.command == "context":
        emit({
            "lesson_plan": lesson.model_dump(mode="json"),
            "execution_contract": {
                "delivery_pace": lesson.delivery_pace,
                "required_modules": lesson.required_modules,
                "auto_advance": True,
                "hint_ladder": lesson.hint_ladder,
                "end_gate": (
                    "Finish every required module unless the learner explicitly "
                    "reports fatigue, time pressure, or asks to end."
                ),
            },
            "teacher_persona": current_persona(paths.database),
            "learner_profile": read_document(
                paths.database, "learner_profile", {}
            ),
        })
        return
    existing = class_run_for_session(paths.database, args.session_id)
    if existing is not None:
        emit({
            "class_run": existing,
            "location": f"sqlite:class_run:{existing['class_run_id']}",
            "database": str(paths.database),
            "handoff_written": False,
            "idempotent_replay": True,
        })
        return
    class_run = ClassRun(
        class_run_id=make_id("CR"), lesson_id=lesson.lesson_id,
        lesson_plan_version=lesson.plan_version, voice_session_id=args.session_id,
        started_at=datetime.now(timezone.utc), note=args.note,
    )
    payload = class_run.model_dump(mode="json")
    location = save_artifact(
        paths.database,
        "class_run",
        class_run.class_run_id,
        payload,
    )
    handoff = Handoff(
        handoff_id=make_id("HO"), workflow_run_id=make_id("WF"),
        from_role="live_teacher", to_role="teaching_assistant", action="review_class", status="completed",
        artifacts=[ArtifactRef(kind="class_run", artifact_id=class_run.class_run_id)],
        created_at=datetime.now(timezone.utc), idempotency_key=f"class:{class_run.class_run_id}:review",
        note="Voice class registered at class start",
    )
    persisted = persist_handoff(paths.database, handoff.model_dump(mode="json"))
    emit({
        "class_run": payload,
        "location": location,
        "database": str(paths.database),
        "handoff_written": persisted,
    })


if __name__ == "__main__":
    main()
