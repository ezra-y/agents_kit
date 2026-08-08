from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .paths import runtime_dir


@dataclass(frozen=True)
class ClassSchedule:
    schedule_text: str
    timezone: str
    rrule: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


def class_schedule(
    schedule_text: str,
    timezone: str,
    rrule: str,
) -> ClassSchedule:
    description = schedule_text.strip()
    recurrence = rrule.strip()
    if not description:
        raise ValueError("schedule_text cannot be empty")
    zone = _timezone(timezone)
    if "RRULE:" not in recurrence.upper():
        raise ValueError("rrule must contain an RFC 5545 RRULE")
    return ClassSchedule(
        schedule_text=description,
        timezone=zone.key,
        rrule=recurrence,
    )


def reminder_status() -> dict[str, object]:
    settings = _read_settings()
    schedule = settings.get("class_schedule")
    automation_id = settings.get("automation_id")
    if not isinstance(schedule, dict):
        return {
            "status": "unconfigured",
            "automation_id": automation_id,
            "class_schedule": None,
        }
    status = str(schedule.get("status", "unconfigured"))
    if status == "active" and not automation_id:
        status = "pending"
    return {
        "status": status,
        "automation_id": automation_id,
        "class_schedule": schedule,
    }


def save_class_schedule(
    schedule: ClassSchedule,
    automation_id: str,
) -> dict[str, object]:
    if not automation_id.strip():
        raise ValueError("automation_id cannot be empty")
    settings = _read_settings()
    settings["automation_id"] = automation_id.strip()
    settings["class_schedule"] = {
        "status": "active",
        **schedule.to_dict(),
        "updated_at": datetime.now(_timezone(schedule.timezone)).isoformat(),
    }
    _write_settings(settings)
    return reminder_status()


def dismiss_reminder_setup() -> dict[str, object]:
    settings = _read_settings()
    settings["automation_id"] = None
    settings["class_schedule"] = {
        "status": "dismissed",
        "updated_at": datetime.now().astimezone().isoformat(),
    }
    _write_settings(settings)
    return reminder_status()


def _timezone(value: str) -> ZoneInfo:
    try:
        return ZoneInfo(value)
    except ZoneInfoNotFoundError as error:
        raise ValueError(f"Unknown timezone: {value}") from error


def _settings_path() -> Path:
    return runtime_dir() / "settings.json"


def _read_settings() -> dict[str, object]:
    path = _settings_path()
    if not path.exists():
        return {"learner_id": 1}
    loaded = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(loaded, dict):
        raise ValueError("runtime/settings.json must contain a JSON object")
    return loaded


def _write_settings(settings: dict[str, object]) -> None:
    path = _settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(settings, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)
