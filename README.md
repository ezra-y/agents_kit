# agents_kit

我的 agent 配置库。技能 **153** 个 · 常驻 **64** 个 · 有上游可自动同步 **130** 个。

完整清册（每个技能的详细说明 + 怎么触发 + 使用次数）：[docs/index.html](docs/index.html)

## 快速上手

```bash
git clone <本仓库> ~/agents_kit
cd ~/agents_kit && ./scripts/link.sh
```

`link.sh` 把 `active.txt` 里列出的技能**软链接**到 `~/.claude/skills` 和 `~/.agents/skills`。
之后只需 `git pull`，所有已装技能自动变成最新 —— 因为是软链不是拷贝。

## 常用命令

| 场景 | 命令 |
|---|---|
| 同步最新 | `git pull` |
| 加新技能 | `python scripts/add.py <github 链接>` |
| 改常驻名单 | 编辑 `active.txt` 后跑 `./scripts/link.sh` |
| 项目里临时要一批 | `./scripts/pull.sh <分类>` |
| 检查有没有坏掉 | `python scripts/doctor.py` |
| 跟上游对齐 | 不用管，GitHub Action 每天自动跑 |

## 目录

| 目录 | 装到哪 | 放什么 |
|---|---|---|
| `skills/` | `~/.claude/skills` + `~/.agents/skills` | 技能，按主题分目录 |
| `rules/` | `~/.claude/rules/` | 规则片段，可按文件路径限定加载 |
| `agents/` | `~/.claude/agents/` | 子代理定义 |
| `hooks/` | 注册进 `settings.json` | 强制执行的脚本 |
| `prompts/` | 不安装 | 私人素材库 |

## 常驻技能（64 个）

按实际使用数据挑的 —— 跨会话次数 ≥ 3，也就是真正反复在用的。

