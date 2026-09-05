from __future__ import annotations

import difflib
import io
import os
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile
from collections.abc import Mapping
from contextlib import AbstractContextManager
from pathlib import Path, PurePosixPath
from typing import Any, Protocol

from .models import (
    ContentMode,
    MergeState,
    ResolvedSource,
    RiskClass,
    SkillCandidate,
    SkillSnapshot,
    SourceSpec,
    UpdateDecision,
    parse_skill_frontmatter,
)
from .repository import Repository


class SourceError(RuntimeError):
    pass


SOURCE_DIFF_LINE_LIMIT = 200


def classify_source_change(
    local_path: Path,
    snapshot: SkillSnapshot,
    *,
    resolved_sha256: str | None,
) -> dict[str, Any]:
    local_sha256 = Repository.hash_skill_content(local_path, snapshot.content_mode)
    remote_sha256 = snapshot.content_sha256
    local_modified = resolved_sha256 is None or local_sha256 != resolved_sha256
    upstream_modified = resolved_sha256 is None or remote_sha256 != resolved_sha256

    if not upstream_modified:
        merge_state = MergeState.LOCAL_ONLY if local_modified else MergeState.UNCHANGED
        return {
            "status": "unchanged",
            "merge_state": merge_state.value,
            "risk_class": None,
            "decision": None,
            "local_sha256": local_sha256,
            "remote_sha256": remote_sha256,
            "resolved_sha256": resolved_sha256,
            "local_modified": local_modified,
            "upstream_modified": False,
        }

    local_lines = _skill_lines(local_path)
    remote_lines = _skill_lines(snapshot.path)
    matcher = difflib.SequenceMatcher(
        None,
        local_lines,
        remote_lines,
        autojunk=False,
    )
    conflict = local_modified and local_sha256 != remote_sha256
    merge_state = MergeState.DIVERGED if conflict else MergeState.UPSTREAM_ONLY
    changed_paths = _changed_paths(
        local_path,
        snapshot.path,
        snapshot.content_mode,
    )
    risk_class = classify_changed_paths(
        local_path,
        snapshot.path,
        changed_paths,
    )
    decision = (
        UpdateDecision.AUTO_APPLY
        if merge_state == MergeState.UPSTREAM_ONLY and risk_class == RiskClass.DOCS_ONLY
        else UpdateDecision.REVIEW_REQUIRED
    )
    skill_diff = list(
        difflib.unified_diff(
            local_lines,
            remote_lines,
            fromfile="local/SKILL.md",
            tofile="upstream/SKILL.md",
            lineterm="",
        )
    )
    changed_lines = sum(
        (local_end - local_start) + (remote_end - remote_start)
        for tag, local_start, local_end, remote_start, remote_end in matcher.get_opcodes()
        if tag != "equal"
    )

    return {
        "status": (
            "safe_update"
            if decision == UpdateDecision.AUTO_APPLY
            else "review_required"
        ),
        "merge_state": merge_state.value,
        "risk_class": risk_class.value,
        "decision": decision.value,
        "changed_paths": changed_paths,
        "local_sha256": local_sha256,
        "remote_sha256": remote_sha256,
        "resolved_sha256": resolved_sha256,
        "local_modified": local_modified,
        "upstream_modified": True,
        "similarity": round(matcher.ratio(), 4),
        "changed_lines": changed_lines,
        "local_lines": len(local_lines),
        "remote_lines": len(remote_lines),
        "reasons": ["local_upstream_conflict"] if conflict else [],
        "skill_diff": skill_diff[:SOURCE_DIFF_LINE_LIMIT],
        "skill_diff_truncated": len(skill_diff) > SOURCE_DIFF_LINE_LIMIT,
    }


