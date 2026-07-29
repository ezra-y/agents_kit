# Skill 分类与标签计划

状态：待执行

## 目标

重新组织 Skill 清册，让一级分类回答“这项能力主要服务哪类工作”，标签回答
“它在这个大类里具体负责什么、面向什么平台、使用什么技术、产出什么”。

标签的目的不是重复一级分类，而是帮助用户快速区分同一大类中的相似技能。例如，
同属 iOS 的技能可以分别是 API 参考、实现指南、代码审查或界面构建。

本次改造不增加新的公开脚本，不接入额外的模型 API。安装技能的当前 AI 负责在同一条
导入命令中给出分类和标签；仓库脚本负责约束词表、保存结果、生成页面和检查完整性。

## 一级分类

每个技能只属于一个一级分类。交叉能力通过标签表达。

| ID | 展示名称 | 边界 | 当前初分 |
|---|---|---|---:|
| `video` | 视频 | 视频理解、字幕、脚本、生成、剪辑及视频工作流 | 1 |
| `operations` | 运营与内容 | 对外宣传、品牌、文章、Banner、海报、幻灯片、ASO 等内容生产 | 9 |
| `ios` | iOS / Apple 开发 | iOS、Swift、SwiftUI、UIKit 和 Apple 平台专用能力，包括少量 macOS 能力 | 43 |
| `frontend-uiux` | 前端与 UI/UX | Web 前端工程，以及非 iOS 的界面、交互、视觉和设计系统能力 | 41 |
| `backend` | 后端 | API、认证、安全、服务端和后端技术 | 4 |
| `engineering` | 通用工程 | 不绑定前后端或平台的调试、测试、架构和代码库维护 | 7 |
| `product` | 产品与需求 | 需求澄清、领域建模、PRD、原型、Issue 和 Triage | 8 |
| `research-office` | 研究与办公 | 搜索、研究、文档、会议、表格、消息和 Lark 办公工作流 | 30 |
| `ai-building` | AI Building | Agent、Skill、MCP、Hook 和 AI 工作流建设 | 12 |

当前 155 个技能都能进入以上分类。`product` 和 `engineering` 必须独立保留：
前者的主要产物是决策、规格和任务，后者的主要对象是代码质量与工程结构。

### 交叉项判定

- 视频媒介优先进入 `video`，研究或运营属性写入标签。
- iOS 专用的设计、测试和工程技能进入 `ios`，不进入 `frontend-uiux`。
- 宣传内容和增长资产进入 `operations`；产品界面和设计系统进入
  `frontend-uiux`。
- Agent、Skill 或 MCP 是主要操作对象时进入 `ai-building`；通用 API 和服务端
  能力进入 `backend`。
- 主要产物是规格、需求或任务时进入 `product`；主要产物是代码改动、测试或架构
  改进时进入 `engineering`。
- 无法由一级分类完整表达的次要用途必须写入标签，不为交叉项新增一级分类。

示例：

| 技能 | 一级分类 | 关键标签 |
|---|---|---|
| `watch` | `video` | `role/researcher`, `focus/video-understanding`, `output/transcript` |
| `apple-aso` | `operations` | `role/guide`, `platform/apple`, `focus/aso` |
| `frontend-design` | `frontend-uiux` | `role/guide`, `focus/ui-design`, `platform/web` |
| `build-mcp-app` | `ai-building` | `role/builder`, `focus/mcp-ui`, `platform/web` |
| `react-native-skills` | `frontend-uiux` | `role/guide`, `stack/react-native`, `focus/mobile-ui` |

## 标签模型

标签使用 `命名空间/值` 格式。通常每个技能使用 4–6 个标签；内容丰富时允许增加，
最多 8 个。HTML 展示全部标签，不截断为少数标签。

### `role/*`

每个技能必须且只能有一个 `role`，用于说明它如何参与工作：

