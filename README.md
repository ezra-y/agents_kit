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

`global apply` 按 `active.txt` 把技能软链到：

- `~/.claude/skills`
- `~/.agents/skills`

技能不是副本。以后执行 `cd ~/agents_kit && git pull`，已启用技能会直接更新。

## 仓库内容

| 路径 | 内容 |
|---|---|
| `skills/` | 按主要用途分类的技能目录 |
| `scripts/agents-kit` | 唯一公开命令 |
| `scripts/agents_kit/` | 命令使用的内部 Python 模块 |
| `active.txt` | 全局常驻技能名 |
| `sources.json` | 上游 provider、定位信息、更新策略和内容摘要 |
| `metadata.json` | 中文说明、触发方式、推荐指数、标签和可选依赖 |
| `mcps.json` | MCP 上游、锁定版本、启动方式、凭据来源和启用状态 |
| `docs/skills.md` | 自动生成的技能清册 |
| `docs/mcps.md` | 自动生成的 MCP 清单 |
| `docs/cli.md` | 自动生成的完整命令参考 |
| `docs/architecture.md` | 架构、模块边界和数据流 |
| `docs/skill-taxonomy.md` | 添加技能时供 AI 读取的分类与标签边界 |
| `docs/skill-publishing.md` | Agent Skill 发布平台、操作流程和验收方法 |
| `docs/skill-publisher-plan.md` | 跨平台 Skill 发布助手的实现规划、来源更新机制和验收标准 |
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
agents-kit ui
agents-kit mcp list
agents-kit mcp apply --all
agents-kit mcp update --all --dry-run

agents-kit global enable <技能名>
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
agents-kit source detach <技能名>
```

默认策略是 `review`。定时任务只检查变化并开 Issue，确认后再更新。Git、压缩包等
整目录来源会替换技能目录；直接指向 `SKILL.md` 的 HTTP 来源只更新该文件，
不会删除仓库维护的 `references/` 或 `scripts/`。

## 文档与体检

```bash
agents-kit docs build
agents-kit docs check
agents-kit check
```

`docs/skills.md`、`docs/mcps.md`、`docs/cli.md` 和 `docs/architecture.md`
的生成区块进入 Git。
可搜索网页生成到 `docs/index.html`，由 CI 上传为 artifact，不写入 Git 历史。
运行 `agents-kit ui` 会先更新网页，再启动本地服务并自动打开浏览器；网页中的
Finder 按钮可以直接打开对应技能目录。
