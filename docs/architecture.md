# agents_kit 架构

本文件记录稳定设计。生成区块由 `agents-kit docs build` 更新。

<!-- BEGIN GENERATED -->

## 当前事实

- 技能：298
- Plugin：8
- 常驻：148
- 来源记录：153 条 Skill，7 条 Plugin
- metadata：298
- 收藏索引：3 个来源，11 个技能
- MCP：5
- MCP 已启用：5
- 分类：视频制作(2), iOS(41), 运营与内容(9), 前端与 UI/UX(42), 后端(3), 安全与逆向(1), 通用工程(89), 产品(28), 学术研究(31), 研究与办公(33), AI Building(19)

## 状态所有权

- `agents-kit.json`：taxonomy、标签词表、安装目标和默认策略
- `plugins/`：完整 Plugin 包及平台权威 manifest
- `desired-installations.json`：按平台保存期望安装状态
- `active.txt`：旧版兼容清单，不再拥有安装状态
- `sources.json`：Skill 和 Plugin provider 来源记录
- `metadata.json`：中文清册、标签和依赖
- `scout.json`：收藏索引，未安装技能的名字、用途和来源定位
- `mcps.json`：MCP 清单、上游、锁定版本、启动方式和启用状态
- 根 Marketplace 索引：由平台 manifest 确定性生成

<!-- END GENERATED -->

## 设计目标

仓库只提供一个公开入口 `scripts/agents-kit`。用户按业务对象记命令：
`source`、`skill`、`plugin`、`marketplace`、`mcp`、`global`、`project`、
`docs`、`ui`、`check`。
内部代码按稳定职责拆分，不把每个动作做成单独脚本。

## 数据流

```text
外部来源
  -> sources.py 获取候选目录
  -> SkillSnapshot 或完整 PluginSnapshot
  -> 当前 AI 读取 skill-taxonomy.md，给出分类和标签
  -> skills.py / plugins.py 修改中央资产和来源登记
  -> ChangeSet 描述后续影响
  -> marketplace.py / installation.py / docs.py / checks.py 收尾

MCP 上游与分发
  -> mcps.json 保存期望状态和锁定版本
  -> mcps.py 解析启动模板和凭据来源
  -> Codex / Claude 只保存 agents-kit mcp run <名称>
```

`AssetRef`、`SkillSnapshot` 和 `PluginSnapshot` 是稳定边界。`ChangeSet` 描述
业务修改对 Marketplace、安装、文档和体检的后续影响。

## 模块边界

| 模块 | 职责 | 不负责 |
|---|---|---|
| `scripts/agents-kit` | 参数解析、命令编排、输出 | 保存业务状态 |
| `models.py` | 共享数据结构 | I/O |
| `repository.py` | 发现仓库、读写状态、锁、原子落盘、内容哈希 | 业务流程 |
| `taxonomy.py` | 校验分类定义、标签词表和数量约束 | 根据语义替模型分类 |
| `sources.py` | Git、HTTP、本地来源识别、获取、候选发现 | 修改仓库状态 |
| `source_reports.py` | 把来源检查 JSON 渲染为 Issue 审核 Markdown | 获取或应用来源更新 |
| `skills.py` | 导入、更新、移动、重命名、删除、metadata 和标签 | 全局或项目安装 |
| `plugins.py` | Plugin 识别、完整导入、sidecar、更新和组件盘点 | 生成 Marketplace 索引 |
| `marketplace.py` | 从原生 manifest 确定性生成两个根索引 | 生成或重写平台 manifest |
| `scout.py` | 收藏索引的登记、来源定位和全文链接 | 获取来源内容、安装技能 |
| `mcps.py` | MCP 导入、启停、版本更新、运行和客户端同步 | 保存凭据值、管理 Skill |
| `installation.py` | 期望安装计划、软链接、项目副本和 Codex Marketplace 操作 | 修改资产正文 |
| `migration.py` | 旧 Schema、裸 Skill ID 和 active 清单迁移 | 长期业务状态 |
| `docs.py` | 纯渲染、write-if-changed、文档过期检查 | 修改事实状态 |
| `ui.py` | 本地网页服务和 Finder 桥接 | 修改技能或清册状态 |
| `checks.py` | 只读验证状态、依赖、引用、文档和安装 | 自动修复 |

依赖方向保持单向：

