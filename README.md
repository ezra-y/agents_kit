# agents_kit

Ezra 的私有 Agent Skill 与 MCP 中央仓库。Claude Code 与 Codex 共用同一份事实，
所有收录、更新、安装和检查都从一个命令进入：`agents-kit`。

## 快速开始

前提：`uv` 已安装，且 `~/.local/bin` 位于 `PATH`。

```bash
git clone git@github.com:ezra-y/agents_kit.git ~/agents_kit
mkdir -p ~/.local/bin
ln -sfn ~/agents_kit/scripts/agents-kit ~/.local/bin/agents-kit
agents-kit global apply
agents-kit check
```

`global apply` 按 `desired-installations.json` 把技能和 Plugin 投射到：

- `~/.claude/skills`
- `~/.agents/skills`

技能不是副本。以后执行 `cd ~/agents_kit && git pull`，已启用技能会直接更新。

## 仓库内容

| 路径 | 内容 |
|---|---|
| `skills/` | 按主要用途分类的技能目录 |
| `plugins/` | 完整 Plugin 包；包含平台 manifest、Skill、Hook、MCP 和资源 |
| `scripts/agents-kit` | 唯一公开命令 |
| `scripts/agents_kit/` | 命令使用的内部 Python 模块 |
| `desired-installations.json` | Claude/Codex 的期望安装状态 |
| `active.txt` | 旧版兼容清单，不再是安装事实源 |
| `sources.json` | Skill/Plugin 上游 provider、定位、更新策略和摘要 |
| `metadata.json` | 中文说明、触发方式、推荐指数、标签和可选依赖 |
| `scout.json` | 收藏索引：未安装技能的名字、用途和来源定位，不含内容 |
| `mcps.json` | MCP 上游、锁定版本、启动方式、凭据来源和启用状态 |
| `docs/skills.md` | 自动生成的技能清册 |
| `docs/plugins.md` | 自动生成的完整 Plugin 清单 |
| `docs/catalog.md` | 自动生成的收藏总目录：未收录索引 + 未常驻 + 常驻 |
| `docs/mcps.md` | 自动生成的 MCP 清单 |
| `docs/cli.md` | 自动生成的完整命令参考 |
| `docs/architecture.md` | 架构、模块边界和数据流 |
| `docs/skill-taxonomy.md` | 添加技能时供 AI 读取的分类与标签边界 |
| `docs/skill-publishing.md` | Agent Skill 发布平台、操作流程和验收方法 |
| `docs/index.html` | 本地生成的可视化 Skill 与 MCP 清册，不进入 Git |

`rules/`、`agents/`、`hooks/`、`prompts/` 目前只保留各自说明，不进入技能安装流程。
仓库规则以 `CLAUDE.md` 为准，`AGENTS.md` 是指向它的软链接。

## 收录技能

一次命令完成获取、校验、入库、登记、安装、文档生成和体检：

```bash
agents-kit skill import "<Git URL、HTTP URL 或本地路径>" \
  --category research-office \
  --tag role/researcher \
  --tag focus/web-research \
  --tag output/research \
  --scope global \
  --description "<中文说明>" \
  --trigger "<触发方式>" \
  --recommendation 3
```

安装到项目时改用：

```bash
agents-kit skill import "<来源>" \
  --category frontend-uiux \
  --tag role/builder \
  --tag focus/ui-design \
  --tag output/code \
  --scope project \
  --project "<项目路径>" \
  --description "<中文说明>"
```

来源中有多个技能时，先运行 `agents-kit source inspect <来源>`，再用
`--candidate <相对路径>` 选择。

## 收录完整 Plugin

带 `.claude-plugin/plugin.json` 或 `.codex-plugin/plugin.json` 的来源按完整
Plugin 导入，不抽取其中的单个 Skill：

```bash
agents-kit plugin inspect "<来源>" --candidate plugins/example
agents-kit plugin import "<来源>" \
  --candidate plugins/example \
  --category ai-building \
  --target claude \
  --target codex \
  --tag role/builder \
  --tag focus/ai-apps
```

导入会保留完整目录树，把同内容的独立 Skill 迁移到 Plugin 所有权，并为缺失
目标创建一次原生 manifest。平台 manifest 后续各自维护；Marketplace build
只校验它们并生成两个根索引。

## 收藏总目录：大仓库不整个收录，看上先记一笔

有的上游仓库一个就带几十个技能，不必全部导入。`source inspect --save`
只登记索引（每个技能的名字和上游原文描述），内容不落地：

```bash
agents-kit source inspect https://github.com/emilkowalski/skills --save
agents-kit source inspect --refresh-index   # 重扫全部已收藏来源
```

