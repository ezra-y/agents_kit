#!/usr/bin/env python3
"""Plan which fresh Feishu source rows may be filled, without changing state."""

import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path
from urllib.parse import urlparse


class UserError(Exception):
    pass


ALLOWED_SUBMISSION = {"", "待投递", "未投递", "待填写", "未填写"}
FINISHED_SUBMISSION = {"已投递", "笔试中", "面试中", "offer", "挂了"}
FINISHED_FILL = {"已保存", "已填写", "独审通过", "已完成"}
PARTIAL_FILL = {"部分填写"}


def load_json(path):
    try:
        with open(path, encoding="utf-8") as stream:
            return json.load(stream)
    except (OSError, json.JSONDecodeError) as error:
        raise UserError(f"无法读取 JSON：{path}：{error}") from error


def text_value(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value).strip()
    if isinstance(value, list):
        return "".join(text_value(item) for item in value).strip()
    if isinstance(value, dict):
        for key in ("text", "name", "value"):
            if key in value:
                return text_value(value[key])
    raise UserError("无法识别文字字段的值，不能当成空白")


def url_value(value):
    candidates = value if isinstance(value, list) else [value]
    for item in candidates:
        if isinstance(item, dict):
            candidate = item.get("link") or item.get("url") or item.get("href") or item.get("text")
        else:
            candidate = item
        if isinstance(candidate, str):
            candidate = candidate.strip()
            markdown = re.fullmatch(r"\[[^\]]*\]\((https?://.*)\)", candidate)
            if markdown:
                candidate = markdown.group(1)
            parsed = urlparse(candidate)
            if parsed.scheme in ("http", "https") and parsed.netloc:
                return candidate
    return ""


def checkbox_value(value):
    if value is None or value is False or value == 0 or value == "":
        return False
    if value is True or value == 1:
        return True
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in ("true", "是"):
            return True
        if normalized in ("false", "否", "0"):
            return False
    raise ValueError(f"无法识别复选框值：{value!r}")


def load_descriptor(data_root):
    path = Path(data_root) / "tables" / "locations.json"
    registry = load_json(path)
    descriptor = registry.get("tables", {}).get("sources") if isinstance(registry, dict) else None
    if not isinstance(descriptor, dict) or descriptor.get("kind") != "feishu":
        raise UserError("locations.json 中缺少飞书 sources 表")
    field_map = descriptor.get("fieldMap")
    if not isinstance(field_map, dict):
        raise UserError("sources.fieldMap 缺失或不是对象")
    for name in ("处理完成", "提交状态", "填写状态", "公司"):
        if not isinstance(field_map.get(name), str) or not field_map[name]:
            raise UserError(f"sources.fieldMap 缺少「{name}」字段 ID")
    url_name = next((name for name in ("来源链接", "岗位链接") if field_map.get(name)), None)
    if not url_name:
        raise UserError("sources.fieldMap 缺少「来源链接」或「岗位链接」字段 ID")
    if not descriptor.get("baseToken") or not descriptor.get("tableId"):
        raise UserError("sources 描述缺少 baseToken 或 tableId")
    return descriptor, url_name


def read_rows(snapshot):
    pages = snapshot if isinstance(snapshot, list) else [snapshot]
    if not pages:
        raise UserError("行快照不能为空")
    result = []
    expected_fields = None
    expected_ids = None
    for index, envelope in enumerate(pages):
        if not isinstance(envelope, dict) or envelope.get("ok") is not True:
            raise UserError(f"第 {index + 1} 页不是成功的 lark-cli 响应")
        data = envelope.get("data")
        if not isinstance(data, dict):
            raise UserError(f"第 {index + 1} 页缺少 data")
        fields, ids, rows, row_ids = (data.get(key) for key in ("fields", "field_id_list", "data", "record_id_list"))
        if not all(isinstance(value, list) for value in (fields, ids, rows, row_ids)):
            raise UserError(f"第 {index + 1} 页缺少表格矩阵字段")
        if len(fields) != len(ids) or len(rows) != len(row_ids):
            raise UserError(f"第 {index + 1} 页表格矩阵长度不一致")
        if len(set(ids)) != len(ids):
            raise UserError(f"第 {index + 1} 页包含重复字段 ID")
        if expected_ids is None:
            expected_fields, expected_ids = fields, ids
        elif set(ids) != set(expected_ids):
            raise UserError("分页之间缺少或增加了字段")
        for row_id, row in zip(row_ids, rows):
            if not isinstance(row_id, str) or not row_id or not isinstance(row, list) or len(row) != len(ids):
                raise UserError(f"第 {index + 1} 页包含不完整的行")
            result.append((row_id, dict(zip(ids, row))))
        if data.get("has_more") is True and index == len(pages) - 1:
            raise UserError("行快照仍有下一页，必须读到 has_more=false")
        if index < len(pages) - 1 and data.get("has_more") is not True:
            raise UserError(f"第 {index + 1} 页没有声明还有下一页")
    return expected_ids, result


