from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_ROOT = ROOT / "authoring" / "shared-runtime"
spec = importlib.util.spec_from_file_location(
    "contracts",
    RUNTIME_ROOT / "contracts.py",
)
if spec is None or spec.loader is None:
    raise RuntimeError("Cannot load shared contracts")
contracts = importlib.util.module_from_spec(spec)
sys.modules["contracts"] = contracts
spec.loader.exec_module(contracts)


def main() -> None:
    destination = ROOT / "authoring" / "schemas"
    destination.mkdir(parents=True, exist_ok=True)
    for name, model in contracts.CONTRACT_MODELS.items():
        path = destination / f"{name}.schema.json"
        path.write_text(
            json.dumps(model.model_json_schema(), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    print(f"generated {len(contracts.CONTRACT_MODELS)} schemas")


if __name__ == "__main__":
    main()
