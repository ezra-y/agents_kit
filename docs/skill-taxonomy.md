# Skill 分类与标签

本文件供添加、移动或重新标注 Skill 的 AI 按需读取。分类帮助用户按主要用途浏览，
标签用于区分同一大类里的具体能力。不要把全文复制进 `CLAUDE.md` 或系统提示词。

## 分类

每个 Skill 只有一个一级分类：

| ID | 含义 |
|---|---|
| `video` | 直接生成、拍摄、剪辑、包装或交付视频 |
| `ios` | 所有 iOS 专用的客户端、服务端、UI、设计、测试和平台工程 |
| `operations` | 宣传、增长、品牌、运营文案、内容及营销素材 |
| `frontend-uiux` | 非 iOS 的前端代码、界面、交互、视觉设计和设计系统 |
| `backend` | 非 iOS 专用的服务端、API、认证、数据和安全能力 |
| `engineering` | 跨平台的审查、测试、调试、架构、工具链和代码库维护 |
| `product` | 产品发现、需求、领域模型、PRD、原型决策、Issue 和 Triage |
| `academic` | 学术论文、科研证据、引用、学术写作、同行评审和发表工作流 |
| `research-office` | 通用信息检索、业务研究、分析及文档、表格、会议、消息和办公工作流 |
| `ai-building` | AI 应用、Agent、Skill、MCP、Hook 和 AI 工作流的构建与管理 |

按主要用户目标和正常产出分类，不按输入素材、上游仓库名称或次要能力分类。

三条强边界：

- iOS 专用能力统一进入 `ios`，不拆到前端、后端或通用工程。
- 只有直接产出视频才进入 `video`。视频研究产出运营内容时进入 `operations`；
  产出一般分析、字幕或摘要时进入 `research-office`。
- 以学术文献、科研证据、科研数据或学术发表为主要对象和产出的能力进入
  `academic`。通用数据分析、行业、市场、政策、新闻和产品研究按主要产出进入
  `research-office`、`product` 或 `operations`。

## 标签

标签回答“这个 Skill 在大类里具体做什么”，不能只重复一级分类。

- `role/*`：在工作中的角色，必须且只能有一个。
- `focus/*`：大类内部的具体能力，必须有 1–3 个。
- `platform/*`：服务或运行平台，可选。
- `stack/*`：框架、语言或工具，可选。
- `output/*`：主要产物，可选。

通常使用 4–6 个标签，最多 8 个。只标注 Skill 明确具备的能力。所有值必须来自
`agents-kit.json` 的中央词表；缺少必要词条时，先补充词表并说明它与现有词条的区别。

`role` 的选择：

| 值 | 使用场景 |
|---|---|
| `reference` | API、规范、索引或资料参考 |
| `guide` | 原则、模式和实现指导 |
| `builder` | 创建或修改代码、内容和其他产物 |
| `reviewer` | 审查、审计或改进已有产物 |
| `router` | 判断需求并路由到其他能力 |
| `workflow` | 编排有明确步骤的完整流程 |
| `researcher` | 搜索、采集、阅读和分析信息 |
| `integration` | 操作或连接外部平台、API 和本地工具 |

## 判断步骤

1. 阅读完整 `SKILL.md`，必要时查看 references 和 scripts 的文件名。
2. 写出这个 Skill 最常见的一句话产出。
3. 根据该产出选择唯一分类。
4. 选择一个 `role`，再用 `focus`、`platform`、`stack`、`output` 区分同类 Skill。
5. 检查中央词表，执行一条完整的 `skill import` 或 `skill metadata set` 命令。

交叉项示例：

| 情况 | 分类 | 原因 |
|---|---|---|
| 检索论文并产出文献综述 | `academic` | 主要对象和产出都属于学术研究 |
| 调研行业趋势并形成分析报告 | `research-office` | 产出是通用研究结果，不是学术成果 |
| 观看视频并输出字幕、摘要或分析 | `research-office` | 输入是视频，产出是研究结果 |
| 研究竞品视频并输出宣传文案 | `operations` | 最终产出服务运营 |
| 审查 iOS 服务端或 SwiftUI 界面 | `ios` | iOS 是强归属 |
| 为 App Store 优化关键词与宣传页 | `operations` | 产出是增长内容，不是 iOS 实现 |

## 命令

新技能在同一条命令里完成分类和标签：

```bash
agents-kit skill import "<来源>" \
  --category research-office \
  --tag role/researcher \
  --tag focus/video-analysis \
  --tag output/summary \
  --scope global \
  --description "<中文说明>" \
  --trigger "<触发方式>" \
  --recommendation 3
```

修改现有标签时，`--tag` 默认追加。需要替换完整标签集合时，同时使用
`--clear-tags` 和全部目标 `--tag`。

模型负责语义判断；仓库代码只验证分类、标签格式、中央词表、数量和完整性。
