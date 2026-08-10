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
4. 优先通过 CLI 修改技能、Plugin 及 `desired-installations.json`、
   `sources.json`、`metadata.json` 和 `mcps.json`。删除技能使用
   `agents-kit skill remove <名称> --yes`，删除 Plugin 使用
   `agents-kit plugin remove <名称> --yes`。
5. 全局安装是软链接，项目安装是副本；依赖由 `metadata.json` 和安装流程展开，
   不把依赖手工写入期望安装清单。`active.txt` 只保留一个兼容周期。
6. 来源检查把合并状态和内容风险分开。只有无本地冲突的 README、License、
   Changelog 纯文档变化可用 `--auto-docs` 自动应用；Skill、Prompt、Manifest、
   Hook、MCP、脚本、二进制和未知内容默认人工确认。
7. MCP 集中记录在 `mcps.json`；`npm`、`pypi` 和 `brew` 分发必须锁定版本。
   凭据只记录环境变量或安全命令来源，不把值写进仓库或客户端配置。
8. 修改 `rules/`、`agents/`、`hooks/` 或 `prompts/` 前，先读取对应目录的
   README。不要覆盖或提交用户的无关改动。

## Plugin 所有权

- 独立 Skill 位于 `skills/<category>/<skill-id>/`。
- 完整 Plugin 位于 `plugins/<plugin-id>/`，整个目录是来源和更新边界。
- Plugin-owned Skill 只保存在 owner Plugin 中，不复制到顶层 `skills/`。
- `agents-kit.plugin.json` 只保存仓库管理策略；Claude/Codex manifest 分别是
  各平台的权威源文件，不由 Marketplace build 重写。
- 内嵌 Skill 默认只能随 Plugin 安装；只有 sidecar 明确标记
  `self_contained` 后才能单独软链接或复制。
- Plugin 导入和更新保留完整目录树。未知文件必须保留并进入 Review，不能作为
  复制白名单之外的垃圾删除。
- 修改 Plugin 前先读 sidecar；修改后运行 `agents-kit marketplace build`、
  `agents-kit docs build` 和 `agents-kit check`。
- 不把 Claude/Codex 客户端缓存当事实源，也不直接修改缓存。

## 按需上下文

- 分类与标签：`docs/skill-taxonomy.md`
- CLI 参数：`docs/cli.md` 或命令的 `--help`
- 模块边界、来源模型和安装语义：`docs/architecture.md`
- 状态文件、本机 LaunchAgent 自动同步和日常操作：`README.md`

本机每 60 分钟尝试把 `origin/main` fast-forward 到 `~/agents_kit`；工作区不干净、
本地领先或分叉时会跳过。普通任务不要绕过这些保护，排障时再读取 README。

## 生成文件

`docs/skills.md`、`docs/plugins.md`、`docs/mcps.md`、`docs/cli.md`、
`docs/architecture.md` 的生成区块和 `docs/index.html` 由
`agents-kit docs build` 管理，不直接编辑。

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