| 标签 | 含义 |
|---|---|
| `role/reference` | API、规范、索引或资料参考 |
| `role/guide` | 提供原则、模式和实现指导 |
| `role/builder` | 创建或修改代码、内容或其他产物 |
| `role/reviewer` | 审查、审计或改进已有产物 |
| `role/router` | 判断需求并路由到其他技能或流程 |
| `role/workflow` | 编排一个有明确步骤的完整流程 |
| `role/researcher` | 搜索、采集、阅读和分析信息 |
| `role/integration` | 操作或连接外部平台、API 和本地工具 |

### 其他命名空间

- `focus/*`：大类内部的具体领域。每个技能至少一个，通常 1–3 个。例如
  `focus/frontend-engineering`、`focus/ui-design`、`focus/testing`、
  `focus/design-system`。
- `platform/*`：运行或服务的平台，通常 0–2 个。例如 `platform/apple`、
  `platform/web`、`platform/lark`。
- `stack/*`：明确的框架、语言或工具，通常 0–2 个。例如 `stack/swiftui`、
  `stack/react`、`stack/gsap`。
- `output/*`：主要产物，通常 0–2 个。例如 `output/code`、`output/report`、
  `output/article`、`output/image`、`output/slides`、`output/config`。

同义词必须收敛到中央词表。例如只保留 `focus/testing`，不能同时出现
`focus/test`、`focus/tests` 和 `focus/qa`。

### 边界展示示例

```text
swiftui
[参考] [Apple] [SwiftUI] [API]

guide-swiftui-performance-audit
[工作流] [Apple] [SwiftUI] [性能] [审计报告]

swiftui-pro
[审查] [Apple] [SwiftUI] [代码质量] [评审报告]

ios-ui-craft
[构建] [Apple] [SwiftUI] [界面设计] [代码]
```

一级分类相同，但 `role`、`focus` 和 `output` 直接说明了四个技能的边界。

## 数据模型

分类继续由 `skills/<category>/<skill-name>` 的目录表达，不在 metadata 中重复保存。
标签和分类来源写入 `metadata.json`：

```json
{
  "swiftui-pro": {
    "recommendation": 4,
    "description": "审查已有 SwiftUI 代码。",
    "trigger": "需要检查 SwiftUI 代码质量时使用。",
    "tags": [
      "role/reviewer",
      "platform/apple",
      "stack/swiftui",
      "focus/code-quality",
      "output/report"
    ],
    "classification": {
      "taxonomy_version": 1,
      "source": "agent"
    }
  }
}
```

`agents-kit.json` 保存：

- taxonomy 版本；
- 一级分类 ID、展示名称和边界说明；
- 标签命名空间和受控词表；
- 必填项、数量上限和同义词映射。

不保存模型的解释文本或主观置信度。标签是长期事实，分类理由只作为导入命令的临时
输出，避免 metadata 膨胀。

## 自动分类流程

### 新技能

技能安装通常由 Codex 或 Claude 发起。当前 AI 在读取来源后，已经需要填写中文说明和
触发方式，因此同时完成分类和标签，不需要额外模型调用。

导入命令扩展为：

```bash
agents-kit skill import "<来源>" \
  --category frontend-uiux \
  --tag role/reviewer \
  --tag focus/accessibility \
  --tag platform/web \
  --tag output/report \
  --scope global \
  ...
```

AI 分类时必须遵守：

1. 先确定主要用户意图和主要产物，再选择唯一一级分类。
2. 标签用于说明大类内部的细分位置，不得只重复分类名称。
3. 必须选择一个 `role` 和至少一个 `focus`。
4. 只标注技能明确具备的能力，不根据上游仓库名扩大能力范围。
5. 交叉能力保留一个主分类，其余信息写入标签。
6. 优先复用中央词表；缺少必要词条时先扩充词表，再导入技能。

### 手动导入

不建设独立的模型调用服务。手动导入时可以直接提供分类和标签；缺失标签时命令拒绝
完成全局安装，并输出所缺维度。以后确有频繁手动导入需求，再增加基于关键词的建议，
不在第一版提前建设规则引擎。

