from __future__ import annotations

import re
from pathlib import Path

import yaml


def test_skill_selects_workflow_from_session_modality_and_persistent_files() -> None:
    root = Path(__file__).resolve().parents[1]
    skill = (root / "SKILL.md").read_text(encoding="utf-8")
    preparation_workflow = (root / "workflows" / "preparation.md").read_text(
        encoding="utf-8"
    )
    live_workflow = (root / "workflows" / "live-class.md").read_text(encoding="utf-8")
    interface = yaml.safe_load(
        (root / "agents" / "openai.yaml").read_text(encoding="utf-8")
    )

    assert "receive realtime audio and respond with realtime spoken audio" in skill
    assert "| Who You Are | Workflow |" in skill
    assert skill.count("| You can receive realtime audio") == 1
    assert skill.count("| You cannot conduct a realtime spoken exchange") == 1
    assert "`gpt-5`" in skill
    assert "`gpt-realtime-2`" in skill
    assert "model-name whitelist" not in skill
    assert "First Setup](workflows/" not in skill
    assert "Search During Class](workflows/" not in skill
    assert "private/learner/course.md absent" in skill
    assert "contains no completed session file" in skill
    assert "GPT Live opens as a separate voice task" in skill
    assert "one globally installed `SKILL_DIR`" in skill
    assert "project-local copies must not hold" in skill
    assert "~/.agents/skills/ai-speaking-coach/SKILL.md" in skill
    assert "resolve that symlink" in skill
    assert "A text task cannot turn on the microphone" not in skill
    assert "Route each request to the preparation teacher" not in skill
    assert "prompts/" not in skill

    assert "I am running in a text-only session" in preparation_workflow
    assert "cannot conduct the spoken class in this session" in preparation_workflow
    assert "../references/course-design.md" in preparation_workflow
    assert "../references/lesson-preparation.md" in preparation_workflow
    assert "before preparing the lesson" in preparation_workflow
    assert "Open the standalone GPT Live entry" in preparation_workflow
    assert "current text task can start, open, or switch itself into GPT Live" in (
        preparation_workflow
    )
    assert "You can open GPT Live and start class now" not in preparation_workflow
    assert "../references/live-class.md" in live_workflow
    assert "Read today's local date" in live_workflow
    assert "first_recorded_class" in live_workflow
    assert "Treat this as a standalone voice task" in live_workflow
    assert "pending-status phrase" in live_workflow
    assert "first GPT Live class" not in live_workflow
    assert not (root / "prompts").exists()

    default_prompt = interface["interface"]["default_prompt"]
    assert "输入和输出模态" in default_prompt
    assert "只能完成课程设计与备课" in default_prompt
    assert "已有个人文件判断" in default_prompt


def test_skill_entry_and_workflow_links_resolve() -> None:
    root = Path(__file__).resolve().parents[1]
    documents = [
        root / "SKILL.md",
        root / "workflows" / "preparation.md",
        root / "workflows" / "live-class.md",
    ]

    for document in documents:
        text = document.read_text(encoding="utf-8")
        for relative_target in re.findall(r"\]\(([^)#]+)", text):
            assert (document.parent / relative_target).exists(), (
                f"{document.relative_to(root)} links to missing {relative_target}"
            )