def classify_changed_paths(
    local_root: Path,
    remote_root: Path,
    changed_paths: list[str],
) -> RiskClass:
    if not changed_paths:
        return RiskClass.UNKNOWN
    classes: set[RiskClass] = set()
    for relative in changed_paths:
        local = local_root / relative
        remote = remote_root / relative
        path = remote if remote.exists() else local
        name = PurePosixPath(relative).name
        upper_name = name.upper()
        parts = PurePosixPath(relative).parts
        if _path_is_binary(path):
            classes.add(RiskClass.BINARY)
        elif _path_is_executable(path):
            classes.add(RiskClass.EXECUTABLE)
        elif (
            name == "SKILL.md"
            or "commands" in parts
            or "agents" in parts
            or "hooks" in parts
            or name in {".mcp.json", ".app.json", ".lsp.json", "plugin.json"}
        ):
            classes.add(RiskClass.INSTRUCTIONAL)
        elif upper_name.startswith(("LICENSE", "CHANGELOG")):
            classes.add(RiskClass.DOCS_ONLY)
        else:
            classes.add(RiskClass.UNKNOWN)
    for risk in (
        RiskClass.BINARY,
        RiskClass.EXECUTABLE,
        RiskClass.INSTRUCTIONAL,
        RiskClass.UNKNOWN,
        RiskClass.DOCS_ONLY,
    ):
        if risk in classes:
            return risk
    return RiskClass.UNKNOWN


def _changed_paths(
    local_root: Path,
    remote_root: Path,
    content_mode: ContentMode,
) -> list[str]:
    if content_mode == ContentMode.SKILL_FILE:
        return ["SKILL.md"]
    local = _file_hashes(local_root)
    remote = _file_hashes(remote_root)
    return sorted(
        path for path in set(local) | set(remote) if local.get(path) != remote.get(path)
    )


def _file_hashes(root: Path) -> dict[str, str]:
    hashes: dict[str, str] = {}
    for path in sorted(root.rglob("*"), key=lambda item: item.as_posix()):
        if not path.is_file() or any(
            part in {".git", "__pycache__"} for part in path.parts
        ):
            continue
        if path.name == ".DS_Store" or path.suffix == ".pyc":
            continue
        hashes[path.relative_to(root).as_posix()] = Repository.hash_file(path)
    return hashes


def _path_is_binary(path: Path) -> bool:
    if not path.is_file():
        return False
    try:
        data = path.read_bytes()[:8192]
    except OSError:
        return True
    if b"\0" in data:
        return True
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        return True
    return False


def _path_is_executable(path: Path) -> bool:
    if not path.exists():
        return False
    try:
        if path.stat().st_mode & 0o111:
            return True
    except OSError:
        return True
    return path.suffix.lower() in {
        ".bash",
        ".command",
        ".exe",
        ".js",
        ".mjs",
        ".py",
        ".sh",
        ".ts",
        ".zsh",
    }


def _skill_lines(path: Path) -> list[str]:
    return (
        (path / "SKILL.md").read_text(encoding="utf-8", errors="replace").splitlines()
    )


class SourceProvider(Protocol):
    id: str

    def can_handle(self, raw_source: str) -> bool: ...

    def normalize(self, raw_source: str, options: Mapping[str, str]) -> SourceSpec: ...

    def resolve(
        self, spec: SourceSpec, workspace: Path, timeout: int
    ) -> ResolvedSource: ...


