from __future__ import annotations

from pathlib import Path

import pytest

from ai_speaking_coach.coach_mode import (
    activate_coach_mode,
    deactivate_coach_mode,
    get_coach_mode,
    process_hook_event,
    set_coach_phase,
)


def test_coach_mode_persists_per_task(isolated_root: Path) -> None:
    state = activate_coach_mode("thread-one", lesson_date="2026-08-08")

    assert state.active is True
    assert state.phase == "onboarding"
    assert state.lesson_date == "2026-08-08"

    changed = set_coach_phase("teaching", "thread-one")
    assert changed.phase == "teaching"

    stopped = deactivate_coach_mode("thread-one")
    assert stopped is not None
    assert stopped.active is False
    assert get_coach_mode("thread-one") == stopped


def test_hook_reinjects_role_and_correction_gate(isolated_root: Path) -> None:
    activation = process_hook_event(
        {
            "hook_event_name": "UserPromptSubmit",
            "session_id": "thread-live",
            "prompt": "使用 $ai-speaking-coach 开始今天的英语口语课",
        }
    )
    assert activation is not None
    context = activation["hookSpecificOutput"]["additionalContext"]
    assert "AI SPEAKING COACH MODE: ACTIVE" in context
    assert "self-introductions" in context
    assert "immediately correct" in context

    later_turn = process_hook_event(
        {
            "hook_event_name": "UserPromptSubmit",
            "session_id": "thread-live",
            "prompt": "I very like watching TV show.",
        }
    )
    assert later_turn is not None
    assert "ROLE LOCK" in later_turn["hookSpecificOutput"]["additionalContext"]

    after_compaction = process_hook_event(
        {
            "hook_event_name": "SessionStart",
            "session_id": "thread-live",
            "source": "compact",
        }
    )
    assert after_compaction is not None
    assert "ENGLISH CORRECTION GATE" in after_compaction["hookSpecificOutput"]["additionalContext"]


@pytest.mark.parametrize(
    "prompt",
    [
        "今天这堂课先结束吧",
        "今天先到这里",
        "下课吧",
        "Let's finish today's lesson.",
    ],
)
def test_ending_the_lesson_exits_coach_mode(isolated_root: Path, prompt: str) -> None:
    thread_id = f"thread-exit-{len(prompt)}"
    activate_coach_mode(thread_id)

    lesson_end = process_hook_event(
        {
            "hook_event_name": "UserPromptSubmit",
            "session_id": thread_id,
            "prompt": prompt,
        }
    )
    assert lesson_end is not None
    assert "requested the lesson" in lesson_end["hookSpecificOutput"]["additionalContext"]
    assert get_coach_mode(thread_id).active is False  # type: ignore[union-attr]


def test_explicit_mode_exit_also_works(isolated_root: Path) -> None:
    activate_coach_mode("thread-explicit-exit")
    explicit_exit = process_hook_event(
        {
            "hook_event_name": "UserPromptSubmit",
            "session_id": "thread-explicit-exit",
            "prompt": "退出当前模式",
        }
    )
    assert explicit_exit is not None
    assert get_coach_mode("thread-explicit-exit").active is False  # type: ignore[union-attr]

    inactive_turn = process_hook_event(
        {
            "hook_event_name": "UserPromptSubmit",
            "session_id": "thread-explicit-exit",
            "prompt": "I have another question.",
        }
    )
    assert inactive_turn is None
