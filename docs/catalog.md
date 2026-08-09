# 收藏技能总目录

全部收藏 **240** 个：未收录索引 **9** · 已收录 **231**（其中常驻 **105**）

匹配优先级：常驻（会话里已可见）→ 已收录未常驻（启用即可，零下载）→
未收录索引（从上游安装）。按描述匹配即可；描述拿不准、候选难取舍或任务
关键时再读全文——已收录的直接读本地
`~/agents_kit/skills/<分类>/<技能名>/SKILL.md`，未收录的点「技能」列链接
（指向上游默认分支最新版）。链接 404 说明上游改了目录，运行
`agents-kit source inspect --refresh-index` 重扫后重试。安装未收录技能前
先读 `~/agents_kit/docs/skill-taxonomy.md` 选分类标签；用户未说明范围时
先问装全局还是项目。注意带 `scripts/`、`references/` 附件的技能必须安装
后才能完整使用。

维护：收藏新来源 `agents-kit source inspect <仓库> --save`；重扫全部
`--refresh-index`；移除来源编辑 `scout.json` 后运行 `agents-kit docs
build`。第二、三层来自仓库清册自动渲染，无需维护。

## 一、未收录索引（看上但还没进仓库）

### emilkowalski-skills（9 个 · 扫描版本 `de33dbed0`）

Emil Kowalski 的动效与 UI 设计技能合集

- 来源：https://github.com/emilkowalski/skills.git
- 安装：`agents-kit skill import https://github.com/emilkowalski/skills.git --candidate <候选路径> --category <分类> --scope <global|project> --description "<中文说明>" --tag <标签>…`