| 技能 | 说明 | 用量 |
|---|---|---|
| `frontend-design` | 50 行短指引:从主题本身出发定视觉方向、排版、克制与自我批判,避免默认模板感。 | 63 次 / 8 个会话 |
| `diagnose` | 诊断难缠的 bug 和性能回归,已更新到上游最新版(上游改名 diagnosing-bugs,134 行)。流程:建反馈回路 → 复现 →  | 62 次 / 4 个会话 |
| `smart-search` | 基于本机 opencli 的智能搜索路由:指定站点、社交媒体、技术资料、新闻、购物、旅游、求职、金融、中文内容各走不同的源。含强制预检、单题 | 54 次 / 23 个会话 |
| `ios-dev` | iOS/SwiftUI 任务的**总入口与路由器**。刚更新到上游最新。负责判断你的需求该走哪个 guide、哪份 API 镜像、哪个评审技 | 51 次 / 6 个会话 |
| `ui-ux-pro-max` | **刚更新,能力大涨**:本地可检索数据库,84 种视觉风格、192 套配色、74 组字体搭配、192 种产品类型、98 条 UX 准则、1 | 34 次 / 2 个会话 |
| `deep-dive` | 不依赖外部 API 的深度研究:把问题拆成 DAG、按依赖顺序并行跑子代理、按缺口迭代一轮。 | 25 次 / 15 个会话 |
| `reference-interpreter` | 你丢来截图、图片、URL 或文字描述 → 分析 → 映射到设计系统 → 输出结构化设计简报(布局/排版/颜色)。标了仅手动调用。 | 21 次 / 8 个会话 |
| `improve-codebase-architecture` | 找「深化机会」——把浅模块改造成深模块,目标是可测试性和 AI 可导航性。已更新到上游最新。强制使用固定术语表。 | 20 次 / 12 个会话 |
| `skill-creator` | 从零建技能、改进已有技能、衡量技能表现,481 行 + 17 个附件。含意图捕获、访谈调研、SKILL.md 写作指南。Anthropic  | 16 次 / 3 个会话 |
| `core-animation` | Core Animation(QuartzCore)API 离线镜像,21 个附件。CALayer 图层树、CABasicAnimation | 15 次 / 1 个会话 |
| `design-system` | 三层 token 架构(primitive → semantic → component)、CSS 变量落地、间距与排版比例、组件规格文档, | 14 次 / 1 个会话 |
| `nextjs-mastery` | Next.js App Router:目录结构约定、RSC 服务端组件取数、ISR 增量再生与缓存、中间件、并行路由、Server Acti | 13 次 / 1 个会话 |
| `security-hardening` | 应用安全加固:输入校验、输出编码、SQL 注入防护、CSRF、内容安全策略 CSP、安全响应头、密钥管理、依赖漏洞审计。 | 13 次 / 6 个会话 |
| `gsap-performance` | GSAP 官方:性能。优先动 transform/opacity、避免布局抖动、will-change 的正确用法、读写批处理、大量元素的处 | 12 次 / 1 个会话 |
| `swift-development` | Swift 全流程命令行操作:构建 SPM 包与 Xcode 工程、跑 XCTest 与 Swift Testing、simctl 管模拟器 | 10 次 / 1 个会话 |
| `redesign-existing-projects` | 给**已有**站点做升级:先审计现状、识别出通用 AI 套路,再套高端标准,且不破坏现有功能。兼容任何 CSS 框架。 | 10 次 / 3 个会话 |
| `apple-docs-index` | Apple 开发者文档的**索引**,不含正文。用来回答「某个框架里到底有哪些 API」「这个东西的文档路径是什么」,再决定要不要去拉详细文 | 8 次 / 1 个会话 |
| `swiftui-pro` | 审查已有 SwiftUI 代码:现代 API 用法是否过时、可维护性、性能问题。输出按文件组织的结构化评审意见。 | 8 次 / 2 个会话 |
| `high-end-visual-design` | 教「像高端代理商那样设计」,具体到字体、间距、阴影、卡片结构。含 ABSOLUTE ZERO 反模式禁令,和一个「氛围档案 × 布局档案」的 | 8 次 / 3 个会话 |
| `gsap-core` | GSAP 官方:核心 API。gsap.to / from / fromTo、缓动函数、时长、stagger 交错、defaults 默认值 | 8 次 / 1 个会话 |
| `authentication-patterns` | 认证授权:JWT 访问令牌与刷新令牌的配对设计、鉴权中间件、OAuth2 授权码 + PKCE 完整流程、RBAC 角色模型,以及各自的反模 | 8 次 / 2 个会话 |
| `manage-skills` | 跨 11 个工具(Cursor、Claude、Agents、Windsurf、Copilot、Codex、Cline 等)发现、列出、创建、 | 7 次 / 6 个会话 |
| `simulator-utils` | 模拟器日常命令:截图并自动缩放到合适尺寸(强制)、设备增删启停、app 安装卸载与启动。 | 6 次 / 3 个会话 |
| `guide-swiftui-view-refactor` | SwiftUI 视图重构准则,观点鲜明:视图内部按固定顺序排列、**默认用 MV 而不是 MVVM**、强烈优先拆成独立子视图类型而非 co | 6 次 / 1 个会话 |
| `minimalist-ui` | 编辑风极简界面:暖色单色调、靠排版对比而非装饰、扁平 bento 网格、低饱和粉彩。明令禁渐变、禁重阴影。 | 6 次 / 3 个会话 |
| `prototype` | 做一次性原型回答一个具体问题。分两支:状态/业务逻辑问题走可运行的终端应用,UI 问题走一个路由下可切换的多套截然不同的方案。 | 6 次 / 2 个会话 |
| `hig` | Apple 人机界面指南(HIG)官方离线镜像,50 个附件。基础规范、各平台导航与呈现模式、全部标准组件、色彩排版布局、无障碍、触感。刚更 | 4 次 / 1 个会话 |
| `guide-swiftui-animations` | SwiftUI 动画模式指南。隐式与显式动画的取舍、transition 转场、phase 与 keyframe 动画、Animatable | 4 次 / 1 个会话 |
| `guide-swiftui-ui-patterns` | SwiftUI 组件与界面构建的最佳实践,37 个示例附件。导航层级怎么搭、自定义 view modifier 怎么写、响应式布局、以及** | 4 次 / 3 个会话 |
| `swift-testing-pro` | 审查并改进已有的 Swift Testing 测试代码,推动用现代 API 重写。 | 4 次 / 1 个会话 |
| `impeccable` | 前端界面设计与评审的总入口,92 个附件。含绝对禁令清单和一套「AI slop 测试」,用来判断产出是不是模板货。 | 4 次 / 2 个会话 |
| `to-prd` | 把当前对话合成规格文档并发到 issue tracker。已更新到上游最新(上游改名 to-spec,75 行)。明确不访谈你,只综合已知信 | 4 次 / 3 个会话 |
| `guide-macos-spm-packaging` | 不用 Xcode 工程、纯 SwiftPM 搭建构建打包 macOS app 的完整流程,15 个模板附件。含目录结构、资源处理、签名、公证 | 3 次 / 1 个会话 |
| `swift-concurrency-pro` | 审查已有 Swift 并发代码的正确性:数据竞争、actor 跨界、错误的 @MainActor 标注、async/await 常见误用。 | 3 次 / 2 个会话 |
| `writing-guidelines` | 按 Vercel 的 Writing Guidelines 审查文档与文案的语气、用词、结构。 | 3 次 / 3 个会话 |
| `lark-shared` | lark-cli 的**公共层**:登录登出与状态、用户身份 vs 机器人身份、按业务域的权限(--domain)、权限不足时怎么处理。 | 3 次 / 3 个会话 |
| `write-a-skill` | 建新技能:结构、渐进披露、附带资源,113 行。 | 3 次 / 2 个会话 |
| `grill-me` | 拷问你的计划直到达成共识,现在是 7 行的入口,实际跑 grilling。已更新到上游最新。 | 3 次 / 2 个会话 |
| `ios-liquid-glass` | iOS 26+ Liquid Glass 玻璃材质,266 行 + 17 个附件。glassEffect 系列修饰符、GlassEffect | 2 次 / 1 个会话 |
| `guide-swiftui-performance-audit` | SwiftUI 运行时性能审计流程:先做代码审查找出重绘源,再引导你用 Instruments 实际采样,最后结合数据定位。 | 2 次 / 1 个会话 |
| `gsap-timeline` | GSAP 官方:时间轴。gsap.timeline()、**position 参数**(最容易写错的地方)、标签、嵌套时间轴、播放控制。 | 2 次 / 1 个会话 |
| `lark-im` | 即时通讯:收发与回复消息、搜聊天记录、管群成员、传图与大文件分片下载、表情回复、应用内/短信/电话加急、交互卡片收发与按钮回调监听。25 个 | 2 次 / 2 个会话 |
| `tdd` | 已更新到最新:从 110 行精简成 36 行 + tests.md / mocking.md 两个附件。核心不再是硬套红绿重构,而是讲清「什 | 2 次 / 2 个会话 |
| `swiftui-design-skill` | SwiftUI 视觉设计,专门针对「一眼就看出是 AI 生成」的通用感。含设计方向选择、布局体系、排版、色彩、间距、品牌整合与设计评审。有中 | 1 次 / 1 个会话 |
| `ios-motion-patterns-index` | MotionBook 合集的**可运行 Swift 动画示例索引**,按菜单/转场/指示器/弹窗/表格/集合视图分类。 | 1 次 / 1 个会话 |
| `ios-ui-craft` | 把 SwiftUI 界面做到 Apple Design Award 水准。设计思维、明确的反模式清单、三条核心原则、有性格的排版规范。 | 1 次 / 1 个会话 |
| `guide-swiftdata` | SwiftData 避坑指南。autosave 的时机陷阱、关系定义、**会导致崩溃的危险谓词写法**、CloudKit 同步的硬性约束、索 | 1 次 / 1 个会话 |
| `guide-swift-testing` | Swift Testing 实践指南。为什么用 struct 而非 class、异步测试用 confirmation、参数化测试、exit  | 1 次 / 1 个会话 |
| `swiftdata-agent-skill` | 审查并改进已有 SwiftData 代码,用现代 API 与最佳实践重写。 | 1 次 / 1 个会话 |
| `design-systems-index` | 各大公司设计系统的外链索引(Material、Fluent、Carbon、Polaris、Atlassian、Lightning)+ tok | 1 次 / 1 个会话 |
| `banner-design` | 社交 / 广告 / 官网 hero / 印刷 banner。流程是问需求 → 调研艺术方向 → 出多个方案 → 导出图片 → 迭代。附各平台 | 1 次 / 1 个会话 |
| `opencli-autofix` | opencli 命令失败时自动修适配器:收集 trace、打补丁、重试,修好后再去上游提 issue。含「空结果 ≠ 坏了」的前置判断。 | 1 次 / 1 个会话 |
| `accessibility-wcag` | Web 无障碍 WCAG 2.2:语义化 HTML、ARIA 模式、键盘导航与焦点管理、表单无障碍、色彩对比度,末尾附自查清单。 | 1 次 / 1 个会话 |
| `playground` | 生成自包含单文件 HTML 交互式 playground——带控件面板、实时预览、可导出配置。Anthropic 官方出品。 | 1 次 / 1 个会话 |
| `gsap-plugins` | GSAP 官方:插件大全,428 行。ScrollSmoother 平滑滚动、Flip 布局翻转、Draggable 拖拽、Inertia  | 1 次 / 1 个会话 |
| `lark-markdown` | Markdown 文件:查看、创建、上传、编辑、局部 patch 和比较差异。 | 1 次 / 1 个会话 |
| `lark-doc` | 云文档(Docx / Wiki)读写:查看、创建、编辑正文、插入与下载文档内图片附件。 | 1 次 / 1 个会话 |
| `lark-drive` | 云空间:上传下载、建文件夹、复制移动删除、元数据、评论权限订阅、版本,以及把 Word/Markdown/Excel/CSV/PPTX 导入 | 1 次 / 1 个会话 |
| `lark-event` | 实时事件监听:用 lark-cli event consume 以 NDJSON 流式消费事件(IM 消息、卡片回调等),含子进程契约和 r | 1 次 / 1 个会话 |
| `lark-apps` | 妙搭(Spark/Miaoda)应用开发托管:建应用、发 HTML 静态站、本地全栈开发、云端生成迭代、日志与监控查询、环境变量管理。 | 1 次 / 1 个会话 |
| `api-design-patterns` | REST API 设计:资源命名规范、HTTP 方法与状态码的正确用法、统一错误响应格式、游标分页(优先)与偏移分页、过滤排序、版本化策略、 | 1 次 / 1 个会话 |
| `rust-systems` | Rust 系统编程:所有权与借用、错误处理(thiserror/anyhow)、trait 与泛型设计、async 运行时、builder  | 1 次 / 1 个会话 |
| `setup-matt-pocock-skills` | 给仓库搭脚手架:在 AGENTS.md / CLAUDE.md 写 ## Agent skills 块,建 docs/agents/,让上面 | 1 次 / 1 个会话 |
| `grill-with-docs` | 拷问 + 落文档版本:边问边更新 CONTEXT.md 和 ADR,现在是 7 行入口,跑 grilling + domain-modeli | 1 次 / 1 个会话 |

