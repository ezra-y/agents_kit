from __future__ import annotations

import json
from pathlib import Path

import pytest

from ai_speaking_coach.class_schedule import (
    class_schedule,
    dismiss_reminder_setup,
    reminder_status,
    save_class_schedule,
)


def test_arbitrary_recurrence_is_preserved(isolated_root: Path) -> None:
    schedule = class_schedule(
        schedule_text="每月第二个周六上午十点",
        timezone="Asia/Shanghai",
        rrule=(
            "DTSTART;TZID=Asia/Shanghai:20260808T100000\n"
            "RRULE:FREQ=MONTHLY;BYDAY=2SA"
        ),
    )

    assert schedule.schedule_text == "每月第二个周六上午十点"
    assert schedule.timezone == "Asia/Shanghai"
    assert schedule.rrule.endswith("RRULE:FREQ=MONTHLY;BYDAY=2SA")


def test_one_time_rule_is_also_accepted(isolated_root: Path) -> None:
    schedule = class_schedule(
        schedule_text="只在下周二晚上八点提醒一次",
        timezone="Asia/Shanghai",
        rrule=(
            "DTSTART;TZID=Asia/Shanghai:20260811T200000\n"
            "RRULE:FREQ=DAILY;COUNT=1"
        ),
    )

    assert "COUNT=1" in schedule.rrule


def test_schedule_requires_a_real_rrule(isolated_root: Path) -> None:
    with pytest.raises(ValueError, match="RRULE"):
        class_schedule(
            schedule_text="工作日晚八点",
            timezone="Asia/Shanghai",
            rrule="every weekday",
        )


def test_save_schedule_preserves_other_settings(isolated_root: Path) -> None:
    settings_path = isolated_root / "private" / "learner" / "settings.json"
    settings_path.write_text(
        json.dumps({"learner_id": 1, "custom": {"keep": True}}),
        encoding="utf-8",
    )
    schedule = class_schedule(
        schedule_text="每个工作日晚八点",
        timezone="Asia/Shanghai",
        rrule=(
            "DTSTART;TZID=Asia/Shanghai:20260810T200000\n"
            "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
        ),
    )

    saved = save_class_schedule(schedule, "automation-123")
    raw = json.loads(settings_path.read_text(encoding="utf-8"))

    assert saved["status"] == "active"
    assert saved["automation_id"] == "automation-123"
    assert raw["custom"] == {"keep": True}
    assert raw["class_schedule"]["schedule_text"] == "每个工作日晚八点"


def test_dismissed_setup_is_not_unconfigured(isolated_root: Path) -> None:
    assert reminder_status()["status"] == "unconfigured"

    dismissed = dismiss_reminder_setup()

    assert dismissed["status"] == "dismissed"
    assert reminder_status()["status"] == "dismissed"
