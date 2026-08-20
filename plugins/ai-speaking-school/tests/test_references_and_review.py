import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_build_resource_report_mentions_all_skills():
    report = json.loads((ROOT / "BUILD_RESOURCE_REPORT.json").read_text(encoding="utf-8"))
    assert set(report) == {
        "speaking-head-teacher",
        "speaking-live-teacher",
        "speaking-teaching-assistant",
        "speaking-learning-analyst",
    }


def test_references_have_source_markers():
    for path in (ROOT / "skills").glob("*/references/*.md"):
        assert "<!-- source:" in path.read_text(encoding="utf-8")