| 技能 | 用途 | 候选路径 | 已装 |
|---|---|---|:--:|
| [animate](https://raw.githubusercontent.com/emilkowalski/skills/HEAD/skills/animate/SKILL.md) | Build an animation from scratch, making the decisions in the order that determines whether it feels right — should it animate at all, what purpose, which tool, which properties, which curve and duration, how it interrupts, how it exits. Writes the implementation. Use when asked to animate something, add motion, make a component feel alive, or build a transition. For critiquing existing motion use review-animations; for auditing a whole codebase use improve-animations. | `skills/animate` | ● |
| [animation-vocabulary](https://raw.githubusercontent.com/emilkowalski/skills/HEAD/skills/animation-vocabulary/SKILL.md) | Reverse-lookup glossary that turns a vague description of a web animation or motion effect into its exact term ("the bouncy thing when a popover opens" → Pop in; "the iOS rubber-band scroll" → Rubber-banding). Use when the user asks "what's it called when…", or describes a motion effect without knowing its name and wants the right word to prompt an AI or designer with. For naming an effect, not designing or building one. | `skills/animation-vocabulary` | ● |
| [apple-design](https://raw.githubusercontent.com/emilkowalski/skills/HEAD/skills/apple-design/SKILL.md) | Apple's approach to interface design and fluid, physical motion, translated for the web. Use when building or reviewing gesture-driven UI, spring animations, drag/swipe/sheet interactions, momentum and interruptible transitions, translucent materials and depth, typography (optical sizing, tracking, leading), reduced-motion, or the design foundations (feedback, spatial consistency, restraint) behind Apple-style interfaces. | `skills/apple-design` | ● |
| [emil-design-eng](https://raw.githubusercontent.com/emilkowalski/skills/HEAD/skills/emil-design-eng/SKILL.md) | This skill encodes Emil Kowalski's philosophy on UI polish, component design, animation decisions, and the invisible details that make software feel great. | `skills/emil-design-eng` | ● |
| [find-animation-opportunities](https://raw.githubusercontent.com/emilkowalski/skills/HEAD/skills/find-animation-opportunities/SKILL.md) | Search a codebase or UI for places that don't animate but should, and reject everything that shouldn't. Read-only; it proposes motion with exact values, it does not implement it. Use when the user asks "what could be animated here?" or wants to "make this feel more alive". For fixing existing animations, use improve-animations or review-animations instead. | `skills/find-animation-opportunities` | ● |
| [improve-animations](https://raw.githubusercontent.com/emilkowalski/skills/HEAD/skills/improve-animations/SKILL.md) | Survey a codebase's animation and motion code as a senior motion advisor, then produce a prioritized audit and self-contained implementation plans for other agents (or cheaper models) to execute. Read-only on source code — it plans improvements, it does not apply them. Use when the user asks to "improve the animations", "audit the motion", "make this app feel better", or wants a roadmap of animation fixes rather than a review of a single diff. | `skills/improve-animations` | ● |
| [pick-ui-library](https://raw.githubusercontent.com/emilkowalski/skills/HEAD/skills/pick-ui-library/SKILL.md) | Pick the right library for a given frontend task from a curated, opinionated list — numbers, OTP inputs, charts, command menus, virtualization, drag and drop, toasts, state, styling, and more. Only runs when explicitly invoked; it does not trigger on its own. | `skills/pick-ui-library` | ● |
| [prototype](https://raw.githubusercontent.com/emilkowalski/skills/HEAD/skills/prototype/SKILL.md) | Build multiple genuinely different versions of a UI piece you describe, rendered behind a visual picker so you can flip through them live and promote the one that feels right. Only runs when explicitly invoked; it does not trigger on its own. | `skills/prototype` | ● |
| [review-animations](https://raw.githubusercontent.com/emilkowalski/skills/HEAD/skills/review-animations/SKILL.md) | Reviews animation and motion code against a high craft bar derived from Emil Kowalski's design engineering philosophy. Default to flagging; approval is earned. | `skills/review-animations` | ● |

## 二、已收录、未常驻（仓库现成，启用即可用）

全局启用：`agents-kit global enable <技能名>`；只装进当前项目：
`agents-kit project install <技能名> --project <项目路径>`。

| 技能 | 分类 | 用途 |
|---|---|---|
| `academic-pdf-translation` | 学术研究 | 学术 PDF 全文翻译与版式重建工作流：保留证据强度、数字、引用和因果边界，支持复杂图表与截图文字本地化、自动完整性检查、源译逐页审查、可检索 PDF 交付及 Zotero 收尾。 |
| `academic-research-suite` | 学术研究 | Codex 原生 ARS 学术研究总入口：在一个 Skill 内路由深度研究、文献综述、论文写作、同行评审、研究到成稿流程和实验规划；其中 Socratic 模式用五层追问把模糊选题收敛为可回答的研究问题。研究与综述能力和 ars-deep-research 高度重叠，但额外包含论文写作等流程。 |
| `ars-deep-research` | 学术研究 | ARS 的严谨学术研究与文献综述工作流：覆盖研究问题定义、可复现检索、纳入排除、双阶段筛选、来源核验、证据综合、PRISMA 系统综述、偏倚评估和可选 Meta 分析；不包含独立论文写作与审稿返修 Skill。 |
| `arts-design-tutor` | 学术研究 | 艺术史与设计分析辅助：用描述、分析、解释、评价四步法处理作品和视觉证据，并提供构图、色彩、字体、设计原则、UX/UI 与作品集评析；用于增强艺术设计专业论证，不代替论文研究总流程。 |
| `arxiv` | 学术研究 | arXiv 专用论文检索、详情读取、摘要和 PDF 下载；适合查最新预印本或处理明确的 arXiv ID。 |
| `cnki-advanced-search` | 学术研究 | 知网高级检索：按主题、题名、关键词、作者、期刊、年份及 CSSCI、北大核心、CSCD、SCI、EI 等来源类别精确筛选论文。 |
| `cnki-download` | 学术研究 | 知网授权下载：在用户已登录且具有下载权限时，从论文详情页触发 PDF 或 CAJ 下载，不绕过登录、验证码或付费限制。 |
| `cnki-export` | 学术研究 | 知网引文导出：从论文详情页或结果页导出引用元数据、GB/T 7714文本和RIS/EndNote数据，并可写入本地Zotero。 |
| `cnki-journal-index` | 学术研究 | 知网期刊收录核验：查询北大核心、CSSCI、CSCD、SCI、EI、AMI、Scopus、ISSN/CN及影响因子等评价信息。 |
| `cnki-journal-search` | 学术研究 | 知网期刊检索：按刊名、ISSN、CN号或主办单位查找期刊，返回影响因子、主办方及被引下载等候选信息。 |
| `cnki-journal-toc` | 学术研究 | 知网期刊目录浏览：提取指定期刊某年某期的论文题名、作者和页码，并在已有权限时触发原版目录下载。 |
| `cnki-navigate-pages` | 学术研究 | 知网结果导航：在检索结果中翻页、跳页，并按相关度、发表时间、被引次数、下载量或综合指标重新排序。 |
| `cnki-paper-detail` | 学术研究 | 知网论文详情：提取题名、作者、机构、摘要、关键词、基金、分类号、来源、发表信息及引证网络计数。 |
| `cnki-parse-results` | 学术研究 | 知网结果解析：把当前检索结果页转换为结构化论文数据，保留题名、作者、来源、日期、被引、下载量、详情链接和导出标识。 |
| `cnki-researcher` | 学术研究 | 知网学术调研总控：编排关键词或高级检索、结果筛选、论文详情、期刊级别、目录浏览、授权下载与Zotero导出完整流程。 |
| `cnki-search` | 学术研究 | 知网关键词检索：使用 Codex 浏览器登录态搜索中国知网，返回题名、作者、来源、日期、被引、下载量及后续详情和导出所需标识。 |
| `nature-academic-search` | 学术研究 | 跨 CrossRef、PubMed、arXiv、Scopus 和 ScienceDirect 的学术检索工作流，支持 MeSH 查询、引用核验、文献去重、引用文件转换及 Scopus 作者、机构、期刊与引用指标查询；Scopus 和 ScienceDirect 需要 Elsevier API 权限。 |
| `nature-figure` | 学术研究 | Nature 风格科研绘图工作流：先明确结论、证据逻辑、数据完整性、导出要求和审稿风险，再用 Python 或 R 生成论文级单图与多面板图，支持 SVG、PDF、TIFF；AI 示意图仅作为可选草稿路线。 |
| `paper-search` | 学术研究 | 通过本机 paper-search CLI 跨 20 多个学术来源检索论文、下载 PDF 和提取全文；它是统一检索工具层，不负责完整文献综述。 |
| `pm-advanced-search` | 学术研究 | PubMed 高级检索：把自然语言条件转换为作者、标题、期刊、MeSH、日期和文章类型等字段限定查询。 |
| `pm-export` | 学术研究 | 把一个或一批 PubMed 记录导出为 RIS，或通过本地 Zotero Connector 写入 Zotero；负责文献管理交接，不负责检索。 |
| `pm-fulltext` | 学术研究 | 按 PMID 查找论文全文入口：解析 DOI、PMC 开放获取和出版社链接，用于从论文元数据继续定位可读全文。 |
| `pm-navigate-pages` | 学术研究 | 延续上一轮 PubMed 检索，切换结果页或排序方式；它只负责检索结果导航，不发起新的研究主题。 |
| `pm-paper-detail` | 学术研究 | 按 PMID 读取 PubMed 论文完整元数据：作者与机构、摘要、MeSH、关键词、文章类型、DOI 和引用信息。 |
| `pm-search` | 学术研究 | PubMed 基础关键词检索：返回 PMID、标题、作者、期刊、日期和 DOI，是拆分式 PubMed 工作流的入口。 |
| `pubmed` | 学术研究 | 单体 PubMed/PMC 学术检索工作流：直接调用 NCBI E-utilities、PMC 与 iCite，覆盖检索、摘要、相似论文、引用指标、开放全文和 MEDLINE/RIS 导出。 |
| `research-lit` | 学术研究 | 多源学术文献综述工作流：检索 Zotero、本地 PDF、网页和学术数据库，去重后阅读并综合相关工作；重点是形成综述，不只是返回论文列表。 |
| `research-writing-skill` | 学术研究 | 中文优先的学术论文写作与修改 Skill：覆盖摘要、引言、相关工作、方法、实验、结果讨论、结论和学位论文正文，强调先搭论证、保持公式术语与实测结果不变，并明确标记仍缺数据或引用支持的主张。 |
| `semantic-scholar` | 学术研究 | Semantic Scholar 专用论文检索：侧重正式会议和期刊，返回 venue、DOI、引用量、TLDR 与开放获取链接，用于补充 arXiv 预印本。 |
| `social-science-paper-writing` | 学术研究 | 面向社会科学与设计研究的论文工作流：支持选题诊断、研究问题细化、文献综述规划、CNKI/Google Scholar 到 Zotero 的资料流、理论框架、问卷访谈与案例研究设计、草稿审查、证据和因果表述检查。 |
| `thesis-figure-skill` | 学术研究 | 面向论文研究框架、方法流程、概念模型、服务蓝图和系统关系的可编辑配图工作流：先明确关系与布局，再用 TikZ 或 draw.io 实现、渲染和检查，避免用不可编辑 AI 位图承载关键学术结构。 |
| `build-mcp-app` | AI Building | 给 MCP 服务加交互式 UI / widget。什么时候 widget 胜过纯文本、widget 与 elicitation 怎么区分、两种部署形态、App 类运行时。Anthropic 官方。 |
| `build-mcp-server` | AI Building | 建 MCP 服务。先盘问用途(连什么、谁用、暴露几个动作、要不要中途要用户输入、上游怎么认证),再推荐部署形态,默认推荐远程 streamable-HTTP。Anthropic 官方。 |
| `caveman` | AI Building | 超压缩沟通模式,砍掉虚词和客套,据称省约 75% token。 |
| `claude-md-improver` | AI Building | 扫描仓库里所有 CLAUDE.md,做质量评估出报告,再做定向修改。 |
| `handoff` | AI Building | 把当前对话压缩成交接文档给下一个 agent,要求不重复 PRD/计划/ADR/commit 里已有的内容,只给路径或 URL。已更新到上游最新。 |
| `hook-development` | AI Building | 写 hook,707 行。PreToolUse / PostToolUse / Stop 各类钩子、prompt 型(推荐)与命令型的取舍、插件 hooks.json 格式、工具调用校验。 |
| `lark-skill-maker` | AI Building | 把飞书 API 操作封装成可复用的自定义 Skill(包装原子 API 或编排多步流程)。 |
| `session-report` | AI Building | 从 ~/.claude/projects 的会话记录生成可探索的 HTML 用量报告:token、缓存命中、子代理、技能调用、最贵的 prompt。 |
| `skill-development` | AI Building | 往插件里加技能、渐进披露设计原则、技能创建流程、description 怎么写才能被正确触发,632 行。 |
| `skill-publisher` | AI Building | 将 Agent Skill 发布、更新并核验到 GitHub、ClawHub、AgentSkill.sh、skills.sh、Claude 社区目录和 OpenAI Plugins，保留可恢复的跨平台回执。 |
| `writing-rules` | AI Building | 写 hookify 规则:规则文件格式、frontmatter、多条件高级写法,369 行。 |
| `codebase-design` | 通用工程 | 代码库设计:怎么把模块划得更深、边界更清楚,让代码既好测试又好让 AI 导航。是 improve-codebase-architecture 的依赖。 |
| `opencli-adapter-author` | 通用工程 | 给新站点写 opencli 适配器,或给已有站点加命令,15 个附件。从初次侦察、字段解码、写适配器到验证,含决策树、逐步 runbook 和卡住时的降级路径。中文写的。 |
| `zoom-out` | 通用工程 | 让 agent 抬升一个抽象层,给出相关模块和调用方的地图。正文只有 2 行,标了仅手动调用。 |
| `animate` | 前端与 UI/UX | 从零实现高质量 Web 动效：依次判断是否该动、动效目的、工具、属性、缓动、时长、中断和退出，并直接写实现。 |
| `animation-vocabulary` | 前端与 UI/UX | 动效术语反查词典：把模糊的视觉描述映射为准确的 Web 动画名称，便于向设计师或 AI 清楚表达。 |
| `apple-design` | 前端与 UI/UX | 将 Apple 的流体界面原则转译到 Web：覆盖跟手手势、可中断弹簧、速度继承、材质层次、排版和减少动态效果。 |
| `composition-patterns` | 前端与 UI/UX | 能扩展的 React 组合模式,专治 boolean prop 泛滥(一个组件挂十几个 isXxx)。compound components、render props、context provider,以及 React 19 的 API 变化。刚更新到上游最新。 |
| `deploy-to-vercel` | 前端与 UI/UX | 部署到 Vercel。按你项目的实际状态分支处理:已 link 且有 git remote 走 git push;已 link 无 remote 走 vercel deploy;未 link 先 link;未认证走安装认证流程;还有无认证时的沙箱兜底。 |
| `design` | 前端与 UI/UX | 设计总入口：品牌识别、设计 token、UI 样式、Logo 生成（55 风格，通过 Codex Imagegen 使用 GPT Image 2，无需单独 API key）、CIP 企业识别（50 项交付物 + mockup）、HTML 演示（Chart.js）、banner（22 风格）、图标（15 风格 SVG，走 Gemini 3.1 Pro）、社交配图（HTML 转截图，多平台）。 |
| `design-assets-index` | 前端与 UI/UX | 现成素材的外链索引:图库、图标集、字体、配色、mockup、UI kit、模板。来自 awesome-design 等合集。 |
| `design-tools-index` | 前端与 UI/UX | 按用途分类的设计工具索引:动画、配色、原型、设计交付、design-to-code、图标、字体、渐变、插画、mockup、线框图等 20+ 类。 |
| `emil-design-eng` | 前端与 UI/UX | Emil Kowalski 的设计工程规范，覆盖 UI 打磨、组件细节、动画取舍、缓动时长与严格评审格式。 |
| `emil-ui-prototype` | 前端与 UI/UX | 围绕一个 UI 组件构建三到五个真正不同、可交互的方案，通过固定选择器逐个比较，并在用户选择后晋升胜出方案。 |
| `figma-style-binding` | 前端与 UI/UX | 强制 Figma 里所有视觉属性(文字、色彩填充、间距、内边距、gap、圆角)都绑定到 Styles 或 Variables,禁止硬编码值,并做 QA 校验。标了仅手动调用。 |
| `find-animation-opportunities` | 前端与 UI/UX | 只读扫描界面，找出真正值得增加动效的位置，并依据频率、目的、速度与功能否决不该动的元素。 |
| `gsap-frameworks` | 前端与 UI/UX | GSAP 官方:Vue 3 / Nuxt 4 / Svelte 集成。生命周期挂载时机、选择器作用域限定、卸载时清理 ScrollTrigger。 |
| `gsap-react` | 前端与 UI/UX | GSAP 官方:React / Next.js 集成。useGSAP 钩子、用 ref 拿目标、gsap.context() 作用域、依赖数组与 revertOnUpdate、SSR 注意事项、卸载清理。 |
| `gsap-scrolltrigger` | 前端与 UI/UX | GSAP 官方:ScrollTrigger,291 行。滚动联动、pin 固定元素、scrub 擦洗式绑定进度、batch 批量、scrollerProxy 自定义滚动容器。 |
| `gsap-utils` | 前端与 UI/UX | GSAP 官方:gsap.utils 工具集。clamp 夹取、mapRange 区间映射、normalize 归一化、interpolate 插值、random、snap 吸附、toArray、wrap 循环、pipe 组合。 |
| `improve-animations` | 前端与 UI/UX | 以资深动效顾问视角审计整个代码库的动画，产出按优先级排列的发现和可独立执行的实施计划，不直接修改源码。 |
| `material-3` | 前端与 UI/UX | Google Material Design 3(Material You),656 行。主攻 Jetpack Compose Material3,也覆盖 Flutter 和 @material/web。含完整 token 体系、30+ 组件规格、M3 Expressive、无障碍。 |
| `pick-ui-library` | 前端与 UI/UX | 从一份有明确偏好的清单中为前端任务选择 UI、动效、图表、状态和性能库，并优先复用项目已安装方案。 |
| `react-best-practices` | 前端与 UI/UX | Vercel 工程团队的 React / Next.js 性能准则,75 个附件。按严重度分级:消灭请求瀑布(CRITICAL)、打包体积(CRITICAL)、服务端性能(HIGH)。刚更新到上游最新。 |
| `react-native-skills` | 前端与 UI/UX | React Native / Expo 最佳实践,41 个附件。列表性能(CRITICAL)、动画、导航、原生模块对接。刚更新到上游最新。 |
| `react-patterns` | 前端与 UI/UX | React 19 新特性:use() 钩子、Server Components、Server Actions、useActionState、useOptimistic 乐观更新、Suspense 边界。 |
| `react-view-transitions` | 前端与 UI/UX | React View Transition API:<ViewTransition> 组件、addTransitionType 转场类型、CSS 伪元素定制、方向性(前进/后退)导航动画、列表重排动画、Next.js 集成。刚更新到上游最新。 |
| `review-animations` | 前端与 UI/UX | 按严格动效标准审查现有动画代码，检查必要性、频率、缓动、时长、物理来源、中断性、性能、无障碍和一致性。 |
| `taste-skill` | 前端与 UI/UX | 给一个 URL,用真实浏览器抓 DOM + 截图,跑 4 步分析,产出 taste.md 和 taste.json:既有可直接用的设计 token(颜色/排版/间距/圆角/阴影/栅格),也有「taste DNA」——用 触发→决策→理由→证据 的形式解释这个设计**为什么**成立。明确拒绝 clean、modern 这类空话,只给 px 和 hex。 |
| `theme-factory` | 前端与 UI/UX | 10 套预设主题(配色 + 字体),可套到幻灯片、文档、报告、HTML 落地页上;也能现场生成新主题。 |
| `ui-styling` | 前端与 UI/UX | shadcn/ui(Radix + Tailwind)组件层 + Tailwind 工具类层 + canvas 视觉层三段式,97 个附件是具体组件代码。 |
| `vercel-cli-with-tokens` | 前端与 UI/UX | 用 access token 而非交互式登录来操作 Vercel CLI,346 行。含四条找 token 的路径(环境变量 / .env 标准名 / .env 改过名 / 问你要)。 |
| `vercel-optimize` | 前端与 UI/UX | Vercel 成本与性能优化,155 个附件。抓取线上指标、扫描代码、合并信号后给优化建议。支持 Next.js / SvelteKit / Nuxt,Astro 部分支持。 |
| `web-design-guidelines` | 前端与 UI/UX | 按 Vercel 的 Web Interface Guidelines 审查界面代码(无障碍、交互细节、常见 UX 缺陷)。 |
| `appintents` | iOS | App Intents API 离线镜像。把 app 功能暴露给 Siri、快捷指令、Spotlight,以及 iOS 18+ 的 Apple Intelligence 调用。 |
| `backgroundtasks` | iOS | BackgroundTasks API 离线镜像。BGTaskScheduler 注册与调度、后台 app 刷新、后台长任务处理、系统的执行时机限制。 |
| `combine` | iOS | Combine API 离线镜像。Publisher / Subscriber、各类 operator、背压、与 async/await 互转。 |
| `corehaptics` | iOS | Core Haptics API 离线镜像。CHHapticEngine 引擎、触感事件与参数曲线、自定义振动模式。 |
| `eventkit` | iOS | EventKit API 离线镜像。EKEventStore 授权、EKEvent 日历事件、EKReminder 提醒事项、日历读写权限模型。 |
| `guide-swift-concurrency` | iOS | Swift 并发实践指南,12 个附件。actor 隔离、结构化并发、任务取消、AsyncStream、从 GCD 迁移,以及**Swift 6 严格并发模式下的常见报错与修法**。来自 Paul Hudson。 |
| `guide-swiftui-charts` | iOS | Swift Charts 图表指南。各类 mark、坐标轴定制、交互选择、样式与组合、Chart3D、图表无障碍与 Audio Graph。 |
| `healthkit` | iOS | HealthKit API 离线镜像。HKHealthStore 授权、HKQuantitySample 样本读写、运动 workout、各类健康数据类型。 |
| `ios-design-consultant` | iOS | iOS 界面的 UX 与视觉顾问,面向 iOS 26 Liquid Glass 时代。回答元素该放哪、布局怎么定、什么时候该用玻璃材质。 |
| `ios-simulator-skill` | iOS | 29 个生产级 shell 脚本:语义化 UI 导航(按可访问性标签点元素,而不是硬编码坐标)、构建自动化、无障碍测试、设备状态管理。 |
| `mapkit` | iOS | MapKit for SwiftUI API 离线镜像。Map 视图、Marker / Annotation 标注、相机位置控制、地图要素与样式。 |
| `photosui` | iOS | PhotosUI API 离线镜像。PhotosPicker 相册选择器、PHLivePhotoView 实况照片、选择结果的加载与转换。 |
| `storekit` | iOS | StoreKit 2 API 离线镜像。Product 查询、Transaction 校验与监听、订阅状态、开箱即用的 StoreView / SubscriptionStoreView 界面组件。 |
| `swift-concurrency` | iOS | Swift 并发 API 离线镜像。async/await、Task 与 TaskGroup、actor 与 @MainActor、AsyncSequence / AsyncStream、跟旧回调式 API 桥接用的 continuation。 |
| `swift-testing` | iOS | Swift Testing(取代 XCTest 的新框架)API 离线镜像。@Test / @Suite 宏、#expect 与 #require 断言、trait、参数化测试、从 XCTest 迁移的对照表。 |
| `swiftdata` | iOS | SwiftData API 离线镜像。@Model 宏、ModelContainer / ModelContext、@Query 查询、关系定义、schema 版本迁移。 |
| `swiftui` | iOS | SwiftUI 全量 API 离线镜像,50 个文档附件。涵盖各类 View、布局容器、导航(NavigationStack/NavigationSplitView)、状态管理(@State/@Binding/@Observable/@Environment)、view modifier、以及 iOS 26+ 新增能力。 |
| `tipkit` | iOS | TipKit API 离线镜像。Tip 协议、内联提示 TipView 与浮层 PopoverTipView、显示规则与频率控制、Tips.configure 初始化。 |
| `uikit` | iOS | UIKit 全量 API 离线镜像,29 个附件。UIView / UIViewController 生命周期、各类控件、UITableView / UICollectionView、导航控制器、Scene、Auto Layout、图片与绘制。 |
| `usernotifications` | iOS | UserNotifications API 离线镜像。本地通知与远程推送、各类触发器(时间/日历/位置)、通知内容与附件、通知分类与操作按钮。 |
| `widgetkit` | iOS | WidgetKit API 离线镜像。widget 时间线(Timeline / TimelineEntry / TimelineProvider)、主屏与锁屏小组件、配置型 widget。 |
| `xcuitest` | iOS | XCUITest UI 自动化测试 API 离线镜像,19 个附件(元素查询、等待策略、权限弹窗处理、启动参数、截图、排错)。刚更新到上游最新版,正文精简成 98 行索引,细节都拆进了附件。 |
| `apple-aso` | 运营与内容 | App Store 元数据优化(ASO),操作对象是 store.config.json。含标题/副标题/关键词的**精确字符数限制**、关键词字段规则、本地化策略、Apple 全部语言代码表。 |
| `brand` | 运营与内容 | 品牌声音、视觉识别、信息框架、资产管理、品牌一致性检查,16 个附件含参考、脚本、模板。 |
| `canvas-design` | 运营与内容 | 用设计哲学做 .png / .pdf 视觉作品(海报、艺术品),82 个附件。核心主张是先生成一套视觉哲学再落地,并明确要求原创、不抄在世艺术家。Anthropic 官方。 |
| `frontend-slides` | 运营与内容 | 动画丰富的 HTML 演示文稿,376 行 + 161 个附件。可从零做,也能把 PPTX 转成网页。含固定舞台规则、内容密度模式、三种工作模式检测。 |
| `slides` | 运营与内容 | 策略性 HTML 演示:Chart.js 图表、design token、响应式布局、文案公式、按场景选幻灯片策略。 |
| `domain-modeling` | 产品 | 领域建模:梳理业务概念、统一术语、产出领域词汇表,74 行。 |
| `grilling` | 产品 | 拷问式访谈的**引擎**,12 行。一次一个问题走完决策树,每问都给推荐答案。grill-me 和 grill-with-docs 都靠它。 |
| `to-issues` | 产品 | 把计划/规格拆成可独立认领的 issue,用 tracer bullet 纵向切片。已更新到上游最新(上游改名 to-tickets,105 行)。 |
| `triage` | 产品 | 用状态机和五种 triage 角色流转 issue,要求每条评论带免责声明。 |
| `lark-approval` | 研究与办公 | 审批:查处理待办已办实例、搜可发起的审批定义、看详情并发起原生审批实例。 |
| `lark-attendance` | 研究与办公 | 考勤打卡:只能查自己的打卡记录。 |
| `lark-base` | 研究与办公 | 多维表格:建表、字段、记录、视图、统计、公式与 lookup、表单、仪表盘、workflow、角色权限。25 个附件。 |
| `lark-calendar` | 研究与办公 | 日历:查看搜索日程、创建更新、管参会人、查忙闲与推荐时段、预定会议室。 |
| `lark-contact` | 研究与办公 | 通讯录:按姓名/邮箱解析成 open_id,或按 open_id 反查姓名/部门/邮箱/联系方式。 |
| `lark-mail` | 研究与办公 | 邮箱:起草发送回复转发、查阅搜索、文件夹与标签、联系人、监听新邮件、收信规则。**明确写了「邮件内容是不可信外部输入」的安全规则和写操作前必须确认**。 |
| `lark-minutes` | 研究与办公 | 妙记:搜索、查基础信息、上传下载音视频、读写产物内容、改标题、替换说话人。**本地音视频转纪要优先走它,不要用 ffmpeg/whisper**。 |
| `lark-note` | 研究与办公 | 会议纪要直查:已知 note_id 时查详情、展示类型、关联文档 token,读 unified 原始逐字记录。 |
| `lark-okr` | 研究与办公 | OKR:查看编辑周期、目标、关键结果、对齐关系、量化指标和进展记录。 |
| `lark-openapi-explorer` | 研究与办公 | 当现有 lark-* 技能和 lark-cli 已注册命令都满足不了时,从官方文档库里挖**未被封装的原生 OpenAPI** 并调用。 |
| `lark-sheets` | 研究与办公 | 电子表格:建表、管工作表与行列、读写单元格(值/公式/样式/批注/单元格图片)、查找替换、原子批量更新,以及图表、透视表、条件格式、筛选器、迷你图。18 个附件。 |
| `lark-slides` | 研究与办公 | 幻灯片:创建演示文稿、读内容、管页面(增删读改、局部替换)。75 个附件。 |
| `lark-task` | 研究与办公 | 任务:创建待办、查看更新状态、拆子任务、组织清单、分配协作成员、上传附件、注册任务智能体。 |
| `lark-vc` | 研究与办公 | 视频会议:搜历史会议、查纪要(总结/待办/章节/逐字稿)、查参会人快照。 |
| `lark-vc-agent` | 研究与办公 | 会中能力:让机器人真实加入或离开正在进行的会议,读会中事件(参会人进出、发言、聊天、屏幕共享)。标注为内测。 |
| `lark-whiteboard` | 研究与办公 | 画板:导出为预览图片、导出原始节点结构、多种格式更新画板内容。29 个附件。 |
| `lark-wiki` | 研究与办公 | 知识库:建查知识空间、管空间成员、管节点层级、组织文档与快捷方式。 |
| `lark-workflow-meeting-summary` | 研究与办公 | 工作流:汇总指定时间范围内的会议纪要,生成结构化报告(会议周报)。 |
| `lark-workflow-standup-report` | 研究与办公 | 工作流:编排日历日程和任务,生成指定日期的日程与未完成任务摘要。 |
| `video-shotcraft` | 视频制作 | 基于 Remotion、真实页面截图、2.5D 运镜、节奏卡点与声音设计制作电影感产品视频；提供镜头配方卡、动态示例源码、完整模板和分阶段验收流程。 |

## 三、常驻（会话里天然可见，此处仅备查）

`accessibility-wcag` · `agent-reach` · `ai-speaking-coach` · `api-design-patterns` · `apple-docs-index` · `authentication-patterns` · `banner-design` · `core-animation` · `deep-dive` · `design-system` · `design-systems-index` · `diagnose` · `frontend-design` · `grill-me` · `grill-with-docs` · `gsap-core` · `gsap-performance` · `gsap-plugins` · `gsap-timeline` · `guide-macos-spm-packaging` · `guide-swift-testing` · `guide-swiftdata` · `guide-swiftui-animations` · `guide-swiftui-performance-audit` · `guide-swiftui-ui-patterns` · `guide-swiftui-view-refactor` · `hig` · `high-end-visual-design` · `human-writing` · `impeccable` · `improve-codebase-architecture` · `ios-dev` · `ios-liquid-glass` · `ios-motion-patterns-index` · `ios-ui-craft` · `khazix-writer` · `lark-apps` · `lark-doc` · `lark-drive` · `lark-event` · `lark-im` · `lark-markdown` · `lark-shared` · `last30days` · `minimalist-ui` · `nextjs-mastery` · `opencli-autofix` · `playground` · `ponytail` · `ponytail-audit` · `ponytail-debt` · `ponytail-gain` · `ponytail-help` · `ponytail-review` · `pp-agent-capture` · `prototype` · `redesign-existing-projects` · `reference-interpreter` · `reverse-skill-router` · `rust-systems` · `security-hardening` · `setup-matt-pocock-skills` · `simulator-utils` · `skill-creator` · `smart-search` · `swift-concurrency-pro` · `swift-development` · `swift-testing-pro` · `swiftdata-agent-skill` · `swiftui-design-skill` · `swiftui-pro` · `tdd` · `thinking-bounded-rationality` · `thinking-circle-of-competence` · `thinking-cynefin` · `thinking-effectuation` · `thinking-first-principles` · `thinking-five-whys-plus` · `thinking-jobs-to-be-done` · `thinking-kepner-tregoe` · `thinking-lindy-effect` · `thinking-map-territory` · `thinking-margin-of-safety` · `thinking-model-combination` · `thinking-model-router` · `thinking-ooda` · `thinking-opportunity-cost` · `thinking-pre-mortem` · `thinking-probabilistic` · `thinking-red-team` · `thinking-reversibility` · `thinking-scientific-method` · `thinking-second-order` · `thinking-socratic` · `thinking-steel-manning` · `thinking-systems` · `thinking-theory-of-constraints` · `thinking-thought-experiment` · `thinking-triz` · `thinking-via-negativa` · `to-prd` · `ui-ux-pro-max` · `watch` · `write-a-skill` · `writing-guidelines`