class GitProvider:
    id = "git"

    def __init__(self) -> None:
        self._cache: dict[tuple[str, str], tuple[Path, str, set[str] | None]] = {}
        self._failures: dict[tuple[str, str], str] = {}

    def can_handle(self, raw_source: str) -> bool:
        if raw_source.startswith(("git@", "ssh://", "git://")):
            return True
        parsed = urllib.parse.urlparse(raw_source)
        if parsed.scheme not in {"http", "https"}:
            return False
        host = (parsed.hostname or "").lower()
        if raw_source.endswith(".git"):
            return True
        return host in {"github.com", "gitlab.com", "bitbucket.org"} and not (
            parsed.path.endswith("/SKILL.md")
            or parsed.path.endswith((".zip", ".tar.gz", ".tgz", ".tar"))
        )

    def normalize(self, raw_source: str, options: Mapping[str, str]) -> SourceSpec:
        url = raw_source.rstrip("/")
        ref = options.get("ref", "")
        path = options.get("path", "").strip("/")

        github = re.match(
            r"https?://github\.com/([^/]+)/([^/]+?)(?:\.git)?"
            r"(?:/tree/([^/]+)(?:/(.*))?)?$",
            url,
        )
        if github:
            owner, repo, web_ref, web_path = github.groups()
            url = f"https://github.com/{owner}/{repo}.git"
            ref = ref or web_ref or ""
            path = path or (web_path or "")
        elif "/-/tree/" in url:
            repo_url, tail = url.split("/-/tree/", 1)
            web_ref, _, web_path = tail.partition("/")
            url = repo_url if repo_url.endswith(".git") else f"{repo_url}.git"
            ref = ref or web_ref
            path = path or web_path
        elif "bitbucket.org" in url and "/src/" in url:
            repo_url, tail = url.split("/src/", 1)
            web_ref, _, web_path = tail.partition("/")
            url = repo_url if repo_url.endswith(".git") else f"{repo_url}.git"
            ref = ref or web_ref
            path = path or web_path

        return SourceSpec(
            provider=self.id,
            locator={"url": url, "ref": ref, "path": path.strip("/")},
        )

    def resolve(
        self, spec: SourceSpec, workspace: Path, timeout: int
    ) -> ResolvedSource:
        url = str(spec.locator["url"])
        ref = str(spec.locator.get("ref") or "")
        path = str(spec.locator.get("path") or "").strip("/")
        key = (url, ref)
        if key in self._failures:
            raise SourceError(f"同仓库前次获取失败：{self._failures[key]}")
        if key in self._cache:
            root, revision, sparse_paths = self._cache[key]
            try:
                if sparse_paths is not None and not path:
                    self._run(
                        [
                            "git",
                            "-C",
                            str(root),
                            "sparse-checkout",
                            "disable",
                        ],
                        timeout=15,
                    )
                    sparse_paths = None
                elif sparse_paths is not None and not _path_is_covered(
                    path, sparse_paths
                ):
                    common = _common_source_parent([*sparse_paths, path])
                    if common:
                        self._run(
                            [
                                "git",
                                "-C",
                                str(root),
                                "sparse-checkout",
                                "set",
                                "--cone",
                                "--skip-checks",
                                common,
                            ],
                            timeout=timeout,
                        )
                        sparse_paths = {common}
                    else:
                        self._run(
                            [
                                "git",
                                "-C",
                                str(root),
                                "sparse-checkout",
                                "disable",
                            ],
                            timeout=timeout,
                        )
                        sparse_paths = None
            except SourceError as exc:
                self._failures[key] = str(exc)
                raise
            self._cache[key] = (root, revision, sparse_paths)
            return ResolvedSource(spec=spec, revision=revision, root=root)

        checkout = workspace / f"git-{len(self._cache)}"
        try:
            self._clone(
                url,
                ref,
                checkout,
                timeout,
                no_checkout=bool(path),
            )
            sparse_paths: set[str] | None = None
            if path:
                self._run(
                    [
                        "git",
                        "-C",
                        str(checkout),
                        "sparse-checkout",
                        "set",
                        "--cone",
                        "--skip-checks",
                        path,
                    ],
                    timeout=15,
                )
                self._run(
                    ["git", "-C", str(checkout), "checkout", "--quiet"],
                    timeout=15,
                )
                sparse_paths = {path}
            revision = self._run(
                ["git", "-C", str(checkout), "rev-parse", "HEAD"],
                timeout=10,
            ).stdout.strip()
        except SourceError as exc:
            self._failures[key] = str(exc)
            raise
        checkout = checkout.resolve()
        resolved = ResolvedSource(spec=spec, revision=revision, root=checkout)
        self._cache[key] = (checkout, revision, sparse_paths)
        return resolved

    def _clone(
        self,
        url: str,
        ref: str,
        destination: Path,
        timeout: int,
        *,
        no_checkout: bool,
    ) -> None:
        attempts = self._clone_urls(url)
        started = time.monotonic()
        errors: list[str] = []
        for label, clone_url, extra_env in attempts:
            remaining = max(1, int(timeout - (time.monotonic() - started)))
            if remaining <= 1 and errors:
                break
            shutil.rmtree(destination, ignore_errors=True)
            command = [
                "git",
                "-c",
                "http.version=HTTP/1.1",
                "clone",
                "--quiet",
                "--depth",
                "1",
                "--filter=blob:none",
            ]
            if no_checkout:
                command.append("--no-checkout")
            if ref:
                command.extend(["--branch", ref])
            command.extend([clone_url, str(destination)])
            env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", **extra_env}
            try:
                result = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    timeout=remaining,
                    env=env,
                    check=False,
                )
            except subprocess.TimeoutExpired:
                errors.append(f"{label} 超过 {remaining} 秒")
                continue
            if result.returncode == 0:
                return
            errors.append(f"{label}: {result.stderr.strip() or 'clone 失败'}")
        raise SourceError("Git 获取失败：\n  " + "\n  ".join(errors))

    def _clone_urls(self, url: str) -> list[tuple[str, str, dict[str, str]]]:
        # Keep the caller's transport. Rewriting HTTPS to SSH also makes later
        # partial-clone fetches use SSH, bypassing the user's HTTPS proxy.
        parsed = urllib.parse.urlparse(url)
        label = "HTTPS" if parsed.scheme in {"http", "https"} else "Git"
        return [(label, url, {})]

    @staticmethod
    def _run(command: list[str], *, timeout: int) -> subprocess.CompletedProcess[str]:
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
            raise SourceError(f"命令失败：{' '.join(command)}: {exc}") from exc
        if result.returncode:
            raise SourceError(result.stderr.strip() or "Git 命令失败")
        return result


