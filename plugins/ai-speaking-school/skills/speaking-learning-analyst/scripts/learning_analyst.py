from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))

from _shared.cli_utils import emit, load_payload
from _shared.contracts import ArtifactRef, CycleReview, Handoff
from _shared.handoff_store import persist_handoff
from _shared.id_generator import make_id
from _shared.paths import SchoolPaths
from _shared.schedule_service import load_task_prompt, register_task
from _shared.state_store import (
    legacy_assessments,
    list_artifacts,
    migration_report,
    read_document,
    read_item_learning_state,
    save_artifact,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Learning analyst deterministic actions")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("assessment-context")
    cycle = sub.add_parser("commit-cycle")
    cycle.add_argument("--input", required=True)
    task = sub.add_parser("task-spec")
    task.add_argument("--kind", choices=["t30", "t0", "t14"], required=True)
    reg = sub.add_parser("register-task")
    reg.add_argument("--kind", choices=["t30", "t0", "t14"], required=True)
    reg.add_argument("--task-id", required=True)
    reg.add_argument("--schedule", default="")
    reg.add_argument("--timezone", default="local")
    args = parser.parse_args()

    paths = SchoolPaths.from_env(); paths.ensure()
    if args.command == "task-spec":
        emit({"kind": args.kind, "prompt": load_task_prompt(SKILL_ROOT, args.kind)})
        return
    if args.command == "register-task":
        emit(
            register_task(
                paths.database,
                args.kind,
                args.task_id,
                schedule=args.schedule,
                timezone_name=args.timezone,
            )
        )
        return
    if args.command == "assessment-context":
        emit({
            "course_plan": read_document(paths.database, "course_plan", {}),
            "item_learning_state": read_item_learning_state(paths.database),
            "lesson_reviews": list_artifacts(
                paths.database, "lesson_review_delta"
            ),
            "class_runs": [
                row
                for row in list_artifacts(paths.database, "class_run")
                if row.get("status") == "reviewed"
            ],
            "previous_cycle_reviews": list_artifacts(
                paths.database, "cycle_review"
            ),
            "legacy_assessments": legacy_assessments(paths.database),
            "migration": migration_report(paths.database),
        })
        return
    review = CycleReview.model_validate(load_payload(args.input))
    payload = review.model_dump(mode="json")
    save_artifact(
        paths.database,
        "cycle_review",
        review.cycle_review_id,
        payload,
    )
    result = {"cycle_review": payload, "handoff_written": False}
    if review.requires_head_teacher:
        handoff = Handoff(
            handoff_id=make_id("HO"), workflow_run_id=make_id("WF"),
            from_role="learning_analyst", to_role="head_teacher", action="revise_plan", status="completed",
            artifacts=[ArtifactRef(kind="cycle_review", artifact_id=review.cycle_review_id)],
            created_at=datetime.now(timezone.utc), idempotency_key=f"cycle:{review.cycle_review_id}:revise-plan",
            note=f"Cycle decision: {review.decision}",
        )
        result["handoff_written"] = persist_handoff(
            paths.database, handoff.model_dump(mode="json")
        )
    emit(result)


if __name__ == "__main__":
    main()