```text
入口 -> 业务模块 -> repository/models
skills/checks -> taxonomy 的确定性校验
checks -> docs 的纯渲染 API / installation 的只读计划
skills/plugins -> models 中的 Snapshot 与 AssetRef
marketplace -> Plugin sidecar 与平台原生 manifest
mcps -> repository 中的单一 MCP 清单
```

## 来源模型

`sources.json` 分为 `skills` 和 `plugins`。Plugin 只有一条来源记录，完整目录是
更新单元；内嵌 Skill 不再各自登记来源。每条记录包含：

- `provider`：来源适配器 ID。
- `locator`：provider 自己解释的定位数据。
- `content_mode`：`directory` 或 `skill_file`。
- `policy`：`review` 或 `pinned`。
- `resolved`：最近确认的 revision 和内容哈希。
- 可选 `source_name`：上游名称与本地名称不同时使用。

来源检查分三个正交维度：

- `merge_state`：`unchanged`、`upstream_only`、`local_only`、`diverged`。
- `risk_class`：`docs_only`、`instructional`、`executable`、`binary`、`unknown`。
- `decision`：`auto_apply`、`review_required`、`blocked`。

只有 `upstream_only + docs_only` 自动应用，当前 `docs_only` 仅包含 License
和 Changelog。README、Skill、Prompt、Manifest、Hook、MCP、脚本、二进制和未知
内容默认人工确认。旧 `safe_update` 只作为兼容输出，不再表示内容安全。

定时任务把同一份审核 Markdown 写入 Actions Summary 和固定 Issue 正文。报告包含
总表、冲突原因、候选体检问题、截断后的 `SKILL.md` diff、精确上游链接和单项
更新命令；完整 JSON 仅作为 Artifact 保留。Issue 每次覆盖为最新状态，避免评论
累积成不可读的日志。

`directory` 管理整个技能目录，适用于 Git 和压缩包。`skill_file` 只管理
`SKILL.md`，适用于直接 HTTP 文件；更新时保留本地附件。增加新来源时，只扩展
`sources.py` 的 provider 注册和对应测试，不修改技能、安装和文档流程。

## 收藏索引模型

`scout.json` 登记「看过但未安装」的上游来源：每条保存 provider、locator、
扫描版本和全部技能条目（path、name、原文 description），不下载内容。
`source inspect --save` 写入，`--refresh-index` 重扫全部来源。

消费端是生成文档 `docs/catalog.md` 收藏总目录，分三层：未收录索引
（scout.json）、已收录未常驻（仓库清册减 active）、常驻备查。AI 通过全局
`CLAUDE.md` / `AGENTS.md` 里的一句指引找到该文件，按描述匹配后走最便宜
路径：启用已收录技能，或按 `HEAD` 原文链接读上游最新全文、用条目 path 作为
`--candidate` 走 `skill import` 的同一条导入流程。描述允许滞后（只用于
初筛），全文和安装始终实时。索引条目不参与安装体检；只有真正安装后才进入
`skills/`、`sources.json` 和 `metadata.json`。

## 分类与标签模型

独立 Skill 使用 `skill:standalone/<id>`；Plugin 内 Skill 使用
`skill:plugin/<plugin-id>/<local-id>`。裸名称只在全仓库唯一时作为 CLI 快捷
别名。两个 Plugin 可以拥有同名 Skill，平台 Adapter 在边界渲染各自命名空间。

目录 `skills/<分类>/<技能名>` 表达独立 Skill 的一级分类。Plugin Skill 的分类
保存在 `metadata.json`，物理目录保持上游布局。`metadata.json` 保存标签，
`agents-kit.json` 保存 taxonomy 版本、分类边界、标签命名空间和中央词表。

添加技能的当前 AI 读取 `docs/skill-taxonomy.md` 后，根据主要用户目标和正常产出给出
分类与标签。代码不实现关键词分类器，只验证结构化结果。这样模型负责语义，脚本负责
不变量，新增来源不需要修改分类逻辑。

跨 Skill 引用以唯一技能名识别。检查器允许 `../<技能名>/SKILL.md` 这类逻辑引用跨越
分类目录，但目标技能必须存在；项目安装仍将依赖复制到同一个扁平 skills 目录。

## Plugin 模型

`plugins/<plugin-id>/` 是完整文件所有权和上游更新边界。导入和更新复制整个子树，
只排除 `.git`、缓存和系统垃圾；Inventory 识别已知组件、可执行文件、二进制和
未知路径，但不充当复制白名单。

