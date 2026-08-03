from __future__ import annotations

import hashlib
import json
import os
import re
import shlex
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

NAME_RE = re.compile(r"^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$")
SEMVER_RE = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
MARKDOWN_LINK_RE = re.compile(r"!?\[[^\]]*]\(([^)]+)\)")
ABSOLUTE_PATH_PATTERNS = (
    re.compile(r"/Users/([A-Za-z0-9._-]+)"),
    re.compile(r"[A-Za-z]:\\Users\\([A-Za-z0-9._-]+)"),
)
SECRET_PATTERNS = (
    ("private-key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("aws-access-key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("github-token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b")),
    ("openai-style-key", re.compile(r"\bsk-[A-Za-z0-9_-]{24,}\b")),
    (
        "bearer-token",
        re.compile(
            r"\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{20,}", re.IGNORECASE
        ),
    ),
)
REDACTION_PATTERNS = tuple(pattern for _, pattern in SECRET_PATTERNS)
URL_CREDENTIAL_RE = re.compile(r"(https?://)[^/@\s]+@", re.IGNORECASE)
EXCLUDED_PARTS = {
    ".DS_Store",
    ".mypy_cache",
    ".nox",
    ".pytest_cache",
    ".ruff_cache",
    ".git",
    ".tox",
    ".venv",
    ".workspace",
    ".work",
    "Workspace",
    "__pycache__",
    "node_modules",
}
TEXT_SUFFIXES = {
    "",
    ".cfg",
    ".css",
    ".csv",
    ".env",
    ".html",
    ".ini",
    ".js",
    ".json",
    ".jsx",
    ".md",
    ".mjs",
    ".py",
    ".sh",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
}
PLACEHOLDER_USERS = {"example", "username", "user", "your-name", "yourname"}


@dataclass(frozen=True)
class Check:
    severity: str
    code: str
    message: str
    path: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class SkillInfo:
    name: str
    description: str
    license: str | None
    version: str | None
    root: str
    skill_file: str
    fingerprint: str
    file_count: int
    bundle_bytes: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class RepositoryInfo:
    root: str | None
    remote_url: str | None
    github_owner: str | None
    github_repo: str | None
    commit: str | None
    branch: str | None
    dirty: bool
    status_lines: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def utc_now() -> str:
    import datetime

    return (
        datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
    )


def redact_text(value: str) -> str:
    redacted = URL_CREDENTIAL_RE.sub(r"\1[REDACTED]@", value)
    for pattern in REDACTION_PATTERNS:
        redacted = pattern.sub("[REDACTED]", redacted)
    return redacted


def command_display(argv: Iterable[str]) -> str:
    return " ".join(shlex.quote(str(part)) for part in argv)


def run_command(
    argv: list[str],
    *,
    cwd: Path | str | None = None,
    timeout: int = 120,
) -> dict[str, Any]:
    started = time.monotonic()
    safe_argv = [str(part) for part in argv]
    recorded_argv = [redact_text(part) for part in safe_argv]
    try:
        completed = subprocess.run(
            safe_argv,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            env={**os.environ, "LC_ALL": os.environ.get("LC_ALL", "C.UTF-8")},
        )
        return {
            "argv": recorded_argv,
            "command": command_display(recorded_argv),
            "cwd": str(cwd) if cwd else None,
            "available": True,
            "timed_out": False,
            "returncode": completed.returncode,
            "stdout": redact_text(completed.stdout),
            "stderr": redact_text(completed.stderr),
            "duration_ms": round((time.monotonic() - started) * 1000),
        }
    except FileNotFoundError:
        return {
            "argv": recorded_argv,
            "command": command_display(recorded_argv),
            "cwd": str(cwd) if cwd else None,
            "available": False,
            "timed_out": False,
            "returncode": 127,
            "stdout": "",
            "stderr": f"Command not found: {safe_argv[0]}",
            "duration_ms": round((time.monotonic() - started) * 1000),
        }
    except subprocess.TimeoutExpired as error:
        return {
            "argv": recorded_argv,
            "command": command_display(recorded_argv),
            "cwd": str(cwd) if cwd else None,
            "available": True,
            "timed_out": True,
            "returncode": 124,
            "stdout": redact_text(_coerce_output(error.stdout)),
            "stderr": redact_text(_coerce_output(error.stderr) or "Command timed out"),
            "duration_ms": round((time.monotonic() - started) * 1000),
        }