## 全部技能（153 个）

<details><summary><b>agent</b> — 10 个</summary>

| 技能 | 说明 | 常驻 | 上游 |
|---|---|:--:|---|
| `build-mcp-app` | 给 MCP 服务加交互式 UI / widget。什么时候 widget 胜过纯文本、widget 与 elicitation 怎么区分、两种部署形态、App  |  | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) |
| `build-mcp-server` | 建 MCP 服务。先盘问用途(连什么、谁用、暴露几个动作、要不要中途要用户输入、上游怎么认证),再推荐部署形态,默认推荐远程 streamable-HTTP。A |  | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) |
| `claude-md-improver` | 扫描仓库里所有 CLAUDE.md,做质量评估出报告,再做定向修改。 |  | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) |
| `hook-development` | 写 hook,707 行。PreToolUse / PostToolUse / Stop 各类钩子、prompt 型(推荐)与命令型的取舍、插件 hooks.j |  | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) |
| `manage-skills` | 跨 11 个工具(Cursor、Claude、Agents、Windsurf、Copilot、Codex、Cline 等)发现、列出、创建、编辑、开关、复制、移 | ● | [rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit) |
| `session-report` | 从 ~/.claude/projects 的会话记录生成可探索的 HTML 用量报告:token、缓存命中、子代理、技能调用、最贵的 prompt。 |  | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) |
| `skill-creator` | 从零建技能、改进已有技能、衡量技能表现,481 行 + 17 个附件。含意图捕获、访谈调研、SKILL.md 写作指南。Anthropic 官方,这一类里最权威 | ● | [anthropics/skills](https://github.com/anthropics/skills) |
| `skill-development` | 往插件里加技能、渐进披露设计原则、技能创建流程、description 怎么写才能被正确触发,632 行。 |  | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) |
| `write-a-skill` | 建新技能:结构、渐进披露、附带资源,113 行。 | ● | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `writing-rules` | 写 hookify 规则:规则文件格式、frontmatter、多条件高级写法,369 行。 |  | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) |

</details>

<details><summary><b>apple</b> — 44 个</summary>

