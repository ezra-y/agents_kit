# 收藏技能总目录

全部收藏 **318** 个：未收录索引 **11** · 已收录 **307**（其中常驻 **75**）

匹配优先级：配置启用（实际加载用 `check --runtime` 核验）→ 已收录未常驻（启用即可，零下载）→
未收录索引（从上游安装）。按描述匹配即可；描述拿不准、候选难取舍或任务
关键时再读全文——已收录的直接读本地
`~/agents_kit/skills/` 或 owner Plugin 中的 `SKILL.md`，未收录的点「技能」列链接
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

### victorzhang016-code-victor-design（1 个 · 扫描版本 `8ff6b367d`）

- 来源：https://github.com/victorzhang016-code/victor-design.git
- 安装：`agents-kit skill import https://github.com/victorzhang016-code/victor-design.git --candidate <候选路径> --category <分类> --scope <global|project> --description "<中文说明>" --tag <标签>…`

| 技能 | 用途 | 候选路径 | 已装 |
|---|---|---|:--:|
| [victor-design](https://raw.githubusercontent.com/victorzhang016-code/victor-design/HEAD/SKILL.md) | 视觉设计与 Figma 交付工作流：从任务分析、字体与版式，到材质处理、HTML 海报和可编辑 UI 迁移。 | `.` |  |

### xixicc2027（1 个 · 扫描版本 `5573a7ef1`）

2027届秋招信息聚合，包含 qiuzhao-feed Skill

- 来源：https://github.com/xixicc186/xixicc2027.git
- 安装：`agents-kit skill import https://github.com/xixicc186/xixicc2027.git --candidate <候选路径> --category <分类> --scope <global|project> --description "<中文说明>" --tag <标签>…`

| 技能 | 用途 | 候选路径 | 已装 |
|---|---|---|:--:|
| [qiuzhao-feed](https://raw.githubusercontent.com/xixicc186/xixicc2027/HEAD/skill/qiuzhao-feed/SKILL.md) | 从 GitHub 仓库 xixicc186/xixicc2027 抓取最新的 2027 届秋招信息，并用喜茶风格前端页面 在本地浏览器展示。当用户说"看看最新秋招"、"秋招信息"、"有什么新的校招/网申"、"哪些公司 快截止了"、"看看互联网/央国企的秋招"、"打开秋招页面"、"qiuzhao"、"xixicc2027" 等任何 查询秋招/校招/网申信息的场景时使用。支持按行业、关键词、截止日期过滤。数据每日更新在 GitHub 上，本 skill 总是拉取远端最新数据，不要用本地 pipeline 的旧产出替代。 | `skill/qiuzhao-feed` | ● |

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
| `build-mcpb` | AI Building | 把本地 MCP 服务打包成可安装的 .mcpb，覆盖 Node/Python 运行时打包、manifest、跨平台路径、本地权限和发布检查。Anthropic 官方。 |
| `caveman` | AI Building | 超压缩沟通模式,砍掉虚词和客套,据称省约 75% token。 |
| `claude-md-improver` | AI Building | 扫描仓库里所有 CLAUDE.md,做质量评估出报告,再做定向修改。 |
| `hook-development` | AI Building | 写 hook,707 行。PreToolUse / PostToolUse / Stop 各类钩子、prompt 型(推荐)与命令型的取舍、插件 hooks.json 格式、工具调用校验。 |
| `lark-skill-maker` | AI Building | 把飞书 API 操作封装成可复用的自定义 Skill(包装原子 API 或编排多步流程)。 |
| `session-report` | AI Building | 从 ~/.claude/projects 的会话记录生成可探索的 HTML 用量报告:token、缓存命中、子代理、技能调用、最贵的 prompt。 |
| `skill-development` | AI Building | 往插件里加技能、渐进披露设计原则、技能创建流程、description 怎么写才能被正确触发,632 行。 |
| `skill-publisher` | AI Building | 将 Agent Skill 发布、更新并核验到 GitHub、ClawHub、AgentSkill.sh、skills.sh、Claude 社区目录和 OpenAI Plugins，保留可恢复的跨平台回执。 |
| `writing-rules` | AI Building | 写 hookify 规则:规则文件格式、frontmatter、多条件高级写法,369 行。 |
| `authentication-patterns` | 后端 | 认证授权:JWT 访问令牌与刷新令牌的配对设计、鉴权中间件、OAuth2 授权码 + PKCE 完整流程、RBAC 角色模型,以及各自的反模式。 |
| `rust-systems` | 后端 | Rust 系统编程:所有权与借用、错误处理(thiserror/anyhow)、trait 与泛型设计、async 运行时、builder 模式、unsafe 使用准则。 |
| `security-hardening` | 后端 | 应用安全加固:输入校验、输出编码、SQL 注入防护、CSRF、内容安全策略 CSP、安全响应头、密钥管理、依赖漏洞审计。 |
| `architect` | 通用工程 | Sketch types, signatures, and module structure before code, then stay in the loop while implementation fills in. Use for /architect, 'architect this', 'design this', or non-trivial work where jumping to code would lock in the wrong shape. |
| `arena` | 通用工程 | Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape. |
| `automate-me` | 通用工程 | Use for "automate me", "create/update/refresh my -mode skill", "turn/capture my preferences or working style into a skill", or wanting agents to follow how the user works. Drafts or revises a personal -mode skill via plugin-dev:skill-development + unslop, optionally pulling fresh evidence from recent transcripts. |
| `babysit` | 通用工程 | Watch an open PR — fix failing CI, handle the straightforward review comments, and drive it to a mergeable state. Claude Code analog of Cursor's built-in /babysit. Use after opening a PR when the user wants the agent to shepherd it without re-prompting. |
| `blast-radius` | 通用工程 | Find what a change could break somewhere else before it ships, beyond the diff, and prove the one fact it's safe because of by running real code instead of writing it up. Use for 'blast radius of X', 'what could this break', or reviewing a small diff you don't trust. |
| `bro` | 通用工程 | Restate the last message in plain human language, with no jargon. |
| `create-verification-skill` | 通用工程 | Generate a project-local verification skill that drives your app the way a user does — any language, framework, or platform. Use for /create-verification-skill, "make a control skill for this repo", or when a project has no scripted way to prove UI/CLI/service behavior. |
| `deslop` | 通用工程 | Remove AI-generated code slop and clean up code style |
| `figure-it-out` | 通用工程 | Design an auditable playbook when no narrower one fits: a large migration, an ambitious multi-part change, or work a human reviews after stepping away. Scales rigor to the task, runs a hypothesis loop, and logs decisions via show-me-your-work. Use for /figure-it-out, 'figure it out', a large migration, or when no narrower playbook applies. |
| `fix-ci` | 通用工程 | Find failing PR checks, inspect logs or external check links, and apply focused fixes |
| `fix-merge-conflicts` | 通用工程 | Resolve merge conflicts non-interactively, validate build and tests, and finalize conflict resolution |
| `get-pr-comments` | 通用工程 | Fetch and summarize review comments from the active pull request |
| `guide-macos-spm-packaging` | 通用工程 | 不用 Xcode 工程、纯 SwiftPM 搭建构建打包 macOS app 的完整流程,15 个模板附件。含目录结构、资源处理、签名、公证,以及常见公证失败的排查表。 |
| `how` | 通用工程 | Use for "how does X work", code walkthroughs before changing something, and placement / ownership / layering questions ("where should this live", "which package owns this", "is this the right layer"). Explains subsystem architecture, runtime flow, onboarding mental models. Can critique architecture. Use why for motivation. |
| `interrogate` | 通用工程 | Use for "interrogate", "adversarial review", "multi-model review", "challenge this", "stress test this code", "find blind spots", or "tear this apart". Multiple LLM reviewers challenge changes from independent angles. |
| `maintain-verification-skill` | 通用工程 | Periodic pass that keeps a project's verification skill and feature map honest: parallel source readers per feature, one live session driving every feature, at most one PR of proven corrections. Use for /maintain-verification-skill or "audit the verify skill". |
| `make-pr-easy-to-review` | 通用工程 | Prepare PRs for review by cleaning noisy history, improving PR descriptions, and adding reviewer guidance without changing code behavior. Use for "make this easy to review", "tidy this PR", "clean up commits", or "annotate the diff". |
| `no-comments` | 通用工程 | Spawn the comment-sicko subagent, fix accepted findings, and offer encodings for claimed constraints. |
| `opencli-adapter-author` | 通用工程 | 给新站点写 opencli 适配器,或给已有站点加命令,15 个附件。从初次侦察、字段解码、写适配器到验证,含决策树、逐步 runbook 和卡住时的降级路径。中文写的。 |
| `poteto-mode` | 通用工程 | poteto's agent style for concise, detailed responses, deliberate subagents, unslopped prose, simple code, and verified work. Use for poteto, /poteto-mode, or requests to work in this style. |
| `principle-boundary-discipline` | 通用工程 | Apply when wiring validation, error handling, or framework adapters. Concentrate guards at system boundaries (CLI, config, network, external APIs); trust internal types and keep business logic in pure functions. |
| `principle-build-the-lever` | 通用工程 | Apply to any non-trivial work, not just bulk work: edits, migrations, analyses, checks. Build the tool that does it or proves it (codemod, script, generator, or a skill your subagents follow) instead of working by hand. The tool is the artifact a reviewer can rerun. |
| `principle-encode-lessons-in-structure` | 通用工程 | Apply when you catch yourself writing the same instruction a second time, or notice a recurring correction. Encode the rule as a lint, metadata flag, runtime check, or script instead of more text. |
| `principle-exhaust-the-design-space` | 通用工程 | Apply when facing a novel UI interaction or architectural decision with no precedent in the codebase. Build 2-3 competing prototypes and compare side by side before committing. |
| `principle-experience-first` | 通用工程 | Apply when product, UX, or feature-scope tradeoffs come up. Choose user delight over implementation convenience; ship fewer polished features over more rough ones. |
| `principle-fix-root-causes` | 通用工程 | Apply when debugging. Trace each symptom to its root cause and fix it there; reproduce first, ask why until you reach it, resist nil-check guards that silence crashes. |
| `principle-foundational-thinking` | 通用工程 | Apply before writing logic: choosing core types and data structures, sequencing scaffold-vs-feature work, asking what concurrent actors share. Get the data structures right so downstream code becomes obvious. |
| `principle-guard-the-context-window` | 通用工程 | Apply when context is filling up: large outputs, long files, repeated reads, fan-out planning. Route bulk to subagents; keep summaries in the main thread, not raw payloads. |
| `principle-laziness-protocol` | 通用工程 | Apply when refactoring, evaluating diff size, or tempted to add abstractions, layers, or signal threading. Bias toward deletion and the smallest change that solves the problem. |
| `principle-make-operations-idempotent` | 通用工程 | Apply when designing commands, lifecycle steps, or processing loops that run amid crashes, restarts, and retries. Converge to the same end state regardless of partial prior runs. |
| `principle-migrate-callers-then-delete-legacy-apis` | 通用工程 | Apply when introducing a new internal API while old callers still exist. Migrate callers and delete the old API in the same wave instead of preserving compatibility layers. |
| `principle-minimize-reader-load` | 通用工程 | Apply when reviewing or shaping code that's hard to trace. Count layers between question and answer, and hidden state in the reader's head; collapse one-caller wrappers and shrink mutable scope. |
| `principle-model-the-domain` | 通用工程 | Apply when writing stateful logic, or when code branches a lot or repeats a shape assumption across files. Encode the domain in a structure instead of scattered conditionals. |
| `principle-never-block-on-the-human` | 通用工程 | Apply when tempted to ask 'should I do X?' on reversible work. Proceed, present the result, let the human course-correct after the fact; reserve confirmation for irreversible actions. |
| `principle-outcome-oriented-execution` | 通用工程 | Apply during planned rewrites and migrations with explicit phase boundaries. Converge on the target architecture; don't preserve smooth intermediate states with throwaway compatibility code. |
| `principle-prove-it-works` | 通用工程 | Apply after completing a task, before declaring done. Verify against the real artifact (run the feature, read the actual value, inspect the diff), not a proxy, self-report, or 'it compiles.' |
| `principle-redesign-from-first-principles` | 通用工程 | Apply when integrating a new requirement into an existing design. Redesign as if the requirement had been a foundational assumption from day one, instead of bolting it on. |
| `principle-separate-before-serializing-shared-state` | 通用工程 | Apply when concurrent actors might write to the same file, branch, key, or state object. Eliminate the sharing first; serialize structurally only when one shared writer is a real invariant. |
| `principle-sequence-verifiable-units` | 通用工程 | Apply to multi-step work (sweeps, migrations, runs of similar edits) and to how you stack commits and PRs. Break work into small units that each end in a verifiable state, check each before the next, and order delivery so the sequence proves itself to a reviewer. |
| `principle-subtract-before-you-add` | 通用工程 | Apply when sequencing an addition, refactor, or rewrite. Remove dead weight, redundant validators, and stub references first, then build on the simpler base. |
| `principle-type-system-discipline` | 通用工程 | Apply when designing types, reviewing a function signature, or writing code in any statically-typed language. Make illegal states unrepresentable, brand semantic primitives, parse external data at boundaries, refuse to lie to the compiler, exhaust variants, derive from authoritative schemas. |
| `recall` | 通用工程 | Reconstruct your recent working context from your own chat history, live state, and the shared record (user reports, prior fixes, incidents), then hand back a tight current-state brief. Use for 'recall my work on X', 'catch me up', 'what have I been working on', 'where did I leave off', before starting or resuming work. |
| `reflect` | 通用工程 | Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect. |
| `setup-pstack` | 通用工程 | Configure pstack's provider-qualified models, per-family requested effort, and parent-owned routes per role. Verifies native and external Claude, Codex, and Grok lanes before writing the override sheet. Use for /setup-pstack, "configure pstack models", or changing pstack's model choices. |
| `show-me-your-work` | 通用工程 | Keep a reviewable decision trail for long-running or unattended work: a TSV log with one row per decision (what, why, evidence, result). Local by default; commit it when a reviewer needs the trail to trust the result. Use for /show-me-your-work, autonomous or multi-phase runs, or work a human reviews after stepping away. |
| `swarm` | 通用工程 | Fan out N parallel workers, drain them, and return one report. Use for /swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration. |
| `tdd` | 通用工程 | Use only when the user explicitly asks for TDD, a failing test, or a regression test, OR when the bug has an obvious cheap local test target. Skip when the test path is unclear, expensive, integration-heavy, or not requested. |
| `teach` | 通用工程 | Explain a body of work plainly so a person actually understands it. Runs the `how` and `why` skills and weaves what they find into one clear explanation. Use for 'teach me this', 'help me really understand X', 'explain this change or subsystem to me'. |
| `technical-writing` | 通用工程 | Layered technical-writing standard: Diátaxis structure, Google developer style sentences, STE instruction rules, Global English syntax. Use for /technical-writing or when writing or reviewing docs, RFCs, readmes, PR descriptions, or commit messages. |
| `thermo-nuclear-code-quality-review` | 通用工程 | Run an extremely strict maintainability review for abstraction quality, giant files, and spaghetti-condition growth. Use for a thermo-nuclear code quality review, thermonuclear review, deep code quality audit, or especially harsh maintainability review. |
| `typescript-best-practices` | 通用工程 | TypeScript guidance for type design, coding conventions, and code review. Use when the task needs TypeScript-specific design or review guidance. |
| `unslop` | 通用工程 | Edit existing text to remove empty phrases and unnatural wording. Use when the user requests copy editing or removal of AI writing patterns. |
| `what-did-i-get-done` | 通用工程 | Summarize authored commits over a user-specified time period into a concise update |
| `why` | 通用工程 | Use for 'why does X work this way', 'why we picked Y', design rationale, regressions, postmortems, or data-backed thresholds. Discovers available MCPs and queries each evidence category (source control, issue tracker, long-form docs, real-time chat, infrastructure observability, error tracking, product analytics warehouse) in parallel, then returns a cited read on decisions and tradeoffs. Use how for runtime behavior. |
| `zoom-out` | 通用工程 | 让 agent 抬升一个抽象层,给出相关模块和调用方的地图。正文只有 2 行,标了仅手动调用。 |
| `animate` | 前端与 UI/UX | 从零实现高质量 Web 动效：依次判断是否该动、动效目的、工具、属性、缓动、时长、中断和退出，并直接写实现。 |
| `animation-vocabulary` | 前端与 UI/UX | 动效术语反查词典：把模糊的视觉描述映射为准确的 Web 动画名称，便于向设计师或 AI 清楚表达。 |
| `apple-design` | 前端与 UI/UX | 将 Apple 的流体界面原则转译到 Web：覆盖跟手手势、可中断弹簧、速度继承、材质层次、排版和减少动态效果。 |
| `composition-patterns` | 前端与 UI/UX | 能扩展的 React 组合模式,专治 boolean prop 泛滥(一个组件挂十几个 isXxx)。compound components、render props、context provider,以及 React 19 的 API 变化。刚更新到上游最新。 |
| `deploy-to-vercel` | 前端与 UI/UX | 部署到 Vercel。按你项目的实际状态分支处理:已 link 且有 git remote 走 git push;已 link 无 remote 走 vercel deploy;未 link 先 link;未认证走安装认证流程;还有无认证时的沙箱兜底。 |
| `design` | 前端与 UI/UX | 设计总入口：品牌识别、设计 token、UI 样式、Logo 生成（55 风格，通过 Codex Imagegen 使用 GPT Image 2，无需单独 API key）、CIP 企业识别（50 项交付物 + mockup）、HTML 演示（Chart.js）、banner（22 风格）、图标（15 风格 SVG，走 Gemini 3.1 Pro）、社交配图（HTML 转截图，多平台）。 |
| `design-assets-index` | 前端与 UI/UX | 现成素材的外链索引:图库、图标集、字体、配色、mockup、UI kit、模板。来自 awesome-design 等合集。 |
| `design-system` | 前端与 UI/UX | 三层 token 架构(primitive → semantic → component)、CSS 变量落地、间距与排版比例、组件规格文档,25 个附件。 |
| `design-systems-index` | 前端与 UI/UX | 各大公司设计系统的外链索引(Material、Fluent、Carbon、Polaris、Atlassian、Lightning)+ token 工具与规范 + React / RN 设计系统组件库。 |
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
| `nextjs-mastery` | 前端与 UI/UX | Next.js App Router:目录结构约定、RSC 服务端组件取数、ISR 增量再生与缓存、中间件、并行路由、Server Actions。 |
| `pick-ui-library` | 前端与 UI/UX | 从一份有明确偏好的清单中为前端任务选择 UI、动效、图表、状态和性能库，并优先复用项目已安装方案。 |
| `react-best-practices` | 前端与 UI/UX | Vercel 工程团队的 React / Next.js 性能准则,75 个附件。按严重度分级:消灭请求瀑布(CRITICAL)、打包体积(CRITICAL)、服务端性能(HIGH)。刚更新到上游最新。 |
| `react-native-skills` | 前端与 UI/UX | React Native / Expo 最佳实践,41 个附件。列表性能(CRITICAL)、动画、导航、原生模块对接。刚更新到上游最新。 |
| `react-patterns` | 前端与 UI/UX | React 19 新特性:use() 钩子、Server Components、Server Actions、useActionState、useOptimistic 乐观更新、Suspense 边界。 |
| `react-view-transitions` | 前端与 UI/UX | React View Transition API:<ViewTransition> 组件、addTransitionType 转场类型、CSS 伪元素定制、方向性(前进/后退)导航动画、列表重排动画、Next.js 集成。刚更新到上游最新。 |
| `redesign-existing-projects` | 前端与 UI/UX | 给**已有**站点做升级:先审计现状、识别出通用 AI 套路,再套高端标准,且不破坏现有功能。兼容任何 CSS 框架。 |
| `review-animations` | 前端与 UI/UX | 按严格动效标准审查现有动画代码，检查必要性、频率、缓动、时长、物理来源、中断性、性能、无障碍和一致性。 |
| `taste-skill` | 前端与 UI/UX | 给一个 URL,用真实浏览器抓 DOM + 截图,跑 4 步分析,产出 taste.md 和 taste.json:既有可直接用的设计 token(颜色/排版/间距/圆角/阴影/栅格),也有「taste DNA」——用 触发→决策→理由→证据 的形式解释这个设计**为什么**成立。明确拒绝 clean、modern 这类空话,只给 px 和 hex。 |
| `theme-factory` | 前端与 UI/UX | 10 套预设主题(配色 + 字体),可套到幻灯片、文档、报告、HTML 落地页上;也能现场生成新主题。 |
| `ui-styling` | 前端与 UI/UX | shadcn/ui(Radix + Tailwind)组件层 + Tailwind 工具类层 + canvas 视觉层三段式,97 个附件是具体组件代码。 |
| `vercel-cli-with-tokens` | 前端与 UI/UX | 用 access token 而非交互式登录来操作 Vercel CLI,346 行。含四条找 token 的路径(环境变量 / .env 标准名 / .env 改过名 / 问你要)。 |
| `vercel-optimize` | 前端与 UI/UX | Vercel 成本与性能优化,155 个附件。抓取线上指标、扫描代码、合并信号后给优化建议。支持 Next.js / SvelteKit / Nuxt,Astro 部分支持。 |
| `web-design-guidelines` | 前端与 UI/UX | 按 Vercel 的 Web Interface Guidelines 审查界面代码(无障碍、交互细节、常见 UX 缺陷)。 |
| `appintents` | iOS | App Intents API 离线镜像。把 app 功能暴露给 Siri、快捷指令、Spotlight,以及 iOS 18+ 的 Apple Intelligence 调用。 |
| `apple-docs-index` | iOS | Apple 开发者文档的**索引**,不含正文。用来回答「某个框架里到底有哪些 API」「这个东西的文档路径是什么」,再决定要不要去拉详细文档。 |
| `backgroundtasks` | iOS | BackgroundTasks API 离线镜像。BGTaskScheduler 注册与调度、后台 app 刷新、后台长任务处理、系统的执行时机限制。 |
| `combine` | iOS | Combine API 离线镜像。Publisher / Subscriber、各类 operator、背压、与 async/await 互转。 |
| `core-animation` | iOS | Core Animation(QuartzCore)API 离线镜像,21 个附件。CALayer 图层树、CABasicAnimation / CAKeyframeAnimation / CASpringAnimation、CATransaction 事务、CAShapeLayer 与 CAGradientLayer。 |
| `corehaptics` | iOS | Core Haptics API 离线镜像。CHHapticEngine 引擎、触感事件与参数曲线、自定义振动模式。 |
| `eventkit` | iOS | EventKit API 离线镜像。EKEventStore 授权、EKEvent 日历事件、EKReminder 提醒事项、日历读写权限模型。 |
| `guide-swift-concurrency` | iOS | Swift 并发实践指南,12 个附件。actor 隔离、结构化并发、任务取消、AsyncStream、从 GCD 迁移,以及**Swift 6 严格并发模式下的常见报错与修法**。来自 Paul Hudson。 |
| `guide-swift-testing` | iOS | Swift Testing 实践指南。为什么用 struct 而非 class、异步测试用 confirmation、参数化测试、exit test、附件,以及**AI 写测试时常犯的错**。 |
| `guide-swiftdata` | iOS | SwiftData 避坑指南。autosave 的时机陷阱、关系定义、**会导致崩溃的危险谓词写法**、CloudKit 同步的硬性约束、索引、类继承支持。 |
| `guide-swiftui-animations` | iOS | SwiftUI 动画模式指南。隐式与显式动画的取舍、transition 转场、phase 与 keyframe 动画、Animatable 协议、iOS 18+ 的 @Animatable 宏。 |
| `guide-swiftui-charts` | iOS | Swift Charts 图表指南。各类 mark、坐标轴定制、交互选择、样式与组合、Chart3D、图表无障碍与 Audio Graph。 |
| `guide-swiftui-performance-audit` | iOS | SwiftUI 运行时性能审计流程:先做代码审查找出重绘源,再引导你用 Instruments 实际采样,最后结合数据定位。 |
| `guide-swiftui-ui-patterns` | iOS | SwiftUI 组件与界面构建的最佳实践,37 个示例附件。导航层级怎么搭、自定义 view modifier 怎么写、响应式布局、以及**状态归属**(哪个状态该放哪一层)的完整对照表。来自 Thomas Ricouard(Dimillian)。 |
| `guide-swiftui-view-refactor` | iOS | SwiftUI 视图重构准则,观点鲜明:视图内部按固定顺序排列、**默认用 MV 而不是 MVVM**、强烈优先拆成独立子视图类型而非 computed `some View`、把副作用移出 body、保持视图树稳定。 |
| `healthkit` | iOS | HealthKit API 离线镜像。HKHealthStore 授权、HKQuantitySample 样本读写、运动 workout、各类健康数据类型。 |
| `ios-design-consultant` | iOS | iOS 界面的 UX 与视觉顾问,面向 iOS 26 Liquid Glass 时代。回答元素该放哪、布局怎么定、什么时候该用玻璃材质。 |
| `ios-dev` | iOS | iOS/SwiftUI 任务的**总入口与路由器**。刚更新到上游最新。负责判断你的需求该走哪个 guide、哪份 API 镜像、哪个评审技能,并做正确性检查。 |
| `ios-simulator-skill` | iOS | 29 个生产级 shell 脚本:语义化 UI 导航(按可访问性标签点元素,而不是硬编码坐标)、构建自动化、无障碍测试、设备状态管理。 |
| `mapkit` | iOS | MapKit for SwiftUI API 离线镜像。Map 视图、Marker / Annotation 标注、相机位置控制、地图要素与样式。 |
| `photosui` | iOS | PhotosUI API 离线镜像。PhotosPicker 相册选择器、PHLivePhotoView 实况照片、选择结果的加载与转换。 |
| `simulator-utils` | iOS | 模拟器日常命令:截图并自动缩放到合适尺寸(强制)、设备增删启停、app 安装卸载与启动。 |
| `storekit` | iOS | StoreKit 2 API 离线镜像。Product 查询、Transaction 校验与监听、订阅状态、开箱即用的 StoreView / SubscriptionStoreView 界面组件。 |
| `swift-concurrency` | iOS | Swift 并发 API 离线镜像。async/await、Task 与 TaskGroup、actor 与 @MainActor、AsyncSequence / AsyncStream、跟旧回调式 API 桥接用的 continuation。 |
| `swift-concurrency-pro` | iOS | 审查已有 Swift 并发代码的正确性:数据竞争、actor 跨界、错误的 @MainActor 标注、async/await 常见误用。 |
| `swift-development` | iOS | Swift 全流程命令行操作:构建 SPM 包与 Xcode 工程、跑 XCTest 与 Swift Testing、simctl 管模拟器、代码签名与分发、SwiftFormat/SwiftLint、Swift 6 并发、Core Data/SwiftData。 |
| `swift-testing` | iOS | Swift Testing(取代 XCTest 的新框架)API 离线镜像。@Test / @Suite 宏、#expect 与 #require 断言、trait、参数化测试、从 XCTest 迁移的对照表。 |
| `swift-testing-pro` | iOS | 审查并改进已有的 Swift Testing 测试代码,推动用现代 API 重写。 |
| `swiftdata` | iOS | SwiftData API 离线镜像。@Model 宏、ModelContainer / ModelContext、@Query 查询、关系定义、schema 版本迁移。 |
| `swiftdata-agent-skill` | iOS | 审查并改进已有 SwiftData 代码,用现代 API 与最佳实践重写。 |
| `swiftui` | iOS | SwiftUI 全量 API 离线镜像,50 个文档附件。涵盖各类 View、布局容器、导航(NavigationStack/NavigationSplitView)、状态管理(@State/@Binding/@Observable/@Environment)、view modifier、以及 iOS 26+ 新增能力。 |
| `swiftui-design-skill` | iOS | SwiftUI 视觉设计,专门针对「一眼就看出是 AI 生成」的通用感。含设计方向选择、布局体系、排版、色彩、间距、品牌整合与设计评审。有中文 README。 |
| `swiftui-pro` | iOS | 审查已有 SwiftUI 代码:现代 API 用法是否过时、可维护性、性能问题。输出按文件组织的结构化评审意见。 |
| `tipkit` | iOS | TipKit API 离线镜像。Tip 协议、内联提示 TipView 与浮层 PopoverTipView、显示规则与频率控制、Tips.configure 初始化。 |
| `uikit` | iOS | UIKit 全量 API 离线镜像,29 个附件。UIView / UIViewController 生命周期、各类控件、UITableView / UICollectionView、导航控制器、Scene、Auto Layout、图片与绘制。 |
| `usernotifications` | iOS | UserNotifications API 离线镜像。本地通知与远程推送、各类触发器(时间/日历/位置)、通知内容与附件、通知分类与操作按钮。 |
| `widgetkit` | iOS | WidgetKit API 离线镜像。widget 时间线(Timeline / TimelineEntry / TimelineProvider)、主屏与锁屏小组件、配置型 widget。 |
| `xcuitest` | iOS | XCUITest UI 自动化测试 API 离线镜像,19 个附件(元素查询、等待策略、权限弹窗处理、启动参数、截图、排错)。刚更新到上游最新版,正文精简成 98 行索引,细节都拆进了附件。 |
| `apple-aso` | 运营与内容 | App Store 元数据优化(ASO),操作对象是 store.config.json。含标题/副标题/关键词的**精确字符数限制**、关键词字段规则、本地化策略、Apple 全部语言代码表。 |
| `brand` | 运营与内容 | 品牌声音、视觉识别、信息框架、资产管理、品牌一致性检查,16 个附件含参考、脚本、模板。 |
| `canvas-design` | 运营与内容 | 用设计哲学做 .png / .pdf 视觉作品(海报、艺术品),82 个附件。核心主张是先生成一套视觉哲学再落地,并明确要求原创、不抄在世艺术家。Anthropic 官方。 |
| `frontend-slides` | 运营与内容 | 动画丰富的 HTML 演示文稿,376 行 + 161 个附件。可从零做,也能把 PPTX 转成网页。含固定舞台规则、内容密度模式、三种工作模式检测。 |
| `marketing-agi` | 运营与内容 | A complete marketing department in one skill. Website and landing-page audits with weighted 0-100 scores, copywriting with panel scoring and AI-slop removal, an 18-tactic ad hook engine, GEO/AEO for getting cited by ChatGPT/Perplexity/AI Overviews, paid-ads creative diagnosis and production briefs, email sequences, LinkedIn/X writing, launch playbooks, positioning and offer design, competitor teardowns, app store optimization, honest analytics and test design. Use for ANY marketing task — audit, write, rewrite, diagnose, score, plan, launch, position, price, analyze — whenever the user mentions marketing, growth, conversion, copy, ads, hooks, CPM, ROAS, SEO, GEO, email, social, landing pages, funnels, launches, competitors, brand, positioning, pricing, or app stores, or says "my landing page sucks", "nobody's converting", "why are my CPMs up", "AI doesn't recommend us", "write me 20 hooks". Route via the table inside; fan out subagents for multi-dimensional work. Not for pure engineering, legal, or finance. |
| `meme-image` | 运营与内容 | 咩咩梗图制作：中文化、加字、修改与原创画面，统一调用已有做图能力 |
| `slides` | 运营与内容 | 策略性 HTML 演示:Chart.js 图表、design token、响应式布局、文案公式、按场景选幻灯片策略。 |
| `thinking-bounded-rationality` | 产品 | 有限理性。搜索或调研可能无止境时，先定一个明确的“够用”阈值，遇到第一个达标的选项就收手，不追最优解。 |
| `thinking-circle-of-competence` | 产品 | 能力圈。判断某个断言自己有没有依据时，先划出证据边界，再估错判的代价，然后选择回答、去查还是明说不知道，不硬编。 |
| `thinking-cynefin` | 产品 | Cynefin 框架。不清楚该用哪种应对方式时，先把问题归到简单、繁杂、复杂或混乱域，混乱域先拆解再定策略。 |
| `thinking-effectuation` | 产品 | 效果推理。真正无法预测时不做预测，盘点手里已有的资源，把下行风险压在可承受损失内，靠承诺推进，目标从可控行动里长出来。 |
| `thinking-first-principles` | 产品 | 第一性原理。某个约束被当成铁律时，把物理限制和行业惯例分开，只保留能独立成立的基本事实，再重建满足真实约束的最简方案。 |
| `thinking-five-whys-plus` | 产品 | 五问法增强版。故障已定位、直接原因已知但系统性根因未明时，每一层 why 都挂上证据，用反事实判断何时停，最后必须落到对策。 |
| `thinking-jobs-to-be-done` | 产品 | JTBD。决定做什么功能或排查为什么没人用时，还原用户在特定情境下雇这个方案取得什么进展，再按结果和现有替代方案排序。 |
| `thinking-kepner-tregoe` | 产品 | KT 法。用 IS/IS-NOT 差异分析定位只在部分场景出现的缺陷，或用 must/want 加权加不利后果对比做重大选型。 |
| `thinking-lindy-effect` | 产品 | 林迪效应。非易逝事物的存续时长可当作剩余寿命的先验，但要先检查领域有没有漂移，再决定要不要押已被时间验证的一方。 |
| `thinking-map-territory` | 产品 | 地图不是疆域。文档、测试、指标或假设和实际行为对不上时，停止从地图推理，去看活代码和真实数据，以实际观测为准。 |
| `thinking-margin-of-safety` | 产品 | 安全边际。做容量规划、设限额或给估算承诺时，按残余误差和击穿代价来定缓冲，而不是贴着乐观值。 |
| `thinking-model-combination` | 产品 | 模型组合。单个思维模型在跨领域或高风险问题上留有实质盲区时，按分工顺序组合互补模型，并事先定好冲突时听谁的。 |
| `thinking-model-router` | 产品 | 思维模型路由。不确定该用哪个 thinking-* 框架时，按领域×问题类型匹配，默认只给一个主模型或直接返回 NONE，最多三个互补。整套 28 个技能的入口。 |
| `thinking-ooda` | 产品 | OODA 循环。时间压力下局势还在变、必须在确定之前行动时，按观察→定向→决策→行动在七成把握上转起来，然后立刻重新观察。 |
| `thinking-opportunity-cost` | 产品 | 机会成本。投入稀缺的时间、人力或钱之前，点名这些资源被放弃的最佳用途，并算出选中方案相对它的价值差。 |
| `thinking-pre-mortem` | 产品 | 事前验尸。方案或上线定稿前先假设它已经失败，倒推具体死因，再把失败路径转成缓解措施、卡点和终止条件。 |
| `thinking-probabilistic` | 产品 | 概率思维。预测、估算或量化风险时锚定基础率，给区间而不是点值，按先验→似然→后验随证据更新，未测量的量用数量级边界兜住。 |
| `thinking-red-team` | 产品 | 红队视角。对自己有授权的代码、认证和 API 做安全审查，建攻击者模型、画攻击面，只报有可复现利用路径且验证过缓解措施的发现。 |
| `thinking-reversibility` | 产品 | 可逆性分类。投入大量思考之前先分清这个决定撤回是便宜还是昂贵，双向门快速定，单向门分阶段走以保留选项。 |
| `thinking-scientific-method` | 产品 | 科学方法。一个症状有多个可能原因时，把假设排成可证伪的序列，先跑最便宜的区分性观察，证据过关后才偏向假设最少的那个。 |
| `thinking-second-order` | 产品 | 二阶效应。改动会波及激励、规模和反馈回路时，带上时间和概率把后果链追一遍再拍板，不停在直接修复上。 |
| `thinking-socratic` | 产品 | 苏格拉底提问。需求含糊、预设很多或被说成“这还用问”时，先问出那几个真正承重的问题，暴露隐藏要求再动手。 |
| `thinking-steel-manning` | 产品 | 钢人论证。否掉一个提案或条件反射同意之前，先如实建出对立面最强的版本，写明什么条件下你会改变立场，再更新或维持。 |
| `thinking-systems` | 产品 | 系统思考。行为跨组件涌现、改这里坏那里、回路和延迟起主导时，画出边界、存量流量、反馈和系统原型，再排杠杆点。 |
| `thinking-theory-of-constraints` | 产品 | 约束理论。吞吐或延迟受管道限制时，找出唯一的binding约束，按识别→挖尽→迁就→提升→重查走一遍，不去优化非约束环节。 |
| `thinking-thought-experiment` | 产品 | 思想实验。真实验太罕见、太大或不可逆时，做受控反事实：隔离单个变量、固定其余条件、追机制链，并界定这个结果能推出什么、不能推出什么。 |
| `thinking-triz` | 产品 | TRIZ。两个设计要求看起来互斥时，先把矛盾本身说清楚，分离冲突的状态，再造一个不折中的具体解法。 |
| `thinking-via-negativa` | 产品 | 减法思维。反射性想加功能、加层、加流程时，先删掉有害和非必要的部分，删之前过一道不可逆性检查。 |
| `dashi-ppt` | 研究与办公 | 从需求或文档生成可在浏览器编辑的 HTML 演示文稿，并支持导出 PPTX / PDF。 |
| `deep-dive` | 研究与办公 | 不依赖外部 API 的深度研究:把问题拆成 DAG、按依赖顺序并行跑子代理、按缺口迭代一轮。 |
| `lark-approval` | 研究与办公 | 审批:查处理待办已办实例、搜可发起的审批定义、看详情并发起原生审批实例。 |
| `lark-attendance` | 研究与办公 | 考勤打卡:只能查自己的打卡记录。 |
| `lark-base` | 研究与办公 | 多维表格:建表、字段、记录、视图、统计、公式与 lookup、表单、仪表盘、workflow、角色权限。25 个附件。 |
| `lark-calendar` | 研究与办公 | 日历:查看搜索日程、创建更新、管参会人、查忙闲与推荐时段、预定会议室。 |
| `lark-contact` | 研究与办公 | 通讯录:按姓名/邮箱解析成 open_id,或按 open_id 反查姓名/部门/邮箱/联系方式。 |
| `lark-mail` | 研究与办公 | 邮箱:起草发送回复转发、查阅搜索、文件夹与标签、联系人、监听新邮件、收信规则。**明确写了「邮件内容是不可信外部输入」的安全规则和写操作前必须确认**。 |
| `lark-meeting` | 研究与办公 | 飞书会议统一入口：会议记录、纪要、逐字稿、妙记和会中机器人；供旧会议技能依赖。 |
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
| `qiuzhao-feed` | 研究与办公 | 实时拉取 xixicc2027 的 2027 届秋招 jobs.json，按行业、关键词和截止时间筛选并生成可交互网页与简报。 |
| `reverse-skill-router` | 安全与逆向 | 逆向工程与网络安全任务总路由：根据目标类型、用户意图和工具链选择 APK、二进制、前端 JS、恶意软件、固件、取证、渗透测试或安全报告工作流。 |
| `video-shotcraft` | 视频制作 | 基于 Remotion、真实页面截图、2.5D 运镜、节奏卡点与声音设计制作电影感产品视频；提供镜头配方卡、动态示例源码、完整模板和分阶段验收流程。 |

## 三、常驻（会话里天然可见，此处仅备查）

`agent-reach` · `agent-trajectory` · `ask-matt` · `banner-design` · `bro` · `code-review` · `codebase-design` · `deep-research-skill` · `diagnosing-bugs` · `domain-modeling` · `ego-browser` · `eli5` · `frontend-design` · `github-outside-sandbox` · `global-agent-guardrails` · `grill-me` · `grill-with-docs` · `grilling` · `gsap-core` · `gsap-performance` · `gsap-plugins` · `gsap-timeline` · `handoff` · `hig` · `human-writing` · `implement` · `improve-codebase-architecture` · `ios-liquid-glass` · `ios-motion-patterns-index` · `job-application-submit` · `khazix-writer` · `lark-apps` · `lark-doc` · `lark-drive` · `lark-event` · `lark-im` · `lark-markdown` · `lark-shared` · `last30days` · `minimalist-ui` · `official-apply` · `opencli-autofix` · `playground` · `ponytail` · `ponytail-audit` · `ponytail-debt` · `ponytail-gain` · `ponytail-help` · `ponytail-review` · `pp-agent-capture` · `prototype` · `recruitment-capability-evolution` · `recruitment-link` · `recruitment-session` · `research` · `resolving-merge-conflicts` · `resume-fill-review` · `setup-matt-pocock-skills` · `skill-creator` · `smart-search` · `speaking-head-teacher` · `speaking-learning-analyst` · `speaking-live-teacher` · `speaking-teaching-assistant` · `tdd` · `teach` · `to-questionnaire` · `to-spec` · `to-tickets` · `triage` · `ui-ux-pro-max` · `wait-what` · `wayfinder` · `wizard` · `writing-for-agents`
