from __future__ import annotations

import json
from pathlib import Path

from ai_speaking_coach.media import ingest_media_dialogue


def test_ingest_media_dialogue(isolated_root: Path) -> None:
    source = isolated_root / "dialogue.json"
    source.write_text(
        json.dumps(
            {
                "title": "Example Show",
                "season": 1,
                "episode": 1,
                "dialogue": 1,
                "lines": [
                    {
                        "speaker": "A",
                        "text": "Are you free?",
                        "start": "00:00:01",
                        "end": "00:00:02",
                    },
                    {
                        "speaker": "B",
                        "text": "It depends.",
                        "start": "00:00:02",
                        "end": "00:00:03",
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    items = ingest_media_dialogue(source)
    assert len(items) == 2
    assert items[0].group_id == items[1].group_id
    assert items[0].id.endswith("l0001")

