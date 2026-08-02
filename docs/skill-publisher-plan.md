# Skill 发布助手实现规划

创建时间：2026-08-02 16:13:29 +0800  
官方来源核对时间：2026-08-02  
文档性质：实现规划，不代表对应平台当前仍保持相同发布方式

本文规划一个轻量、通用的 Agent Skill 发布助手。它负责检查一份已经可以运行的
Skill，调用平台官方工具完成可自动化的发布，协助处理必须登录或审核的渠道，并在
最后验证公开结果。

具体平台当前如何操作，见
[Agent Skill 发布平台与操作指南](skill-publishing.md)。本文只定义自动化系统应该
怎么写，不复制各平台的完整操作步骤。

## 一、目标

用户应该能够用一句自然语言开始：

> 把这个 Skill 发布到核心平台：`/path/to/my-skill`

发布助手完成：

1. 找到 Skill、Git 仓库、远程地址、版本和当前提交；
2. 按 Agent Skills 规范和目标平台规则做只读检查；
3. 在当前任务中重新核对每个目标平台的官方来源和本机 CLI；
4. 向用户展示将要发布的平台、版本和外部修改；
5. 调用官方 CLI 或进入平台官方提交入口；
6. 区分“已提交”“审核中”“已发布”“已索引”和“验证失败”；
7. 返回公开地址、版本、提交 ID、阻塞原因和本地回执路径；
8. 重复运行时先读取远端事实，避免重复发布。

### 不做什么

- 不创建新的公共 Skill 注册中心。
- 不重写 GitHub、ClawHub 等平台已经提供的发布器。
- 不绕过验证码、OAuth、条款确认、组织权限或人工审核。
- 不把网站按钮位置和临时页面文案写成长期核心逻辑。
- 不保存密码、Cookie、API Key 或 OAuth Token。
- 不把本地“命令执行成功”直接写成“已经公开发布”。
- 不自动修改待发布 Skill 的正文、许可证或版本；需要修改时先展示差异。

## 二、产品边界

“发布到多个平台”和“安装到多个 Agent”是两件事：

- 发布解决发现、审核、版本和公开页面。
- 安装解决把 Skill 放入 Claude Code、Codex、Cursor 等客户端目录。

本 Skill 只负责前者。安装与跨 Agent 同步继续交给 `agents-kit`、`skills`、
`skild` 等已有工具。

平台分为四类：

| 类型 | 例子 | 自动化边界 |
|---|---|---|
| 官方 CLI 发布 | GitHub、ClawHub | 可以完整自动化，但先 `--dry-run` |
| GitHub 导入 | AgentSkill.sh | 可以准备和辅助提交，发布后必须查公开页 |
| 自动索引 | skills.sh | 没有“上传”动作，只触发安装并检查索引 |
| 登录与审核 | Claude、OpenAI | 自动准备材料和验证，表单、授权与审核按官方入口处理 |

## 三、正常用户流程

### 1. 识别输入

接受以下输入：

- 单个 Skill 目录；
- 包含多个 Skill 的仓库；
- GitHub 仓库地址和可选子目录；
- 上一次发布运行的 ID，用于继续处理。

如果一个仓库包含多个 Skill，只让用户选择一次，不猜测发布范围。

### 2. 生成只读发布计划

先输出：

- 识别出的 Skill；
- 源仓库、分支、提交 SHA 和工作区是否干净；
- 建议版本；
- 目标平台；
- 各平台将执行的动作；
- 需要用户登录、授权或接受条款的环节；
- 已经远端存在、因此会跳过的项目。

计划阶段不创建 Release、不上传文件、不提交表单。

### 3. 实时核对官方来源

每个会产生外部修改的平台都在当前任务中完成：

1. 打开该平台登记的官方发布文档或官方控制台入口；
2. 对 CLI 平台运行 `--version` 和对应命令的 `--help`；
3. 核对命令、必要参数、认证方式、授权条件、版本规则和发布许可证；
4. 将核对时间、CLI 版本、来源 URL 和结果写入本次回执；
5. 官方文档与适配器不一致时停止该平台发布，标记为“适配器需更新”。

HTTP 200 只能证明页面存在，不能证明发布规则没有变化。规则核对需要 Agent 读取
官方页面；脚本只负责可重复的结构和命令检查。

### 4. 一次确认

把所有外部修改汇总后只确认一次。确认内容应使用人话：

> 将为 `my-skill` 创建 GitHub `v1.2.0` Release，并向 ClawHub 发布
> `1.2.0`。Claude 只准备并打开官方提交页，不会替你接受条款。

