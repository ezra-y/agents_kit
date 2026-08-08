from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from ai_speaking_coach.class_schedule import (
    dismiss_reminder_setup,
    plan_class_schedule,
    reminder_status,
    save_class_schedule,
)


def test_daily_schedule_uses_next_local_occurrence(isolated_root: Path) -> None:
    reference = datetime(2026, 8, 8, 19, 0, tzinfo=ZoneInfo("Asia/Shanghai"))

    schedule = plan_class_schedule(
        cadence="daily",
        local_time="20:30",
        timezone="Asia/Shanghai",
        reference=reference,
    )

    assert schedule.starts_at == "2026-08-08T20:30:00+08:00"
    assert schedule.rrule == (
        "DTSTART;TZID=Asia/Shanghai:20260808T203000\nRRULE:FREQ=DAILY"
    )


def test_weekly_schedule_sorts_days_and_finds_next_match(isolated_root: Path) -> None:
    reference = datetime(2026, 8, 8, 21, 0, tzinfo=ZoneInfo("Asia/Shanghai"))

    schedule = plan_class_schedule(
        cadence="weekly",
        local_time="19:30",
        timezone="Asia/Shanghai",
        weekdays=["WE", "MO"],
        reference=reference,
    )

    assert schedule.weekdays == ["MO", "WE"]
    assert schedule.starts_at == "2026-08-10T19:30:00+08:00"
    assert schedule.rrule.endswith("RRULE:FREQ=WEEKLY;BYDAY=MO,WE")


def test_save_schedule_preserves_other_settings(isolated_root: Path) -> None:
    settings_path = isolated_root / "runtime" / "settings.json"
    settings_path.write_text(
        json.dumps({"learner_id": 1, "custom": {"keep": True}}),
        encoding="utf-8",
    )
    schedule = plan_class_schedule(
        cadence="every_other_day",
        local_time="20:00",
        timezone="Asia/Shanghai",
        reference=datetime(2026, 8, 8, 21, 0, tzinfo=ZoneInfo("Asia/Shanghai")),
    )

    saved = save_class_schedule(schedule, "automation-123")
    raw = json.loads(settings_path.read_text(encoding="utf-8"))

    assert saved["status"] == "active"
    assert saved["automation_id"] == "automation-123"
    assert raw["custom"] == {"keep": True}
    assert raw["class_schedule"]["cadence"] == "every_other_day"


def test_dismissed_setup_is_not_unconfigured(isolated_root: Path) -> None:
    assert reminder_status()["status"] == "unconfigured"

    dismissed = dismiss_reminder_setup()

    assert dismissed["status"] == "dismissed"
    assert reminder_status()["status"] == "dismissed"
