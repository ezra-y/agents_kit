#!/usr/bin/env python3
"""Register and edit user-owned recruitment tables without importing their data."""

import argparse
import csv
import json
import os
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse


ROLES = ("sources", "candidates")
FILENAMES = {"sources": "招聘来源.csv", "candidates": "候选岗位.csv"}


class UserError(Exception):
    pass


def load_json(path):
    try:
        with open(path, encoding="utf-8") as stream:
            return json.load(stream)
    except (OSError, json.JSONDecodeError) as error:
        raise UserError(f"无法读取 JSON：{path}：{error}") from error


def registry_path(data_root):
    return Path(data_root) / "tables" / "locations.json"


def empty_registry():
    return {"version": 1, "tables": {}}


def load_registry(data_root):
    path = registry_path(data_root)
    if not path.exists():
        return empty_registry()
    value = load_json(path)
    if not isinstance(value, dict):
        raise UserError(f"位置注册文件必须是 JSON 对象：{path}")
    if not isinstance(value.get("tables", {}), dict):
        raise UserError(f"位置注册文件的 tables 必须是对象：{path}")
    value.setdefault("version", 1)
    value.setdefault("tables", {})
    return value


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temporary, path)
    except Exception:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def is_web_url(value):
    parsed = urlparse(value)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def validate_descriptor(value):
    if not isinstance(value, dict):
        raise UserError("descriptor 必须是 JSON 对象")
    kind = value.get("kind")
    location = value.get("location")
    name = value.get("name")
    if kind not in ("file", "link", "feishu"):
        raise UserError("kind 必须是 file、link 或 feishu")
    if not isinstance(location, str) or not location:
        raise UserError("location 必须是非空字符串")
    if not isinstance(name, str) or not name:
        raise UserError("name 必须是非空字符串")
    if kind == "file":
        path = Path(location)
        if not path.is_absolute():
            raise UserError("file location 必须是绝对路径")
        if not path.is_file():
            raise UserError(f"表格文件不存在：{location}")
    else:
        if not is_web_url(location):
            raise UserError(f"{kind} location 必须是 http(s) URL")
    if kind == "feishu" and (not value.get("baseToken") or not value.get("tableId")):
        raise UserError("feishu descriptor 必须包含 baseToken 和 tableId")
    if "fieldMap" in value and not isinstance(value["fieldMap"], dict):
        raise UserError("fieldMap 必须是对象")
    if "keyField" in value and not isinstance(value["keyField"], str):
        raise UserError("keyField 必须是字符串")
    return value


def register(data_root, role, descriptor):
    validate_descriptor(descriptor)
    registry = load_registry(data_root)
    previous = registry["tables"].get(role)
    if previous and previous.get("kind") == "link" and descriptor["kind"] != "link":
        sources = registry.setdefault("externalSources", [])
        if previous not in sources:
            sources.append(previous)
    registry["tables"][role] = descriptor
    write_json(registry_path(data_root), registry)
    return registry


def load_schema(role):
    path = Path(__file__).resolve().parent.parent / "assets" / "table-schemas.json"
    schemas = load_json(path)
    schema = schemas.get(role)
    if not isinstance(schema, dict):
        raise UserError(f"表格模板缺少 {role} 定义：{path}")
    fields = schema.get("fields")
    if not isinstance(fields, list) or not fields:
        raise UserError(f"表格模板 {role}.fields 必须是非空列表")
    names = [field.get("name") if isinstance(field, dict) else None for field in fields]
    if not all(isinstance(name, str) and name for name in names):
        raise UserError(f"表格模板 {role}.fields 中每项都必须有 name")
    key_field = schema.get("keyField")
    if key_field not in names:
        raise UserError(f"表格模板 {role}.keyField 必须出现在 fields 中")
    return names, key_field


def create_local(data_root, role, directory):
    fields, key_field = load_schema(role)
    directory = Path(directory) if directory else Path(data_root) / "tables"
    if not directory.is_absolute():
        raise UserError("--directory 必须是绝对路径")
    target = directory / FILENAMES[role]
    registry = load_registry(data_root)
    current = registry["tables"].get(role)
    if current:
        if current.get("kind") == "file" and Path(current.get("location", "")) == target:
            if not target.is_file():
                raise UserError(f"已登记本地表格，但文件不存在：{target}")
            return registry, True
        if current.get("kind") != "link":
            raise UserError(f"{role} 已登记在其他位置：{current.get('location', '未知位置')}")
    existed = target.exists()
    if existed and not target.is_file():
        raise UserError(f"目标路径不是文件：{target}")
    if existed:
        existing_fields, _ = read_csv(target)
        if key_field not in existing_fields:
            raise UserError(f"已有 CSV 缺少关键列，未登记也未覆盖：{key_field}")
    if not existed:
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "x", encoding="utf-8-sig", newline="") as stream:
            csv.writer(stream).writerow(fields)
    descriptor = {
        "kind": "file",
        "location": str(target),
        "name": FILENAMES[role],
        "keyField": key_field,
    }
    return register(data_root, role, descriptor), existed


