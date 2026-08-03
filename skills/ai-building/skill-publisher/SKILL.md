---
name: skill-publisher
description: 将一个或多个 Agent Skill 发布、更新或核验到 GitHub、ClawHub、AgentSkill.sh、skills.sh、Claude 社区目录和 OpenAI Plugins。用于用户提出“发布 Skill”“把 Skill 上架到各个平台”“更新已发布版本”“检查是否真的公开”“继续上次中断的发布”或需要跨平台发布回执时。先读取当前官方来源和本机 CLI，再执行一次确认、逐平台发布、远端验证和可恢复记录；不要把跨 Agent 安装误当成跨平台上架。
---

# Skill 发布

把 GitHub 当作源码事实源，把注册表当作版本与发现渠道，把审核目录当作信任渠道。
本 Skill 负责发布编排，不重写平台自己的发布器。

## 输入

至少需要：

- Skill 目录、`SKILL.md` 或包含 Skill 的 Git 仓库；
- 目标平台，未指定时使用 `core`；
- 版本，首次发布通常为 `1.0.0`，更新时根据实际变更建议新版本。

目标配置：

- `core`：GitHub、ClawHub、AgentSkill.sh、skills.sh；
- `official`：`core` 加 Claude 和 OpenAI；
- 也可以点名一个或多个平台。

一个仓库发现多个 Skill 时，只问一次要发布哪些；当前脚本每个运行处理一个 Skill。
GitHub 的 Release 和 tag 作用于整个仓库，ClawHub 等目录只处理本次选中的 Skill。
多 Skill 仓库的计划必须把这个范围差异说清楚。

## 正常流程

以下 `<skill-dir>` 指向本文件所在的 Skill 目录。先解析为绝对路径，不依赖用户当前
工作目录。

### 1. 创建只读计划

```bash
python3 <skill-dir>/scripts/publisher.py plan /path/to/skill \
  --version 1.0.0 \
  --target core \
  --clawhub-owner <handle>
```

读取命令返回的 `run_dir` 和 `report.md`。计划会记录：

- Skill 名、内容指纹和版本；
- 本发布器的内容指纹；
- GitHub 远程地址、提交 SHA、分支和脏工作区；
- 通用检查结果；
- 各平台 dry-run、远端已有状态和外部修改；
- 唯一运行 ID。

存在 blocker 时先处理 blocker，再创建新计划。脏工作区属于 blocker，因为 GitHub
可能发布已提交内容，而目录型平台可能读取本地内容。不要在发布命令中临时改 Skill。

### 2. 核对当前官方来源

```bash
python3 <skill-dir>/scripts/publisher.py source-check /path/to/run
```

脚本只检查官方 URL 是否可访问，以及当前 CLI 的 `--version`、`--help` 是否仍能
运行。`401`、`403` 和 `429` 只说明入口存在但访问受限，不作为地址失效；随后必须
用已登录浏览器读取。脚本不能判断文档含义有没有变化。

随后读取 `plan.json` 中每个平台的 `official_sources`，在当前任务中打开这些页面，
对照：

- 发布命令和必要参数；
- 认证方式与权限；
- 版本、目录和包结构；
- 许可证与条款；
- 发布后的查询或审核方式。

确认适配器仍符合官方规则：

```bash
python3 <skill-dir>/scripts/publisher.py review-sources /path/to/run \
  --platform github \
  --status current \
  --note "官方文档与本机 CLI 均与适配器一致"
```

每个平台分别记录。官方规则已经变化时使用 `--status changed`，停止该平台发布，
说明变化和需要修改的适配器。核对结果六小时内有效；超过时限要重新检查和阅读。
不要用旧回执或社区文章覆盖官方来源。

维护平台登记时读取
[platform-maintenance.md](references/platform-maintenance.md)。

### 3. 一次确认

把 `report.md` 中所有外部修改合并成一句人话，只问一次。例如：

