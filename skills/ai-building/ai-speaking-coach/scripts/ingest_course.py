#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from ai_speaking_coach.corpus import (
    import_content_items,
    parse_common_500,
    parse_pattern_220,
    validate_items,
    write_jsonl,
)
from ai_speaking_coach.paths import skill_root


def parse_args() -> argparse.Namespace:
    project_root = skill_root().parent
    parser = argparse.ArgumentParser(description="Parse the initial speaking course corpus.")
    parser.add_argument(
        "--common-500",
        type=Path,
        default=project_root / "邵艾伦三合一/课件/(4)-常用英语500句.doc",
    )
    parser.add_argument(
        "--pattern-220",
        type=Path,
        default=project_root / "邵艾伦三合一/课件/(5)-万能造句公式(220个).doc",
    )
    parser.add_argument("--skip-database", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    expressions = parse_common_500(args.common_500)
    patterns = parse_pattern_220(args.pattern_220)
    items = [*expressions, *patterns]
    errors = validate_items(items)
    if len(expressions) != 502:
        errors.append(f"Expected 502 source expressions, found {len(expressions)}")
    if len(patterns) != 220:
        errors.append(f"Expected 220 patterns, found {len(patterns)}")
    if errors:
        raise SystemExit("\n".join(errors))
    output = write_jsonl(items)
    imported = 0 if args.skip_database else import_content_items(items)
    print(f"expressions={len(expressions)}")
    print(f"patterns={len(patterns)}")
    print(f"approved={sum(item.approved for item in items)}")
    print(f"jsonl={output}")
    print(f"database_rows_imported={imported}")


if __name__ == "__main__":
    main()