用户改变目标平台时重新生成计划。

### 5. 发布

按依赖顺序执行：

1. GitHub 源码和 Release；
2. 依赖 GitHub 地址的平台；
3. 独立注册表；
4. 审核型平台；
5. 自动索引检查。

每个平台执行完立即保存结果。中途退出后可以从最后一个已确认状态继续。

### 6. 验证

发布命令结束后读取平台远端状态：

- GitHub：仓库、tag、Release 和源提交；
- ClawHub：公开条目、版本、源提交和扫描状态；
- GitHub 导入平台：公开 Skill 页面；
- 审核型平台：提交 ID 和审核状态；
- 自动索引平台：公开索引页和安装命令。

只有公开地址可访问且身份、Skill、版本或提交能够对应时，状态才是 `verified`。

## 四、建议目录结构

```text
skill-publisher/
├── SKILL.md
├── scripts/
│   ├── publish.py
│   ├── preflight.py
│   ├── state.py
│   ├── source_check.py
│   ├── verify.py
│   └── adapters/
│       ├── base.py
│       ├── github.py
│       ├── clawhub.py
│       ├── github_import.py
│       ├── auto_index.py
│       └── reviewed_form.py
├── assets/
│   └── platforms.json
├── references/
│   ├── platform-maintenance.md
│   └── security-and-credentials.md
└── evals/
    └── evals.json
```

### 文件职责

`SKILL.md`

- 只写触发条件、正常流程、何时读取参考文件和如何向用户报告。
- 不堆放容易变化的平台按钮、URL 参数和完整 CLI 帮助。
- 控制在 500 行以内。

`publish.py`

- 一个用户入口；
- 解析 `plan`、`publish`、`resume`、`verify`；
- 调用核心模块和平台适配器；
- 不直接实现平台细节。

`preflight.py`

- 识别 Skill、仓库和版本；
- 执行通用结构、许可证、文件引用和敏感信息检查；
- 调用目标平台自己的只读校验。

`state.py`

- 保存运行计划、平台事件和最终回执；
- 根据远端状态防止重复发布；
- 不保存认证凭据。

`source_check.py`

- 打开或请求官方来源；
- 记录来源 URL、核对时间和本机 CLI 版本；
- 检测命令是否仍存在；
- 不尝试仅凭页面哈希判断语义变化。

`verify.py`

- 把平台返回转换成统一状态；
- 检查公开 URL、版本、提交 SHA 和扫描或审核状态；
- 生成简明报告和机器可读回执。

`adapters/`

- 每个平台类型实现相同接口；
- 同类平台尽量共用适配器，不为每个表单复制整套流程；
- 平台特有逻辑只放在对应模块。

`platforms.json`

- 保存平台能力和官方来源；
- 不保存 Token，也不保存易失效的网页选择器。

## 五、适配器接口

每个适配器实现五个动作：

```python
discover(context) -> RemoteState
preflight(context) -> CheckResult
plan(context) -> PlannedAction
publish(context, confirmation) -> PublishResult
verify(context, result) -> VerificationResult
```

含义：

- `discover`：先读远端，判断相同版本或内容是否已经存在。
- `preflight`：只读检查目标平台是否接受当前内容。
- `plan`：生成用户能看懂的外部修改说明。
- `publish`：只执行已经确认的动作。
- `verify`：独立读取远端结果，不相信 `publish` 的本地返回。

网页审核平台的 `publish` 可以返回 `manual_handoff`，内容包括官方入口、已准备好的
字段、尚需用户完成的动作和恢复运行的方法。它不能伪造一个成功状态。

## 六、平台登记结构

`platforms.json` 建议保存：

```json
{
  "schema_version": 1,
  "platforms": {
    "github": {
      "label": "GitHub",
      "adapter": "github",
      "mode": "cli",
      "official_sources": [
        "https://cli.github.com/manual/gh_skill_publish"
      ],
      "cli_probe": [
        "gh --version",
        "gh skill publish --help"
      ],
      "live_recheck_before_mutation": true
    }
  }
}
```

正式实现时再补 JSON Schema。所有 URL 必须指向平台官方域名、官方组织仓库或官方
控制台。社区项目另放“设计参考”，不能作为发布规则的唯一依据。

## 七、状态与防重复

### 远端优先

本地状态只用于恢复运行，平台远端才是事实源。每次发布前都重新执行 `discover`。

### 幂等键

每个动作使用：

