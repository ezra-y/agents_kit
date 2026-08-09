# agents_kit 架构

本文件记录稳定设计。生成区块由 `agents-kit docs build` 更新。

<!-- BEGIN GENERATED -->

## 当前事实

- 技能：231
- 常驻：105
- 来源记录：206
- metadata：231
- 收藏索引：1 个来源，9 个技能
- MCP：5
- MCP 已启用：5
- 分类：视频制作(2), iOS(42), 运营与内容(9), 前端与 UI/UX(46), 后端(4), 安全与逆向(1), 通用工程(14), 产品(36), 学术研究(31), 研究与办公(30), AI Building(16)

## 状态所有权

- `agents-kit.json`：taxonomy、标签词表、安装目标和默认策略
- `active.txt`：全局常驻技能名
- `sources.json`：provider 来源记录
- `metadata.json`：中文清册、标签和依赖
- `scout.json`：收藏索引，未安装技能的名字、用途和来源定位
- `mcps.json`：MCP 清单、上游、锁定版本、启动方式和启用状态

<!-- END GENERATED -->

## 设计目标

仓库只提供一个公开入口 `scripts/agents-kit`。用户按业务对象记命令：
`source`、`skill`、`mcp`、`global`、`project`、`docs`、`ui`、`check`。
内部代码按稳定职责拆分，不把每个动作做成单独脚本。

## 数据流

```text
外部来源
  -> sources.py 获取并生成 SkillSnapshot
  -> 当前 AI 读取 skill-taxonomy.md，给出分类和标签
  -> skills.py 调用 taxonomy.py 校验后修改中央技能库和登记
  -> ChangeSet 描述后续影响
  -> installation.py / docs.py / checks.py 收尾

MCP 上游与分发
  -> mcps.json 保存期望状态和锁定版本
  -> mcps.py 解析启动模板和凭据来源
  -> Codex / Claude 只保存 agents-kit mcp run <名称>
```

`SkillSnapshot` 是来源层与技能层之间的固定接口。`ChangeSet` 是业务修改与安装、
生成、体检之间的固定接口。两者都定义在 `models.py`。

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
| `scout.py` | 收藏索引的登记、来源定位和全文链接 | 获取来源内容、安装技能 |
| `mcps.py` | MCP 导入、启停、版本更新、运行和客户端同步 | 保存凭据值、管理 Skill |
| `installation.py` | 全局软链接和项目副本 | 修改技能正文 |
| `docs.py` | 纯渲染、write-if-changed、文档过期检查 | 修改事实状态 |
| `ui.py` | 本地网页服务和 Finder 桥接 | 修改技能或清册状态 |
| `checks.py` | 只读验证状态、依赖、引用、文档和安装 | 自动修复 |

依赖方向保持单向：

```text
入口 -> 业务模块 -> repository/models
skills/checks -> taxonomy 的确定性校验
checks -> docs 的纯渲染 API / installation 的只读计划
skills -> models 中的 SkillSnapshot
mcps -> repository 中的单一 MCP 清单
```

## 来源模型

`sources.json` 的每条记录包含：

- `provider`：来源适配器 ID。
- `locator`：provider 自己解释的定位数据。
- `content_mode`：`directory` 或 `skill_file`。
- `policy`：`review` 或 `pinned`。
- `resolved`：最近确认的 revision 和内容哈希。
- 可选 `source_name`：上游名称与本地名称不同时使用。

`review` 策略把检查结果分成三类：

- `unchanged`：上游相对上次同步版本没有变化；只有本地修改时也归入此类。
- `safe_update`：上游已变化，本地仍是上次同步版本，或本地已与上游一致；候选
  Skill 通过格式、引用和附件检查后直接同步。
- `review_required`：本地与上游相对上次同步版本都发生变化且内容不一致，或候选
  Skill 体检失败；保留本地版本并开 Issue 等待处理。

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

目录 `skills/<分类>/<技能名>` 表达唯一一级分类。`metadata.json` 保存标签，
`agents-kit.json` 保存 taxonomy 版本、分类边界、标签命名空间和中央词表。

添加技能的当前 AI 读取 `docs/skill-taxonomy.md` 后，根据主要用户目标和正常产出给出
分类与标签。代码不实现关键词分类器，只验证结构化结果。这样模型负责语义，脚本负责
不变量，新增来源不需要修改分类逻辑。

跨 Skill 引用以唯一技能名识别。检查器允许 `../<技能名>/SKILL.md` 这类逻辑引用跨越
分类目录，但目标技能必须存在；项目安装仍将依赖复制到同一个扁平 skills 目录。

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

写操作先完成来源解析和参数校验，再取得仓库锁。JSON、文本和单文件技能更新使用
临时文件加 `os.replace`；整目录安装使用同目录临时目录再替换。Git 负责历史恢复，
仓库不实现第二套事务或回滚系统。

安装层只删除自己能证明由本仓库管理的链接。遇到同名实体目录或外部链接时停止并报告，
不自动覆盖。

## 生成内容

`docs.py` 从事实状态生成：

- `docs/skills.md`
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

1. 技能固定放在 `skills/<分类>/<技能名>/SKILL.md`。
2. 技能名在全部分类中唯一。
3. metadata 必须覆盖全部技能，并与当前 taxonomy 版本一致。
4. 每个技能有一个 `role`、1–3 个 `focus`，全部标签来自中央词表且总数不超过 8。
5. active 和 sources 只能引用存在的技能。
6. 全局安装由 `active.txt` 决定，项目安装不写回中央状态。
7. 体检只报告问题，不修改仓库。
8. MCP 凭据值不得进入仓库或客户端配置；运行时再从声明的来源读取。
9. MCP 客户端同步不能删除同名但不受本仓库 launcher 管理的配置。
