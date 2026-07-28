# agents_kit

本仓库是 Claude Code 与 Codex 共用技能的唯一事实来源。

## 操作规则

1. 使用 `agents-kit` 这个公开命令，一般不直接调用 `scripts/agents_kit/` 内部模块。
2. 用户没有说明安装范围时，先问全局还是当前项目。
3. 新技能先进入本仓库，再按 scope 安装；不要直接复制到
   `~/.claude/skills`、`~/.agents/skills` 或项目目录。
4. 优先使用 CLI 修改 `active.txt`、`sources.json`、`metadata.json` 和技能目录。
   直接改源码或事实状态后，运行 `agents-kit docs build` 和 `agents-kit check`。
5. 删除技能必须同时处理技能目录、常驻状态、来源记录、metadata 和本仓库管理的链接。
   使用 `agents-kit skill remove <技能名> --yes`。
6. 项目安装是副本，不受中央仓库继续追踪；全局安装是软链接。
7. 上游默认使用 `review` 策略。先 `source check`，确认后再 `source update`。
8. HTTP 单文件来源只管理 `SKILL.md`；`references/`、`scripts/` 等附件由仓库保留。
9. 修改 `rules/`、`agents/`、`hooks/` 或 `prompts/` 前，先读对应目录的 README。

## 状态文件

| 文件 | 唯一职责 |
|---|---|
| `agents-kit.json` | 分类、安装目标和默认策略 |
| `active.txt` | 全局常驻技能名 |
| `sources.json` | 上游来源、更新策略和受管内容摘要 |
| `metadata.json` | 中文清册、触发信息、推荐指数和依赖 |

## 正常流程

收录并安装：

```bash
agents-kit skill import "<来源>" \
  --category <分类> \
  --scope <global|project|library> \
  --project "<项目路径>" \
  --description "<中文说明>" \
  --trigger "<触发方式>" \
  --recommendation <1-5>
```

`--project` 只在 `scope=project` 时需要。来源有多个候选时，先用
`agents-kit source inspect <来源>` 查看，再传 `--candidate`。

管理命令及完整参数见 `docs/cli.md`。模块职责和依赖方向见
`docs/architecture.md`。

## 生成文件

一般不直接编辑：

- `docs/skills.md`
- `docs/cli.md`
- `docs/architecture.md` 的生成区块
- `docs/index.html`

修改事实状态后运行：

```bash
agents-kit docs build
agents-kit check
```

如果改过常驻状态或技能路径，再运行 `agents-kit global apply`。

## 完成标准

1. `uv run --with "PyYAML>=6,<7" python -m unittest discover -s tests` 通过。
2. `agents-kit docs build` 后，第二次运行不产生变化。
3. `agents-kit check` 通过；CI 使用 `agents-kit check --repo-only`。
4. `git diff --check` 通过。
5. 不覆盖或提交用户的无关改动。
