from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime, time, timedelta
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .paths import runtime_dir

Cadence = Literal["daily", "every_other_day", "weekly"]

WEEKDAY_CODES = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")


@dataclass(frozen=True)
class ClassSchedule:
    cadence: Cadence
    local_time: str
    timezone: str
    weekdays: list[str]
    starts_at: str
    rrule: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def plan_class_schedule(
    cadence: Cadence,
    local_time: str,
    timezone: str,
    weekdays: list[str] | None = None,
    reference: datetime | None = None,
) -> ClassSchedule:
    zone = _timezone(timezone)
    clock = _clock(local_time)
    selected_days = _weekdays(cadence, weekdays or [])
    current = reference.astimezone(zone) if reference else datetime.now(zone)
    start = _next_start(current, clock, cadence, selected_days)
    recurrence = _rrule(cadence, start, timezone, selected_days)
    return ClassSchedule(
        cadence=cadence,
        local_time=clock.strftime("%H:%M"),
        timezone=timezone,
        weekdays=selected_days,
        starts_at=start.isoformat(),
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


def _next_start(
    current: datetime,
    clock: time,
    cadence: Cadence,
    weekdays: list[str],
) -> datetime:
    if cadence == "weekly":
        for offset in range(8):
            day = current.date() + timedelta(days=offset)
            candidate = datetime.combine(day, clock, current.tzinfo)
            if WEEKDAY_CODES[candidate.weekday()] in weekdays and candidate > current:
                return candidate
        raise RuntimeError("Could not resolve the next weekly class")

    candidate = datetime.combine(current.date(), clock, current.tzinfo)
    if candidate <= current:
        candidate += timedelta(days=1)
    return candidate


def _rrule(
    cadence: Cadence,
    start: datetime,
    timezone: str,
    weekdays: list[str],
) -> str:
    start_line = f"DTSTART;TZID={timezone}:{start.strftime('%Y%m%dT%H%M%S')}"
    if cadence == "daily":
        rule = "RRULE:FREQ=DAILY"
    elif cadence == "every_other_day":
        rule = "RRULE:FREQ=DAILY;INTERVAL=2"
    else:
        rule = f"RRULE:FREQ=WEEKLY;BYDAY={','.join(weekdays)}"
    return f"{start_line}\n{rule}"


def _timezone(value: str) -> ZoneInfo:
    try:
        return ZoneInfo(value)
    except ZoneInfoNotFoundError as error:
        raise ValueError(f"Unknown timezone: {value}") from error


def _clock(value: str) -> time:
    try:
        parsed = datetime.strptime(value, "%H:%M")
    except ValueError as error:
        raise ValueError("local_time must use HH:MM in 24-hour time") from error
    return parsed.time()


def _weekdays(cadence: Cadence, values: list[str]) -> list[str]:
    normalized = list(dict.fromkeys(value.strip().upper() for value in values if value.strip()))
    invalid = [value for value in normalized if value not in WEEKDAY_CODES]
    if invalid:
        raise ValueError(f"Unknown weekday codes: {', '.join(invalid)}")
    if cadence == "weekly" and not normalized:
        raise ValueError("weekly cadence requires at least one weekday")
    if cadence != "weekly" and normalized:
        raise ValueError("weekdays are only valid for weekly cadence")
    return sorted(normalized, key=WEEKDAY_CODES.index)


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