def local_blocks(data_root, descriptor, rows):
    path = Path(data_root) / "db" / "runtime.sqlite"
    if not path.exists():
        return set()
    external_ids = {
        row_id: (f"feishu:{descriptor['baseToken']}:{descriptor['tableId']}:{row_id}", row_id)
        for row_id, _ in rows
    }
    blocked = set()
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as db:
        columns = {row[1] for row in db.execute("PRAGMA table_info(application_tasks)")}
        required = {"id", "task_kind", "company_name", "external_row_id", "status"}
        if not required <= columns:
            raise UserError("runtime.sqlite 的 application_tasks 结构不兼容")
        tasks = db.execute(
            "SELECT id, task_kind, company_name, external_row_id, status FROM application_tasks"
        ).fetchall()
        run_columns = {row[1] for row in db.execute("PRAGMA table_info(application_runs)")}
        dangerous_runs = set()
        if {"task_id", "state"} <= run_columns:
            dangerous_runs = {
                row[0] for row in db.execute(
                    "SELECT DISTINCT task_id FROM application_runs "
                    "WHERE rowid IN (SELECT rowid FROM (SELECT rowid, "
                    "ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY updated_at DESC, rowid DESC) AS rank "
                    "FROM application_runs) WHERE rank = 1) "
                    "AND state IN ('submitting','submitted_confirmed','submission_uncertain')"
                )
            }
        dangerous_runs.update(
            row[0] for row in db.execute(
                "SELECT DISTINCT task_id FROM submission_attempts "
                "WHERE outcome IN ('confirmed','uncertain','in_progress')"
            )
        )
    confirmed_by_company = {
        company.strip() for task_id, kind, company, _, status in tasks
        if isinstance(company, str) and company.strip() and (
            status in ("submitted", "submission_uncertain")
            or status == "completed"
            or task_id in dangerous_runs
        )
    }
    for row_id, cells in rows:
        company = text_value(cells.get(descriptor["fieldMap"]["公司"]))
        identities = external_ids[row_id]
        for task_id, kind, task_company, external_id, status in tasks:
            is_confirmed = (
                status in ("submitted", "submission_uncertain")
                or status == "completed"
                or task_id in dangerous_runs
            )
            if is_confirmed and (
                external_id in identities
                or (isinstance(external_id, str) and external_id.startswith(row_id + "-"))
                or (not external_id and company and isinstance(task_company, str) and task_company.strip() == company)
            ):
                blocked.add(row_id)
                break
        if company in confirmed_by_company:
            blocked.add(row_id)
    return blocked


def plan(data_root, snapshot):
    descriptor, url_name = load_descriptor(data_root)
    field_ids, rows = read_rows(snapshot)
    field_map = descriptor["fieldMap"]
    required = [field_map[name] for name in ("处理完成", "提交状态", "公司", url_name)]
    if any(field_id not in field_ids for field_id in required):
        raise UserError("行快照缺少 fieldMap 指定的必需列")
    if len(set(required)) != len(required):
        raise UserError("fieldMap 的必需字段不能指向同一列")
    fill_id = field_map.get("填写状态")
    if fill_id and fill_id not in field_ids:
        raise UserError("行快照缺少 fieldMap 指定的「填写状态」列")
    if fill_id in required:
        raise UserError("fieldMap 的「填写状态」不能复用其他必需列")
    local = local_blocks(data_root, descriptor, rows)
    items = []
    for row_id, cells in rows:
        company = text_value(cells[field_map["公司"]])
        url = url_value(cells[field_map[url_name]])
        if not url and field_map.get("岗位链接") in cells:
            url = url_value(cells[field_map["岗位链接"]])
        decision, reason, fill_mode = "eligible", "待填写，只补空字段", "empty_only"
        try:
            checked = checkbox_value(cells[field_map["处理完成"]])
        except ValueError as error:
            decision, reason = "blocked", str(error)
        else:
            submission = text_value(cells[field_map["提交状态"]])
            fill = text_value(cells.get(fill_id)) if fill_id else ""
            if checked:
                decision, reason = "skipped", "处理完成已勾选"
            elif submission in FINISHED_SUBMISSION:
                decision, reason = "skipped", f"提交状态为{submission}"
            elif submission not in ALLOWED_SUBMISSION:
                decision, reason = "blocked", f"未知提交状态：{submission}"
            elif fill in FINISHED_FILL:
                decision, reason = "skipped", f"填写状态为{fill}"
            elif row_id in local:
                decision, reason = "skipped", "本地运行记录表明该公司已填写、已提交或提交结果不确定"
            elif not company:
                decision, reason = "blocked", "缺少公司"
            elif not url:
                decision, reason = "blocked", f"缺少有效{url_name}"
            elif fill in PARTIAL_FILL:
                reason = "继续部分填写，只填空字段"
            elif fill not in ("", "未填写", "待填写"):
                decision, reason = "blocked", f"未知填写状态：{fill}"
        items.append({
            "rowId": row_id, "company": company, "url": url,
            "decision": decision, "reason": reason, "fillMode": fill_mode,
        })
    return {
        "source": {"baseToken": descriptor["baseToken"], "tableId": descriptor["tableId"]},
        "items": items,
        "summary": {name: sum(item["decision"] == name for item in items) for name in ("eligible", "skipped", "blocked")},
    }


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--rows", required=True)
    args = parser.parse_args(argv)
    try:
        result = plan(args.data_root, load_json(args.rows))
    except (UserError, sqlite3.Error) as error:
        json.dump({"ok": False, "error": str(error)}, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        return 2
    json.dump({"ok": True, **result}, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
