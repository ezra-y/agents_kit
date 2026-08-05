# Knowledge Schema

`knowledge/items.jsonl` contains one JSON object per teachable content item.

Required fields:

```json
{
  "id": "common500-s0001",
  "type": "expression",
  "text": "What's up?",
  "meaning": "最近怎么样？/怎么了？",
  "topics": ["friends", "daily_life"],
  "examples": [],
  "usage_note": "Casual. Meaning depends on situation and tone.",
  "source_ref": {
    "file": "常用英语500句.doc",
    "order": 1
  },
  "approved": true,
  "context": ""
}
```

Rules:

- `id` is stable and globally unique.
- `type` is `expression`, `pattern`, or `screen_line`.
- `text` is the single approved teaching version.
- `meaning`, topics, examples, notes, and context support retrieval and teaching.
- `source_ref` maps back to the source file and source order.
- Unreviewed or questionable content has `approved: false`.
- A media target line is one tracked item; preserve two to six dialogue turns in `context`.
- Never create duplicate IDs to force an expected item count.

After edits, run `scripts/validate_knowledge.py --strict`, import the content into SQLite, and rebuild
LanceDB. `items.jsonl` remains the content source even though SQLite and LanceDB contain runtime
copies.
