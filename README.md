# agents_kit

Ezra 的 Agent Skill 与 MCP 中央仓库。Claude Code 与 Codex 共用同一份事实，
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
云端更新使用 `--repo-only`，只处理仓库文件，不尝试启动本机客户端。
当前只有 License 和 Changelog 归入 `docs_only`；README、`SKILL.md`、Prompt、
Manifest、Hook、MCP、脚本、二进制和未知文件即使没有本地冲突也要人工确认。
完整 Plugin 更新复制整个上游子树，再覆盖 sidecar 声明的本地 authority 路径；
组件 Inventory 只用于识别和审核，不决定保留哪些文件。

### 本机自动同步

macOS 每 60 分钟运行 `agents-kit sync`，入口是仓库内的
`scripts/sync-local.zsh`。仅在干净的 `main` 上快进更新，不自动提交、推送或覆盖工作区。
即使远端没有新提交，也会核对安装、版本和真实插件加载。

完整流程：拉取仓库 → 更新插件索引与清单 → 同步安装副本 → 核验两端实际加载。
“跳过”“失败”“完整成功”分别记录，不把退出码 0 当成已经同步。
运行记录只保留当前一份，位于 `~/.local/state/agents-kit/sync-status.json`；
包含上次尝试、上次完整成功、阻塞原因及插件加载结果。

```bash
agents-kit status                 # 查看数量和上次同步结果
agents-kit sync                   # 立即执行完整同步；有修改时安全跳过
agents-kit check --runtime        # 核验仓库、安装和实际加载，不调用模型
agents-kit check --repo-only --runtime  # 只查技能插件，不检查独立 MCP 配置
agents-kit ui                     # 网页区分独立/随插件启用，并可检查实际加载
```

插件更新会同步本地生成清单中仍继承上游的版本和技能路径，保留用户改过的字段。
Codex 安装核对版本、启用状态及实际安装文件；发现差异使用原生安装命令更新，
不手工修改客户端缓存。Claude 出现同名来源遮挡或清单错误时，实际加载检查会明确报错。
Thinking 的 Claude 路径修复是本地改动；若上游也修改该清单，更新须审查，不自动覆盖。


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

### 完整验收与故障恢复

`agents-kit check` 只读配置，不会为检查配置而启动 MCP 服务。
`agents-kit check --runtime` 再核验两端插件内的真实技能清单，并对启用的
MCP 做初始化和工具列表握手，不调用模型或执行业务工具。检查有超时和进程清理。
`--repo-only --runtime` 仅核验插件，适合不需要检查本机 MCP 的场景。

每小时同步也会应用受管 MCP 配置并执行完整验收。失败会保留上一次成功时间，
明确标出失败步骤，修正后可重复运行 `agents-kit sync`。未提交修改、分支分叉、
或检查后出现的新修改，都不会被当成同步成功。

同名外部 MCP 与中央清单冲突时，整批安装在修改前停止；不会先安装一半再报冲突。
受管版本固定为 `pinned` 的插件不会被更新命令越过。

### 上游更新待办

每天仍检查所有登记来源，每次保留完整的 Actions 报告。`source notify` 只在待办内容
或检查错误发生变化时更新同一条「上游技能待更新」Issue；运行链接、执行时间和无关
上游提交变化不会触发重复更新。事项只展示摘要，详细差异在对应运行的报告中。
待办全部解决时关闭事项，出现新待办时复用原事项。不会更改 GitHub 邮件订阅。

飞书技能跟踪 `larksuite/cli` 官方仓库中的完整 `skills/<名称>` 目录，主文件和附件
一起更新，不再只抓取远程 `SKILL.md`。旧会议名称保留官方兼容入口，其依赖
`lark-meeting` 只收录为依赖，没有增加独立常驻项。

普通上游新版本需要审核；文件不完整和本地冲突会明确区分。显式单项更新遇到这些
问题会返回失败并保留当前内容，`--yes` 不绕过检查。批量更新在写入前再次核对
候选，避免下载期间的本地改动被覆盖。
