from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from .paths import load_settings


def now() -> datetime:
    timezone = ZoneInfo(load_settings()["timezone"])
    return datetime.now(timezone)


def parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise ValueError(f"Timestamp must include a timezone: {value}")
    return parsed


def isoformat(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError("Datetime must include a timezone")
    return value.isoformat(timespec="seconds")

