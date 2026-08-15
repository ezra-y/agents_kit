#!/usr/bin/env python3
"""Fill the bundled HTML template with trajectory data and annotations.

Usage:
  python3 scripts/render.py --data traj.json [--annotations ann.json] -o out.html

Kept separate from parsing so the learn tier can regenerate the page after
annotations are written, without re-parsing the session log.
"""

import argparse
import json
from pathlib import Path

TEMPLATE = Path(__file__).parent.parent / "assets" / "template.html"


def embed(html, element_id, payload):
    """Replace the JSON body of <script id=...> with payload, safely escaped."""
    marker = f'<script id="{element_id}" type="application/json">'
    start = html.index(marker) + len(marker)
    end = html.index("</script>", start)
    # HTML parses script bodies before JSON. Escaping every "<" also covers
    # closing tags and legacy comment/script states such as "<!--<script>".
    body = json.dumps(payload, ensure_ascii=False).replace("<", "\\u003c")
    return html[:start] + body + html[end:]


def build_html(data, annotations=None, live_config=None, template=TEMPLATE):
    """Build every static, live, and exported viewer through one code path."""
    html = Path(template).read_text(encoding="utf-8")
    html = embed(html, "trajectory-data", data)
    html = embed(html, "annotations-data", annotations)
    return embed(html, "live-config", live_config or {"live": False})


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", required=True, help="trajectory JSON from parse_trajectory.py")
    ap.add_argument("--annotations", help="optional annotations JSON (learn tier)")
    ap.add_argument("--template", default=str(TEMPLATE))
    ap.add_argument("-o", "--output", required=True)
    args = ap.parse_args()

    data = json.loads(Path(args.data).read_text(encoding="utf-8"))
    ann = None
    if args.annotations:
        ann = json.loads(Path(args.annotations).read_text(encoding="utf-8"))
        warn_unmatched_whys(data, ann)
    html = build_html(data, ann, template=args.template)
    Path(args.output).write_text(html, encoding="utf-8")
    print(args.output)


def warn_unmatched_whys(data, ann):
    """A why keyed to a nonexistent event id would vanish silently — warn."""
    import sys
    valid = {e["id"] for turn in data.get("turns", []) for e in turn.get("events", [])}
    for turn in (ann or {}).get("turns", []):
        for event_id in (turn.get("whys") or {}):
            if event_id not in valid:
                print(f"warning: annotation why '{event_id}' matches no event; "
                      "it will not be shown", file=sys.stderr)


if __name__ == "__main__":
    main()
