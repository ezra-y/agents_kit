# agents_kit

本仓库是 Claude Code 与 Codex 共用技能、MCP 清单的唯一事实来源。

## 操作规则

1. 使用 `agents-kit` 这个公开命令，一般不直接调用 `scripts/agents_kit/` 内部模块。
2. 用户没有说明安装范围时，先问全局还是当前项目。
3. 新技能先进入本仓库，再按 scope 安装；不要直接复制到
   `~/.claude/skills`、`~/.agents/skills` 或项目目录。
4. 添加技能、移动分类或修改标签前，先读 `docs/skill-taxonomy.md`。当前 AI 根据
   Skill 的主要产出选择分类和标签，只使用 `agents-kit.json` 的中央词表。
5. 优先使用 CLI 修改 `active.txt`、`sources.json`、`metadata.json` 和技能目录。
   直接改源码或事实状态后，运行 `agents-kit docs build` 和 `agents-kit check`。
6. 删除技能必须同时处理技能目录、常驻状态、来源记录、metadata 和本仓库管理的链接。
   使用 `agents-kit skill remove <技能名> --yes`。
7. 项目安装是副本，不受中央仓库继续追踪；全局安装是软链接。两条路径都会按
   `metadata.json` 的 `dependencies` 自动展开依赖：`active.txt` 只记显式启用的技能，
   依赖由 `global apply` 连带安装，停用后无人依赖的会被自动回收。
8. 上游默认使用 `review` 策略。定时任务按正文、全部内容、改动规模、候选体检
   和结构语义判断安全更新；允许小文件新增、非运行元数据清理、相同内容的重复
   副本清理和内部软链接去重，唯一文件删除等破坏性变化进入 Issue，确认后使用
   `source update` 单独更新。
9. HTTP 单文件来源只管理 `SKILL.md`；`references/`、`scripts/` 等附件由仓库保留。
10. 修改 `rules/`、`agents/`、`hooks/` 或 `prompts/` 前，先读对应目录的 README。
11. 第三方 MCP 集中记录在 `mcps.json`，不要为只有配置的 MCP 建独立目录。
    凭据只记录环境变量或安全命令来源，不把值写进仓库和客户端配置。

## 状态文件

| 文件 | 唯一职责 |
|---|---|
| `agents-kit.json` | taxonomy、标签词表、安装目标和默认策略 |
| `active.txt` | 全局常驻技能名 |
| `sources.json` | 上游来源、更新策略和受管内容摘要 |
| `metadata.json` | 中文清册、触发信息、推荐指数、标签和依赖 |
| `mcps.json` | MCP 上游、锁定版本、启动方式、凭据来源、目标和启用状态 |

## 正常流程

收录并安装：

```bash
agents-kit skill import "<来源>" \
  --category <分类> \
  --tag role/<角色> \
  --tag focus/<细分能力> \
  --scope <global|project|library> \
  --project "<项目路径>" \
  --description "<中文说明>" \
  --trigger "<触发方式>" \
  --recommendation <1-5>
```

`--project` 只在 `scope=project` 时需要。来源有多个候选时，先用
`agents-kit source inspect <来源>` 查看，再传 `--candidate`。

收录并全局安装 MCP：

```bash
agents-kit mcp import "<上游>" \
  --name <名称> \
  --description "<中文说明>" \
  --distribution <npm|pypi|brew|remote> \
  --package <包名> \
  --version <锁定版本> \
  --command <启动命令> \
  --arg <启动参数> \
  --scope global
```

`npm`、`pypi` 和 `brew` 必须锁定版本。需要凭据时使用 `--secret-env`
或 `--secret-command` 记录读取方式。客户端统一运行
`agents-kit mcp run <名称>`，不要把具体包命令复制进各客户端。

管理命令及完整参数见 `docs/cli.md`。模块职责和依赖方向见
`docs/architecture.md`。

## 生成文件

一般不直接编辑：

- `docs/skills.md`
- `docs/mcps.md`
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
2. `uvx ruff==0.16.0 check scripts/agents-kit scripts/agents_kit tests` 和
   `uvx ruff==0.16.0 format --check scripts/agents-kit scripts/agents_kit tests` 通过。
3. `agents-kit docs build` 后，第二次运行不产生变化。
4. `agents-kit check` 通过；CI 使用 `agents-kit check --repo-only`。
5. `git diff --check` 通过。
6. 不覆盖或提交用户的无关改动。