def _coerce_output(value: str | bytes | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value


def check_url(url: str, *, timeout: int = 15) -> dict[str, Any]:
    started = time.monotonic()
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "skill-publisher-source-check/0.1",
            "Accept": "text/html,application/json;q=0.9,*/*;q=0.5",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            sample = response.read(512)
            return {
                "url": url,
                "reachable": 200 <= response.status < 400,
                "status": response.status,
                "final_url": response.geturl(),
                "content_type": response.headers.get("Content-Type"),
                "sample_sha256": hashlib.sha256(sample).hexdigest(),
                "duration_ms": round((time.monotonic() - started) * 1000),
            }
    except urllib.error.HTTPError as error:
        access_restricted = error.code in {401, 403, 429}
        return {
            "url": url,
            "reachable": access_restricted,
            "status": error.code,
            "final_url": error.geturl(),
            "error": str(error),
            "access_restricted": access_restricted,
            "duration_ms": round((time.monotonic() - started) * 1000),
        }
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return {
            "url": url,
            "reachable": False,
            "status": None,
            "final_url": None,
            "error": str(error),
            "duration_ms": round((time.monotonic() - started) * 1000),
        }


def discover_skill_files(source: Path | str) -> list[Path]:
    path = Path(source).expanduser().resolve()
    if path.is_file():
        if path.name != "SKILL.md":
            raise ValueError(f"Expected SKILL.md, got: {path}")
        return [path]
    if not path.is_dir():
        raise FileNotFoundError(path)
    direct = path / "SKILL.md"
    found: list[Path] = [direct.resolve()] if direct.is_file() else []
    for candidate in path.rglob("SKILL.md"):
        if candidate == direct:
            continue
        relative_parts = candidate.relative_to(path).parts
        if any(part in EXCLUDED_PARTS for part in relative_parts):
            continue
        if len(relative_parts) > 8:
            continue
        found.append(candidate.resolve())
    return sorted(found)


def select_skill(skill_files: list[Path], requested: str | None) -> Path:
    if not skill_files:
        raise ValueError("No SKILL.md found")
    if requested:
        matches = []
        for skill_file in skill_files:
            metadata = parse_frontmatter(skill_file)
            if skill_file.parent.name == requested or metadata.get("name") == requested:
                matches.append(skill_file)
        if len(matches) != 1:
            names = ", ".join(path.parent.name for path in skill_files)
            raise ValueError(
                f"Skill selector {requested!r} matched {len(matches)} entries. "
                f"Available: {names}"
            )
        return matches[0]
    if len(skill_files) > 1:
        names = ", ".join(path.parent.name for path in skill_files)
        raise ValueError(f"Multiple skills found; choose one with --skill: {names}")
    return skill_files[0]


def parse_frontmatter(skill_file: Path | str) -> dict[str, Any]:
    text = Path(skill_file).read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ValueError(f"Missing YAML frontmatter: {skill_file}")
    try:
        frontmatter, _ = text[4:].split("\n---", 1)
    except ValueError as error:
        raise ValueError(f"Unclosed YAML frontmatter: {skill_file}") from error

    try:
        import yaml  # type: ignore[import-not-found]

        parsed = yaml.safe_load(frontmatter)
        if not isinstance(parsed, dict):
            raise TypeError("Frontmatter must be a mapping")
        return parsed
    except ImportError:
        return _parse_minimal_yaml(frontmatter)


def _parse_minimal_yaml(frontmatter: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    lines = frontmatter.splitlines()
    index = 0
    while index < len(lines):
        line = lines[index]
        if (
            not line.strip()
            or line.lstrip().startswith("#")
            or line.startswith((" ", "\t"))
        ):
            index += 1
            continue
        if ":" not in line:
            index += 1
            continue
        key, raw_value = line.split(":", 1)
        key = key.strip()
        value = raw_value.strip()
        if value in {"|", ">"}:
            block: list[str] = []
            index += 1
            while index < len(lines) and (
                not lines[index].strip() or lines[index].startswith((" ", "\t"))
            ):
                block.append(lines[index].strip())
                index += 1
            result[key] = " ".join(part for part in block if part)
            continue
        if value:
            result[key] = _strip_yaml_scalar(value)
        else:
            nested: dict[str, Any] = {}
            index += 1
            while index < len(lines) and (
                not lines[index].strip() or lines[index].startswith((" ", "\t"))
            ):
                nested_line = lines[index].strip()
                if ":" in nested_line:
                    nested_key, nested_value = nested_line.split(":", 1)
                    nested[nested_key.strip()] = _strip_yaml_scalar(
                        nested_value.strip()
                    )
                index += 1
            result[key] = nested
            continue
        index += 1
    return result


def _strip_yaml_scalar(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def inspect_skill(skill_file: Path | str) -> SkillInfo:
    path = Path(skill_file).resolve()
    metadata = parse_frontmatter(path)
    root = path.parent
    files = list(iter_bundle_files(root))
    bundle_bytes = sum(file.stat().st_size for file in files)
    version = _metadata_version(metadata)
    return SkillInfo(
        name=str(metadata.get("name", "")).strip(),
        description=str(metadata.get("description", "")).strip(),
        license=_optional_string(metadata.get("license")),
        version=version,
        root=str(root),
        skill_file=str(path),
        fingerprint=bundle_fingerprint(root, files=files),
        file_count=len(files),
        bundle_bytes=bundle_bytes,
    )


def _metadata_version(metadata: dict[str, Any]) -> str | None:
    direct = _optional_string(metadata.get("version"))
    if direct:
        return direct
    nested = metadata.get("metadata")
    if isinstance(nested, dict):
        return _optional_string(nested.get("version"))
    return None


def _optional_string(value: Any) -> str | None:
    if value is None:
        return None
    result = str(value).strip()
    return result or None


def iter_bundle_files(root: Path | str) -> Iterable[Path]:
    base = Path(root).resolve()
    for path in sorted(base.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(base)
        if any(part in EXCLUDED_PARTS for part in relative.parts):
            continue
        yield path


def bundle_fingerprint(root: Path | str, *, files: list[Path] | None = None) -> str:
    base = Path(root).resolve()
    digest = hashlib.sha256()
    selected = files if files is not None else list(iter_bundle_files(base))
    for path in selected:
        relative = path.relative_to(base).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def inspect_repository(path: Path | str) -> RepositoryInfo:
    source = Path(path).resolve()
    root_result = run_command(
        ["git", "-C", str(source), "rev-parse", "--show-toplevel"]
    )
    if root_result["returncode"] != 0:
        return RepositoryInfo(
            root=None,
            remote_url=None,
            github_owner=None,
            github_repo=None,
            commit=None,
            branch=None,
            dirty=False,
            status_lines=(),
        )
    root = Path(root_result["stdout"].strip()).resolve()
    remote = sanitize_remote_url(_git_value(root, ["remote", "get-url", "origin"]))
    owner, repo = parse_github_remote(remote)
    commit = _git_value(root, ["rev-parse", "HEAD"])
    branch = _git_value(root, ["branch", "--show-current"])
    status = _git_value(root, ["status", "--porcelain=v1"], allow_empty=True)
    status_lines = tuple(line for line in status.splitlines() if line)
    return RepositoryInfo(
        root=str(root),
        remote_url=remote or None,
        github_owner=owner,
        github_repo=repo,
        commit=commit or None,
        branch=branch or None,
        dirty=bool(status_lines),
        status_lines=status_lines,
    )


def _git_value(root: Path, args: list[str], *, allow_empty: bool = False) -> str:
    result = run_command(["git", "-C", str(root), *args])
    if result["returncode"] != 0:
        return ""
    value = result["stdout"].strip()
    if value or allow_empty:
        return value
    return ""


def parse_github_remote(remote: str | None) -> tuple[str | None, str | None]:
    if not remote:
        return None, None
    patterns = (
        re.compile(r"^git@github\.com:([^/]+)/(.+?)(?:\.git)?$"),
        re.compile(r"^ssh://git@github\.com/([^/]+)/(.+?)(?:\.git)?$"),
        re.compile(r"^https?://github\.com/([^/]+)/(.+?)(?:\.git)?/?$"),
    )
    for pattern in patterns:
        match = pattern.match(remote.strip())
        if match:
            return match.group(1), match.group(2)
    return None, None


def sanitize_remote_url(remote: str | None) -> str:
    if not remote:
        return ""
    parsed = urllib.parse.urlsplit(remote)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return remote
    host = parsed.hostname
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    try:
        port = parsed.port
    except ValueError:
        port = None
    if port:
        host = f"{host}:{port}"
    return urllib.parse.urlunsplit((parsed.scheme, host, parsed.path, "", ""))


def validate_skill(
    skill: SkillInfo,
    repository: RepositoryInfo,
    *,
    target_platforms: Iterable[str] = (),
) -> list[Check]:
    checks: list[Check] = []
    targets = set(target_platforms)
    root = Path(skill.root)
    skill_file = Path(skill.skill_file)

    if not NAME_RE.fullmatch(skill.name):
        checks.append(
            Check(
                "blocker",
                "invalid-name",
                "name must contain only lowercase letters, numbers, and single hyphens",
                str(skill_file),
            )
        )
    if skill.name != root.name:
        checks.append(
            Check(
                "blocker",
                "name-directory-mismatch",
                f"name {skill.name!r} does not match directory {root.name!r}",
                str(skill_file),
            )
        )
    if not skill.description:
        checks.append(
            Check(
                "blocker",
                "missing-description",
                "description is required",
                str(skill_file),
            )
        )
    elif len(skill.description) > 1024:
        checks.append(
            Check(
                "blocker",
                "description-too-long",
                "description exceeds the 1024-character Agent Skills limit",
                str(skill_file),
            )
        )

    repo_root = Path(repository.root) if repository.root else root
    if not skill.license and not any(repo_root.glob("LICENSE*")):
        checks.append(
            Check(
                "warning",
                "missing-license",
                "No license field or LICENSE file was found",
                str(root),
            )
        )
    if repository.root is None:
        checks.append(
            Check(
                "blocker",
                "not-a-git-repository",
                "Publishing requires a Git repository",
                str(root),
            )
        )
    elif repository.github_owner is None:
        checks.append(
            Check(
                "blocker",
                "missing-github-origin",
                "origin is not a recognized GitHub repository URL",
                repository.remote_url,
            )
        )
    if (
        "github" in targets
        and repository.root
        and Path(skill.root) == Path(repository.root)
    ):
        checks.append(
            Check(
                "blocker",
                "github-root-skill-layout",
                (
                    "GitHub's Skill publisher requires SKILL.md inside a named "
                    "subdirectory such as skills/<skill-name>/"
                ),
                skill.root,
            )
        )
    if repository.dirty:
        checks.append(
            Check(
                "blocker",
                "dirty-worktree",
                "Commit or remove local changes so every platform publishes identical content",
                repository.root,
            )
        )

    checks.extend(_check_relative_links(root))
    checks.extend(_check_bundle_files(root))
    checks.extend(_check_text_content(root))

    if "clawhub" in targets and skill.bundle_bytes > 50 * 1024 * 1024:
        checks.append(
            Check(
                "blocker",
                "clawhub-bundle-too-large",
                "ClawHub currently limits a Skill bundle to 50 MB",
                str(root),
            )
        )
    return checks


def _check_relative_links(root: Path) -> list[Check]:
    checks: list[Check] = []
    for filename in ("SKILL.md", "README.md"):
        source = root / filename
        if not source.is_file():
            continue
        text = source.read_text(encoding="utf-8", errors="replace")
        for match in MARKDOWN_LINK_RE.finditer(text):
            raw_target = match.group(1).strip().split(maxsplit=1)[0].strip("<>")
            target = urllib.parse.unquote(raw_target.split("#", 1)[0])
            if not target or target.startswith(
                ("http://", "https://", "mailto:", "#", "data:")
            ):
                continue
            resolved = (source.parent / target).resolve()
            if not _is_relative_to(resolved, root.resolve()):
                checks.append(
                    Check(
                        "blocker",
                        "external-relative-link",
                        f"Referenced file is outside the Skill bundle: {raw_target}",
                        str(source),
                    )
                )
            elif not resolved.exists():
                checks.append(
                    Check(
                        "blocker",
                        "broken-relative-link",
                        f"Referenced file does not exist: {raw_target}",
                        str(source),
                    )
                )
    return checks


def _check_bundle_files(root: Path) -> list[Check]:
    checks: list[Check] = []
    resolved_root = root.resolve()
    for path in root.rglob("*"):
        relative = path.relative_to(root)
        if any(part in EXCLUDED_PARTS for part in relative.parts):
            continue
        if path.is_symlink():
            resolved = path.resolve()
            if not path.exists():
                checks.append(
                    Check(
                        "blocker",
                        "broken-symlink",
                        "Symlink target does not exist",
                        str(path),
                    )
                )
            elif not _is_relative_to(resolved, resolved_root):
                checks.append(
                    Check(
                        "blocker",
                        "external-symlink",
                        "Symlink points outside the Skill directory",
                        str(path),
                    )
                )
        if path.is_file() and path.stat().st_size > 50 * 1024 * 1024:
            checks.append(
                Check(
                    "warning",
                    "large-file",
                    "A single file exceeds 50 MB",
                    str(path),
                )
            )
    return checks


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def _check_text_content(root: Path) -> list[Check]:
    checks: list[Check] = []
    for path in iter_bundle_files(root):
        if (
            path.suffix.lower() not in TEXT_SUFFIXES
            or path.stat().st_size > 1024 * 1024
        ):
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for code, pattern in SECRET_PATTERNS:
            if pattern.search(text):
                checks.append(
                    Check(
                        "blocker",
                        f"possible-secret-{code}",
                        f"Possible credential detected ({code}); inspect before publishing",
                        str(path),
                    )
                )
        for pattern in ABSOLUTE_PATH_PATTERNS:
            for match in pattern.finditer(text):
                username = match.group(1).lower()
                if username not in PLACEHOLDER_USERS:
                    checks.append(
                        Check(
                            "blocker",
                            "personal-absolute-path",
                            "Replace the machine-specific user path before publishing",
                            str(path),
                        )
                    )
                    break
    return _dedupe_checks(checks)


def _dedupe_checks(checks: list[Check]) -> list[Check]:
    seen: set[tuple[str, str, str | None]] = set()
    result: list[Check] = []
    for check in checks:
        key = (check.code, check.message, check.path)
        if key not in seen:
            seen.add(key)
            result.append(check)
    return result


def validate_semver(value: str) -> str:
    normalized = value.removeprefix("v")
    if not SEMVER_RE.fullmatch(normalized):
        raise ValueError(f"Invalid semantic version: {value}")
    return normalized


def load_json(path: Path | str) -> dict[str, Any]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise TypeError(f"Expected JSON object: {path}")
    return data