```text
platform + repository + skill_slug + version + source_commit
```

作为幂等键。同一键已经在远端存在时：

- 内容一致：跳过上传，直接重新验证；
- 版本相同但内容不同：停止并要求改版本；
- 本地回执存在但远端不存在：把回执降为 `unknown`，不得跳过。

### 统一状态

```text
planned
blocked
submitted
pending_review
published
indexed
verified
rejected
unknown
```

`submitted`、`pending_review`、`published`、`indexed` 和 `verified` 不互相混用。

### 状态保存位置

默认不向待发布仓库写过程文件：

```text
$SKILL_PUBLISHER_HOME/
└── repositories/<repo-key>/
    ├── latest.json
    └── runs/<timestamp>-<skill>-<version>/
        ├── plan.json
        ├── events.ndjson
        ├── receipt.json
        └── report.md
```

未设置 `SKILL_PUBLISHER_HOME` 时，macOS/Linux 使用
`$XDG_STATE_HOME/skill-publisher`，没有该变量时使用
`~/.local/state/skill-publisher`。这样不会污染 Skill 仓库，也不会在 Skill
更新时丢失记录。

## 八、发布前检查

通用检查：

- 存在合法的 `SKILL.md`；
- `name` 与目录一致；
- `description` 同时说明能力和触发场景；
- 文件引用存在；
- README、许可证、图标和安装命令符合发布目标；
- 没有 API Key、私钥、Cookie、真实个人路径和内部报告；
- Git 远程地址、当前提交和工作区状态明确；
- 发布包不包含缓存、工作区、测试输出或未授权材料；
- 语义化版本有效；
- 目标平台许可证与仓库许可证没有冲突。

优先调用官方校验器：

- Agent Skills：`skills-ref validate`；
- GitHub：`gh skill publish --dry-run`；
- Claude：`claude plugin validate <path>`；
- ClawHub：`clawhub skill publish <path> --dry-run --json`。

没有安装某个校验器时明确报告，不自行伪造“通过”。

敏感信息检查只能降低风险，不能给出“绝对安全”的保证。第一版使用少量明确规则，
后续再评估是否调用 `gitleaks` 等成熟工具，不手写庞大的安全扫描器。

## 九、首批平台

### 第一阶段：完整自动化

#### GitHub

- 调用官方 `gh skill publish`。
- 先运行 `--dry-run`。
- 发布后通过 GitHub API 验证 Release、tag、Topics 和提交。
- 不自动运行会改文件的 `--fix`；先展示差异。

#### ClawHub

- 调用官方 `clawhub skill publish`。
- 使用 `--dry-run --json` 获取机器可读计划。
- 利用平台内容指纹避免重复上传。
- 发布后核对版本、源提交和扫描状态。
- 发布前提示 ClawHub 当前规定的许可证条件。

### 第二阶段：辅助发布

#### AgentSkill.sh

- 根据官方页面准备 GitHub 仓库或 `SKILL.md` 地址。
- 优先复用已有导入结果和每日同步。
- 没有官方稳定发布 API 时，通过浏览器协助提交，不把页面选择器编入核心脚本。
- 最终以公开 Skill 页面为准。

#### skills.sh

- 不实现不存在的“上传”命令。
- 验证 GitHub Skill 可由官方 `skills` CLI 安装；
- 必要时执行一次真实安装以触发匿名索引；
- 查询公开详情页，状态记为 `indexed`，不是 `published`。

### 第三阶段：审核型平台

#### Claude

- 先运行官方 `claude plugin validate`。
- 通过 Anthropic 当前官方 Console 或 claude.ai 表单提交社区目录审核。
- 保存提交记录和审核状态。
- 只有社区目录出现条目并可以安装时才标记 `verified`。

#### OpenAI

- 只使用 OpenAI 官方控制台和官方文档。
- 当前官方公开文档未提供稳定的批量发布 API，因此第一版只做材料准备、登录态下的
  浏览器协助和结果验证。
- 身份审核与 Skill 内容审核分别记录。
- 官方入口、字段或产品形态改变时，先更新适配器再继续。

### 后续平台

Skild、SkillsMD、verified-skill 和其他长尾目录按真实用户需求增加。只有满足以下
条件才进入核心适配器：

- 有持续可访问的官方入口；
- 能明确验证发布结果；
- 维护价值高于账号、OAuth 和页面变化成本；
- 不要求把凭据保存在 Skill 中。

## 十、官方来源登记

以下是 2026-08-02 的核对结果。执行发布时仍需重新打开对应来源。