class HttpProvider:
    id = "http"

    def __init__(self) -> None:
        self._counter = 0

    def can_handle(self, raw_source: str) -> bool:
        return urllib.parse.urlparse(raw_source).scheme in {"http", "https"}

    def normalize(self, raw_source: str, options: Mapping[str, str]) -> SourceSpec:
        locator: dict[str, Any] = {"url": raw_source}
        if options.get("path"):
            locator["path"] = options["path"].strip("/")
        return SourceSpec(provider=self.id, locator=locator)

    def resolve(
        self, spec: SourceSpec, workspace: Path, timeout: int
    ) -> ResolvedSource:
        request = urllib.request.Request(
            str(spec.locator["url"]),
            headers={"User-Agent": "agents-kit/1"},
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                content = response.read(100 * 1024 * 1024 + 1)
                headers = response.headers
        except Exception as exc:
            raise SourceError(f"HTTP 获取失败：{exc}") from exc
        if len(content) > 100 * 1024 * 1024:
            raise SourceError("HTTP 来源超过 100 MB 上限")

        root = workspace / f"http-{self._counter}"
        self._counter += 1
        root.mkdir()
        if zipfile.is_zipfile(io.BytesIO(content)):
            self._extract_zip(content, root)
            content_mode = ContentMode.DIRECTORY
        elif self._is_tar(content):
            self._extract_tar(content, root)
            content_mode = ContentMode.DIRECTORY
        else:
            text = content.decode("utf-8", "replace")
            if len(text.strip()) < 20:
                raise SourceError("HTTP 来源内容异常短")
            skill_dir = root / self._name_from_url(str(spec.locator["url"]))
            skill_dir.mkdir()
            (skill_dir / "SKILL.md").write_text(text, encoding="utf-8")
            content_mode = ContentMode.SKILL_FILE

        revision = headers.get("ETag") or headers.get("Last-Modified")
        return ResolvedSource(
            spec=spec,
            revision=revision,
            root=root.resolve(),
            content_mode=content_mode,
        )

    @staticmethod
    def _name_from_url(url: str) -> str:
        path = PurePosixPath(urllib.parse.urlparse(url).path)
        if path.name == "SKILL.md":
            name = path.parent.name
        else:
            name = path.name.split(".", 1)[0]
        return name or "downloaded-skill"

    @staticmethod
    def _extract_zip(content: bytes, root: Path) -> None:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            for info in archive.infolist():
                _validate_archive_path(info.filename)
                mode = info.external_attr >> 16
                if stat.S_ISLNK(mode):
                    raise SourceError(f"ZIP 包含软链接：{info.filename}")
            archive.extractall(root)

    @staticmethod
    def _is_tar(content: bytes) -> bool:
        try:
            with tarfile.open(fileobj=io.BytesIO(content), mode="r:*"):
                return True
        except tarfile.TarError:
            return False

    @staticmethod
    def _extract_tar(content: bytes, root: Path) -> None:
        with tarfile.open(fileobj=io.BytesIO(content), mode="r:*") as archive:
            for member in archive.getmembers():
                _validate_archive_path(member.name)
                if member.issym() or member.islnk():
                    raise SourceError(f"TAR 包含链接：{member.name}")
                if not member.isfile() and not member.isdir():
                    raise SourceError(f"TAR 包含特殊文件：{member.name}")
            archive.extractall(root)


class LocalProvider:
    id = "local"

    def __init__(self) -> None:
        self._counter = 0

    def can_handle(self, raw_source: str) -> bool:
        return Path(raw_source).expanduser().exists()

    def normalize(self, raw_source: str, options: Mapping[str, str]) -> SourceSpec:
        path = Path(raw_source).expanduser().resolve()
        return SourceSpec(provider=self.id, locator={"local_path": str(path)})

    def resolve(
        self, spec: SourceSpec, workspace: Path, timeout: int
    ) -> ResolvedSource:
        source = Path(str(spec.locator["local_path"]))
        if source.is_file():
            if source.name != "SKILL.md":
                raise SourceError("本地文件来源必须是 SKILL.md")
            source = source.parent
        if not source.is_dir():
            raise SourceError(f"本地来源不存在：{source}")
        root = workspace / f"local-{self._counter}"
        self._counter += 1
        shutil.copytree(
            source,
            root,
            symlinks=True,
            ignore=shutil.ignore_patterns(".git", "__pycache__", "*.pyc", ".DS_Store"),
        )
        return ResolvedSource(
            spec=spec,
            revision=None,
            root=root.resolve(),
        )


class SourceSession(AbstractContextManager["SourceSession"]):
    def __init__(self, timeout: int):
        self.timeout = timeout
        self.workspace = Path(tempfile.mkdtemp(prefix="agents-kit-source-"))
        self.providers: dict[str, SourceProvider] = {
            provider.id: provider
            for provider in (LocalProvider(), GitProvider(), HttpProvider())
        }

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        shutil.rmtree(self.workspace, ignore_errors=True)

    def provider_names(self) -> list[str]:
        return sorted(self.providers)

    def spec(
        self,
        raw_source: str,
        *,
        provider_id: str | None = None,
        options: Mapping[str, str] | None = None,
    ) -> SourceSpec:
        options = options or {}
        if provider_id:
            provider = self.providers.get(provider_id)
            if provider is None:
                raise SourceError(
                    f"未知 provider：{provider_id}；可用：{', '.join(self.provider_names())}"
                )
            return provider.normalize(raw_source, options)
        matched = [
            provider
            for provider in self.providers.values()
            if provider.can_handle(raw_source)
        ]
        if not matched:
            raise SourceError(
                "无法识别来源；请用 --provider 指定 " + "/".join(self.provider_names())
            )
        if len(matched) > 1:
            non_http = [provider for provider in matched if provider.id != "http"]
            if len(non_http) == 1:
                matched = non_http
            else:
                raise SourceError("来源匹配多个 provider；请用 --provider 明确指定")
        return matched[0].normalize(raw_source, options)

    def candidates(self, spec: SourceSpec) -> list[SkillCandidate]:
        return self.scan(spec)[1]

    def scan(self, spec: SourceSpec) -> tuple[str | None, list[SkillCandidate]]:
        resolved = self._resolve(spec)
        roots = self._candidate_roots(resolved)
        return (
            resolved.revision,
            [self._candidate(root, resolved.root) for root in roots],
        )

    def snapshot(
        self, spec: SourceSpec, *, candidate_path: str | None = None
    ) -> SkillSnapshot:
        resolved = self._resolve(spec)
        roots = self._candidate_roots(resolved)
        if candidate_path:
            candidate = (resolved.root / candidate_path).resolve()
            if candidate not in roots:
                choices = ", ".join(
                    root.relative_to(resolved.root).as_posix() for root in roots
                )
                raise SourceError(f"找不到候选 {candidate_path}；可用候选：{choices}")
        elif len(roots) == 1:
            candidate = roots[0]
        else:
            choices = "\n  ".join(
                root.relative_to(resolved.root).as_posix() for root in roots
            )
            raise SourceError(f"来源中有多个技能，请用 --candidate 指定：\n  {choices}")
        _validate_skill_tree(candidate)
        summary = self._candidate(candidate, resolved.root)
        snapshot_spec = resolved.spec
        if candidate_path:
            locator = dict(resolved.spec.locator)
            locator["path"] = candidate.relative_to(resolved.root).as_posix()
            snapshot_spec = SourceSpec(
                provider=resolved.spec.provider,
                locator=locator,
            )
        return SkillSnapshot(
            path=candidate,
            declared_name=summary.declared_name,
            description=summary.description,
            content_sha256=Repository.hash_skill_content(
                candidate, resolved.content_mode
            ),
            content_mode=resolved.content_mode,
            revision=resolved.revision,
            spec=snapshot_spec,
            source_name=summary.declared_name,
        )

    def snapshot_from_record(self, record: Mapping[str, Any]) -> SkillSnapshot:
        spec = SourceSpec(
            provider=str(record["provider"]),
            locator=dict(record["locator"]),
        )
        snapshot = self.snapshot(spec)
        expected_mode = record.get("content_mode")
        if expected_mode and snapshot.content_mode != ContentMode(expected_mode):
            raise SourceError(
                "来源内容类型已变化："
                f"登记为 {expected_mode}，当前为 {snapshot.content_mode.value}"
            )
        return snapshot

    def directory(
        self,
        spec: SourceSpec,
        *,
        candidate_path: str | None = None,
    ) -> tuple[Path, str | None, SourceSpec]:
        resolved = self._resolve(spec)
        locator_path = str(resolved.spec.locator.get("path") or "").strip("/")
        relative = candidate_path.strip("/") if candidate_path else locator_path
        candidate = (
            (resolved.root / relative).resolve()
            if relative
            else resolved.root.resolve()
        )
        root = resolved.root.resolve()
        if candidate != root and root not in candidate.parents:
            raise SourceError("来源目录越出了获取根目录")
        if not candidate.is_dir():
            raise SourceError(f"来源目录不存在：{relative or '.'}")
        locator = dict(resolved.spec.locator)
        if relative:
            locator["path"] = candidate.relative_to(root).as_posix()
        else:
            locator.pop("path", None)
        return (
            candidate,
            resolved.revision,
            SourceSpec(provider=resolved.spec.provider, locator=locator),
        )

    def _resolve(self, spec: SourceSpec) -> ResolvedSource:
        provider = self.providers.get(spec.provider)
        if provider is None:
            raise SourceError(f"未安装来源 provider：{spec.provider}")
        return provider.resolve(spec, self.workspace, self.timeout)

    @staticmethod
    def _candidate_roots(resolved: ResolvedSource) -> list[Path]:
        locator_path = str(resolved.spec.locator.get("path") or "").strip("/")
        search_root = resolved.root
        if locator_path:
            search_root = (resolved.root / locator_path).resolve()
            root_real = resolved.root.resolve()
            if search_root != root_real and root_real not in search_root.parents:
                raise SourceError("来源 path 越出了获取目录")
            if not search_root.exists():
                raise SourceError(f"来源 path 不存在：{locator_path}")
        if (search_root / "SKILL.md").is_file():
            return [search_root]
        found: list[Path] = []
        for directory, dirs, files in os.walk(search_root):
            if ".git" in dirs:
                dirs.remove(".git")
            if "SKILL.md" in files:
                found.append(Path(directory).resolve())
                dirs[:] = []
        if not found:
            raise SourceError("来源中找不到 SKILL.md")
        return sorted(found)

    @staticmethod
    def _candidate(path: Path, root: Path) -> SkillCandidate:
        path = path.resolve()
        root = root.resolve()
        text = (path / "SKILL.md").read_text(encoding="utf-8", errors="replace")
        try:
            frontmatter = parse_skill_frontmatter(text)
        except (ValueError, RuntimeError) as exc:
            raise SourceError(f"{path}/SKILL.md: {exc}") from exc
        declared_name = str(frontmatter.get("name") or path.name)
        description = str(frontmatter.get("description") or "").strip()
        return SkillCandidate(
            relative_path=path.relative_to(root).as_posix(),
            declared_name=declared_name,
            description=" ".join(description.split()),
        )


def _path_is_covered(path: str, roots: set[str]) -> bool:
    return any(path == root or path.startswith(f"{root}/") for root in roots)


def _common_source_parent(paths: list[str]) -> str:
    parts = [PurePosixPath(path).parts for path in paths]
    common: list[str] = []
    for candidates in zip(*parts, strict=False):
        if len(set(candidates)) != 1:
            break
        common.append(candidates[0])
    return "/".join(common)


def _validate_archive_path(name: str) -> None:
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        raise SourceError(f"压缩包路径越界：{name}")


def _validate_skill_tree(root: Path) -> None:
    root_real = root.resolve()
    for path in root.rglob("*"):
        if not path.is_symlink():
            continue
        target = path.resolve()
        if target != root_real and root_real not in target.parents:
            raise SourceError(f"技能包含指向目录外的软链接：{path}")
