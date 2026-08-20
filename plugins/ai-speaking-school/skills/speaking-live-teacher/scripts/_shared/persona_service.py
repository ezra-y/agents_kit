from __future__ import annotations

from pathlib import Path
from typing import Any

from .contracts import PersonaChangeEvent
from .state_store import list_artifacts, save_artifact


def current_persona(database: Path) -> dict[str, Any]:
    events = list_artifacts(database, "persona_change_event")
    applied = [
        event
        for event in events
        if event["scope"] == "persistent"
        and event["status"] in {"confirmed", "applied"}
    ]
    instructions = list(dict.fromkeys(event["instruction"] for event in applied))
    return {
        "name": "小King",
        "instructions": instructions,
        "version": len(applied) + 1,
        "source": "skill_and_confirmed_events",
    }


def apply_event(database: Path, payload: dict[str, Any]) -> dict[str, Any]:
    event = PersonaChangeEvent.model_validate(payload).model_dump(mode="json")
    save_artifact(
        database,
        "persona_change_event",
        event["event_id"],
        event,
    )
    return current_persona(database)
