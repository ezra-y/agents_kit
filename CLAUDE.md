# agents_kit

本仓库是 Claude Code 与 Codex 共用技能和 MCP 清单的唯一事实来源。

## 操作原则

1. 使用公开命令 `agents-kit` 管理仓库；具体参数先查 `--help` 或
   `docs/cli.md`，一般不直接调用 `scripts/agents_kit/` 内部模块。
2. 用户未说明安装范围时，先确认全局还是当前项目；只收录、不安装时使用
   `library`。新技能先进入本仓库，不直接复制到客户端或项目的技能目录。
   上游仓库技能太多、暂不安装时，用 `agents-kit source inspect <来源> --save`
   记入收藏索引（scout.json，渲染成 `docs/catalog.md` 收藏总目录），之后
   按需启用或安装；找技能先查 `docs/catalog.md`。
3. 添加技能、移动分类或修改标签前，读取 `docs/skill-taxonomy.md`，按主要产出
   选择分类，只使用 `agents-kit.json` 的中央词表。
4. 优先通过 CLI 修改技能目录及 `active.txt`、`sources.json`、`metadata.json`
   和 `mcps.json`。删除技能使用 `agents-kit skill remove <名称> --yes`，由 CLI
   同时清理状态、来源、metadata 和受管链接。
5. 全局安装是软链接，项目安装是副本；依赖由 `metadata.json` 和安装流程展开，
   不把依赖手工写入 `active.txt`。
6. 已登记的上游在本地未修改时直接同步；本地与上游同时修改且内容不一致，或
   候选体检失败时才等待人工处理。低频来源细节见 `docs/architecture.md`。
7. MCP 集中记录在 `mcps.json`；`npm`、`pypi` 和 `brew` 分发必须锁定版本。
   凭据只记录环境变量或安全命令来源，不把值写进仓库或客户端配置。
8. 修改 `rules/`、`agents/`、`hooks/` 或 `prompts/` 前，先读取对应目录的
   README。不要覆盖或提交用户的无关改动。

## 按需上下文

- 分类与标签：`docs/skill-taxonomy.md`
- CLI 参数：`docs/cli.md` 或命令的 `--help`
- 模块边界、来源模型和安装语义：`docs/architecture.md`
- 状态文件、本机 LaunchAgent 自动同步和日常操作：`README.md`

本机每 60 分钟尝试把 `origin/main` fast-forward 到 `~/agents_kit`；工作区不干净、
本地领先或分叉时会跳过。普通任务不要绕过这些保护，排障时再读取 README。

## 生成文件

`docs/skills.md`、`docs/mcps.md`、`docs/cli.md`、`docs/architecture.md` 的生成区块
和 `docs/index.html` 由 `agents-kit docs build` 管理，不直接编辑。

修改源码或事实状态后运行：

```bash
agents-kit docs build
agents-kit check
```

改过常驻状态或技能路径时，再运行 `agents-kit global apply`。

## 完成标准

1. `uv run --with "PyYAML>=6,<7" python -m unittest discover -s tests` 通过。
2. `uvx ruff==0.16.0 check scripts/agents-kit scripts/agents_kit tests` 和
   `uvx ruff==0.16.0 format --check scripts/agents-kit scripts/agents_kit tests` 通过。
3. `agents-kit docs build` 后，第二次运行不产生变化。
4. `agents-kit check` 通过；CI 使用 `agents-kit check --repo-only`。
5. `git diff --check` 通过。
