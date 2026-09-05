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

from .models import AssetRef, ContentMode, PluginSpec, SkillEntry
from .plugins import PluginError, _embedded_skill_paths, load_plugin_spec
from .taxonomy import TaxonomyError, validate_definition

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
        self.plugins_dir = self.root / "plugins"
        self.active_path = self.root / "active.txt"
        self.desired_installations_path = self.root / "desired-installations.json"
        self.sources_path = self.root / "sources.json"
        self.metadata_path = self.root / "metadata.json"
        self.mcps_path = self.root / "mcps.json"
        self.scout_path = self.root / "scout.json"
        self.config_path = self.root / CONFIG_NAME
        self._config: dict[str, Any] | None = None
        self._inventory: dict[str, SkillEntry] | None = None
        self._skill_registry: dict[str, SkillEntry] | None = None
        self._plugin_inventory: dict[str, PluginSpec] | None = None

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
    def taxonomy_version(self) -> int:
        return int(self.config["taxonomy_version"])

    @property
    def tag_namespaces(self) -> dict[str, dict[str, Any]]:
        return dict(self.config["tag_namespaces"])

    @property
    def max_tags(self) -> int:
        return int(self.config["max_tags"])

    def category_label(self, category: str) -> str:
        definition = self.config["categories"].get(category)
        return definition["label"] if definition else category

    @property
    def network_timeout(self) -> int:
        return int(self.config["defaults"]["network_timeout_seconds"])

    def refresh(self) -> None:
        self._inventory = None
        self._skill_registry = None
        self._plugin_inventory = None
        self._config = None

    def inventory(self, *, refresh: bool = False) -> dict[str, SkillEntry]:
        """Compatibility view keyed by an unambiguous CLI selector.

        New code should prefer skill_registry(), whose keys are canonical AssetRefs.
        """
        if self._inventory is not None and not refresh:
            return dict(self._inventory)
        registry = self.skill_registry(refresh=refresh)
        by_name: dict[str, list[SkillEntry]] = {}
        for entry in registry.values():
            by_name.setdefault(entry.name, []).append(entry)
        found: dict[str, SkillEntry] = {}
        for name, entries in sorted(by_name.items()):
            if len(entries) == 1:
                found[name] = entries[0]
                continue
            for entry in entries:
                found[entry.qualified_id] = entry
        self._inventory = found
        return dict(found)

    def skill_registry(self, *, refresh: bool = False) -> dict[str, SkillEntry]:
        if self._skill_registry is not None and not refresh:
            return dict(self._skill_registry)
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
            entry = SkillEntry(name=name, category=category, path=path)
            key = entry.qualified_id
            if key in found:
                raise RepositoryError(
                    f"技能身份重复：{key}\n  {found[key].path}\n  {path}"
                )
            found[key] = entry

        metadata = self.read_metadata()["skills"]
        for plugin_id, plugin in self.plugin_inventory(refresh=refresh).items():
            for name, path in _embedded_skill_paths(plugin.root).items():
                ref = AssetRef.plugin_skill(plugin_id, name)
                record = metadata.get(ref.canonical, {})
                category = record.get("category")
                if not isinstance(category, str) or not category:
                    category = "uncategorized"
                entry = SkillEntry(
                    name=name,
                    category=category,
                    path=path,
                    owner_kind="plugin",
                    owner_id=plugin_id,
                )
                if ref.canonical in found:
                    raise RepositoryError(f"技能身份重复：{ref.canonical}")
                found[ref.canonical] = entry
        self._skill_registry = found
        return dict(found)

    def plugin_inventory(self, *, refresh: bool = False) -> dict[str, PluginSpec]:
        if self._plugin_inventory is not None and not refresh:
            return dict(self._plugin_inventory)
        found: dict[str, PluginSpec] = {}
        if self.plugins_dir.is_dir():
            for root in sorted(self.plugins_dir.iterdir()):
                if not root.is_dir() or root.name.startswith("."):
                    continue
                try:
                    plugin = load_plugin_spec(root)
                except PluginError as exc:
                    raise RepositoryError(str(exc)) from exc
                if plugin.package_id in found:
                    raise RepositoryError(f"Plugin ID 重复：{plugin.package_id}")
                found[plugin.package_id] = plugin
        self._plugin_inventory = found
        return dict(found)

    def require_plugin(self, selector: str) -> PluginSpec:
        try:
            ref = AssetRef.parse(selector)
        except ValueError:
            ref = AssetRef.plugin(selector)
        if ref.kind != "plugin":
            raise RepositoryError(f"不是 Plugin 引用：{selector}")
        plugin = self.plugin_inventory().get(ref.local_id)
        if plugin is None:
            raise RepositoryError(f"找不到 Plugin：{selector}")
        return plugin

    def resolve_skill_ref(self, selector: str | AssetRef) -> AssetRef:
        registry = self.skill_registry()
        if isinstance(selector, AssetRef):
            if selector.kind != "skill" or selector.canonical not in registry:
                raise RepositoryError(f"找不到技能：{selector}")
            return selector
        if selector.startswith("skill:"):
            try:
                ref = AssetRef.parse(selector)
            except ValueError as exc:
                raise RepositoryError(str(exc)) from exc
            if ref.kind != "skill" or ref.canonical not in registry:
                raise RepositoryError(f"找不到技能：{selector}")
            return ref
        matches = [entry.ref for entry in registry.values() if entry.name == selector]
        if not matches:
            raise RepositoryError(f"找不到技能：{selector}")
        if len(matches) > 1:
            choices = "、".join(sorted(ref.canonical for ref in matches))
            raise RepositoryError(f"技能名不唯一：{selector}；请使用 {choices}")
        return matches[0]

    def require_skill(self, selector: str | AssetRef) -> SkillEntry:
        ref = self.resolve_skill_ref(selector)
        return self.skill_registry()[ref.canonical]

    def skill_activation(self) -> dict[str, dict[str, str]]:
        """Declared availability per client; runtime loading is checked separately."""
        inventory = self.skill_registry()
        result: dict[str, dict[str, str]] = {}
        metadata = self.read_metadata()["skills"]
        for target, state in self.read_desired_installations()["targets"].items():
            pending = list(state.get("skills", []))
            explicit = set(pending)
            seen: set[str] = set()
            while pending:
                ref = pending.pop()
                if ref in seen or ref not in inventory:
                    continue
                seen.add(ref)
                result.setdefault(ref, {})[target] = (
                    "independent" if ref in explicit else "dependency"
                )
                pending.extend(metadata.get(ref, {}).get("dependencies", []))
            for item in state.get("plugins", []):
                plugin_id = AssetRef.parse(item["ref"]).local_id
                plugin = self.require_plugin(plugin_id)
                for name in _embedded_skill_paths(plugin.root, target=target):
                    ref = AssetRef.plugin_skill(plugin_id, name).canonical
                    result.setdefault(ref, {})[target] = "plugin"
        return result

    def read_active(self) -> list[str]:
        if self.desired_installations_path.is_file():
            names: list[str] = []
            for target in self.read_desired_installations()["targets"].values():
                for raw_ref in target.get("skills", []):
                    try:
                        ref = AssetRef.parse(raw_ref)
                    except ValueError:
                        continue
                    if ref.local_id not in names:
                        names.append(ref.local_id)
            return names
        names: list[str] = []
        for line in self.active_path.read_text(encoding="utf-8").splitlines():
            name = line.split("#", 1)[0].strip()
            if name and name not in names:
                names.append(name)
        return names

    def write_active(self, names: list[str]) -> bool:
        unique = list(dict.fromkeys(names))
        changed = self.write_text_if_changed(
            self.active_path, ACTIVE_HEADER + "\n".join(unique) + "\n"
        )
        if self.desired_installations_path.is_file():
            desired = self.read_desired_installations()
            refs = [self.resolve_skill_ref(name).canonical for name in unique]
            for target in desired["targets"].values():
                target["skills"] = list(refs)
            changed = self.write_desired_installations(desired) or changed
        return changed

    def read_desired_installations(self) -> dict[str, Any]:
        if not self.desired_installations_path.is_file():
            refs = []
            for line in self.active_path.read_text(encoding="utf-8").splitlines():
                name = line.split("#", 1)[0].strip()
                if name and name not in refs:
                    refs.append(AssetRef.standalone_skill(name).canonical)
            return {
                "schema_version": 1,
                "targets": {
                    "claude": {
                        "scope": "user",
                        "skills": list(refs),
                        "plugins": [],
                    },
                    "codex": {
                        "scope": "user",
                        "skills": list(refs),
                        "plugins": [],
                    },
                },
            }
        data = self._load_json(self.desired_installations_path)
        if data.get("schema_version") != 1 or not isinstance(data.get("targets"), dict):
            raise RepositoryError(
                "desired-installations.json schema_version 必须是 1 且包含 targets"
            )
        for target, record in data["targets"].items():
            if target not in {"claude", "codex"} or not isinstance(record, dict):
                raise RepositoryError(
                    f"desired-installations.json target 无效：{target}"
                )
            if not isinstance(record.get("skills", []), list) or not isinstance(
                record.get("plugins", []), list
            ):
                raise RepositoryError(f"desired-installations.json {target} 清单无效")
        return data

    def write_desired_installations(self, data: dict[str, Any]) -> bool:
        normalized = dict(data)
        normalized["schema_version"] = 1
        targets: dict[str, Any] = {}
        for target, record in sorted(normalized.get("targets", {}).items()):
            updated = dict(record)
            updated["scope"] = updated.get("scope", "user")
            updated["skills"] = sorted(dict.fromkeys(updated.get("skills", [])))
            plugins = updated.get("plugins", [])
            updated["plugins"] = sorted(
                plugins,
                key=lambda item: (
                    item.get("ref", "") if isinstance(item, dict) else str(item)
                ),
            )
            targets[target] = updated
        normalized["targets"] = targets
        return self.write_json_if_changed(self.desired_installations_path, normalized)

    def read_sources(self) -> dict[str, Any]:
        data = self._load_json(self.sources_path)
        if data.get("schema_version") not in {2, 3}:
            raise RepositoryError("sources.json schema_version 必须是 2 或 3")
        if not isinstance(data.get("skills"), dict):
            raise RepositoryError("sources.json 缺 skills 对象")
        if data.get("schema_version") == 2:
            data = dict(data)
            data["plugins"] = {}
        elif not isinstance(data.get("plugins"), dict):
            raise RepositoryError("sources.json 缺 plugins 对象")
        return data

    def write_sources(self, data: dict[str, Any]) -> bool:
        normalized = dict(data)
        normalized["schema_version"] = 3
        normalized["skills"] = dict(sorted(normalized.get("skills", {}).items()))
        normalized["plugins"] = dict(sorted(normalized.get("plugins", {}).items()))
        return self.write_json_if_changed(self.sources_path, normalized)

    def read_metadata(self) -> dict[str, Any]:
        data = self._load_json(self.metadata_path)
        if data.get("schema_version") not in {2, 3}:
            raise RepositoryError("metadata.json schema_version 必须是 2 或 3")
        if not isinstance(data.get("taxonomy_version"), int):
            raise RepositoryError("metadata.json 缺 taxonomy_version")
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

    def read_scout(self) -> dict[str, Any]:
        if not self.scout_path.is_file():
            return {"schema_version": 1, "sources": {}}
        data = self._load_json(self.scout_path)
        if data.get("schema_version") != 1:
            raise RepositoryError("scout.json schema_version 必须是 1")
        if not isinstance(data.get("sources"), dict):
            raise RepositoryError("scout.json 缺 sources 对象")
        return data

    def write_scout(self, data: dict[str, Any]) -> bool:
        normalized = dict(data)
        normalized["schema_version"] = 1
        normalized["sources"] = dict(sorted(normalized.get("sources", {}).items()))
        return self.write_json_if_changed(self.scout_path, normalized)

    def write_metadata(self, data: dict[str, Any]) -> bool:
        normalized = dict(data)
        normalized["schema_version"] = 3
        normalized["taxonomy_version"] = self.taxonomy_version
        normalized["skills"] = dict(sorted(normalized.get("skills", {}).items()))
        return self.write_json_if_changed(self.metadata_path, normalized)

    def source_record(self, name: str) -> dict[str, Any] | None:
        ref = self._lookup_ref(name)
        records = self.read_sources()["skills"]
        return records.get(ref.canonical) or records.get(ref.local_id)

    def set_source_record(self, name: str, record: dict[str, Any]) -> bool:
        ref = self.resolve_skill_ref(name)
        data = self.read_sources()
        data["skills"].pop(ref.local_id, None)
        data["skills"][ref.canonical] = record
        return self.write_sources(data)

    def remove_source_record(self, name: str) -> bool:
        ref = self._record_ref(name)
        data = self.read_sources()
        removed = data["skills"].pop(ref.canonical, None)
        legacy_removed = data["skills"].pop(ref.local_id, None)
        if removed is None and legacy_removed is None:
            return False
        return self.write_sources(data)

    def plugin_source_record(self, plugin_id: str) -> dict[str, Any] | None:
        self.require_plugin(plugin_id)
        return self.read_sources()["plugins"].get(plugin_id)

    def set_plugin_source_record(self, plugin_id: str, record: dict[str, Any]) -> bool:
        self.require_plugin(plugin_id)
        data = self.read_sources()
        data["plugins"][plugin_id] = record
        return self.write_sources(data)

    def remove_plugin_source_record(self, plugin_id: str) -> bool:
        data = self.read_sources()
        if data["plugins"].pop(plugin_id, None) is None:
            return False
        return self.write_sources(data)

    def metadata_record(self, name: str) -> dict[str, Any] | None:
        ref = self._lookup_ref(name)
        records = self.read_metadata()["skills"]
        return records.get(ref.canonical) or records.get(ref.local_id)

    def set_metadata_record(self, name: str, record: dict[str, Any]) -> bool:
        ref = self.resolve_skill_ref(name)
        data = self.read_metadata()
        data["skills"].pop(ref.local_id, None)
        data["skills"][ref.canonical] = record
        return self.write_metadata(data)

    def remove_metadata_record(self, name: str) -> bool:
        ref = self._record_ref(name)
        data = self.read_metadata()
        removed = data["skills"].pop(ref.canonical, None)
        legacy_removed = data["skills"].pop(ref.local_id, None)
        if removed is None and legacy_removed is None:
            return False
        return self.write_metadata(data)

    def _record_ref(self, selector: str) -> AssetRef:
        if selector.startswith("skill:"):
            try:
                ref = AssetRef.parse(selector)
            except ValueError as exc:
                raise RepositoryError(str(exc)) from exc
            if ref.kind != "skill":
                raise RepositoryError(f"不是技能引用：{selector}")
            return ref
        return self.resolve_skill_ref(selector)

    def _lookup_ref(self, selector: str) -> AssetRef:
        try:
            return self.resolve_skill_ref(selector)
        except RepositoryError:
            if not selector.startswith(("skill:", "plugin:")):
                return AssetRef.standalone_skill(selector)
            raise

    @contextmanager
    def write_lock(self) -> Iterator[None]:
        lock_dir = self.root / ".git"
        if lock_dir.is_file():
            marker = lock_dir.read_text(encoding="utf-8").strip()
            if not marker.startswith("gitdir: "):
                raise RepositoryError("工作树 .git 定位文件无效")
            lock_dir = (self.root / marker.removeprefix("gitdir: ")).resolve()
        elif not lock_dir.is_dir():
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
        self._skill_registry = None

    def install_skill_file(self, staged: Path, destination: Path) -> bool:
        return self.write_text_if_changed(
            destination / "SKILL.md",
            (staged / "SKILL.md").read_text(encoding="utf-8"),
        )

    def install_plugin_directory(
        self, staged: Path, destination: Path, *, replace: bool = False
    ) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists() and not replace:
            raise RepositoryError(f"目标 Plugin 已存在：{destination}")
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
                backup = Path(
                    tempfile.mkdtemp(
                        prefix=f".{destination.name}.backup.",
                        dir=destination.parent,
                    )
                )
                shutil.rmtree(backup)
                os.replace(destination, backup)
                try:
                    os.replace(temp, destination)
                except OSError:
                    os.replace(backup, destination)
                    raise
                shutil.rmtree(backup, ignore_errors=True)
            else:
                os.replace(temp, destination)
        finally:
            shutil.rmtree(temp, ignore_errors=True)
        self._inventory = None
        self._skill_registry = None
        self._plugin_inventory = None

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
        if config.get("schema_version") != 2:
            raise RepositoryError("agents-kit.json schema_version 必须是 2")
        try:
            validate_definition(config)
        except TaxonomyError as exc:
            raise RepositoryError(f"agents-kit.json taxonomy 无效：{exc}") from exc
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
