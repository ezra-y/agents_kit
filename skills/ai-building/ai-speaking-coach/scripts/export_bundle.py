#!/usr/bin/env python3
from __future__ import annotations

import argparse

from ai_speaking_coach.exporter import export_bundle


def main() -> None:
    parser = argparse.ArgumentParser(description="Export a portable speaking coach bundle.")
    parser.add_argument("--include-index", action="store_true")
    parser.add_argument("--include-model", action="store_true")
    args = parser.parse_args()
    print(
        "bundle="
        f"{export_bundle(include_index=args.include_index, include_model=args.include_model)}"
    )


if __name__ == "__main__":
    main()
