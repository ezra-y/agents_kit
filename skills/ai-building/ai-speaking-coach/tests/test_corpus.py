from __future__ import annotations

from pathlib import Path

import pytest

from ai_speaking_coach.corpus import (
    parse_common_500,
    parse_pattern_220,
    validate_items,
)


def source_path(filename: str) -> Path:
    project_root = Path(__file__).resolve().parents[2]
    source = project_root / "邵艾伦三合一" / "课件" / filename
    if not source.exists():
        pytest.skip("original course document is not part of the portable Skill bundle")
    return source


def test_parse_common_500() -> None:
    items = parse_common_500(source_path("(4)-常用英语500句.doc"))
    assert len(items) == 502
    assert items[0].id == "common500-s0001"
    assert items[0].text == "What's up?"
    assert items[-1].id == "common500-s0502"
    assert not validate_items(items)


def test_parse_pattern_220() -> None:
    items = parse_pattern_220(source_path("(5)-万能造句公式(220个).doc"))
    assert len(items) == 220
    assert items[0].id == "pattern220-p0001"
    assert items[0].text
    assert items[-1].id == "pattern220-p0220"
    assert not validate_items(items)
