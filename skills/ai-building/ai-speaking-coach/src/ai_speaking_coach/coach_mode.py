from __future__ import annotations

import os
import re
from dataclasses import asdict, dataclass
from typing import Any, Literal

from .db import apply_migrations, connect, transaction
from .time_utils import isoformat, now

CoachPhase = Literal["onboarding", "teaching", "after_class"]

ACTIVATION_PATTERNS = (
    re.compile(r"\$ai-speaking-coach\b", re.IGNORECASE),
    re.compile(
        r"(调用|使用|加载|启用)\s*(?:\$)?ai[- ]?speaking[- ]?coach",
        re.IGNORECASE,
    ),
    re.compile(r"(进入|开启|启动)\s*(?:英语)?口语教练模式"),
    re.compile(r"开始.{0,10}(?:英语)?口语课"),
    re.compile(r"继续.{0,10}(?:英语)?口语课"),
    re.compile(
        r"\b(?:start|continue|resume|enter)\b.{0,24}"
        r"\b(?:speaking|english)\b.{0,16}\b(?:class|lesson|coach mode)\b",
        re.IGNORECASE,
    ),
)

EXIT_PATTERNS = (
    re.compile(r"退出(?:当前|这个)?(?:的)?(?:口语教练)?模式"),
    re.compile(r"(?:关闭|离开|停止)(?:英语)?口语教练模式"),
    re.compile(
        r"(?:结束|停止|终止).{0,8}(?:今天|这节|本节|当前)?(?:的)?"
        r"(?:英语)?(?:口语)?(?:课|课程|课堂)"
    ),
    re.compile(
        r"(?:今天|这节|本节|当前)?(?:的)?(?:英语)?(?:口语)?"
        r"(?:课|课程|课堂).{0,8}(?:结束|停止|终止)"
    ),
    re.compile(r"(?:今天|这节|本节).{0,6}(?:先)?到这里"),
    re.compile(r"(?:先)?下课(?:吧|了)?"),
    re.compile(
        r"\b(?:exit|leave|disable|stop)\b.{0,20}"
        r"\b(?:speaking coach|english coach|coach mode)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:end|finish|stop|wrap up)\b.{0,20}"
        r"\b(?:today'?s )?(?:speaking |english )?(?:class|lesson)\b",
        re.IGNORECASE,
    ),
)


@dataclass(frozen=True)
class CoachModeState:
    thread_id: str
    active: bool
    phase: CoachPhase
    lesson_date: str | None
    activated_at: str
    updated_at: str
    deactivated_at: str | None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def resolve_thread_id(thread_id: str | None = None) -> str:
    resolved = thread_id or os.environ.get("CODEX_THREAD_ID")
    if not resolved:
        raise ValueError("No thread id supplied and CODEX_THREAD_ID is not set")
    return resolved


def activate_coach_mode(
    thread_id: str | None = None,
    phase: CoachPhase | None = None,
    lesson_date: str | None = None,
) -> CoachModeState:
    apply_migrations()
    resolved = resolve_thread_id(thread_id)
    timestamp = isoformat(now())
    selected_phase = phase or _default_phase()
    with transaction() as connection:
        existing = connection.execute(
            "SELECT * FROM coach_mode_state WHERE thread_id = ?",
            (resolved,),
        ).fetchone()
        if existing and existing["active"]:
            connection.execute(
                """
                UPDATE coach_mode_state
                SET phase = ?, lesson_date = COALESCE(?, lesson_date),
                    updated_at = ?, deactivated_at = NULL
                WHERE thread_id = ?
                """,
                (phase or existing["phase"], lesson_date, timestamp, resolved),
            )
        else:
            connection.execute(
                """
                INSERT INTO coach_mode_state(
                    thread_id, active, phase, lesson_date, activated_at,
                    updated_at, deactivated_at
                ) VALUES (?, 1, ?, ?, ?, ?, NULL)
                ON CONFLICT(thread_id) DO UPDATE SET
                    active = 1,
                    phase = excluded.phase,
                    lesson_date = excluded.lesson_date,
                    activated_at = excluded.activated_at,
                    updated_at = excluded.updated_at,
                    deactivated_at = NULL
                """,
                (
                    resolved,
                    selected_phase,
                    lesson_date or now().date().isoformat(),
                    timestamp,
                    timestamp,
                ),
            )
    state = get_coach_mode(resolved)
    if state is None:
        raise RuntimeError("Coach mode activation did not persist")
    return state