| 对象 | 官方来源 | 本次确认的用途 | 执行前重查 |
|---|---|---|---|
| Agent Skills 规范 | <https://agentskills.io/specification> | 目录、frontmatter、命名和校验规则 | 字段、长度、实验字段 |
| GitHub CLI | <https://cli.github.com/manual/gh_skill_publish> | `gh skill publish`、`--dry-run`、`--fix`、`--tag` | 命令、目录发现、修改行为 |
| GitHub CLI 发布版本 | <https://github.com/cli/cli/releases> | 判断本机 CLI 是否过旧 | 本机版本和最新稳定版 |
| Claude Skill 与插件 | <https://code.claude.com/docs/en/plugins> | 插件结构、校验、社区目录提交入口 | 提交入口、权限、校验命令 |
| Claude Marketplace | <https://code.claude.com/docs/en/plugin-marketplaces> | `marketplace.json` 和分发规则 | Schema、版本和目录规则 |
| Claude 提交控制台 | <https://platform.claude.com/plugins/submit> | 个人作者社区目录提交 | 登录后的字段和审核状态 |
| ClawHub CLI | <https://github.com/openclaw/clawhub/blob/main/docs/cli.md> | 发布、同步、指纹、JSON 和扫描 | CLI 版本、参数、许可证 |
| ClawHub 发布规则 | <https://github.com/openclaw/clawhub/blob/main/docs/publishing.md> | 所有权、审核和发布条件 | 许可证、所有权、审核 |
| AgentSkill.sh | <https://agentskill.sh/submit> | GitHub 导入、每日同步、Webhook | 是否出现 API、登录要求 |
| skills.sh | <https://skills.sh/docs> | 安装遥测驱动的索引机制 | 索引规则、CLI 和公开 URL |
| skills CLI | <https://github.com/vercel-labs/skills> | 安装、验证可发现性 | 命令和遥测说明 |
| OpenAI Plugins | <https://platform.openai.com/plugins> | 官方登录控制台入口 | 产品入口、提交方式、审核状态 |

### 当前本机工具快照

该快照只用于说明规划时的环境，不能替代未来运行时核对：

| 工具 | 2026-08-02 实测版本 | 实测方式 |
|---|---:|---|
| GitHub CLI | `2.93.0`，发布于 2026-05-27 | `gh --version` |
| `gh skill publish` | 命令存在 | `gh skill publish --help` |
| ClawHub CLI | `0.23.1` | `npx clawhub --cli-version` |
| ClawHub 发布命令 | 支持 `--dry-run`、`--json` 和源提交字段 | `npx clawhub skill publish --help` |

### 来源可信度顺序

1. 平台官方规范或产品文档；
2. 本机已安装官方 CLI 的 `--help`；
3. 平台官方组织的源码仓库和 Release；
4. 登录后的官方控制台；
5. 社区实现，仅用于设计参考。

来源冲突时，先停止会产生外部修改的动作。不能用博客或旧回执覆盖当前官方规则。

## 十一、设计参考

这些项目可以借鉴实现，但不是平台规则的事实源：