每个平台 manifest 对该平台保持权威。`agents-kit.plugin.json` 只记录：

- `upstream_targets`；
- 每个 manifest 的路径和 `upstream` / `local` authority；
- 目标支持状态和限制；
- 内嵌 Skill 的独立安装资格；
- 本地 overlay 路径。

缺失平台的 manifest 由 Adapter 创建一次，之后作为普通源文件维护。
`marketplace build` 不重写 manifest，只生成根索引。内嵌 Skill 默认
`plugin_only`；明确验证为 `self_contained` 后才能独立软链接或项目复制。

## 安装状态

`desired-installations.json` 只表达 agents_kit 希望向每个平台安装或投射的资产，
不声称是客户端实际状态。安装器从软链接和 Claude/Codex CLI 读取实际状态并计算
Plan。Claude Plugin 只允许 `skills-dir`，Codex Plugin 只允许 `marketplace`；
CLI、仓库体检和安装器共享同一套静态验证。Codex 状态探测失败时停止对应目标，
不把失败当作空状态。`~/.local/state/agents-kit/receipts.json` 记录每个目标
已完成和失败的动作，但不是事实源。`active.txt` 在兼容期只读，不再拥有安装状态。

## MCP 模型

`mcps.json` 是第三方 MCP 的唯一事实来源。每条记录包含：

- `source`：上游地址和 `review` / `pinned` 策略。
- `distribution`：npm、PyPI、Homebrew 或远程分发及锁定版本。
- `runtime`：启动命令和使用 `{package}`、`{version}` 的参数模板。
- `environment`：凭据名称及读取方式，只允许环境变量或无 shell 的命令。
- `targets`、`enabled`：目标客户端和全局启用状态。

Codex 和 Claude 不保存真实包命令，只运行本仓库的稳定 launcher。这样版本更新只修改
`mcps.json`，不需要同步改多份客户端配置。`mcp apply` 只处理能够证明由本仓库
launcher 管理的记录；同名外部配置默认停止并报告。

第三方 MCP 只有一条清单记录，不建立独立目录。只有本仓库自己维护 MCP 源码、测试和
发布流程时，才为源码建立工程目录。

## 写入模型

写操作先在临时目录和内存中完成来源身份、manifest、sidecar、全部 Skill
frontmatter、metadata 和安装期望校验，再取得仓库锁。JSON、文本和单路径更新
使用临时路径替换。Plugin 替换先把旧目录 rename 为备份，失败时恢复；跨多个状态
文件不承诺事务原子性。Git 负责历史恢复，仓库不实现第二套事务系统。

安装层只删除自己能证明由本仓库管理的链接。遇到同名实体目录或外部链接时停止并报告，
不自动覆盖。

## 生成内容

`docs.py` 从事实状态生成：

- `docs/skills.md`
- `docs/plugins.md`
- `docs/catalog.md`
- `docs/mcps.md`
- `docs/cli.md`
- 本文件的生成区块
- 未跟踪的 `docs/index.html`

相同输入必须生成相同内容；内容未变化时不得重写文件。CI 检查全部 tracked 文档是否过期，
并把 HTML 作为 artifact 上传。

`agents-kit ui` 在本机重新生成 HTML 后启动只监听 `127.0.0.1` 的服务。网页只把
技能名交给后端，后端从仓库清册解析目录并调用 Finder；不接受任意文件路径。
网页展示全部标签，并按一级分类、标签命名空间和全文搜索筛选。

## 不变量

1. 独立 Skill 放在 `skills/<分类>/<技能名>/SKILL.md`；Plugin Skill 只保存在 owner Plugin。
2. 资产使用结构化身份；裸 Skill 名称可以重复，但目标投射路径不能碰撞。
3. metadata 必须覆盖独立和 Plugin-owned Skill，并与当前 taxonomy 版本一致。
4. 每个技能有一个 `role`、1–3 个 `focus`，全部标签来自中央词表且总数不超过 8。
5. desired installations 和 sources 只能引用存在的结构化资产。
6. 全局安装由 `desired-installations.json` 决定，项目安装不写回中央状态。
7. 体检只报告问题，不修改仓库。
8. MCP 凭据值不得进入仓库或客户端配置；运行时再从声明的来源读取。
9. MCP 客户端同步不能删除同名但不受本仓库 launcher 管理的配置。
10. 平台 manifest 是权威源文件；Marketplace build 不得重写它们。
11. Plugin 更新保留完整上游目录和全部未知文件。
