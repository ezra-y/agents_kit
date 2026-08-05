from __future__ import annotations

import zipfile
from pathlib import Path

from .db import backup_database, connect
from .paths import database_path, runtime_dir, skill_root
from .time_utils import now

EXCLUDED_PARTS = {
    ".env",
    ".git",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
}


def export_bundle(include_index: bool = False, include_model: bool = False) -> Path:
    root = skill_root()
    stamp = now().strftime("%Y%m%d-%H%M%S")
    backup_dir = runtime_dir() / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    database_backup = backup_dir / f"coach-export-{stamp}.sqlite"
    if database_path().exists():
        with connect() as connection:
            integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"SQLite integrity check failed: {integrity}")
        backup_database(database_backup)
    destination = backup_dir / f"ai-speaking-coach-{stamp}.zip"
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in root.rglob("*"):
            if not path.is_file() or path in (destination, database_backup):
                continue
            relative = path.relative_to(root)
            if any(part in EXCLUDED_PARTS for part in relative.parts):
                continue
            if relative.parts[:2] == ("runtime", "backups"):
                continue
            if relative.parts[:2] == ("runtime", "lancedb") and not include_index:
                continue
            if relative.parts[:2] == ("runtime", "models") and not include_model:
                continue
            if relative == Path("runtime/coach.sqlite"):
                continue
            if path.name.startswith("coach.sqlite-"):
                continue
            archive.write(path, Path("ai-speaking-coach") / relative)
        if database_backup.exists():
            archive.write(
                database_backup,
                Path("ai-speaking-coach/runtime/coach.sqlite"),
            )
    database_backup.unlink(missing_ok=True)
    return destination