| 项目 | 可借鉴部分 | 不直接采用的原因 |
|---|---|---|
| [Enterprise Crew publish-skill](https://github.com/h-mascot/Enterprise-Crew-skills/blob/main/publish-skill/SKILL.md) | 脱敏、GitHub 与 ClawHub 编排、远端验证和发布回执 | 绑定作者自己的仓库和 SuperAda |
| [Agent Skill Creator](https://github.com/FrancyJGLisboa/agent-skill-creator) | Skill 校验、跨客户端安装和团队 Git 注册表 | 重点是创建与安装，不是跨广场发布 |
| [Skild](https://github.com/Peiiii/skild) | 注册表 CLI、版本和跨客户端同步 | 只发布到自己的注册表 |
| [Vercel skills](https://github.com/vercel-labs/skills) | Git 来源解析、Skill 发现和多客户端路径 | 没有跨广场发布 |

采用原则：优先调用其稳定 CLI 或学习数据模型，不复制绑定特定作者环境的路径和
规则。

## 十二、失败与恢复

常见失败统一处理：

| 情况 | 行为 |
|---|---|
| 未登录 | 保存计划，给出官方登录命令或入口 |
| 需要验证码或接受条款 | 转为 `manual_handoff`，完成后继续验证 |
| 官方文档与适配器不一致 | 标记 `adapter_review_required`，停止该平台 |
| 网络中断 | 保存已完成平台，重试前先查询远端 |
| 相同版本不同内容 | 阻止覆盖，要求新版本 |
| 已提交但没有公开条目 | 记录 `submitted` 或 `pending_review` |
| 公开页存在但版本不符 | 记录验证失败，不重复提交 |
| 本地回执与远端冲突 | 以远端为准并保留冲突事件 |

## 十三、输出规范

给用户的最终回答保持简短：

```text
发布对象：my-skill 1.2.0
源提交：abc1234

GitHub：已验证
ClawHub：已验证
Claude：已提交，等待审核
skills.sh：已索引

公开地址：...
本地回执：...
需要处理：...
```

`receipt.json` 至少包含：

- 运行 ID、开始与结束时间；
- Skill 名、版本、仓库、源提交；
- 发布目标和幂等键；
- 官方来源核对记录；
- 本机 CLI 版本；
- 每个平台的计划、命令结果、远端状态和公开 URL；
- 用户需要完成的后续动作；
- 错误和恢复点。

日志中对环境变量值、Token、Cookie 和认证头做脱敏。

## 十四、实现阶段

### 阶段一：只读内核

- 建立 `platforms.json` 和 Schema；
- 实现 Skill/仓库识别；
- 实现通用 preflight；
- 实现状态目录、事件日志和报告；
- 实现 `plan` 与 `verify`，不发布。

完成标准：对已有两个公开 Skill 能生成准确计划，并识别其远端现状。

### 阶段二：官方 CLI

- 接入 GitHub；
- 接入 ClawHub；
- 实现 `--dry-run`、一次确认、发布、远端验证和重复运行跳过。

完成标准：同一次发布重复运行不会产生第二个版本；本地回执删除后也能通过远端
发现已有发布。

### 阶段三：辅助渠道

- 接入 AgentSkill.sh；
- 接入 skills.sh；
- 接入 Claude 社区目录的校验、材料准备和审核跟踪；
- 为 OpenAI 保留官方控制台适配器，不假设未公开 API。

完成标准：每个平台都能准确区分提交、审核、发布、索引和验证状态。

### 阶段四：评测与发布

- 补齐单元测试、集成夹具和 Skill eval；
- 用真实公开 Skill 做一轮有意义的版本更新；
- 检查耗时、失败恢复和报告清晰度；
- 完善中英文 README；
- 通过 `agents-kit` 入库、安装、体检、提交和发布。

## 十五、测试与验收

### 单元测试

- Agent Skills 名称与目录规则；
- 单 Skill 与多 Skill 仓库发现；
- 平台配置 Schema；
- 幂等键；
- 状态迁移；
- 敏感字段脱敏；
- CLI 输出解析；
- 公开 URL 规则。

### 集成测试

使用固定夹具模拟：

- 首次发布；
- 相同提交重复运行；
- 相同版本内容冲突；
- CLI 缺失；
- CLI 参数变化；
- 登录失效；
- 审核中；
- 发布成功但公开页尚未同步；
- 中途退出后恢复。

CI 默认只跑 dry-run、模拟服务器和只读远端查询，不向公共注册表制造测试条目。

### Skill eval

至少覆盖：

1. “把这个单 Skill 仓库发布到核心平台。”
2. “这个仓库有三个 Skill，只发布其中一个。”
3. “继续上次中断的发布，不要重复提交。”
4. “只检查现在各平台是否真的已经公开。”
5. “官方 CLI 更新后，旧命令已经不匹配。”

### 正式验收标准

- 一句话可以开始，非必要信息不反复询问；
- 所有外部修改在一次清晰确认后发生；
- 不保存凭据，不污染待发布仓库；
- 每次外部发布前都有本次官方来源核对记录；
- 官方来源变化时停止对应适配器，不带着旧规则继续；
- GitHub 和 ClawHub 支持 dry-run 与机器可读结果；
- 相同发布重复运行不产生重复版本；
- 中途退出后可以恢复；
- 最终报告中的每个“已发布”都有远端证据；
- 平台失败不影响已经成功的平台，也不会丢失记录；
- Skill 本身保持轻量，确定性工作由 Python 完成，平台官方工具负责实际发布。

## 十六、首版取舍

首版不做“全平台”。先把 GitHub、ClawHub、AgentSkill.sh、skills.sh 和 Claude
做扎实，OpenAI 保留官方入口和状态跟踪。长尾平台只有在出现真实发布需求时才加。

这样维护成本主要来自少量适配器，不会因为十几个低价值表单变化而频繁重写整个
Skill。
