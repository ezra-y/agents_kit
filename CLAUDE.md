@AGENTS.md

## Claude Code 补充

- 改 `docs/` 下的内容不要直接编辑文件。它由 `render.py` 生成；中文说明在 `metadata.json`，常驻名单在 `active.txt`。
- 跑脚本用 `python3`（macOS 没有 `python` 命令）。
- 动完任何东西，运行 `python3 scripts/manage.py refresh`；改过常驻或技能路径时加 `--link`，删除或停用时加 `--prune`。
