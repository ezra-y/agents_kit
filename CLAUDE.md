@AGENTS.md

## Claude Code 补充

- 改 `docs/` 下的内容不要直接编辑文件 —— 那是 `render.py` 生成的，改了也会被下次生成覆盖。改源头：中文说明在 `scripts/descriptions.py`，常驻名单在 `active.txt`。
- 跑脚本用 `python3`（macOS 没有 `python` 命令）。
- 动完任何东西，收尾固定两步：`python3 scripts/render.py` && `python3 scripts/doctor.py`。
