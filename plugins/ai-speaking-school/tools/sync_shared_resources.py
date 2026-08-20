from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAP = json.loads((ROOT / "authoring" / "shared-map.json").read_text(encoding="utf-8"))


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sync() -> dict:
    report = {}
    for skill, config in MAP.items():
        skill_root = ROOT / "skills" / skill
        runtime_dst = skill_root / "scripts" / "_shared"
        refs_dst = skill_root / "references" / "_shared"
        schemas_dst = refs_dst / "schemas"
        for directory in (runtime_dst, refs_dst, schemas_dst):
            directory.mkdir(parents=True, exist_ok=True)
        copied = []
        for name in config["runtime"]:
            src = ROOT / "authoring" / "shared-runtime" / name
            dst = runtime_dst / name
            shutil.copy2(src, dst); copied.append((src, dst))
        (runtime_dst / "__init__.py").write_text('"""Generated shared runtime copy."""\n', encoding="utf-8")
        for name in config["references"]:
            src = ROOT / "authoring" / "shared-references" / name
            dst = refs_dst / name
            shutil.copy2(src, dst); copied.append((src, dst))
        for name in config["schemas"]:
            src = ROOT / "authoring" / "schemas" / name
            dst = schemas_dst / name
            shutil.copy2(src, dst); copied.append((src, dst))
        report[skill] = [{"source": str(s.relative_to(ROOT)), "target": str(d.relative_to(ROOT)), "sha256": digest(d)} for s, d in copied]
    (ROOT / "BUILD_RESOURCE_REPORT.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


if __name__ == "__main__":
    report = sync()
    print(f"synced {sum(len(v) for v in report.values())} resources")
