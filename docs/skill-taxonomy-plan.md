# Skill 分类与标签计划

状态：待执行

## 目标

一级分类回答“这个 Skill 主要完成哪类工作”，标签回答“它在这个大类里具体做什么”。
每个 Skill 只有一个一级分类，交叉能力用标签表达。

分类需要语义判断，不建设关键词分类器。安装技能的 AI 读取 `SKILL.md` 后，在原有导入
命令中同时给出分类和标签；仓库代码只负责校验、保存、生成文档和更新 HTML。

## 一级分类

| ID | 展示名称 | 分类边界 |
|---|---|---|
| `video` | 视频制作 | 直接生成、拍摄、剪辑、包装或交付视频。只研究视频、提取字幕或总结视频不属于此类。 |
| `ios` | iOS | 所有 iOS 专用能力，包括客户端、服务端、UI、设计、测试和平台工程。 |
| `operations` | 运营与内容 | 宣传、增长、品牌、运营文案、文章、社交内容及营销素材。 |
| `frontend-uiux` | 前端与 UI/UX | 非 iOS 的前端代码、界面、交互、视觉设计和设计系统。 |
| `backend` | 后端 | 非 iOS 专用的服务端、API、认证、数据与安全能力。 |
| `engineering` | 通用工程 | 跨平台的代码审查、测试、调试、架构、工具链和代码库维护。 |
| `product` | 产品 | 产品发现、需求、领域模型、PRD、原型决策、Issue 与 Triage。 |
| `research-office` | 研究与办公 | 通用搜索、研究、分析，以及文档、表格、会议、消息和 Lark 工作流。 |
| `ai-building` | AI Building | Agent、Skill、MCP、Hook 和 AI 工作流的构建与管理。 |

按主要用户目标和常见产出分类，不按输入媒介或上游仓库名称分类。只有两条强边界：

- iOS 专用能力统一进入 `ios`，不拆到前端、后端或通用工程。
- 视频只有在产出视频时进入 `video`。研究视频后产出运营内容，进入 `operations`；
  产出一般分析、字幕或摘要，进入 `research-office`。

当前清册中的 `watch` 应从视频移到研究与办公。现有清册可能暂时没有纯视频制作 Skill，
允许 `video` 初始为空。`apple-aso` 属于运营；仅 macOS 的打包能力属于通用工程。

## 给模型的分类说明

实施时把下面这段作为唯一的分类提示，放入独立的 `docs/skill-taxonomy.md`，仅在导入、
改类和批量标注时读取。仓库规则只链接该文档，不复制全文。

```text
# 目标
阅读一个 Skill，为它选择一个一级分类和一组标签，让用户能看出它与同类 Skill 的区别。

# 分类
- video：直接生成、剪辑、包装或交付视频。
- ios：所有 iOS 专用的实现、服务端、UI、设计、测试和平台工程。
- operations：宣传、增长、品牌、运营文案、内容和营销素材。
- frontend-uiux：非 iOS 的前端代码及 UI/UX、视觉和设计系统。
- backend：非 iOS 专用的服务端、API、认证、数据和安全。
- engineering：跨平台的审查、测试、调试、架构、工具链和代码库维护。
- product：产品发现、需求、领域模型、PRD、原型决策、Issue 和 Triage。
- research-office：通用研究、分析及文档、表格、会议、消息和 Lark 工作流。
- ai-building：Agent、Skill、MCP、Hook 和 AI 工作流的构建与管理。

# 判断
按主要用户目标和正常产出选择唯一分类，不按输入素材分类。
iOS 专用能力统一归 ios。
视频研究不归 video：产出运营内容归 operations，其他研究产出归 research-office。
次要用途写入标签，不新增分类。

# 标签
必须选择一个 role/* 和 1–3 个 focus/*。
按实际能力选填 platform/*、stack/*、output/*。
通常使用 4–6 个标签，最多 8 个；不要用标签重复一级分类。
只使用中央词表中已有标签。确需新标签时，先补充词表。

# 输出
{"category":"分类 ID","tags":["role/...","focus/..."],"reason":"一句话说明主要产出"}
```

只保留少量交叉示例，用来校准边界：

