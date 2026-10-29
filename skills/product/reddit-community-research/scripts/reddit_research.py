import argparse
import json
import sqlite3
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

API = "https://arctic-shift.photon-reddit.com/api"


def connect(path, create=False, *, read_only=False):
    path = Path(path).resolve()
    if create:
        path.parent.mkdir(parents=True, exist_ok=True)
    mode = "rwc" if create else "ro" if read_only else "rw"
    connection = sqlite3.connect(f"{path.as_uri()}?mode={mode}", uri=True)
    connection.row_factory = sqlite3.Row
    if create:
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS records (
                id TEXT PRIMARY KEY, kind TEXT NOT NULL, post_id TEXT NOT NULL,
                parent_id TEXT, created_utc INTEGER NOT NULL, author TEXT,
                in_scope INTEGER NOT NULL, origin TEXT NOT NULL, raw TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS records_post ON records(post_id, created_utc);
            CREATE TABLE IF NOT EXISTS fetches (
                query TEXT PRIMARY KEY, cursor INTEGER NOT NULL, complete INTEGER NOT NULL
            );
        """)
    return connection


def thing_id(value, prefix):
    value = str(value)
    value = value.removeprefix(prefix)
    if not value or not value.isascii() or not value.isalnum():
        raise ValueError(f"无效的 Reddit 编号：{value}")
    return prefix + value.lower()


def read_rows(path):
    path = Path(path)
    with path.open(encoding="utf-8") as handle:
        if path.suffix == ".jsonl":
            for line in handle:
                if line.strip():
                    yield json.loads(line)
        else:
            data = json.load(handle)
            if isinstance(data, dict):
                data = data["data"]
            if not isinstance(data, list):
                raise ValueError("输入应为 JSON 数组、含 data 数组的 API 响应或 JSONL")
            yield from data


def save_record(connection, raw, kind, origin, in_scope=True):
    prefix = "t3_" if kind == "posts" else "t1_"
    source_id = thing_id(raw["id"], prefix)
    post_id = source_id if kind == "posts" else thing_id(raw["link_id"], "t3_")
    parent_id = None
    if kind == "comments":
        parent = raw["parent_id"]
        if not parent.startswith(("t1_", "t3_")):
            raise ValueError(f"评论缺少有效的父级编号：{source_id}")
        parent_id = thing_id(parent, parent[:3])
    connection.execute(
        """INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            parent_id=excluded.parent_id, author=excluded.author,
            in_scope=MAX(records.in_scope, excluded.in_scope),
            origin=excluded.origin, raw=excluded.raw""",
        (
            source_id,
            kind,
            post_id,
            parent_id,
            int(raw["created_utc"]),
            raw.get("author"),
            int(in_scope),
            origin,
            json.dumps(raw, ensure_ascii=False),
        ),
    )


def get_record(connection, source_id):
    row = connection.execute(
        "SELECT * FROM records WHERE id=?", (source_id,)
    ).fetchone()
    if row is None:
        raise ValueError(f"资料库缺少来源：{source_id}")
    return row


ACTION_RANK = {"expressing": 0, "seeking": 1, "acted": 2}
RANK_ACTION = {rank: name for name, rank in ACTION_RANK.items()}
UNKNOWN_AUTHORS = {None, "", "[deleted]", "[removed]"}


def post_contested(post_raw):
    if not post_raw:
        return False
    ratio = post_raw.get("upvote_ratio")
    comments = post_raw.get("num_comments") or 0
    return ratio is not None and ratio <= 0.65 and comments >= 10


def record_text(row):
    raw = json.loads(row["raw"])
    if row["kind"] == "posts":
        return raw.get("title", "") + "\n" + raw.get("selftext", "")
    return raw.get("body", "")


def record_url(row):
    raw = json.loads(row["raw"])
    base = f"https://www.reddit.com/r/{raw['subreddit']}/comments/{row['post_id'][3:]}/"
    return base if row["kind"] == "posts" else base + "_/" + row["id"][3:] + "/"


def request_data(endpoint, params):
    url = API + endpoint + "?" + urlencode(params)
    request = Request(url, headers={"User-Agent": "reddit-community-research/1.0"})
    with urlopen(request, timeout=30) as response:
        payload = json.load(response)
    rows = payload["data"]
    if not isinstance(rows, list):
        raise TypeError(f"API 未返回资料数组：{url}")
    return rows


def timestamp(value):
    date = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if date.tzinfo is None:
        date = date.replace(tzinfo=timezone.utc)
    return int(date.timestamp())


def collect_range(connection, kind, filters, after, before, in_scope=True):
    if after >= before:
        raise ValueError("开始时间必须早于结束时间")
    query = json.dumps([kind, filters, after, before, in_scope], sort_keys=True)
    saved = connection.execute(
        "SELECT * FROM fetches WHERE query=?", (query,)
    ).fetchone()
    if saved and saved["complete"]:
        return
    cursor = saved["cursor"] if saved else after
    while True:
        params = {
            **filters,
            "after": cursor - 1,
            "before": before,
            "limit": 100,
            "sort": "asc",
        }
        rows = request_data(f"/{kind}/search", params)
        last = max((int(row["created_utc"]) for row in rows), default=cursor)
        complete = len(rows) < 100 or last >= before
        with connection:
            for raw in rows:
                if after <= int(raw["created_utc"]) < before:
                    save_record(connection, raw, kind, "Arctic Shift", in_scope)
            connection.execute(
                "INSERT OR REPLACE INTO fetches VALUES (?, ?, ?)",
                (query, last, int(complete)),
            )
        print(
            json.dumps(
                {
                    "kind": kind,
                    "received": len(rows),
                    "cursor": last,
                    "complete": complete,
                }
            ),
            flush=True,
        )
        if complete:
            return
        # 重读边界这一秒，避免遗漏同秒记录；无法继续分页时明确终止。
        if last <= cursor:
            raise RuntimeError(
                "同一秒返回满 100 条，无法确认完整覆盖；已保存结果，需改用归档文件"
            )
        cursor = last
        time.sleep(0.6)


def hydrate_posts(connection):
    missing = [
        row[0]
        for row in connection.execute("""
        SELECT DISTINCT c.post_id FROM records c
        LEFT JOIN records p ON p.id=c.post_id WHERE p.id IS NULL
    """)
    ]
    for offset in range(0, len(missing), 500):
        rows = request_data(
            "/posts/ids", {"ids": ",".join(missing[offset : offset + 500])}
        )
        with connection:
            for raw in rows:
                save_record(connection, raw, "posts", "Arctic Shift context", False)
        time.sleep(0.6)


def import_data(connection, posts=None, comments=None):
    if not posts and not comments:
        raise ValueError("至少提供帖子或评论文件")
    for kind, path in (("posts", posts), ("comments", comments)):
        if path:
            with connection:
                for raw in read_rows(path):
                    save_record(connection, raw, kind, str(Path(path).resolve()))


def status(connection):
    counts = [
        dict(row)
        for row in connection.execute(
            "SELECT kind, in_scope, COUNT(*) AS count FROM records GROUP BY kind, in_scope"
        )
    ]
    missing = [
        row[0]
        for row in connection.execute("""
        SELECT DISTINCT c.parent_id FROM records c LEFT JOIN records p ON p.id=c.parent_id
        WHERE c.parent_id IS NOT NULL AND p.id IS NULL
    """)
    ]
    return {
        "records": counts,
        "missing_parent_ids": missing,
        "fetches": [dict(row) for row in connection.execute("SELECT * FROM fetches")],
    }


def export_batches(connection, directory, max_chars=20000, record_chars=6000):
    if record_chars <= 0 or max_chars <= 0:
        raise ValueError("批次和分段长度必须为正数")
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=False)
    batch, size, lines, parts = 1, 0, [], 0
    for row in connection.execute(
        "SELECT * FROM records WHERE in_scope=1 ORDER BY created_utc, id"
    ):
        raw = json.loads(row["raw"])
        text = record_text(row)
        parent = connection.execute(
            "SELECT * FROM records WHERE id=?", (row["parent_id"],)
        ).fetchone()
        post = connection.execute(
            "SELECT * FROM records WHERE id=?", (row["post_id"],)
        ).fetchone()
        post_raw = json.loads(post["raw"]) if post else None
        chunks = [
            text[i : i + record_chars] for i in range(0, len(text), record_chars)
        ] or [""]
        for index, chunk in enumerate(chunks, 1):
            item = {
                "source_id": row["id"],
                "post_id": row["post_id"],
                "parent_id": row["parent_id"],
                "subreddit": raw.get("subreddit"),
                "author": row["author"],
                "author_flair": raw.get("author_flair_text") or None,
                "score": raw.get("score"),
                "part": index,
                "parts": len(chunks),
                "text": chunk,
                "post_title": post_raw.get("title") if post_raw else None,
                "post_flair": (post_raw.get("link_flair_text") or None)
                if post_raw
                else None,
                "post_upvote_ratio": post_raw.get("upvote_ratio") if post_raw else None,
                "contested": post_contested(post_raw)
                or bool(raw.get("controversiality")),
                "reply_to_text": record_text(parent)[:1200] if parent else None,
                "reply_to_truncated": bool(parent and len(record_text(parent)) > 1200),
                "url": record_url(row),
            }
            line = json.dumps(item, ensure_ascii=False) + "\n"
            if lines and size + len(line) > max_chars:
                (directory / f"batch-{batch:05d}.jsonl").write_text(
                    "".join(lines), encoding="utf-8"
                )
                batch, size, lines = batch + 1, 0, []
            lines.append(line)
            size += len(line)
            parts += 1
    if lines:
        (directory / f"batch-{batch:05d}.jsonl").write_text(
            "".join(lines), encoding="utf-8"
        )
    return {"batches": batch if lines else 0, "parts": parts}


def thread(connection, post_id):
    post_id = thing_id(post_id, "t3_")
    post = get_record(connection, post_id)
    comments = list(
        connection.execute(
            "SELECT * FROM records WHERE post_id=? AND kind='comments' ORDER BY created_utc, id",
            (post_id,),
        )
    )
    ids = {post_id, *(row["id"] for row in comments)}
    raw = json.loads(post["raw"])
    return {
        "post": raw,
        "post_url": record_url(post),
        "comments": [json.loads(row["raw"]) for row in comments],
        "saved_comments": len(comments),
        "reported_comments": raw.get("num_comments"),
        "missing_parent_ids": sorted(
            {row["parent_id"] for row in comments if row["parent_id"] not in ids}
        ),
    }


def read_findings(connection, findings, start=0, limit=20):
    findings = list(findings)
    if start < 0 or start > len(findings) or limit < 1:
        raise ValueError("读取位置须在记录范围内，每批数量须大于零")
    batch = findings[start : start + limit]
    source_ids = {
        source_id
        for finding in batch
        for source_id in (
            finding["source_id"],
            *(item["source_id"] for item in finding["evidence"]),
            *(
                [finding["action_evidence"]["source_id"]]
                if isinstance(finding.get("action_evidence"), dict)
                and finding["action_evidence"].get("source_id")
                else []
            ),
        )
    }
    records = {
        source_id: get_record(connection, source_id) for source_id in sorted(source_ids)
    }
    for finding in batch:
        source = records[finding["source_id"]]
        if source["author"] and source["author"] not in ("[deleted]", "[removed]"):
            updates = connection.execute(
                """SELECT * FROM records
                WHERE post_id=? AND kind='comments' AND author=? COLLATE NOCASE
                    AND created_utc>=?
                ORDER BY created_utc, id""",
                (source["post_id"], source["author"], source["created_utc"]),
            )
            records.update((row["id"], row) for row in updates)
    pending = list(records.values())
    missing = set()
    while pending:
        row = pending.pop()
        for source_id in (row["post_id"], row["parent_id"]):
            if not source_id or source_id in records or source_id in missing:
                continue
            parent = connection.execute(
                "SELECT * FROM records WHERE id=?", (source_id,)
            ).fetchone()
            if parent is None:
                missing.add(source_id)
                continue
            records[source_id] = parent
            pending.append(parent)
    end = start + len(batch)
    return {
        "total": len(findings),
        "start": start,
        "next_start": end if end < len(findings) else None,
        "findings": batch,
        "sources": {
            source_id: {
                "kind": row["kind"],
                "post_id": row["post_id"],
                "parent_id": row["parent_id"],
                "url": record_url(row),
                "contested": post_contested(raw)
                if row["kind"] == "posts"
                else bool(raw.get("controversiality")),
                "raw": raw,
            }
            for source_id, row in sorted(records.items())
            for raw in (json.loads(row["raw"]),)
        },
        "missing_parent_ids": sorted(missing),
    }


def select_threads(connection, screens, batches):
    expected = set()
    for path in sorted(Path(batches).glob("batch-*.jsonl")):
        expected.update((row["source_id"], row["part"]) for row in read_rows(path))
    if not expected:
        raise ValueError("找不到初筛批次")
    seen, sources, posts = set(), set(), set()
    for item in screens:
        key = (item["source_id"], item.get("part", 1))
        if key not in expected or key in seen:
            raise ValueError(f"初筛来源不在批次内或重复：{key}")
        if item["decision"] not in ("keep", "skip", "uncertain"):
            raise ValueError(f"初筛决定无效：{key}")
        row = get_record(connection, item["source_id"])
        quote = item.get("evidence", "")
        if quote and quote not in record_text(row):
            raise ValueError(f"初筛依据不在原文中：{key}")
        seen.add(key)
        if item["decision"] != "skip":
            sources.add(row["id"])
            posts.add(row["post_id"])
    return {
        "total_parts": len(expected),
        "processed_parts": len(seen),
        "remaining_parts": len(expected - seen),
        "post_ids": sorted(posts),
        "source_ids": sorted(sources),
    }


def discussion_unit(connection, row, megathreads, discussion_id=None):
    if row["post_id"] not in megathreads or row["kind"] == "posts":
        return row["post_id"]
    if not discussion_id:
        raise ValueError(f"集中讨论中的需求须注明独立问题的起点：{row['id']}")
    while row["id"] != discussion_id:
        if row["parent_id"] == row["post_id"]:
            raise ValueError(f"指定讨论起点不在当前回复链中：{discussion_id}")
        parent = get_record(connection, row["parent_id"])
        if parent["post_id"] != row["post_id"]:
            raise ValueError(f"回复关系跨越帖子：{row['id']}")
        row = parent
    return row["id"]


def new_bucket(name=None):
    return {
        "name": name,
        "discussions": set(),
        "discussion_actions": {},
        "authors": set(),
        "comments": set(),
        "posts": set(),
        "contested_posts": set(),
        "sources": {},
    }


def record_in_bucket(
    bucket, discussion_id, source, source_raw, post_is_contested, action
):
    bucket["discussions"].add(discussion_id)
    rank = ACTION_RANK[action]
    if rank > bucket["discussion_actions"].get(discussion_id, -1):
        bucket["discussion_actions"][discussion_id] = rank
    if source["author"] not in UNKNOWN_AUTHORS:
        bucket["authors"].add(source["author"].casefold())
    if source["kind"] == "comments":
        bucket["comments"].add(source["id"])
    bucket["posts"].add(source["post_id"])
    if post_is_contested:
        bucket["contested_posts"].add(source["post_id"])
    bucket["sources"][source["id"]] = source_raw.get("score")


def bucket_metrics(bucket):
    scores = [score for score in bucket["sources"].values() if score is not None]
    actions = {"acted": 0, "seeking": 0, "expressing": 0}
    for rank in bucket["discussion_actions"].values():
        actions[RANK_ACTION[rank]] += 1
    return {
        "discussions": len(bucket["discussions"]),
        "authors": len(bucket["authors"]),
        "expressing_comments": len(bucket["comments"]),
        "posts": len(bucket["posts"]),
        "contested_posts": len(bucket["contested_posts"]),
        "actions": actions,
        "score_total": sum(scores) if scores else None,
        "scored_sources": len(scores),
    }


def count_findings(connection, findings, megathreads=(), *, include_attributions):
    if not include_attributions:
        raise ValueError("请指定本轮纳入统计的问题归属标签")
    include_attributions = set(include_attributions)
    megathreads = {thing_id(value, "t3_") for value in megathreads}
    for post_id in megathreads:
        get_record(connection, post_id)
    groups = defaultdict(
        lambda: {**new_bucket(), "findings": [], "subreddits": {}}
    )
    seen = set()
    for finding in findings:
        if finding["id"] in seen:
            raise ValueError(f"重复的需求记录编号：{finding['id']}")
        seen.add(finding["id"])
        attribution = finding.get("attribution")
        if not isinstance(attribution, str) or not attribution.strip():
            raise ValueError(f"缺少问题归属标签：{finding['id']}")
        if attribution not in include_attributions:
            continue
        source = get_record(connection, finding["source_id"])
        post = get_record(connection, source["post_id"])
        if not source["in_scope"]:
            raise ValueError(f"表达来源超出初始资料范围：{source['id']}")
        if finding["kind"] not in ("pain", "need") or not finding["statement"].strip():
            raise ValueError(f"需求类型或描述无效：{finding['id']}")
        action = finding.get("action")
        if action not in ACTION_RANK:
            raise ValueError(f"缺少或无效的行动等级：{finding['id']}")
        need_id = (finding.get("need_id") or "").strip()
        if not need_id:
            continue
        if not finding.get("evidence"):
            raise ValueError(f"缺少原文依据：{finding['id']}")
        has_source_quote = False
        for evidence in finding["evidence"]:
            record = get_record(connection, evidence["source_id"])
            if record["post_id"] != source["post_id"]:
                raise ValueError(f"证据来自另一篇讨论：{finding['id']}")
            if not evidence["quote"].strip() or evidence["quote"] not in record_text(
                record
            ):
                raise ValueError(f"原文中找不到摘录：{finding['id']} / {record['id']}")
            has_source_quote |= record["id"] == source["id"]
        if not has_source_quote:
            raise ValueError(f"缺少表达来源自身的原话：{finding['id']}")
        disc_id = discussion_unit(
            connection, source, megathreads, finding.get("discussion_id")
        )
        action_evidence = finding.get("action_evidence")
        if action == "expressing":
            if action_evidence:
                raise ValueError(f"纯表达记录不应包含行动证据：{finding['id']}")
        else:
            if (
                not isinstance(action_evidence, dict)
                or not isinstance(action_evidence.get("source_id"), str)
                or not isinstance(action_evidence.get("quote"), str)
                or not action_evidence["quote"].strip()
            ):
                raise ValueError(f"行动等级须附原文行动证据：{finding['id']}")
            action_record = get_record(connection, action_evidence["source_id"])
            if action_record["post_id"] != source["post_id"]:
                raise ValueError(f"行动证据来自另一篇讨论：{finding['id']}")
            if (
                source["post_id"] in megathreads
                and source["kind"] == "comments"
                and discussion_unit(
                    connection, action_record, megathreads, finding.get("discussion_id")
                )
                != disc_id
            ):
                raise ValueError(f"行动证据不在同一集中讨论问题内：{finding['id']}")
            if action_record["id"] != source["id"] and (
                source["author"] in UNKNOWN_AUTHORS
                or action_record["author"] in UNKNOWN_AUTHORS
                or action_record["author"].casefold() != source["author"].casefold()
            ):
                raise ValueError(f"行动证据须来自同一表达作者：{finding['id']}")
            if action_evidence["quote"] not in record_text(action_record):
                raise ValueError(
                    f"原文中找不到行动摘录：{finding['id']} / {action_record['id']}"
                )
        source_raw = json.loads(source["raw"])
        subreddit = (source_raw.get("subreddit") or "").strip()
        if not subreddit:
            raise ValueError(f"来源缺少社区名称：{source['id']}")
        post_is_contested = post_contested(json.loads(post["raw"]))
        group = groups[need_id]
        record_in_bucket(group, disc_id, source, source_raw, post_is_contested, action)
        sub_key = subreddit.casefold()
        if sub_key not in group["subreddits"]:
            group["subreddits"][sub_key] = new_bucket(subreddit)
        record_in_bucket(
            group["subreddits"][sub_key],
            disc_id,
            source,
            source_raw,
            post_is_contested,
            action,
        )
        group["findings"].append(finding["id"])
    result = []
    for need_id, group in groups.items():
        result.append(
            {
                "need_id": need_id,
                **bucket_metrics(group),
                "by_subreddit": [
                    {"subreddit": sub["name"], **bucket_metrics(sub)}
                    for sub in sorted(
                        group["subreddits"].values(),
                        key=lambda item: (
                            -len(item["discussions"]),
                            item["name"].casefold(),
                        ),
                    )
                ],
                "discussion_ids": sorted(group["discussions"]),
                "source_ids": sorted(group["sources"]),
                "finding_ids": group["findings"],
            }
        )
    return sorted(result, key=lambda row: (-row["discussions"], row["need_id"]))


def write_json(path, value):
    Path(path).write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def parse_subreddits(values):
    subreddits, seen = [], set()
    for item in values:
        clean = item.removeprefix("r/").removeprefix("/r/").strip()
        if not clean:
            raise ValueError("社区名称不能为空")
        key = clean.casefold()
        if key not in seen:
            seen.add(key)
            subreddits.append(clean)
    return subreddits


def build_parser():
    parser = argparse.ArgumentParser(
        description="Reddit 资料采集、分批、完整讨论读取与需求计数"
    )
    commands = parser.add_subparsers(dest="command", required=True)
    collect = commands.add_parser(
        "collect", help="按 UTC 时间范围采集帖子与评论，可重复运行继续"
    )
    collect.add_argument(
        "--subreddit",
        action="append",
        required=True,
        help="目标社区名称，可重复指定以采集多个社区",
    )
    collect.add_argument("--after", required=True)
    collect.add_argument("--before", required=True)
    collect.add_argument(
        "--kind", choices=("posts", "comments", "both"), default="both"
    )
    ingest = commands.add_parser(
        "import", help="导入 Reddit / Arctic Shift 原生 JSON 或 JSONL"
    )
    ingest.add_argument("--posts")
    ingest.add_argument("--comments")
    batches = commands.add_parser(
        "batches", help="导出初筛批次，保留全文分段与父级提示"
    )
    batches.add_argument("--out", required=True)
    batches.add_argument("--max-chars", type=int, default=20000)
    batches.add_argument("--record-chars", type=int, default=6000)
    context = commands.add_parser("thread", help="导出完整讨论；可补取归档内评论")
    context.add_argument("--post-id", required=True)
    context.add_argument("--out", required=True)
    context.add_argument("--fetch", action="store_true")
    selected = commands.add_parser(
        "selected", help="合并初筛结果并列出待深入阅读的帖子"
    )
    selected.add_argument("--screen", required=True)
    selected.add_argument("--batches", required=True)
    selected.add_argument("--out", required=True)
    reading = commands.add_parser(
        "read-findings", help="分批读取完整需求、原文、作者后续及回复背景"
    )
    reading.add_argument("--findings", required=True)
    reading.add_argument("--start", type=int, default=0)
    reading.add_argument("--limit", type=int, default=20)
    reading.add_argument("--out", required=True)
    count = commands.add_parser("count", help="核查原文来源并按独立讨论计数")
    count.add_argument("--findings", required=True)
    count.add_argument(
        "--include-attribution",
        action="append",
        required=True,
        help="纳入统计的问题归属标签，可重复指定",
    )
    count.add_argument("--megathread", action="append", default=[])
    count.add_argument("--out", required=True)
    commands.add_parser("status", help="显示实际资料数量与缺少的父级")
    for command in commands.choices.values():
        command.add_argument("--db", required=True)
    return parser


def main():
    args = build_parser().parse_args()
    if getattr(args, "out", None):
        inputs = [args.db]
        if args.command in ("count", "read-findings"):
            inputs.append(args.findings)
        if args.command == "selected":
            inputs.append(args.screen)
        if Path(args.out).resolve() in {Path(value).resolve() for value in inputs}:
            raise ValueError("输出位置必须与输入资料分开")
    with connect(
        args.db,
        create=args.command in ("collect", "import"),
        read_only=args.command == "read-findings",
    ) as connection:
        if args.command == "collect":
            kinds = ("posts", "comments") if args.kind == "both" else (args.kind,)
            after, before = timestamp(args.after), timestamp(args.before)
            for subreddit in parse_subreddits(args.subreddit):
                for kind in kinds:
                    collect_range(
                        connection,
                        kind,
                        {"subreddit": subreddit},
                        after,
                        before,
                    )
            hydrate_posts(connection)
            print(json.dumps(status(connection), ensure_ascii=False))
        elif args.command == "import":
            import_data(connection, args.posts, args.comments)
            print(json.dumps(status(connection), ensure_ascii=False))
        elif args.command == "batches":
            print(
                json.dumps(
                    export_batches(
                        connection, args.out, args.max_chars, args.record_chars
                    )
                )
            )
        elif args.command == "thread":
            post_id = thing_id(args.post_id, "t3_")
            if args.fetch:
                raw = request_data("/posts/ids", {"ids": post_id})
                with connection:
                    for post in raw:
                        save_record(
                            connection, post, "posts", "Arctic Shift context", False
                        )
                collect_range(
                    connection,
                    "comments",
                    {"link_id": post_id},
                    get_record(connection, post_id)["created_utc"],
                    int(time.time()),
                    False,
                )
            write_json(args.out, thread(connection, post_id))
        elif args.command == "read-findings":
            write_json(
                args.out,
                read_findings(
                    connection,
                    read_rows(args.findings),
                    args.start,
                    args.limit,
                ),
            )
        elif args.command == "count":
            write_json(
                args.out,
                count_findings(
                    connection,
                    read_rows(args.findings),
                    args.megathread,
                    include_attributions=args.include_attribution,
                ),
            )
        elif args.command == "selected":
            write_json(
                args.out,
                select_threads(connection, read_rows(args.screen), args.batches),
            )
        elif args.command == "status":
            print(json.dumps(status(connection), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
