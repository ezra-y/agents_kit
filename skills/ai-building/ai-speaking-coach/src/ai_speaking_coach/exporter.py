from __future__ import annotations

import sqlite3
import zipfile
from pathlib import Path

from .db import backup_database
from .paths import (
    backup_dir,
    coach_mode_database_path,
    database_path,
    skill_root,
)
from .time_utils import now

EXCLUDED_PARTS = {
    ".env",
    ".git",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
}


def export_bundle(
    include_index: bool = False,
    include_model: bool = False,
    public_release: bool = False,
) -> Path:
    root = skill_root()
    stamp = now().strftime("%Y%m%d-%H%M%S")
    destination_dir = backup_dir()
    destination_dir.mkdir(parents=True, exist_ok=True)
    kind = "public" if public_release else "personal"
    destination = destination_dir / f"ai-speaking-coach-{kind}-{stamp}.zip"

    database_backups: list[tuple[Path, Path]] = []
    if not public_release:
        database_backups = _database_backups(destination_dir, stamp)

    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in root.rglob("*"):
            if not path.is_file() or path == destination:
                continue
            relative = path.relative_to(root)
            if any(
                part in EXCLUDED_PARTS or part.endswith(".egg-info")
                for part in relative.parts
            ):
                continue
            if path in {temporary for temporary, _ in database_backups}:
                continue
            if _skip_path(
                relative,
                public_release=public_release,
                include_index=include_index,
                include_model=include_model,
            ):
                continue
            archive.write(path, Path("ai-speaking-coach") / relative)

        for temporary, archive_path in database_backups:
            archive.write(temporary, Path("ai-speaking-coach") / archive_path)

    for temporary, _ in database_backups:
        temporary.unlink(missing_ok=True)
    return destination


def _database_backups(destination_dir: Path, stamp: str) -> list[tuple[Path, Path]]:
    backups: list[tuple[Path, Path]] = []
    for source, filename, archive_path in (
        (
            database_path(),
            f"learner-export-{stamp}.sqlite",
            Path("private/learner/state/coach.sqlite"),
        ),
        (
            coach_mode_database_path(),
            f"coach-mode-export-{stamp}.sqlite",
            Path("private/runtime/coach-mode.sqlite"),
        ),
    ):
        if not source.exists():
            continue
        _assert_database_integrity(source)
        temporary = destination_dir / filename
        backup_database(temporary, source)
        backups.append((temporary, archive_path))
    return backups


def _skip_path(
    relative: Path,
    *,
    public_release: bool,
    include_index: bool,
    include_model: bool,
) -> bool:
    parts = relative.parts
    if parts and parts[0] in {"knowledge", "runtime"}:
        return True
    if parts[:3] == ("private", "learner", "backups"):
        return True
    if relative in {
        Path("private/learner/state/coach.sqlite"),
        Path("private/runtime/coach-mode.sqlite"),
    }:
        return True
    if relative.name.startswith(("coach.sqlite-", "coach-mode.sqlite-")):
        return True

    if public_release and parts and parts[0] == "private":
        return not _is_public_private_skeleton(relative)
    if parts[:3] == ("private", "cache", "models") and not include_model:
        return True
    return parts[:3] == ("private", "cache", "lancedb") and not include_index


def _is_public_private_skeleton(relative: Path) -> bool:
    name = relative.name
    return name == ".gitkeep" or ".example." in name


def _assert_database_integrity(path: Path) -> None:
    with sqlite3.connect(path) as connection:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
    if integrity != "ok":
        raise RuntimeError(f"SQLite integrity check failed for {path}: {integrity}")