def deactivate_coach_mode(thread_id: str | None = None) -> CoachModeState | None:
    apply_migrations()
    resolved = resolve_thread_id(thread_id)
    timestamp = isoformat(now())
    with transaction() as connection:
        existing = connection.execute(
            "SELECT 1 FROM coach_mode_state WHERE thread_id = ?",
            (resolved,),
        ).fetchone()
        if existing is None:
            return None
        connection.execute(
            """
            UPDATE coach_mode_state
            SET active = 0, updated_at = ?, deactivated_at = ?
            WHERE thread_id = ?
            """,
            (timestamp, timestamp, resolved),
        )
    return get_coach_mode(resolved)


def set_coach_phase(
    phase: CoachPhase,
    thread_id: str | None = None,
) -> CoachModeState:
    apply_migrations()
    resolved = resolve_thread_id(thread_id)
    timestamp = isoformat(now())
    with transaction() as connection:
        cursor = connection.execute(
            """
            UPDATE coach_mode_state
            SET phase = ?, updated_at = ?
            WHERE thread_id = ? AND active = 1
            """,
            (phase, timestamp, resolved),
        )
        if cursor.rowcount != 1:
            raise ValueError("Coach mode is not active for this task")
    state = get_coach_mode(resolved)
    if state is None:
        raise RuntimeError("Coach phase update did not persist")
    return state


def get_coach_mode(thread_id: str | None = None) -> CoachModeState | None:
    apply_migrations()
    resolved = resolve_thread_id(thread_id)
    with connect() as connection:
        row = connection.execute(
            "SELECT * FROM coach_mode_state WHERE thread_id = ?",
            (resolved,),
        ).fetchone()
    return _state_from_row(row) if row else None


def should_activate(prompt: str) -> bool:
    return any(pattern.search(prompt) for pattern in ACTIVATION_PATTERNS)


def should_exit(prompt: str) -> bool:
    return any(pattern.search(prompt) for pattern in EXIT_PATTERNS)


def process_hook_event(payload: dict[str, Any]) -> dict[str, Any] | None:
    event = str(payload.get("hook_event_name", ""))
    thread_id = payload.get("session_id") or os.environ.get("CODEX_THREAD_ID")
    if not thread_id or event not in {"SessionStart", "UserPromptSubmit"}:
        return None

    if event == "UserPromptSubmit":
        prompt = str(payload.get("prompt", ""))
        if should_exit(prompt):
            previous = get_coach_mode(str(thread_id))
            if previous and previous.active:
                deactivate_coach_mode(str(thread_id))
                return _hook_output(
                    event,
                    "The learner requested the lesson or AI speaking coach mode to end. Finish the "
                    "session record now, give a concise class close, and stop applying the coach "
                    "role after this turn. Do not reactivate unless the learner starts another "
                    "lesson.",
                )
            return None
        if should_activate(prompt):
            activate_coach_mode(str(thread_id))

    state = get_coach_mode(str(thread_id))
    if state is None or not state.active:
        return None
    return _hook_output(event, render_coach_context(state))


def render_coach_context(state: CoachModeState) -> str:
    return (
        "[AI SPEAKING COACH MODE: ACTIVE]\n"
        f"Phase: {state.phase}\n"
        f"Lesson date: {state.lesson_date or 'not selected'}\n"
        "ROLE: Remain the learner's English speaking coach through questions and useful detours.\n"
        "RESPONSE: The client has delivered the learner's current turn. Reply promptly and "
        "naturally; do not stay silent waiting for an imagined continuation.\n"
        "FEEDBACK: Inspect English, but usually correct only the single highest-value issue. "
        "Prioritize meaning, today's target, clear Chinglish, and repeated errors. Keep feedback "
        "brief and proportional. Recast lesser awkwardness only when useful; let minor or "
        "self-corrected slips pass. With no important issue, continue the conversation. Diagnose "
        "pronunciation only from audio actually heard.\n"
        "END: A request to end the lesson, say class is over, or exit coach mode means save, close "
        "briefly, and deactivate in that turn."
    )


def _hook_output(event: str, context: str) -> dict[str, Any]:
    return {
        "hookSpecificOutput": {
            "hookEventName": event,
            "additionalContext": context,
        }
    }


def _default_phase() -> CoachPhase:
    with connect() as connection:
        profile = connection.execute(
            "SELECT preferred_name, goals FROM learner_profile WHERE id = 1"
        ).fetchone()
    if profile and (profile["preferred_name"] or profile["goals"]):
        return "teaching"
    return "onboarding"


def _state_from_row(row: Any) -> CoachModeState:
    return CoachModeState(
        thread_id=str(row["thread_id"]),
        active=bool(row["active"]),
        phase=row["phase"],
        lesson_date=row["lesson_date"],
        activated_at=row["activated_at"],
        updated_at=row["updated_at"],
        deactivated_at=row["deactivated_at"],
    )