### 现有 155 个技能

安排一次 AI 批量标注：

1. 从现有清册生成只含名称、说明、触发方式、来源路径和资源文件名的输入。
2. 按当前目录和候选新分类分批，每批处理一组相关技能，让 AI 能同时比较相似项。
3. AI 输出统一 JSON 映射：技能名、一级分类、标签和临时分类理由。
4. 在修改仓库前，脚本校验 155 个技能全部覆盖、无重名、分类合法、标签合法。
5. 对跨分类或标签高度相似的技能进行第二轮集中复核。
6. 一次性移动目录并更新 metadata，最后只运行一次全局链接同步、文档生成和体检。

批量标注不是 155 次模型调用。当前任务中的 AI 可以按组读取和判断；模型只负责语义
判断，文件移动、JSON 更新和验证全部由确定性代码完成。

### 上游更新

上游内容更新不自动覆盖现有标签。更新后若名称或 description 发生显著变化，体检生成
“建议重新分类”警告，由当前 AI 复核。人工或 AI 已确认的标签保持稳定。

## CLI 与模块调整

不新增公开脚本，继续使用 `agents-kit`：

- `skill import`：增加可重复的 `--tag`。
- `skill metadata set`：增加 `--tag`、`--clear-tags`。
- `skill list`：支持按 category 和 tag 筛选。
- `check`：验证分类、标签命名空间、受控词表、唯一 role、focus 和数量上限。
- `docs build`：生成分类统计、标签索引和 HTML 数据。

分类与标签校验逻辑放在一个内部 taxonomy 模块中，不把规则散落到 CLI、文档生成器和
检查器。

## HTML 展示

- 每个技能行展示全部标签，允许自然换行，不省略。
- `role` 使用最明显的视觉样式，其余命名空间使用稳定但不同的样式。
- 支持一级分类筛选、标签筛选和全文搜索。
- 标签筛选按命名空间分组，避免形成无结构的标签云。
- 详情区继续展示中文说明、触发方式、来源、推荐指数和 Finder 操作。
- 同一分类内，根据共享的 `focus`、`platform` 和 `stack` 计算相似技能。
- 相似技能区域同时展示不同的 `role` 和 `output`，帮助用户理解边界，不额外保存
  手写关系。
- 桌面和窄屏下都必须完整显示标签，不能覆盖名称、说明和操作按钮。

## 实施顺序

1. 在 `agents-kit.json` 定义 taxonomy、一级分类和标签词表。
2. 扩展 metadata 读写、CLI 参数和 taxonomy 校验。
3. 更新检查器、文档生成和 HTML 标签筛选。
4. 让 AI 对现有 155 个技能生成完整分类与标签映射。
5. 校验映射后一次性迁移目录和 metadata。
6. 收敛全局软链接，重新生成文档与 HTML。
7. 运行代码测试、文档幂等检查、完整体检和四类客户端路径检查。
8. 将最终稳定规则合并进 `docs/architecture.md`，完成后删除本执行计划，避免长期
   维护两份架构说明。

## 验收标准

- 155 个技能全部且只属于一个合法一级分类。
- 每个技能有且只有一个 `role`，至少一个 `focus`，通常 4–6 个、最多 8 个标签。
- 全部标签来自中央词表，没有同义词分裂和重复标签。
- 一条 `skill import` 命令能同时完成入库、分类、标签、安装、文档生成和体检。
- HTML 展示所有标签，并能按分类和任意标签筛选。
- 相似技能能根据标签自动形成可理解的对照。
- `active.txt`、`sources.json` 和技能依赖关系不因目录迁移丢失。
- 全局软链接与新目录一致，不保留指向旧分类的链接。
- 连续运行两次 `docs build`，第二次不产生文件变化。
- 全部单元测试、`agents-kit check` 和 `git diff --check` 通过。