| Skill 情况 | 分类 | 原因 |
|---|---|---|
| 观看视频并输出字幕、摘要或分析 | `research-office` | 输入是视频，产出是研究结果 |
| 研究竞品视频并输出宣传文案或营销脚本 | `operations` | 最终产出服务运营 |
| 审查 iOS 服务端或 SwiftUI 界面 | `ios` | iOS 是强归属 |
| 为 App Store 优化关键词与宣传页 | `operations` | 产出是增长与宣传，不是 iOS 实现 |

## 标签

标签采用 `命名空间/值`：

- `role/*`：Skill 在流程中的角色。必须且只能有一个。
- `focus/*`：一级分类内的具体能力。必须有 1–3 个。
- `platform/*`：服务或运行平台。可选。
- `stack/*`：框架、语言或工具。可选。
- `output/*`：主要产物。可选。

`role` 的中央词表为：

`reference`、`guide`、`builder`、`reviewer`、`router`、`workflow`、
`researcher`、`integration`。

其余标签也使用中央词表并收敛同义词。标签的目的不是再次写
`ios`、`backend` 等大类名称，而是区分同类 Skill 的角色、细分能力、技术和产出。
HTML 展示每个 Skill 的全部标签，不截断。

## 数据与命令

- 目录 `skills/<category>/<skill-name>` 继续表达一级分类。
- `metadata.json` 保存标签和 taxonomy 版本，不重复保存目录中已有的分类。
- `agents-kit.json` 保存 taxonomy 版本、分类定义、标签命名空间和中央词表。
- 分类理由只用于当次检查，不写入长期清册。

不新增公开脚本，继续使用一个 `agents-kit` 入口：

```bash
agents-kit skill import "<来源>" \
  --category research-office \
  --tag role/researcher \
  --tag focus/video-analysis \
  --tag output/summary \
  --scope global \
  ...
```

- `skill import` 接收分类和可重复的 `--tag`，一次完成入库、安装、文档与体检。
- `skill metadata set` 负责后续改标签。
- `skill list` 支持按分类和标签筛选。
- `check` 只做确定性校验：合法分类、中央词表、唯一 `role`、必需 `focus` 和数量上限。
- `docs build` 根据清册生成分类统计、标签索引和 HTML。

分类语义不写进 Python 条件分支。代码只验证模型给出的结构化结果，因此以后新增来源、
分类或标签时，不需要改一套关键词规则。

## 迁移步骤

1. 在 `agents-kit.json` 定义 taxonomy 和中央词表。
2. 扩展 metadata、CLI、检查器和 HTML 数据结构。
3. 当前 AI 按组读取 155 个 Skill，输出分类、标签和临时理由。
4. 一次校验全部结果，集中复核跨分类项，再移动目录和更新 metadata。
5. 重新同步全局链接，只生成一次文档和 HTML。
6. 运行单元测试、`agents-kit check`、文档幂等检查和 `git diff --check`。
7. 将本计划中的稳定规则落入 `docs/skill-taxonomy.md`，然后删除本计划。

批量迁移不是 155 次模型 API 调用。当前 AI 可以分组完成语义判断，脚本只负责批量应用
和验证。上游更新不自动重写人工确认过的分类和标签；能力描述发生实质变化时，由当前
AI 重新判断。

## 验收

- 155 个 Skill 全部且只属于一个合法分类。
- 每个 Skill 有且只有一个 `role`，有 1–3 个 `focus`，总标签不超过 8 个。
- 所有标签来自中央词表，没有同义词分裂。
- 一条 `skill import` 完成分类、标签、安装、文档生成和体检。
- HTML 展示全部标签，并支持分类、标签和全文筛选。
- 全局链接、来源记录、依赖关系在目录迁移后保持正确。
- 连续运行两次 `docs build`，第二次不产生文件变化。
- 全部测试、`agents-kit check` 和 `git diff --check` 通过。

## 提示词设计依据

Anthropic 的建议是使用最少的高信号上下文、直接语言和清晰分段，在观察到失败后再补充
规则或例子；不要先写一份覆盖所有边角情况的规则清单。Skill 编写指南也建议假设模型
具备通用判断力，只补充它不知道的仓库边界，并使用少量有代表性的例子。

- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [System prompts](https://platform.claude.com/docs/en/release-notes/system-prompts)
