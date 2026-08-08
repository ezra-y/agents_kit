from __future__ import annotations

from pathlib import Path

import yaml


def test_first_use_is_text_only() -> None:
    root = Path(__file__).resolve().parents[1]
    skill = (root / "SKILL.md").read_text(encoding="utf-8")
    goals = (root / "references" / "learning-goals.md").read_text(encoding="utf-8")
    interface = yaml.safe_load(
        (root / "agents" / "openai.yaml").read_text(encoding="utf-8")
    )

    assert "A text task cannot turn on the microphone or switch itself into GPT Live" in skill
    assert "Do not ask the learner to open GPT Live" in skill
    assert "The first Skill invocation is a text setup" in goals
    assert "do not ask me to turn on voice" in interface["interface"]["default_prompt"]