def local_descriptor(data_root, role):
    descriptor = load_registry(data_root)["tables"].get(role)
    if not descriptor:
        raise UserError(f"{role} 尚未登记")
    if descriptor.get("kind") != "file":
        raise UserError(f"{role} 登记的是 {descriptor.get('kind')}，不是本地文件")
    path = Path(descriptor.get("location", ""))
    if path.suffix.lower() != ".csv":
        raise UserError(f"暂不支持读取 {path.suffix or '无扩展名'} 文件；目前只支持 CSV")
    if not path.is_file():
        raise UserError(f"表格文件不存在：{path}")
    return descriptor, path


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames:
            raise UserError(f"CSV 缺少表头：{path}")
        return reader.fieldnames, list(reader)


def read_local(data_root, role, offset, limit):
    descriptor, path = local_descriptor(data_root, role)
    fields, rows = read_csv(path)
    return {
        "role": role,
        "location": str(path),
        "fields": fields,
        "offset": offset,
        "limit": limit,
        "total": len(rows),
        "rows": rows[offset : offset + limit],
        "externalRowIds": [
            json.dumps(["file", str(path.resolve()), row.get(descriptor.get("keyField"), "")], ensure_ascii=False)
            if row.get(descriptor.get("keyField")) else None
            for row in rows[offset : offset + limit]
        ],
        "keyField": descriptor.get("keyField"),
    }


def patch_rows(value):
    if isinstance(value, list):
        rows = value
    elif isinstance(value, dict) and isinstance(value.get("rows"), list):
        rows = value["rows"]
    elif isinstance(value, dict):
        rows = [value]
    else:
        raise UserError("patch 必须是对象、对象列表或包含 rows 的对象")
    if not rows or not all(isinstance(row, dict) for row in rows):
        raise UserError("patch 必须至少包含一个对象")
    return rows


def upsert_local(data_root, role, patch_file):
    descriptor, path = local_descriptor(data_root, role)
    fields, rows = read_csv(path)
    key_field = descriptor.get("keyField")
    if not key_field:
        _, key_field = load_schema(role)
    if key_field not in fields:
        raise UserError(f"keyField 不在实际表头中：{key_field}")
    patches = patch_rows(load_json(patch_file))
    indexes = {}
    for index, row in enumerate(rows):
        key = row.get(key_field, "")
        if key:
            indexes.setdefault(key, []).append(index)
    seen = set()
    added = updated = 0
    for patch in patches:
        unknown = set(patch) - set(fields)
        if unknown:
            raise UserError(f"patch 包含实际表头之外的列：{', '.join(sorted(unknown))}")
        key = patch.get(key_field)
        if not isinstance(key, str) or not key:
            raise UserError(f"每条 patch 都必须包含非空 {key_field}")
        if key in seen:
            raise UserError(f"patch 中 key 重复，无法判断：{key}")
        seen.add(key)
        matches = indexes.get(key, [])
        if len(matches) > 1:
            raise UserError(f"CSV 中 key 重复，无法判断：{key}")
        if matches:
            rows[matches[0]].update(patch)
            updated += 1
        else:
            rows.append({field: patch.get(field, "") for field in fields})
            added += 1
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    try:
        with os.fdopen(fd, "w", encoding="utf-8-sig", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)
        os.replace(temporary, path)
    except Exception:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise
    return {"role": role, "location": str(path), "updated": updated, "added": added}


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--data-root", required=True, type=Path)
    commands = result.add_subparsers(dest="command", required=True)
    commands.add_parser("show")
    register_parser = commands.add_parser("register")
    register_parser.add_argument("--role", choices=ROLES, required=True)
    register_parser.add_argument("--file", required=True, type=Path)
    create_parser = commands.add_parser("create-local")
    create_parser.add_argument("--role", choices=ROLES, required=True)
    create_parser.add_argument("--directory", type=Path)
    read_parser = commands.add_parser("read-local")
    read_parser.add_argument("--role", choices=ROLES, required=True)
    read_parser.add_argument("--limit", type=int, default=20)
    read_parser.add_argument("--offset", type=int, default=0)
    upsert_parser = commands.add_parser("upsert-local")
    upsert_parser.add_argument("--role", choices=ROLES, required=True)
    upsert_parser.add_argument("--file", required=True, type=Path)
    return result


def main():
    args = parser().parse_args()
    if not args.data_root.is_absolute():
        raise UserError("--data-root 必须是绝对路径")
    if args.command == "show":
        output = load_registry(args.data_root)
    elif args.command == "register":
        output = register(args.data_root, args.role, load_json(args.file))
    elif args.command == "create-local":
        registry, reused = create_local(args.data_root, args.role, args.directory)
        output = {"reused": reused, "descriptor": registry["tables"][args.role]}
    elif args.command == "read-local":
        if args.limit < 0 or args.offset < 0:
            raise UserError("--limit 和 --offset 不能小于 0")
        output = read_local(args.data_root, args.role, args.offset, args.limit)
    else:
        output = upsert_local(args.data_root, args.role, args.file)
    json.dump(output, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    try:
        main()
    except UserError as error:
        print(f"错误：{error}", file=sys.stderr)
        raise SystemExit(2)
