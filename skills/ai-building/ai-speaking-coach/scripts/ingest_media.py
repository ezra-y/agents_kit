#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from ai_speaking_coach.media import ingest_media_dialogue, write_media_template


def main() -> None:
    parser = argparse.ArgumentParser(description="Import a short media dialogue.")
    parser.add_argument("source", type=Path, nargs="?")
    parser.add_argument("--write-template", type=Path)
    args = parser.parse_args()
    if args.write_template:
        print(f"template={write_media_template(args.write_template)}")
        return
    if not args.source:
        parser.error("source is required unless --write-template is used")
    items = ingest_media_dialogue(args.source)
    print(f"imported={len(items)}")
    print(f"group_id={items[0].group_id}")


if __name__ == "__main__":
    main()