索引存进 `scout.json`，`docs build` 把它和仓库清册一起渲染成
`docs/catalog.md` 收藏总目录，分三层：

1. **未收录索引**：看上但还没进仓库的，每条带上游原文描述、指向默认分支
   最新版的全文链接和现成的 `skill import --candidate` 命令模板；
2. **已收录、未常驻**：仓库现成的技能，`global enable` 即可用，零下载；
3. **常驻**：备查名单。

AI 的入口是全局 `~/.claude/CLAUDE.md` / `AGENTS.md` 里的一句指引：需要
新能力时先读 `~/agents_kit/docs/catalog.md`。上游改目录导致链接失效时，
`--refresh-index` 重扫即可恢复；移除来源直接编辑 `scout.json` 后运行
`agents-kit docs build`。

## 收录 MCP

第三方 MCP 集中记录在一个 `mcps.json`，不为单条配置建立目录。一次命令完成
入库、客户端同步、文档生成和体检：

```bash
agents-kit mcp import "<上游 URL>" \
  --name <名称> \
  --description "<中文说明>" \
  --distribution npm \
  --package <包名> \
  --version <锁定版本> \
  --command npx \
  --arg=-y \
  --arg='{package}@{version}' \
  --scope global
```

需要凭据时使用 `--secret-env <变量名>`，或用
`--secret-command '变量名=无 shell 命令'` 从钥匙串工具读取。凭据值不会写入仓库
或客户端配置。

## 日常管理

```bash
agents-kit status
agents-kit skill list
agents-kit skill list --active
agents-kit skill list --category ios --tag role/reviewer
agents-kit skill show <技能名>
agents-kit skill open <技能名>
agents-kit plugin list
agents-kit plugin show <Plugin>
agents-kit marketplace status
agents-kit ui
agents-kit mcp list
agents-kit mcp apply --all
agents-kit mcp update --all --dry-run

agents-kit global enable <技能名>
agents-kit global enable <技能名> --target codex
agents-kit global disable <技能名>
agents-kit skill move <技能名> <分类>
agents-kit skill rename <旧名> <新名>
agents-kit skill remove <技能名> --yes
```

向项目复制一个技能或整个分类：

```bash
agents-kit project install <技能名或分类> --project "<项目路径>"
```

项目安装使用副本，后续不会被中央仓库自动覆盖。

## 上游更新

```bash
agents-kit source check --all
agents-kit source update <技能名> --yes
agents-kit source update --all --auto-docs --yes
agents-kit source detach <技能名>
agents-kit plugin update --all --dry-run
agents-kit plugin update <Plugin> --yes
```

默认策略是 `review`。检查结果分别报告 `merge_state`、`risk_class` 和
`decision`。只有 `upstream_only + docs_only` 可由 `--auto-docs` 自动应用。
当前只有 License 和 Changelog 归入 `docs_only`；README、`SKILL.md`、Prompt、
Manifest、Hook、MCP、脚本、二进制和未知文件即使没有本地冲突也要人工确认。
完整 Plugin 更新复制整个上游子树，再覆盖 sidecar 声明的本地 authority 路径；
组件 Inventory 只用于识别和审核，不决定保留哪些文件。

### 本机自动同步

macOS 使用 LaunchAgent `com.ezra.agents-kit-sync`，每 60 分钟检查一次
`origin/main`。同步脚本位于
`~/Library/Application Support/agents-kit/sync-local.zsh`，调度配置位于
`~/Library/LaunchAgents/com.ezra.agents-kit-sync.plist`。

脚本只允许干净的 `main` 分支 fast-forward。本地有未提交内容、独立提交或分叉时
会跳过，不会覆盖本地内容，也不会自动 push。同步完成后，全局软链接立即使用新版；
项目级复制安装需要单独重新安装。

```bash
# 查看状态
launchctl print gui/$(id -u)/com.ezra.agents-kit-sync

# 立即执行一次
launchctl kickstart -k gui/$(id -u)/com.ezra.agents-kit-sync

# 查看日志
tail -n 20 ~/Library/Logs/agents-kit-sync.log
```

## 文档与体检

```bash
agents-kit docs build
agents-kit docs check
agents-kit check
```

`docs/skills.md`、`docs/plugins.md`、`docs/mcps.md`、`docs/cli.md` 和
`docs/architecture.md` 的生成区块进入 Git。
可搜索网页生成到 `docs/index.html`，由 CI 上传为 artifact，不写入 Git 历史。
运行 `agents-kit ui` 会先更新网页，再启动本地服务并自动打开浏览器；网页中的
Finder 按钮可以直接打开对应技能目录。