> 将为 `sample-skill` 创建 GitHub `v1.2.0` Release，并向 ClawHub 发布
> `1.2.0`；AgentSkill.sh 需要打开官方导入页。是否开始？

确认后使用报告中的准确运行 ID：

```bash
python3 <skill-dir>/scripts/publisher.py publish /path/to/run \
  --confirm <run-id>
```

`--confirm` 不匹配、通用检查有 blocker、源文件、Git 提交或发布器在计划后发生
变化，或任一目标平台没有仍在有效期内的 `source-review=current` 时，脚本拒绝
发布。

### 4. 处理辅助渠道

脚本对没有稳定官方发布 API 的平台返回 `manual_handoff`：

- 打开返回的官方入口；
- 复用用户当前已登录会话；
- 填写脚本准备的仓库、Skill 和版本信息；
- 登录、授权、验证码和条款按平台正常流程处理；
- 保存提交 ID 或审核状态；
- 不把“表单已提交”写成“已经公开”。

用 `record` 把人工平台返回的事实写入同一份回执：

```bash
python3 <skill-dir>/scripts/publisher.py record /path/to/run \
  --platform claude \
  --status pending_review \
  --submission-id <id> \
  --note "官方入口已接收，当前等待审核"
```

状态只能记录为 `submitted`、`pending_review`、`published` 或 `rejected`。
有公开页面时补 `--public-url <url>`，随后运行 `verify`。不要手工记录 `verified`；
该状态只能由远端页面验证产生。

不要把网页按钮坐标、临时 CSS 选择器或验证码处理写入 Skill 核心代码。

### 5. 远端验证

```bash
python3 <skill-dir>/scripts/publisher.py verify /path/to/run
```

验证以远端为准：

- GitHub：Release、tag 和源提交；
- ClawHub：精确版本和扫描状态；
- AgentSkill.sh：公开详情页；
- skills.sh：公开索引页；
- Claude、OpenAI：官方提交状态或公开目录，不从历史操作推断。

状态含义：

- `submitted`：平台收到提交；
- `pending_review`：等待审核；
- `published`：版本存在，但还缺最终验证或安全结果；
- `rejected`：平台明确拒绝了本次提交；
- `indexed`：聚合目录已索引；
- `verified`：公开地址、Skill 身份和版本或提交已经对应；
- `version_conflict`：同版本指向不同内容，必须使用新版本；
- `unknown`：远端事实不足，不能重复提交。

### 6. 中断后继续

```bash
python3 <skill-dir>/scripts/publisher.py resume /path/to/run
```

恢复时先运行 `verify`。本地回执只帮助定位工作，远端平台才是事实源。即使回执
缺失，也先查询远端版本和提交，不能直接重发。

## 输出

每次运行保存在用户状态目录，不写入待发布仓库：

```text
<state-home>/repositories/<repo>/runs/<run-id>/
├── plan.json
├── events.ndjson
├── receipt.json
└── report.md
```

最终只向用户汇报：

- Skill、版本和源提交；
- 各平台的真实状态；
- 已验证的公开地址；
- 提交 ID 或明确阻塞原因；
- 本地回执绝对路径；
- 仍需用户完成的动作。

不要把 CLI 全量输出、检查报告或内部过程文件导入目标 Skill 仓库。

## 安全与边界

1. 发布前检查高置信度凭据、私钥、个人绝对路径、断链、外部符号链接和异常大包。
2. Token、Cookie 和认证头不进入命令参数、日志、回执或 Skill 文件。
3. 不自动运行 `gh skill publish --fix`；它会修改文件，先展示差异。
4. 不覆盖已存在的同版本不同内容。
5. 不绕过登录、组织权限、验证码、条款和审核。
6. 单个平台失败后保存当前结果；其他已成功平台不回滚，也不丢记录。
7. 社区项目只能作为设计参考，平台规则只认官方文档、官方 CLI 和官方控制台。
