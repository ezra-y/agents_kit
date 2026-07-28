from __future__ import annotations

import fcntl
import hashlib
import json
import os
import shutil
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from .models import ContentMode, SkillEntry

CONFIG_NAME = "agents-kit.json"
ACTIVE_HEADER = (
    "# 常驻技能名单。这里只记录需要全局生效的技能名。\n"
    "# 请使用 agents-kit global enable/disable/apply 修改和应用。\n\n"
)


class RepositoryError(RuntimeError):
    pass


class Repository:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.skills_dir = self.root / "skills"
        self.active_path = self.root / "active.txt"
        self.sources_path = self.root / "sources.json"
        self.metadata_path = self.root / "metadata.json"
        self.mcps_path = self.root / "mcps.json"
        self.config_path = self.root / CONFIG_NAME
        self._config: dict[str, Any] | None = None
        self._inventory: dict[str, SkillEntry] | None = None

    @classmethod
    def discover(cls, start: Path) -> Repository:
        start = start.resolve()
        candidates = [start, *start.parents]
        for candidate in candidates:
            if (candidate / "skills").is_dir() and (
                candidate / "sources.json"
            ).is_file():
                return cls(candidate)
        raise RepositoryError(f"从 {start} 找不到 agents_kit 仓库")

    @property
    def config(self) -> dict[str, Any]:
        if self._config is None:
            self._config = self._load_json(self.config_path)
            self._validate_config(self._config)
        return self._config

    @property
    def categories(self) -> tuple[str, ...]:
        return tuple(self.config["categories"])

    @property
    def network_timeout(self) -> int:
        return int(self.config["defaults"]["network_timeout_seconds"])

    def refresh(self) -> None:
        self._inventory = None
        self._config = None

    def inventory(self, *, refresh: bool = False) -> dict[str, SkillEntry]:
        if self._inventory is not None and not refresh:
            return dict(self._inventory)
        found: dict[str, SkillEntry] = {}
        if not self.skills_dir.is_dir():
            raise RepositoryError(f"技能目录不存在：{self.skills_dir}")
        for directory, dirs, files in os.walk(self.skills_dir):
            if "SKILL.md" not in files:
                continue
            dirs[:] = []
            path = Path(directory)
            relative = path.relative_to(self.skills_dir)
            if len(relative.parts) != 2:
                raise RepositoryError(f"技能必须位于 skills/<分类>/<名称>：{relative}")
            category, name = relative.parts
            if name in found:
                raise RepositoryError(
                    f"技能重名：{name}\n  {found[name].path}\n  {path}"
                )
            found[name] = SkillEntry(name=name, category=category, path=path)
        self._inventory = found
        return dict(found)

    def require_skill(self, name: str) -> SkillEntry:
        entry = self.inventory().get(name)
        if entry is None:
            raise RepositoryError(f"找不到技能：{name}")
        return entry

    def read_active(self) -> list[str]:
        names: list[str] = []
        for line in self.active_path.read_text(encoding="utf-8").splitlines():
            name = line.split("#", 1)[0].strip()
            if name and name not in names:
                names.append(name)
        return names

    def write_active(self, names: list[str]) -> bool:
        unique = list(dict.fromkeys(names))
        return self.write_text_if_changed(
            self.active_path, ACTIVE_HEADER + "\n".join(unique) + "\n"
        )

    def read_sources(self) -> dict[str, Any]:
        data = self._load_json(self.sources_path)
        if data.get("schema_version") != 2:
            raise RepositoryError("sources.json schema_version 必须是 2")
        if not isinstance(data.get("skills"), dict):
            raise RepositoryError("sources.json 缺 skills 对象")
        return data

    def write_sources(self, data: dict[str, Any]) -> bool:
        normalized = dict(data)
        normalized["schema_version"] = 2
        normalized["skills"] = dict(sorted(normalized.get("skills", {}).items()))
        return self.write_json_if_changed(self.sources_path, normalized)

    def read_metadata(self) -> dict[str, Any]:
        data = self._load_json(self.metadata_path)
        if not isinstance(data.get("skills"), dict):
            raise RepositoryError("metadata.json 缺 skills 对象")
        return data

    def read_mcps(self) -> dict[str, Any]:
        data = self._load_json(self.mcps_path)
        if data.get("schema_version") != 1:
            raise RepositoryError("mcps.json schema_version 必须是 1")
        if not isinstance(data.get("servers"), dict):
            raise RepositoryError("mcps.json 缺 servers 对象")
        return data

    def write_mcps(self, data: dict[str, Any]) -> bool:
        normalized = dict(data)
        normalized["schema_version"] = 1
        normalized["servers"] = dict(sorted(normalized.get("servers", {}).items()))
        return self.write_json_if_changed(self.mcps_path, normalized)

    def write_metadata(self, data: dict[str, Any]) -> bool:
        normalized = dict(data)
        normalized["skills"] = dict(sorted(normalized.get("skills", {}).items()))
        return self.write_json_if_changed(self.metadata_path, normalized)

    def source_record(self, name: str) -> dict[str, Any] | None:
        return self.read_sources()["skills"].get(name)

    def set_source_record(self, name: str, record: dict[str, Any]) -> bool:
        data = self.read_sources()
        data["skills"][name] = record
        return self.write_sources(data)

    def remove_source_record(self, name: str) -> bool:
        data = self.read_sources()
        if data["skills"].pop(name, None) is None:
            return False
        return self.write_sources(data)

    def metadata_record(self, name: str) -> dict[str, Any] | None:
        return self.read_metadata()["skills"].get(name)

    def set_metadata_record(self, name: str, record: dict[str, Any]) -> bool:
        data = self.read_metadata()
        data["skills"][name] = record
        return self.write_metadata(data)

    def remove_metadata_record(self, name: str) -> bool:
        data = self.read_metadata()
        if data["skills"].pop(name, None) is None:
            return False
        return self.write_metadata(data)

    @contextmanager
    def write_lock(self) -> Iterator[None]:
        lock_dir = self.root / ".git"
        if not lock_dir.is_dir():
            lock_dir = self.root
        lock_path = lock_dir / "agents-kit.lock"
        with lock_path.open("a+", encoding="utf-8") as lock_file:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)

    def write_json_if_changed(self, path: Path, data: Any) -> bool:
        text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        return self.write_text_if_changed(path, text)

    def write_text_if_changed(self, path: Path, text: str) -> bool:
        if path.is_file() and path.read_text(encoding="utf-8") == text:
            return False
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as temp_file:
                temp_file.write(text)
                temp_file.flush()
                os.fsync(temp_file.fileno())
            os.replace(temp_name, path)
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)
        return True

    def install_skill_directory(
        self, staged: Path, destination: Path, *, replace: bool = False
    ) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists() and not replace:
            raise RepositoryError(f"目标技能已存在：{destination}")
        temp = Path(
            tempfile.mkdtemp(prefix=f".{destination.name}.", dir=destination.parent)
        )
        shutil.rmtree(temp)
        try:
            shutil.copytree(
                staged,
                temp,
                symlinks=True,
                ignore=shutil.ignore_patterns(
                    ".git", "__pycache__", "*.pyc", ".DS_Store"
                ),
            )
            if destination.exists():
                shutil.rmtree(destination)
            os.replace(temp, destination)
        finally:
            shutil.rmtree(temp, ignore_errors=True)
        self._inventory = None

    def install_skill_file(self, staged: Path, destination: Path) -> bool:
        return self.write_text_if_changed(
            destination / "SKILL.md",
            (staged / "SKILL.md").read_text(encoding="utf-8"),
        )

    @staticmethod
    def hash_file(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def hash_skill_content(path: Path, content_mode: ContentMode | str) -> str:
        mode = ContentMode(content_mode)
        if mode == ContentMode.SKILL_FILE:
            return Repository.hash_file(path / "SKILL.md")
        return Repository.hash_directory(path)

    @staticmethod
    def hash_directory(path: Path) -> str:
        digest = hashlib.sha256()
        for item in sorted(path.rglob("*"), key=lambda candidate: candidate.as_posix()):
            relative = item.relative_to(path).as_posix()
            if any(part in {".git", "__pycache__"} for part in item.parts):
                continue
            if item.name == ".DS_Store" or item.suffix == ".pyc":
                continue
            digest.update(relative.encode("utf-8"))
            if item.is_symlink():
                digest.update(b"L")
                digest.update(os.readlink(item).encode("utf-8"))
            elif item.is_file():
                digest.update(b"F")
                with item.open("rb") as handle:
                    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                        digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def _load_json(path: Path) -> dict[str, Any]:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError as exc:
            raise RepositoryError(f"文件不存在：{path}") from exc
        except json.JSONDecodeError as exc:
            raise RepositoryError(f"JSON 格式错误：{path}: {exc}") from exc
        if not isinstance(data, dict):
            raise RepositoryError(f"JSON 顶层必须是对象：{path}")
        return data

    @staticmethod
    def _validate_config(config: dict[str, Any]) -> None:
        if config.get("schema_version") != 1:
            raise RepositoryError("agents-kit.json schema_version 必须是 1")
        categories = config.get("categories")
        if (
            not isinstance(categories, list)
            or not categories
            or any(not isinstance(item, str) or not item for item in categories)
            or len(categories) != len(set(categories))
        ):
            raise RepositoryError("agents-kit.json categories 必须是非空唯一字符串数组")
        targets = config.get("install_targets")
        if not isinstance(targets, dict):
            raise RepositoryError("agents-kit.json 缺 install_targets")
        for scope in ("global", "project"):
            if not isinstance(targets.get(scope), list):
                raise RepositoryError(f"install_targets.{scope} 必须是数组")
            for target in targets[scope]:
                if not isinstance(target, dict) or not all(
                    isinstance(target.get(key), str) and target[key]
                    for key in ("id", "path", "mode")
                ):
                    raise RepositoryError(f"install_targets.{scope} 记录不完整")
        mcp_targets = config.get("mcp_install_targets")
        if not isinstance(mcp_targets, dict) or not isinstance(
            mcp_targets.get("global"), list
        ):
            raise RepositoryError("agents-kit.json 缺 mcp_install_targets.global")
        mcp_target_ids: list[str] = []
        for target in mcp_targets["global"]:
            if (
                not isinstance(target, dict)
                or not isinstance(target.get("id"), str)
                or not target["id"]
            ):
                raise RepositoryError("mcp_install_targets.global 记录不完整")
            mcp_target_ids.append(target["id"])
        if len(mcp_target_ids) != len(set(mcp_target_ids)):
            raise RepositoryError("mcp_install_targets.global id 必须唯一")
        defaults = config.get("defaults")
        if not isinstance(defaults, dict):
            raise RepositoryError("agents-kit.json 缺 defaults")
        timeout = defaults.get("network_timeout_seconds")
        if not isinstance(timeout, int) or timeout < 1 or timeout > 300:
            raise RepositoryError("network_timeout_seconds 必须是 1-300 的整数")
        if defaults.get("source_policy") not in {"review", "pinned"}:
            raise RepositoryError("source_policy 必须是 review 或 pinned")
