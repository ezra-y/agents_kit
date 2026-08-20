from __future__ import annotations

import argparse
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from _shared.cli_utils import emit, load_payload
from _shared.contracts import ArtifactRef, Handoff, LessonReviewDelta
from _shared.handoff_store import persist_handoff
from _shared.id_generator import make_id
from _shared.memory_scheduler import apply_review
from _shared.paths import SchoolPaths
from _shared.persona_service import apply_event
from _shared.session_reader import SessionReaderUnavailable, read_session
from _shared.state_store import (
    list_artifacts,
    read_artifact,
    read_item_learning_state,
    save_artifact,
    save_review_evidence,
    update_class_status,
    write_item_learning_state,
)


def get_class(paths: SchoolPaths, class_run_id: str) -> dict:
    payload = read_artifact(paths.database, "class_run", class_run_id)
    if payload is None:
        raise SystemExit(f"Unknown class_run_id: {class_run_id}")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Teaching assistant deterministic actions")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("next-pending")
    ctx = sub.add_parser("review-context")
    ctx.add_argument("--class-run-id", required=True)
    read = sub.add_parser("read-session")
    read.add_argument("--class-run-id", required=True)
    read.add_argument("--transcript-file")
    apply_cmd = sub.add_parser("apply-review")
    apply_cmd.add_argument("--input", required=True)
    render = sub.add_parser("render-summary")
    render.add_argument("--review-id", required=True)
    args = parser.parse_args()

    paths = SchoolPaths.from_env(); paths.ensure()
    if args.command == "next-pending":
        pending = sorted(
            [
                row
                for row in list_artifacts(paths.database, "class_run")
                if row.get("status") == "review_pending"
            ],
            key=lambda row: row.get("started_at", ""),
        )
        emit({"class_run": pending[0] if pending else None, "count": len(pending)})
        return
    if args.command in {"review-context", "read-session"}:
        class_run = get_class(paths, args.class_run_id)
        lesson = read_artifact(
            paths.database,
            "lesson_plan",
            class_run["lesson_id"],
            version=class_run["lesson_plan_version"],
        )
        if args.command == "review-context":
            emit({
                "class_run": class_run,
                "lesson_plan": lesson,
                "item_learning_state": read_item_learning_state(paths.database),
            })
            return
        try:
            payload = read_session(
                class_run["voice_session_id"],
                transcript_file=Path(args.transcript_file) if args.transcript_file else None,
            )
            emit(payload)
        except SessionReaderUnavailable as exc:
            emit({"status": "adapter_required", "voice_session_id": class_run["voice_session_id"], "message": str(exc)})
        return
    if args.command == "render-summary":
        review = read_artifact(
            paths.database, "lesson_review_delta", args.review_id
        )
        if review is None:
            raise SystemExit(f"Unknown review_id: {args.review_id}")
        emit({"review_id": args.review_id, "summary": review.get("user_summary", []), "limitations": review.get("limitations", [])})
        return

    delta = LessonReviewDelta.model_validate(load_payload(args.input))
    class_run = get_class(paths, delta.class_run_id)
    if class_run["lesson_id"] != delta.lesson_id:
        raise SystemExit("Review lesson_id does not match class_run")
    item_state = read_item_learning_state(paths.database)
    item_state, adjusted = apply_review(
        item_state,
        delta.review_id,
        delta.reviewed_at.isoformat(),
        [item.model_dump(mode="json") for item in delta.item_updates],
    )
    payload = delta.model_dump(mode="json")
    payload["item_updates"] = adjusted
    delta = LessonReviewDelta.model_validate(payload)
    final_payload = delta.model_dump(mode="json")
    save_artifact(
        paths.database,
        "lesson_review_delta",
        delta.review_id,
        final_payload,
    )
    write_item_learning_state(paths.database, item_state)
    save_review_evidence(paths.database, final_payload)
    for event in delta.persona_change_events:
        apply_event(paths.database, event.model_dump(mode="json"))
    class_run["status"] = "unreadable" if delta.completion == "unreadable" else "reviewed"
    update_class_status(paths.database, delta.class_run_id, class_run["status"])
    handoff = Handoff(
        handoff_id=make_id("HO"), workflow_run_id=make_id("WF"),
        from_role="teaching_assistant", to_role="head_teacher", action="prepare_next_lesson", status="completed",
        artifacts=[ArtifactRef(kind="lesson_review_delta", artifact_id=delta.review_id)],
        created_at=delta.reviewed_at, idempotency_key=f"review:{delta.review_id}:prepare-next",
        note="Post-class evidence applied before next lesson preparation",
    )
    persisted = persist_handoff(paths.database, handoff.model_dump(mode="json"))
    emit({"review": delta.model_dump(mode="json"), "class_run_status": class_run["status"], "handoff_written": persisted})


if __name__ == "__main__":
    main()