| 技能 | 说明 | 常驻 | 上游 |
|---|---|:--:|---|
| `appintents` | App Intents API 离线镜像。把 app 功能暴露给 Siri、快捷指令、Spotlight,以及 iOS 18+ 的 Apple Intellig |  | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `apple-aso` | App Store 元数据优化(ASO),操作对象是 store.config.json。含标题/副标题/关键词的精确字符数限制、关键词字段规则、本地化 |  | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `apple-docs-index` | Apple 开发者文档的索引,不含正文。用来回答「某个框架里到底有哪些 API」「这个东西的文档路径是什么」,再决定要不要去拉详细文档。 | ● | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `backgroundtasks` | BackgroundTasks API 离线镜像。BGTaskScheduler 注册与调度、后台 app 刷新、后台长任务处理、系统的执行时机限制。 |  | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `combine` | Combine API 离线镜像。Publisher / Subscriber、各类 operator、背压、与 async/await 互转。 |  | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `core-animation` | Core Animation(QuartzCore)API 离线镜像,21 个附件。CALayer 图层树、CABasicAnimation / CAKeyfr | ● | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `corehaptics` | Core Haptics API 离线镜像。CHHapticEngine 引擎、触感事件与参数曲线、自定义振动模式。 |  | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `eventkit` | EventKit API 离线镜像。EKEventStore 授权、EKEvent 日历事件、EKReminder 提醒事项、日历读写权限模型。 |  | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `guide-macos-spm-packaging` | 不用 Xcode 工程、纯 SwiftPM 搭建构建打包 macOS app 的完整流程,15 个模板附件。含目录结构、资源处理、签名、公证,以及常见公证失败的 | ● | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `guide-swift-concurrency` | Swift 并发实践指南,12 个附件。actor 隔离、结构化并发、任务取消、AsyncStream、从 GCD 迁移,以及Swift 6 严格并发模式下 |  | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `guide-swift-testing` | Swift Testing 实践指南。为什么用 struct 而非 class、异步测试用 confirmation、参数化测试、exit test、附件,以及 | ● | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `guide-swiftdata` | SwiftData 避坑指南。autosave 的时机陷阱、关系定义、会导致崩溃的危险谓词写法、CloudKit 同步的硬性约束、索引、类继承支持。 | ● | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `guide-swiftui-animations` | SwiftUI 动画模式指南。隐式与显式动画的取舍、transition 转场、phase 与 keyframe 动画、Animatable 协议、iOS 18 | ● | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `guide-swiftui-charts` | Swift Charts 图表指南。各类 mark、坐标轴定制、交互选择、样式与组合、Chart3D、图表无障碍与 Audio Graph。 |  | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `guide-swiftui-performance-audit` | SwiftUI 运行时性能审计流程:先做代码审查找出重绘源,再引导你用 Instruments 实际采样,最后结合数据定位。 | ● | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `guide-swiftui-ui-patterns` | SwiftUI 组件与界面构建的最佳实践,37 个示例附件。导航层级怎么搭、自定义 view modifier 怎么写、响应式布局、以及状态归属(哪个状 | ● | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `guide-swiftui-view-refactor` | SwiftUI 视图重构准则,观点鲜明:视图内部按固定顺序排列、默认用 MV 而不是 MVVM、强烈优先拆成独立子视图类型而非 computed `so | ● | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `healthkit` | HealthKit API 离线镜像。HKHealthStore 授权、HKQuantitySample 样本读写、运动 workout、各类健康数据类型。 |  | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `hig` | Apple 人机界面指南(HIG)官方离线镜像,50 个附件。基础规范、各平台导航与呈现模式、全部标准组件、色彩排版布局、无障碍、触感。刚更新到上游最新。 | ● | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `ios-design-consultant` | iOS 界面的 UX 与视觉顾问,面向 iOS 26 Liquid Glass 时代。回答元素该放哪、布局怎么定、什么时候该用玻璃材质。 |  | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `ios-dev` | iOS/SwiftUI 任务的总入口与路由器。刚更新到上游最新。负责判断你的需求该走哪个 guide、哪份 API 镜像、哪个评审技能,并做正确性检查。 | ● | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `ios-liquid-glass` | iOS 26+ Liquid Glass 玻璃材质,266 行 + 17 个附件。glassEffect 系列修饰符、GlassEffectContainer、 | ● | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `ios-motion-patterns-index` | MotionBook 合集的可运行 Swift 动画示例索引,按菜单/转场/指示器/弹窗/表格/集合视图分类。 | ● | — |
| `ios-simulator-skill` | 29 个生产级 shell 脚本:语义化 UI 导航(按可访问性标签点元素,而不是硬编码坐标)、构建自动化、无障碍测试、设备状态管理。 |  | [conorluddy/ios-simulator-skill](https://github.com/conorluddy/ios-simulator-skill) |
| `ios-ui-craft` | 把 SwiftUI 界面做到 Apple Design Award 水准。设计思维、明确的反模式清单、三条核心原则、有性格的排版规范。 | ● | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `mapkit` | MapKit for SwiftUI API 离线镜像。Map 视图、Marker / Annotation 标注、相机位置控制、地图要素与样式。 |  | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `photosui` | PhotosUI API 离线镜像。PhotosPicker 相册选择器、PHLivePhotoView 实况照片、选择结果的加载与转换。 |  | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `simulator-utils` | 模拟器日常命令:截图并自动缩放到合适尺寸(强制)、设备增删启停、app 安装卸载与启动。 | ● | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `storekit` | StoreKit 2 API 离线镜像。Product 查询、Transaction 校验与监听、订阅状态、开箱即用的 StoreView / Subscrip |  | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `swift-concurrency` | Swift 并发 API 离线镜像。async/await、Task 与 TaskGroup、actor 与 @MainActor、AsyncSequence  |  | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `swift-concurrency-pro` | 审查已有 Swift 并发代码的正确性:数据竞争、actor 跨界、错误的 @MainActor 标注、async/await 常见误用。 | ● | [twostraws/Swift-Concurrency-Agent-Skill](https://github.com/twostraws/Swift-Concurrency-Agent-Skill) |
| `swift-development` | Swift 全流程命令行操作:构建 SPM 包与 Xcode 工程、跑 XCTest 与 Swift Testing、simctl 管模拟器、代码签名与分发、S | ● | — |
| `swift-testing` | Swift Testing(取代 XCTest 的新框架)API 离线镜像。@Test / @Suite 宏、#expect 与 #require 断言、tra |  | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `swift-testing-pro` | 审查并改进已有的 Swift Testing 测试代码,推动用现代 API 重写。 | ● | [twostraws/Swift-Testing-Agent-Skill](https://github.com/twostraws/Swift-Testing-Agent-Skill) |
| `swiftdata` | SwiftData API 离线镜像。@Model 宏、ModelContainer / ModelContext、@Query 查询、关系定义、schema  |  | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `swiftdata-agent-skill` | 审查并改进已有 SwiftData 代码,用现代 API 与最佳实践重写。 | ● | — |
| `swiftui` | SwiftUI 全量 API 离线镜像,50 个文档附件。涵盖各类 View、布局容器、导航(NavigationStack/NavigationSplitVi |  | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `swiftui-design-skill` | SwiftUI 视觉设计,专门针对「一眼就看出是 AI 生成」的通用感。含设计方向选择、布局体系、排版、色彩、间距、品牌整合与设计评审。有中文 README。 | ● | — |
| `swiftui-pro` | 审查已有 SwiftUI 代码:现代 API 用法是否过时、可维护性、性能问题。输出按文件组织的结构化评审意见。 | ● | [twostraws/SwiftUI-Agent-Skill](https://github.com/twostraws/SwiftUI-Agent-Skill) |
| `tipkit` | TipKit API 离线镜像。Tip 协议、内联提示 TipView 与浮层 PopoverTipView、显示规则与频率控制、Tips.configure  |  | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `uikit` | UIKit 全量 API 离线镜像,29 个附件。UIView / UIViewController 生命周期、各类控件、UITableView / UICol |  | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `usernotifications` | UserNotifications API 离线镜像。本地通知与远程推送、各类触发器(时间/日历/位置)、通知内容与附件、通知分类与操作按钮。 |  | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `widgetkit` | WidgetKit API 离线镜像。widget 时间线(Timeline / TimelineEntry / TimelineProvider)、主屏与锁屏 |  | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |
| `xcuitest` | XCUITest UI 自动化测试 API 离线镜像,19 个附件(元素查询、等待策略、权限弹窗处理、启动参数、截图、排错)。刚更新到上游最新版,正文精简成 9 |  | [Prisma-Labs-Dev/apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) |

</details>

<details><summary><b>backend</b> — 4 个</summary>

| 技能 | 说明 | 常驻 | 上游 |
|---|---|:--:|---|
| `api-design-patterns` | REST API 设计:资源命名规范、HTTP 方法与状态码的正确用法、统一错误响应格式、游标分页(优先)与偏移分页、过滤排序、版本化策略、OpenAPI 规格 | ● | [rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit) |
| `authentication-patterns` | 认证授权:JWT 访问令牌与刷新令牌的配对设计、鉴权中间件、OAuth2 授权码 + PKCE 完整流程、RBAC 角色模型,以及各自的反模式。 | ● | [rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit) |
| `rust-systems` | Rust 系统编程:所有权与借用、错误处理(thiserror/anyhow)、trait 与泛型设计、async 运行时、builder 模式、unsafe  | ● | [rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit) |
| `security-hardening` | 应用安全加固:输入校验、输出编码、SQL 注入防护、CSRF、内容安全策略 CSP、安全响应头、密钥管理、依赖漏洞审计。 | ● | [rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit) |

</details>

<details><summary><b>design</b> — 14 个</summary>

| 技能 | 说明 | 常驻 | 上游 |
|---|---|:--:|---|
| `banner-design` | 社交 / 广告 / 官网 hero / 印刷 banner。流程是问需求 → 调研艺术方向 → 出多个方案 → 导出图片 → 迭代。附各平台尺寸速查表。 | ● | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) |
| `brand` | 品牌声音、视觉识别、信息框架、资产管理、品牌一致性检查,16 个附件含参考、脚本、模板。 |  | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) |
| `canvas-design` | 用设计哲学做 .png / .pdf 视觉作品(海报、艺术品),82 个附件。核心主张是先生成一套视觉哲学再落地,并明确要求原创、不抄在世艺术家。Anthrop |  | [anthropics/skills](https://github.com/anthropics/skills) |
| `design` | 刚更新,现在是设计总入口:品牌识别、设计 token、UI 样式、logo 生成(55 风格,走 Gemini)、CIP 企业识别(50 项交付物 +  |  | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) |
| `design-assets-index` | 现成素材的外链索引:图库、图标集、字体、配色、mockup、UI kit、模板。来自 awesome-design 等合集。 |  | — |
| `design-system` | 三层 token 架构(primitive → semantic → component)、CSS 变量落地、间距与排版比例、组件规格文档,25 个附件。 | ● | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) |
| `design-systems-index` | 各大公司设计系统的外链索引(Material、Fluent、Carbon、Polaris、Atlassian、Lightning)+ token 工具与规范 + | ● | — |
| `design-tools-index` | 按用途分类的设计工具索引:动画、配色、原型、设计交付、design-to-code、图标、字体、渐变、插画、mockup、线框图等 20+ 类。 |  | — |
| `figma-style-binding` | 强制 Figma 里所有视觉属性(文字、色彩填充、间距、内边距、gap、圆角)都绑定到 Styles 或 Variables,禁止硬编码值,并做 QA 校验。标 |  | [senlindesign/claude2figma](https://github.com/senlindesign/claude2figma) |
| `frontend-slides` | 动画丰富的 HTML 演示文稿,376 行 + 161 个附件。可从零做,也能把 PPTX 转成网页。含固定舞台规则、内容密度模式、三种工作模式检测。 |  | [zarazhangrui/frontend-slides](https://github.com/zarazhangrui/frontend-slides) |
| `reference-interpreter` | 你丢来截图、图片、URL 或文字描述 → 分析 → 映射到设计系统 → 输出结构化设计简报(布局/排版/颜色)。标了仅手动调用。 | ● | [senlindesign/claude2figma](https://github.com/senlindesign/claude2figma) |
| `slides` | 策略性 HTML 演示:Chart.js 图表、design token、响应式布局、文案公式、按场景选幻灯片策略。 |  | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) |
| `taste-skill` | 给一个 URL,用真实浏览器抓 DOM + 截图,跑 4 步分析,产出 taste.md 和 taste.json:既有可直接用的设计 token(颜色/排版/ |  | — |
| `theme-factory` | 10 套预设主题(配色 + 字体),可套到幻灯片、文档、报告、HTML 落地页上;也能现场生成新主题。 |  | [anthropics/skills](https://github.com/anthropics/skills) |

</details>

<details><summary><b>lark</b> — 27 个</summary>

| 技能 | 说明 | 常驻 | 上游 |
|---|---|:--:|---|
| `lark-approval` | 审批:查处理待办已办实例、搜可发起的审批定义、看详情并发起原生审批实例。 |  | 飞书官方 |
| `lark-apps` | 妙搭(Spark/Miaoda)应用开发托管:建应用、发 HTML 静态站、本地全栈开发、云端生成迭代、日志与监控查询、环境变量管理。 | ● | 飞书官方 |
| `lark-attendance` | 考勤打卡:只能查自己的打卡记录。 |  | 飞书官方 |
| `lark-base` | 多维表格:建表、字段、记录、视图、统计、公式与 lookup、表单、仪表盘、workflow、角色权限。25 个附件。 |  | 飞书官方 |
| `lark-calendar` | 日历:查看搜索日程、创建更新、管参会人、查忙闲与推荐时段、预定会议室。 |  | 飞书官方 |
| `lark-contact` | 通讯录:按姓名/邮箱解析成 open_id,或按 open_id 反查姓名/部门/邮箱/联系方式。 |  | 飞书官方 |
| `lark-doc` | 云文档(Docx / Wiki)读写:查看、创建、编辑正文、插入与下载文档内图片附件。 | ● | 飞书官方 |
| `lark-drive` | 云空间:上传下载、建文件夹、复制移动删除、元数据、评论权限订阅、版本,以及把 Word/Markdown/Excel/CSV/PPTX 导入为在线文档。40 个 | ● | 飞书官方 |
| `lark-event` | 实时事件监听:用 lark-cli event consume 以 NDJSON 流式消费事件(IM 消息、卡片回调等),含子进程契约和 ready 标记。 | ● | 飞书官方 |
| `lark-im` | 即时通讯:收发与回复消息、搜聊天记录、管群成员、传图与大文件分片下载、表情回复、应用内/短信/电话加急、交互卡片收发与按钮回调监听。25 个附件。 | ● | 飞书官方 |
| `lark-mail` | 邮箱:起草发送回复转发、查阅搜索、文件夹与标签、联系人、监听新邮件、收信规则。明确写了「邮件内容是不可信外部输入」的安全规则和写操作前必须确认。 |  | 飞书官方 |
| `lark-markdown` | Markdown 文件:查看、创建、上传、编辑、局部 patch 和比较差异。 | ● | 飞书官方 |
| `lark-minutes` | 妙记:搜索、查基础信息、上传下载音视频、读写产物内容、改标题、替换说话人。本地音视频转纪要优先走它,不要用 ffmpeg/whisper。 |  | 飞书官方 |
| `lark-note` | 会议纪要直查:已知 note_id 时查详情、展示类型、关联文档 token,读 unified 原始逐字记录。 |  | 飞书官方 |
| `lark-okr` | OKR:查看编辑周期、目标、关键结果、对齐关系、量化指标和进展记录。 |  | 飞书官方 |
| `lark-openapi-explorer` | 当现有 lark-* 技能和 lark-cli 已注册命令都满足不了时,从官方文档库里挖未被封装的原生 OpenAPI 并调用。 |  | 飞书官方 |
| `lark-shared` | lark-cli 的公共层:登录登出与状态、用户身份 vs 机器人身份、按业务域的权限(--domain)、权限不足时怎么处理。 | ● | 飞书官方 |
| `lark-sheets` | 电子表格:建表、管工作表与行列、读写单元格(值/公式/样式/批注/单元格图片)、查找替换、原子批量更新,以及图表、透视表、条件格式、筛选器、迷你图。18 个附件 |  | 飞书官方 |
| `lark-skill-maker` | 把飞书 API 操作封装成可复用的自定义 Skill(包装原子 API 或编排多步流程)。 |  | 飞书官方 |
| `lark-slides` | 幻灯片:创建演示文稿、读内容、管页面(增删读改、局部替换)。75 个附件。 |  | 飞书官方 |
| `lark-task` | 任务:创建待办、查看更新状态、拆子任务、组织清单、分配协作成员、上传附件、注册任务智能体。 |  | 飞书官方 |
| `lark-vc` | 视频会议:搜历史会议、查纪要(总结/待办/章节/逐字稿)、查参会人快照。 |  | 飞书官方 |
| `lark-vc-agent` | 会中能力:让机器人真实加入或离开正在进行的会议,读会中事件(参会人进出、发言、聊天、屏幕共享)。标注为内测。 |  | 飞书官方 |
| `lark-whiteboard` | 画板:导出为预览图片、导出原始节点结构、多种格式更新画板内容。29 个附件。 |  | 飞书官方 |
| `lark-wiki` | 知识库:建查知识空间、管空间成员、管节点层级、组织文档与快捷方式。 |  | 飞书官方 |
| `lark-workflow-meeting-summary` | 工作流:汇总指定时间范围内的会议纪要,生成结构化报告(会议周报)。 |  | 飞书官方 |
| `lark-workflow-standup-report` | 工作流:编排日历日程和任务,生成指定日期的日程与未完成任务摘要。 |  | 飞书官方 |

</details>

<details><summary><b>method</b> — 16 个</summary>

| 技能 | 说明 | 常驻 | 上游 |
|---|---|:--:|---|
| `caveman` | 超压缩沟通模式,砍掉虚词和客套,据称省约 75% token。 |  | — |
| `codebase-design` | 代码库设计:怎么把模块划得更深、边界更清楚,让代码既好测试又好让 AI 导航。是 improve-codebase-architecture 的依赖。 |  | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `diagnose` | 诊断难缠的 bug 和性能回归,已更新到上游最新版(上游改名 diagnosing-bugs,134 行)。流程:建反馈回路 → 复现 → 提假设 → 埋点 → | ● | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `domain-modeling` | 领域建模:梳理业务概念、统一术语、产出领域词汇表,74 行。 |  | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `grill-me` | 拷问你的计划直到达成共识,现在是 7 行的入口,实际跑 grilling。已更新到上游最新。 | ● | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `grill-with-docs` | 拷问 + 落文档版本:边问边更新 CONTEXT.md 和 ADR,现在是 7 行入口,跑 grilling + domain-modeling。已更新到上游最 | ● | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `grilling` | 拷问式访谈的引擎,12 行。一次一个问题走完决策树,每问都给推荐答案。grill-me 和 grill-with-docs 都靠它。 |  | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `handoff` | 把当前对话压缩成交接文档给下一个 agent,要求不重复 PRD/计划/ADR/commit 里已有的内容,只给路径或 URL。已更新到上游最新。 |  | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `improve-codebase-architecture` | 找「深化机会」——把浅模块改造成深模块,目标是可测试性和 AI 可导航性。已更新到上游最新。强制使用固定术语表。 | ● | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `prototype` | 做一次性原型回答一个具体问题。分两支:状态/业务逻辑问题走可运行的终端应用,UI 问题走一个路由下可切换的多套截然不同的方案。 | ● | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `setup-matt-pocock-skills` | 给仓库搭脚手架:在 AGENTS.md / CLAUDE.md 写 ## Agent skills 块,建 docs/agents/,让上面几个技能知道本仓库的 | ● | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `tdd` | 已更新到最新:从 110 行精简成 36 行 + tests.md / mocking.md 两个附件。核心不再是硬套红绿重构,而是讲清「什么算好测试」和接 | ● | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `to-issues` | 把计划/规格拆成可独立认领的 issue,用 tracer bullet 纵向切片。已更新到上游最新(上游改名 to-tickets,105 行)。 |  | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `to-prd` | 把当前对话合成规格文档并发到 issue tracker。已更新到上游最新(上游改名 to-spec,75 行)。明确不访谈你,只综合已知信息。 | ● | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `triage` | 用状态机和五种 triage 角色流转 issue,要求每条评论带免责声明。 |  | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `zoom-out` | 让 agent 抬升一个抽象层,给出相关模块和调用方的地图。正文只有 2 行,标了仅手动调用。 |  | — |

</details>

<details><summary><b>tools</b> — 4 个</summary>

| 技能 | 说明 | 常驻 | 上游 |
|---|---|:--:|---|
| `deep-dive` | 不依赖外部 API 的深度研究:把问题拆成 DAG、按依赖顺序并行跑子代理、按缺口迭代一轮。 | ● | [rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit) |
| `opencli-adapter-author` | 给新站点写 opencli 适配器,或给已有站点加命令,15 个附件。从初次侦察、字段解码、写适配器到验证,含决策树、逐步 runbook 和卡住时的降级路径。 |  | — |
| `opencli-autofix` | opencli 命令失败时自动修适配器:收集 trace、打补丁、重试,修好后再去上游提 issue。含「空结果 ≠ 坏了」的前置判断。 | ● | — |
| `smart-search` | 基于本机 opencli 的智能搜索路由:指定站点、社交媒体、技术资料、新闻、购物、旅游、求职、金融、中文内容各走不同的源。含强制预检、单题预算和频率限制。 | ● | — |

</details>

<details><summary><b>web</b> — 34 个</summary>

| 技能 | 说明 | 常驻 | 上游 |
|---|---|:--:|---|
| `accessibility-wcag` | Web 无障碍 WCAG 2.2:语义化 HTML、ARIA 模式、键盘导航与焦点管理、表单无障碍、色彩对比度,末尾附自查清单。 | ● | [rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit) |
| `animation-vocabulary` | 反查词典:把「弹窗弹出时那个弹弹的感觉」翻译成准确术语(Pop in)、「iOS 那个橡皮筋滚动」→ Rubber-banding。 |  | — |
| `apple-design` | 把 Apple 的流体物理动效原理翻译到 Web,278 行。消除延迟、1:1 直接操控、可打断性(作者认为最重要的一条)、用弹簧而非贝塞尔曲线 |  | — |
| `composition-patterns` | 能扩展的 React 组合模式,专治 boolean prop 泛滥(一个组件挂十几个 isXxx)。compound components、render pr |  | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) |
| `deploy-to-vercel` | 部署到 Vercel。按你项目的实际状态分支处理:已 link 且有 git remote 走 git push;已 link 无 remote 走 verce |  | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) |
| `emil-design-eng` | Emil Kowalski 的 UI 打磨哲学,675 行单文件。品味是练出来的、看不见的细节会累积、美是杠杆。含动画决策框架(第一问:这东西到底该不该 |  | — |
| `find-animation-opportunities` | 扫代码库找「该动却没动」的地方,并否掉不该动的。四道闸:频率(用户会看到多少次)、目的、速度(能否进预算)、功能(帮忙还是添乱)。只读,只出方案不改代码 |  | — |
| `frontend-design` | 50 行短指引:从主题本身出发定视觉方向、排版、克制与自我批判,避免默认模板感。 | ● | [anthropics/skills](https://github.com/anthropics/skills) |
| `gsap-core` | GSAP 官方:核心 API。gsap.to / from / fromTo、缓动函数、时长、stagger 交错、defaults 默认值,以及 matchM | ● | [greensock/gsap-skills](https://github.com/greensock/gsap-skills) |
| `gsap-frameworks` | GSAP 官方:Vue 3 / Nuxt 4 / Svelte 集成。生命周期挂载时机、选择器作用域限定、卸载时清理 ScrollTrigger。 |  | [greensock/gsap-skills](https://github.com/greensock/gsap-skills) |
| `gsap-performance` | GSAP 官方:性能。优先动 transform/opacity、避免布局抖动、will-change 的正确用法、读写批处理、大量元素的处理策略。 | ● | [greensock/gsap-skills](https://github.com/greensock/gsap-skills) |
| `gsap-plugins` | GSAP 官方:插件大全,428 行。ScrollSmoother 平滑滚动、Flip 布局翻转、Draggable 拖拽、Inertia 惯性、Observe | ● | [greensock/gsap-skills](https://github.com/greensock/gsap-skills) |
| `gsap-react` | GSAP 官方:React / Next.js 集成。useGSAP 钩子、用 ref 拿目标、gsap.context() 作用域、依赖数组与 revertO |  | [greensock/gsap-skills](https://github.com/greensock/gsap-skills) |
| `gsap-scrolltrigger` | GSAP 官方:ScrollTrigger,291 行。滚动联动、pin 固定元素、scrub 擦洗式绑定进度、batch 批量、scrollerProxy 自 |  | [greensock/gsap-skills](https://github.com/greensock/gsap-skills) |
| `gsap-timeline` | GSAP 官方:时间轴。gsap.timeline()、position 参数(最容易写错的地方)、标签、嵌套时间轴、播放控制。 | ● | [greensock/gsap-skills](https://github.com/greensock/gsap-skills) |
| `gsap-utils` | GSAP 官方:gsap.utils 工具集。clamp 夹取、mapRange 区间映射、normalize 归一化、interpolate 插值、rando |  | [greensock/gsap-skills](https://github.com/greensock/gsap-skills) |
| `high-end-visual-design` | 教「像高端代理商那样设计」,具体到字体、间距、阴影、卡片结构。含 ABSOLUTE ZERO 反模式禁令,和一个「氛围档案 × 布局档案」的随机组合引擎防止千篇 | ● | — |
| `impeccable` | 前端界面设计与评审的总入口,92 个附件。含绝对禁令清单和一套「AI slop 测试」,用来判断产出是不是模板货。 | ● | — |
| `improve-animations` | 以资深动效顾问身份通盘审已有动画代码,产出优先级排序的审计报告 + 可交给更便宜模型执行的自包含实施计划。只读。 |  | — |
| `material-3` | Google Material Design 3(Material You),656 行。主攻 Jetpack Compose Material3,也覆盖 Fl |  | — |
| `minimalist-ui` | 编辑风极简界面:暖色单色调、靠排版对比而非装饰、扁平 bento 网格、低饱和粉彩。明令禁渐变、禁重阴影。 | ● | — |
| `nextjs-mastery` | Next.js App Router:目录结构约定、RSC 服务端组件取数、ISR 增量再生与缓存、中间件、并行路由、Server Actions。 | ● | [rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit) |
| `playground` | 生成自包含单文件 HTML 交互式 playground——带控件面板、实时预览、可导出配置。Anthropic 官方出品。 | ● | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) |
| `react-best-practices` | Vercel 工程团队的 React / Next.js 性能准则,75 个附件。按严重度分级:消灭请求瀑布(CRITICAL)、打包体积(CRITICAL)、 |  | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) |
| `react-native-skills` | React Native / Expo 最佳实践,41 个附件。列表性能(CRITICAL)、动画、导航、原生模块对接。刚更新到上游最新。 |  | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) |
| `react-patterns` | React 19 新特性:use() 钩子、Server Components、Server Actions、useActionState、useOptimis |  | [rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit) |
| `react-view-transitions` | React View Transition API:<ViewTransition> 组件、addTransitionType 转场类型、CSS 伪元素定制、方 |  | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) |
| `redesign-existing-projects` | 给已有站点做升级:先审计现状、识别出通用 AI 套路,再套高端标准,且不破坏现有功能。兼容任何 CSS 框架。 | ● | — |
| `ui-styling` | shadcn/ui(Radix + Tailwind)组件层 + Tailwind 工具类层 + canvas 视觉层三段式,97 个附件是具体组件代码。 |  | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) |
| `ui-ux-pro-max` | 刚更新,能力大涨:本地可检索数据库,84 种视觉风格、192 套配色、74 组字体搭配、192 种产品类型、98 条 UX 准则、104 个图标条目、1 | ● | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) |
| `vercel-cli-with-tokens` | 用 access token 而非交互式登录来操作 Vercel CLI,346 行。含四条找 token 的路径(环境变量 / .env 标准名 / .env |  | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) |
| `vercel-optimize` | Vercel 成本与性能优化,155 个附件。抓取线上指标、扫描代码、合并信号后给优化建议。支持 Next.js / SvelteKit / Nuxt,Astr |  | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) |
| `web-design-guidelines` | 按 Vercel 的 Web Interface Guidelines 审查界面代码(无障碍、交互细节、常见 UX 缺陷)。 |  | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) |
| `writing-guidelines` | 按 Vercel 的 Writing Guidelines 审查文档与文案的语气、用词、结构。 | ● | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) |

</details>

---

标 `—` 的 23 个查不到上游，只有本地这一份，同步脚本不会碰它们。

