#!/usr/bin/env python3
from __future__ import annotations

import json
import sys

from ai_speaking_coach.coach_mode import process_hook_event


def main() -> None:
    try:
        payload = json.load(sys.stdin)
        result = process_hook_event(payload)
    except Exception as error:
        print(f"ai-speaking-coach hook skipped: {error}", file=sys.stderr)
        return
    if result is not None:
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
