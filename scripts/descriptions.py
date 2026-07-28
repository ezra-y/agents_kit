# -*- coding: utf-8 -*-
"""每个技能的中文说明 —— render.py 用它生成 docs/ 下的文档。

格式：  技能名: (分类, 推荐指数 1-5, 说明, 怎么触发)

加了新技能之后，在这里补一条，然后跑 scripts/render.py。
没补也不会报错，render.py 会退回用 SKILL.md 里的英文 description。

推荐指数的尺度不是「质量好不好」，而是「留着值不值这份上下文税」：
  5 = 模型完全不可能知道（私有工具、离线 API 文档、具体规格）
  3 = 有用但可被替代
  1 = 通用知识模型本来就会，或上游已废弃
"""

C_FE='前端 / Web UI'; C_ANIM='动画 / 动效'; C_DSGN='设计系统 / 视觉'
C_RCT='React / Vercel'; C_APPLE='iOS / Swift / Apple'; C_BE='后端 / 通用工程'
C_META='Claude Code 元技能'; C_ENG='工程方法论'; C_LARK='飞书 Lark'; C_MISC='其他 / 杂项'

CATS=[C_FE,C_ANIM,C_RCT,C_DSGN,C_APPLE,C_BE,C_META,C_ENG,C_LARK,C_MISC]

D = {

# ══════════ iOS / Swift / Apple ══════════
# ── A. Apple 官方文档离线镜像（frontmatter 带 context:fork + agent:Explore，
#      意思是它们跑在独立子代理里查资料，查完只把结论带回来，不占主对话上下文）──
'swiftui': (C_APPLE,4,'SwiftUI 全量 API 离线镜像,50 个文档附件。涵盖各类 View、布局容器、导航(NavigationStack/NavigationSplitView)、状态管理(@State/@Binding/@Observable/@Environment)、view modifier、以及 iOS 26+ 新增能力。','说「查 SwiftUI 的 XXX 怎么用」「NavigationStack 的 API 是什么」。这一组都跑在独立子代理里,查完只带结论回来,不占你的主上下文。'),
'uikit': (C_APPLE,3,'UIKit 全量 API 离线镜像,29 个附件。UIView / UIViewController 生命周期、各类控件、UITableView / UICollectionView、导航控制器、Scene、Auto Layout、图片与绘制。','维护老项目或做 UIKit↔SwiftUI 桥接时说「查 UIKit 的 XXX」。纯新项目基本用不到。'),
'swiftdata': (C_APPLE,3,'SwiftData API 离线镜像。@Model 宏、ModelContainer / ModelContext、@Query 查询、关系定义、schema 版本迁移。','说「SwiftData 怎么定义关系」「@Query 的谓词怎么写」。想要**避坑建议**而不是 API 清单,用 guide-swiftdata;想让人**审你写好的代码**,用 swiftdata-agent-skill。'),
'swift-concurrency': (C_APPLE,3,'Swift 并发 API 离线镜像。async/await、Task 与 TaskGroup、actor 与 @MainActor、AsyncSequence / AsyncStream、跟旧回调式 API 桥接用的 continuation。','说「TaskGroup 怎么用」「AsyncStream 的 API」。要**Swift 6 严格并发的避坑指南**用 guide-swift-concurrency,要**审代码**用 swift-concurrency-pro。'),
'swift-testing': (C_APPLE,3,'Swift Testing(取代 XCTest 的新框架)API 离线镜像。@Test / @Suite 宏、#expect 与 #require 断言、trait、参数化测试、从 XCTest 迁移的对照表。','说「#expect 和 #require 有什么区别」「参数化测试怎么写」。'),
'xcuitest': (C_APPLE,4,'XCUITest UI 自动化测试 API 离线镜像,19 个附件(元素查询、等待策略、权限弹窗处理、启动参数、截图、排错)。刚更新到上游最新版,正文精简成 98 行索引,细节都拆进了附件。','说「UI 测试怎么等元素出现」「怎么处理系统权限弹窗」。UI 测试最容易卡在「元素找不到 / 时序不对」,这个附件里有成套的等待模式。'),
'storekit': (C_APPLE,3,'StoreKit 2 API 离线镜像。Product 查询、Transaction 校验与监听、订阅状态、开箱即用的 StoreView / SubscriptionStoreView 界面组件。','做内购或订阅时说「StoreKit 2 怎么校验交易」。StoreKit 2 和老 StoreKit 差别极大,模型容易串到旧写法,查一下更稳。'),
'appintents': (C_APPLE,3,'App Intents API 离线镜像。把 app 功能暴露给 Siri、快捷指令、Spotlight,以及 iOS 18+ 的 Apple Intelligence 调用。','说「怎么把这个功能做成快捷指令」「App Intents 怎么定义参数」。'),
'widgetkit': (C_APPLE,2,'WidgetKit API 离线镜像。widget 时间线(Timeline / TimelineEntry / TimelineProvider)、主屏与锁屏小组件、配置型 widget。','说「小组件怎么定时刷新」。'),
'usernotifications': (C_APPLE,2,'UserNotifications API 离线镜像。本地通知与远程推送、各类触发器(时间/日历/位置)、通知内容与附件、通知分类与操作按钮。','说「本地通知怎么按日历重复」。'),
'healthkit': (C_APPLE,2,'HealthKit API 离线镜像。HKHealthStore 授权、HKQuantitySample 样本读写、运动 workout、各类健康数据类型。','做健康类 app 时说「HealthKit 怎么请求步数权限」。'),
'eventkit': (C_APPLE,2,'EventKit API 离线镜像。EKEventStore 授权、EKEvent 日历事件、EKReminder 提醒事项、日历读写权限模型。','说「怎么往系统日历写事件」。'),
'mapkit': (C_APPLE,2,'MapKit for SwiftUI API 离线镜像。Map 视图、Marker / Annotation 标注、相机位置控制、地图要素与样式。','说「SwiftUI 的 Map 怎么加标注」。'),
'photosui': (C_APPLE,2,'PhotosUI API 离线镜像。PhotosPicker 相册选择器、PHLivePhotoView 实况照片、选择结果的加载与转换。','说「PhotosPicker 怎么限制只选视频」。'),
'tipkit': (C_APPLE,2,'TipKit API 离线镜像。Tip 协议、内联提示 TipView 与浮层 PopoverTipView、显示规则与频率控制、Tips.configure 初始化。','做新手引导时说「TipKit 怎么控制只提示一次」。'),
'corehaptics': (C_APPLE,2,'Core Haptics API 离线镜像。CHHapticEngine 引擎、触感事件与参数曲线、自定义振动模式。','说「怎么做一个自定义的震动反馈」。'),
'backgroundtasks': (C_APPLE,2,'BackgroundTasks API 离线镜像。BGTaskScheduler 注册与调度、后台 app 刷新、后台长任务处理、系统的执行时机限制。','说「后台刷新怎么注册」。这块系统限制多,查文档比猜靠谱。'),
'combine': (C_APPLE,2,'Combine API 离线镜像。Publisher / Subscriber、各类 operator、背压、与 async/await 互转。','老项目里遇到 Combine 代码时用。新代码基本已被 async/await 取代,优先级最低。'),
'core-animation': (C_APPLE,3,'Core Animation(QuartzCore)API 离线镜像,21 个附件。CALayer 图层树、CABasicAnimation / CAKeyframeAnimation / CASpringAnimation、CATransaction 事务、CAShapeLayer 与 CAGradientLayer。','SwiftUI 动画做不出来的效果(复杂路径、图层遮罩、精细时序)才下沉到这层。说「用 CAShapeLayer 做一个描边动画」。'),
'hig': (C_APPLE,4,'Apple 人机界面指南(HIG)官方离线镜像,50 个附件。基础规范、各平台导航与呈现模式、全部标准组件、色彩排版布局、无障碍、触感。刚更新到上游最新。','拿不准「这个交互该用 sheet 还是 push」「按钮最小点击区域多大」时说「查一下 HIG 怎么规定的」。这是规范依据,不是代码。'),
'apple-docs-index': (C_APPLE,3,'Apple 开发者文档的**索引**,不含正文。用来回答「某个框架里到底有哪些 API」「这个东西的文档路径是什么」,再决定要不要去拉详细文档。','当你连该查哪个框架都不确定时先用它定位,比直接搜快。'),

# ── B. guide-*：工作流与最佳实践指南（文件开头就写明「不是 API 参考」）──
'guide-swiftui-ui-patterns': (C_APPLE,4,'SwiftUI 组件与界面构建的最佳实践,37 个示例附件。导航层级怎么搭、自定义 view modifier 怎么写、响应式布局、以及**状态归属**(哪个状态该放哪一层)的完整对照表。来自 Thomas Ricouard(Dimillian)。','写新界面前说「按 SwiftUI 最佳实践搭这个页面」。跟 swiftui 那个 API 镜像的区别:这个告诉你**该怎么组织**,那个告诉你**有什么 API**。'),
'guide-swiftui-view-refactor': (C_APPLE,4,'SwiftUI 视图重构准则,观点鲜明:视图内部按固定顺序排列、**默认用 MV 而不是 MVVM**、强烈优先拆成独立子视图类型而非 computed `some View`、把副作用移出 body、保持视图树稳定。','视图文件膨胀到几百行时说「重构这个视图」。注意它反对 MVVM,跟多数中文教程相左,认可这个观点再用。'),
'guide-swiftui-performance-audit': (C_APPLE,4,'SwiftUI 运行时性能审计流程:先做代码审查找出重绘源,再引导你用 Instruments 实际采样,最后结合数据定位。','界面卡顿、滚动掉帧、CPU 偏高时说「审一下这个页面的性能」。它会让你去跑 Instruments,不是纯静态看代码。'),
'guide-swiftui-animations': (C_APPLE,3,'SwiftUI 动画模式指南。隐式与显式动画的取舍、transition 转场、phase 与 keyframe 动画、Animatable 协议、iOS 18+ 的 @Animatable 宏。','说「这个展开动画怎么做得自然些」。'),
'guide-swiftui-charts': (C_APPLE,3,'Swift Charts 图表指南。各类 mark、坐标轴定制、交互选择、样式与组合、Chart3D、图表无障碍与 Audio Graph。','做数据图表时说「用 Swift Charts 画一个 XXX 图」。'),
'guide-swift-concurrency': (C_APPLE,4,'Swift 并发实践指南,12 个附件。actor 隔离、结构化并发、任务取消、AsyncStream、从 GCD 迁移,以及**Swift 6 严格并发模式下的常见报错与修法**。来自 Paul Hudson。','开了 Swift 6 严格并发编译报一堆 Sendable 错误时说「按这个指南修并发问题」。这是当前最容易踩坑的地方。'),
'guide-swift-testing': (C_APPLE,3,'Swift Testing 实践指南。为什么用 struct 而非 class、异步测试用 confirmation、参数化测试、exit test、附件,以及**AI 写测试时常犯的错**。','写测试前说「按最佳实践写 Swift Testing 用例」。'),
'guide-swiftdata': (C_APPLE,3,'SwiftData 避坑指南。autosave 的时机陷阱、关系定义、**会导致崩溃的危险谓词写法**、CloudKit 同步的硬性约束、索引、类继承支持。','SwiftData 出现奇怪的数据丢失或崩溃时说「查一下 SwiftData 有什么坑」。'),
'guide-macos-spm-packaging': (C_APPLE,3,'不用 Xcode 工程、纯 SwiftPM 搭建构建打包 macOS app 的完整流程,15 个模板附件。含目录结构、资源处理、签名、公证,以及常见公证失败的排查表。','做 macOS 命令行工具或小工具 app 时说「用 SwiftPM 打包成 macOS app」。这条路自己摸索极费时间。'),

# ── C. 代码评审型（Paul Hudson / twostraws 出品，输入是你已有的代码）──
'swiftui-pro': (C_APPLE,4,'审查已有 SwiftUI 代码:现代 API 用法是否过时、可维护性、性能问题。输出按文件组织的结构化评审意见。','写完一版界面后说「审一下这段 SwiftUI」。跟 guide-* 的区别:guide 是动手前看的规范,这个是动手后挑毛病的。'),
'swift-concurrency-pro': (C_APPLE,4,'审查已有 Swift 并发代码的正确性:数据竞争、actor 跨界、错误的 @MainActor 标注、async/await 常见误用。','并发代码写完或出现偶发崩溃时说「审一下并发正确性」。'),
'swift-testing-pro': (C_APPLE,3,'审查并改进已有的 Swift Testing 测试代码,推动用现代 API 重写。','说「审一下我的测试」。'),
'swiftdata-agent-skill': (C_APPLE,3,'审查并改进已有 SwiftData 代码,用现代 API 与最佳实践重写。','说「审一下我的 SwiftData 模型层」。'),

# ── D. 视觉设计型 ──
'ios-ui-craft': (C_APPLE,4,'把 SwiftUI 界面做到 Apple Design Award 水准。设计思维、明确的反模式清单、三条核心原则、有性格的排版规范。','说「把这个界面做得精致些」「这界面太平庸了」。'),
'ios-design-consultant': (C_APPLE,3,'iOS 界面的 UX 与视觉顾问,面向 iOS 26 Liquid Glass 时代。回答元素该放哪、布局怎么定、什么时候该用玻璃材质。','拿不准设计决策时说「这个按钮放哪合适」。它给判断和理由,不直接写代码。'),
'ios-liquid-glass': (C_APPLE,4,'iOS 26+ Liquid Glass 玻璃材质,266 行 + 17 个附件。glassEffect 系列修饰符、GlassEffectContainer、导航与工具栏的玻璃化改造、设计哲学与反模式。刚更新到上游最新。','说「把工具栏改成 Liquid Glass」。iOS 26 太新,模型训练数据覆盖薄,这个尤其值得查。'),
'swiftui-design-skill': (C_APPLE,4,'SwiftUI 视觉设计,专门针对「一眼就看出是 AI 生成」的通用感。含设计方向选择、布局体系、排版、色彩、间距、品牌整合与设计评审。有中文 README。','说「这个 iOS 界面看着很 AI,重新设计一下」。文件里专门有一节写「什么时候不要用本技能」,写得克制。'),
'ios-motion-patterns-index': (C_APPLE,3,'MotionBook 合集的**可运行 Swift 动画示例索引**,按菜单/转场/指示器/弹窗/表格/集合视图分类。','想做某个具体动效时说「找个现成的 XX 动画示例」,先取代码再改,比从零写快。'),

# ── E. 工具与入口 ──
'ios-dev': (C_APPLE,4,'iOS/SwiftUI 任务的**总入口与路由器**。刚更新到上游最新。负责判断你的需求该走哪个 guide、哪份 API 镜像、哪个评审技能,并做正确性检查。','不确定该用上面哪一个时,直接说「做个 iOS 的 XXX」让它来分派。留着它,整套 Apple 技能才好用。'),
'ios-simulator-skill': (C_APPLE,4,'29 个生产级 shell 脚本:语义化 UI 导航(按可访问性标签点元素,而不是硬编码坐标)、构建自动化、无障碍测试、设备状态管理。','说「在模拟器里跑一下点进第二个 tab 截图」。脚本是实打实的资产,不是提示词。'),
'simulator-utils': (C_APPLE,3,'模拟器日常命令:截图并自动缩放到合适尺寸(强制)、设备增删启停、app 安装卸载与启动。','说「截个模拟器的图」。跟上面那个的区别:这个是零散命令,那个是成套自动化脚本。'),
'swift-development': (C_APPLE,3,'Swift 全流程命令行操作:构建 SPM 包与 Xcode 工程、跑 XCTest 与 Swift Testing、simctl 管模拟器、代码签名与分发、SwiftFormat/SwiftLint、Swift 6 并发、Core Data/SwiftData。','说「命令行构建并跑测试」。覆盖面广但每块都不深,具体问题优先用上面的专项。'),
'apple-aso': (C_APPLE,3,'App Store 元数据优化(ASO),操作对象是 store.config.json。含标题/副标题/关键词的**精确字符数限制**、关键词字段规则、本地化策略、Apple 全部语言代码表。','上架前说「优化一下 App Store 的关键词」。字符限制这类硬规格值得留着查。'),

# ══════════ 后端 / 通用工程 ══════════
'api-design-patterns': (C_BE,2,'REST API 设计:资源命名规范、HTTP 方法与状态码的正确用法、统一错误响应格式、游标分页(优先)与偏移分页、过滤排序、版本化策略、OpenAPI 规格生成。','设计新接口时说「按 REST 规范设计这组接口」。内容是通用知识,Opus 5 本身就会,留着主要图个统一口径。'),
'authentication-patterns': (C_BE,2,'认证授权:JWT 访问令牌与刷新令牌的配对设计、鉴权中间件、OAuth2 授权码 + PKCE 完整流程、RBAC 角色模型,以及各自的反模式。','做登录体系时说「设计一下认证流程」。'),
'security-hardening': (C_BE,2,'应用安全加固:输入校验、输出编码、SQL 注入防护、CSRF、内容安全策略 CSP、安全响应头、密钥管理、依赖漏洞审计。','上线前说「过一遍安全检查」。'),
'rust-systems': (C_BE,2,'Rust 系统编程:所有权与借用、错误处理(thiserror/anyhow)、trait 与泛型设计、async 运行时、builder 模式、unsafe 使用准则。','写 Rust 时说「按 Rust 惯用法重构」。'),
'nextjs-mastery': (C_BE,2,'Next.js App Router:目录结构约定、RSC 服务端组件取数、ISR 增量再生与缓存、中间件、并行路由、Server Actions。','说「用 App Router 搭这个页面」。注意内容停在 Next.js 14 时期,新版本特性可能没覆盖。'),
'react-patterns': (C_BE,2,'React 19 新特性:use() 钩子、Server Components、Server Actions、useActionState、useOptimistic 乐观更新、Suspense 边界。','说「用 React 19 的新写法改一下」。和 Vercel 官方那套(react-best-practices)重叠且更浅,冲突时以官方那份为准。'),
'accessibility-wcag': (C_BE,2,'Web 无障碍 WCAG 2.2:语义化 HTML、ARIA 模式、键盘导航与焦点管理、表单无障碍、色彩对比度,末尾附自查清单。','说「检查一下无障碍」。'),

# ══════════ React / Vercel 官方 ══════════
'react-best-practices': (C_RCT,5,'Vercel 工程团队的 React / Next.js 性能准则,75 个附件。按严重度分级:消灭请求瀑布(CRITICAL)、打包体积(CRITICAL)、服务端性能(HIGH)。刚更新到上游最新。','写或改 React 代码时说「按 Vercel 的性能准则审一遍」。分级明确,能直接告诉你先修哪个。'),
'composition-patterns': (C_RCT,4,'能扩展的 React 组合模式,专治 boolean prop 泛滥(一个组件挂十几个 isXxx)。compound components、render props、context provider,以及 React 19 的 API 变化。刚更新到上游最新。','组件参数越加越多、开始难维护时说「用组合模式重构这个组件」。'),
'react-native-skills': (C_RCT,4,'React Native / Expo 最佳实践,41 个附件。列表性能(CRITICAL)、动画、导航、原生模块对接。刚更新到上游最新。','做 RN 开发时说「按最佳实践优化这个列表」。'),
'react-view-transitions': (C_RCT,4,'React View Transition API:<ViewTransition> 组件、addTransitionType 转场类型、CSS 伪元素定制、方向性(前进/后退)导航动画、列表重排动画、Next.js 集成。刚更新到上游最新。','说「给路由切换加个丝滑转场」。这是较新的 API,模型训练数据里样例少,查一下更准。'),
'deploy-to-vercel': (C_RCT,4,'部署到 Vercel。按你项目的实际状态分支处理:已 link 且有 git remote 走 git push;已 link 无 remote 走 vercel deploy;未 link 先 link;未认证走安装认证流程;还有无认证时的沙箱兜底。','说「部署上线」「给我个预览链接」。'),
'vercel-cli-with-tokens': (C_RCT,4,'用 access token 而非交互式登录来操作 Vercel CLI,346 行。含四条找 token 的路径(环境变量 / .env 标准名 / .env 改过名 / 问你要)。','在 CI 或非交互环境里说「用 token 部署」。'),
'vercel-optimize': (C_RCT,4,'Vercel 成本与性能优化,155 个附件。抓取线上指标、扫描代码、合并信号后给优化建议。支持 Next.js / SvelteKit / Nuxt,Astro 部分支持。','账单变高或页面变慢时说「优化一下 Vercel 上的开销」。'),
'web-design-guidelines': (C_RCT,2,'按 Vercel 的 Web Interface Guidelines 审查界面代码(无障碍、交互细节、常见 UX 缺陷)。','说「按 Web Interface Guidelines 审一下 UI」。仅 31 行,本体是外链到规范文档。'),
'writing-guidelines': (C_RCT,2,'按 Vercel 的 Writing Guidelines 审查文档与文案的语气、用词、结构。','说「审一下这段文档的写法」。同样仅 31 行,本体是外链。'),

# ══════════ 前端 / Web UI ══════════
'ui-ux-pro-max': (C_FE,4,'**刚更新,能力大涨**:本地可检索数据库,84 种视觉风格、192 套配色、74 组字体搭配、192 种产品类型、98 条 UX 准则、104 个图标条目、16 组 GSAP 动效预设、25 种图表 × **22 个技术栈**(React/Next/Vue/Nuxt/Svelte/Astro/SwiftUI/RN/Flutter/Tailwind/shadcn/Compose/Angular/Laravel/JavaFX/WPF/WinUI/Avalonia/Three.js 等)。','说「给这个落地页选一套配色和字体」「按 shadcn 的规范做这个组件」。是查表型资料库,具体的 hex 值和字体对模型记不住,查表比瞎编强。'),
'ui-styling': (C_FE,4,'shadcn/ui(Radix + Tailwind)组件层 + Tailwind 工具类层 + canvas 视觉层三段式,97 个附件是具体组件代码。','说「用 shadcn 搭一个表单/对话框」。'),
'impeccable': (C_FE,4,'前端界面设计与评审的总入口,92 个附件。含绝对禁令清单和一套「AI slop 测试」,用来判断产出是不是模板货。','说「审一下这个界面」「这页面太平庸了」。'),
'frontend-design': (C_FE,3,'50 行短指引:从主题本身出发定视觉方向、排版、克制与自我批判,避免默认模板感。','做新界面开头说「先定个视觉方向」。你用得最多的技能(63 次),轻量、通用。'),
'high-end-visual-design': (C_FE,3,'教「像高端代理商那样设计」,具体到字体、间距、阴影、卡片结构。含 ABSOLUTE ZERO 反模式禁令,和一个「氛围档案 × 布局档案」的随机组合引擎防止千篇一律。','说「做得高级一点」「像大厂官网那样」。'),
'minimalist-ui': (C_FE,3,'编辑风极简界面:暖色单色调、靠排版对比而非装饰、扁平 bento 网格、低饱和粉彩。明令禁渐变、禁重阴影。','说「做成极简编辑风」。风格很具体,不喜欢这个调性就别用。'),
'redesign-existing-projects': (C_FE,3,'给**已有**站点做升级:先审计现状、识别出通用 AI 套路,再套高端标准,且不破坏现有功能。兼容任何 CSS 框架。','说「把这个老页面重新设计一下」。跟上面几个的区别:那些是从零做,这个是改存量。'),
'material-3': (C_FE,4,'Google Material Design 3(Material You),656 行。主攻 Jetpack Compose Material3,也覆盖 Flutter 和 @material/web。含完整 token 体系、30+ 组件规格、M3 Expressive、无障碍。','做 Android 或 Material 风格界面时说「按 MD3 规范做」。token 名这类规格模型容易记错。'),
'playground': (C_FE,4,'生成自包含单文件 HTML 交互式 playground——带控件面板、实时预览、可导出配置。Anthropic 官方出品。','说「做个能调参数看效果的小页面」。产出形态很特别,模型自己临时写达不到这个完成度。'),
'frontend-slides': (C_FE,4,'动画丰富的 HTML 演示文稿,376 行 + 161 个附件。可从零做,也能把 PPTX 转成网页。含固定舞台规则、内容密度模式、三种工作模式检测。','说「做一套演示」「把这个 PPT 转成网页」。'),

# ══════════ 动画 / 动效 ══════════
'gsap-core': (C_ANIM,4,'GSAP 官方:核心 API。gsap.to / from / fromTo、缓动函数、时长、stagger 交错、defaults 默认值,以及 matchMedia(响应式断点 + 尊重 prefers-reduced-motion)。','说「用 GSAP 做个 XXX 动画」。GSAP 的 API 细节多,模型容易记岔。'),
'gsap-timeline': (C_ANIM,4,'GSAP 官方:时间轴。gsap.timeline()、**position 参数**(最容易写错的地方)、标签、嵌套时间轴、播放控制。','需要多个动画按顺序编排时说「用 timeline 串起来」。'),
'gsap-scrolltrigger': (C_ANIM,5,'GSAP 官方:ScrollTrigger,291 行。滚动联动、pin 固定元素、scrub 擦洗式绑定进度、batch 批量、scrollerProxy 自定义滚动容器。','说「做个滚动触发的动画」「这一屏滚动时钉住」。GSAP 里最复杂也最常用的插件。'),
'gsap-plugins': (C_ANIM,4,'GSAP 官方:插件大全,428 行。ScrollSmoother 平滑滚动、Flip 布局翻转、Draggable 拖拽、Inertia 惯性、Observer 统一事件、SplitText 文字拆分、CustomEase/Wiggle/Bounce、GSDevTools。含**哪些是收费插件**的授权说明。','说「文字逐字出现」「做个可拖拽的卡片」。授权边界这个信息很实用,免得用了付费插件才发现。'),
'gsap-react': (C_ANIM,4,'GSAP 官方:React / Next.js 集成。useGSAP 钩子、用 ref 拿目标、gsap.context() 作用域、依赖数组与 revertOnUpdate、SSR 注意事项、卸载清理。','在 React 里做 GSAP 动画时说明是 React 项目。useGSAP 是较新 API,模型容易退回旧的 useEffect 写法导致内存泄漏。'),
'gsap-frameworks': (C_ANIM,3,'GSAP 官方:Vue 3 / Nuxt 4 / Svelte 集成。生命周期挂载时机、选择器作用域限定、卸载时清理 ScrollTrigger。','Vue/Svelte 项目里用 GSAP 时用。'),
'gsap-utils': (C_ANIM,3,'GSAP 官方:gsap.utils 工具集。clamp 夹取、mapRange 区间映射、normalize 归一化、interpolate 插值、random、snap 吸附、toArray、wrap 循环、pipe 组合。','做鼠标跟随、视差这类需要数值映射的效果时用。'),
'gsap-performance': (C_ANIM,3,'GSAP 官方:性能。优先动 transform/opacity、避免布局抖动、will-change 的正确用法、读写批处理、大量元素的处理策略。','动画卡顿时说「优化一下动画性能」。'),
'apple-design': (C_ANIM,5,'把 Apple 的流体物理动效**原理**翻译到 Web,278 行。消除延迟、1:1 直接操控、**可打断性**(作者认为最重要的一条)、用弹簧而非贝塞尔曲线、拖拽到动画的速度接力、动量投射、空间一致性。','做手势驱动的界面(拖拽、滑动、下拉表单)时说「按 Apple 那套动效原理做」。讲的是原理不是 API,是这批里质量最高的之一。'),
'emil-design-eng': (C_ANIM,4,'Emil Kowalski 的 UI 打磨哲学,675 行单文件。品味是练出来的、看不见的细节会累积、美是杠杆。含**动画决策框架**(第一问:这东西到底该不该动)和强制的评审输出格式。','说「按 Emil 那套标准审一下动效」。信息密度很高。'),
'animation-vocabulary': (C_ANIM,3,'反查词典:把「弹窗弹出时那个弹弹的感觉」翻译成准确术语(Pop in)、「iOS 那个橡皮筋滚动」→ Rubber-banding。','你想要某个效果但说不出名字时说「那个 XXX 的效果叫什么」。拿到准确术语再去下指令,效果好很多。'),
'find-animation-opportunities': (C_ANIM,3,'扫代码库找「该动却没动」的地方,并**否掉不该动的**。四道闸:频率(用户会看到多少次)、目的、速度(能否进预算)、功能(帮忙还是添乱)。只读,只出方案不改代码。','说「看看这个项目哪儿该加动效」。'),
'improve-animations': (C_ANIM,3,'以资深动效顾问身份通盘审已有动画代码,产出优先级排序的审计报告 + 可交给更便宜模型执行的自包含实施计划。只读。','说「把这个项目的动效整体提升一下」。'),

# ══════════ 设计系统 / 视觉 ══════════
'taste-skill': (C_DSGN,5,'给一个 URL,用真实浏览器抓 DOM + 截图,跑 4 步分析,产出 taste.md 和 taste.json:既有可直接用的设计 token(颜色/排版/间距/圆角/阴影/栅格),也有「taste DNA」——用 触发→决策→理由→证据 的形式解释这个设计**为什么**成立。明确拒绝 clean、modern 这类空话,只给 px 和 hex。','说「分析一下 stripe.com 的设计」「我想做得像 XXX 那样」。产出形态模型自己做不到。'),
'design-system': (C_DSGN,4,'三层 token 架构(primitive → semantic → component)、CSS 变量落地、间距与排版比例、组件规格文档,25 个附件。','项目要建立统一设计语言时说「搭一套设计 token」。方法论可复用性强。'),
'design': (C_DSGN,3,'**刚更新**,现在是设计总入口:品牌识别、设计 token、UI 样式、logo 生成(55 风格,走 Gemini)、CIP 企业识别(50 项交付物 + mockup)、HTML 演示(Chart.js)、banner(22 风格)、图标(15 风格 SVG,走 Gemini 3.1 Pro)、社交配图(HTML 转截图,多平台)。','说「设计一个 logo」「做一套 VI」「做张社交配图」。职责很杂,直接说要哪一样最省事。'),
'brand': (C_DSGN,3,'品牌声音、视觉识别、信息框架、资产管理、品牌一致性检查,16 个附件含参考、脚本、模板。','说「定一下品牌调性」「检查这段文案符不符合品牌」。'),
'banner-design': (C_DSGN,3,'社交 / 广告 / 官网 hero / 印刷 banner。流程是问需求 → 调研艺术方向 → 出多个方案 → 导出图片 → 迭代。附各平台尺寸速查表。','说「做张公众号头图」「做个 Twitter banner」。'),
'canvas-design': (C_DSGN,4,'用设计哲学做 .png / .pdf 视觉作品(海报、艺术品),82 个附件。核心主张是先生成一套视觉哲学再落地,并明确要求原创、不抄在世艺术家。Anthropic 官方。','说「做张海报」「做个 PDF 封面」。'),
'slides': (C_DSGN,3,'策略性 HTML 演示:Chart.js 图表、design token、响应式布局、文案公式、按场景选幻灯片策略。','说「做套带图表的演示」。跟 frontend-slides 的区别:那个偏动画和视觉冲击,这个偏内容策略和图表。'),
'theme-factory': (C_DSGN,3,'10 套预设主题(配色 + 字体),可套到幻灯片、文档、报告、HTML 落地页上;也能现场生成新主题。','说「换个主题风格」「给这个页面套个主题」。'),
'design-assets-index': (C_DSGN,2,'现成素材的外链索引:图库、图标集、字体、配色、mockup、UI kit、模板。来自 awesome-design 等合集。','说「找几张免费商用的图」「推荐个图标库」。纯链接清单。'),
'design-systems-index': (C_DSGN,2,'各大公司设计系统的外链索引(Material、Fluent、Carbon、Polaris、Atlassian、Lightning)+ token 工具与规范 + React / RN 设计系统组件库。','说「参考一下 Polaris 是怎么做的」。'),
'design-tools-index': (C_DSGN,2,'按用途分类的设计工具索引:动画、配色、原型、设计交付、design-to-code、图标、字体、渐变、插画、mockup、线框图等 20+ 类。','说「有什么好用的配色工具」。'),
'reference-interpreter': (C_DSGN,3,'你丢来截图、图片、URL 或文字描述 → 分析 → 映射到设计系统 → 输出结构化设计简报(布局/排版/颜色)。标了仅手动调用。','丢张参考图说「照这个风格做」。'),
'figma-style-binding': (C_DSGN,3,'强制 Figma 里所有视觉属性(文字、色彩填充、间距、内边距、gap、圆角)都绑定到 Styles 或 Variables,禁止硬编码值,并做 QA 校验。标了仅手动调用。','用 Figma MCP 做设计时挂上,防止 AI 到处塞硬编码色值。'),

# ══════════ Claude Code 元技能 ══════════
'skill-creator': (C_META,4,'从零建技能、改进已有技能、衡量技能表现,481 行 + 17 个附件。含意图捕获、访谈调研、SKILL.md 写作指南。Anthropic 官方,这一类里最权威的。','说「帮我做个技能」。'),
'skill-development': (C_META,3,'往插件里加技能、渐进披露设计原则、技能创建流程、description 怎么写才能被正确触发,632 行。','说「这个技能的 description 该怎么写」。和 skill-creator / write-a-skill 三选一即可。'),
'write-a-skill': (C_META,2,'建新技能:结构、渐进披露、附带资源,113 行。','三个同类里最短最浅的,优先用 skill-creator。'),
'hook-development': (C_META,4,'写 hook,707 行。PreToolUse / PostToolUse / Stop 各类钩子、prompt 型(推荐)与命令型的取舍、插件 hooks.json 格式、工具调用校验。','说「每次改完文件自动跑格式化」这类**自动化**需求时用。hook 是唯一能做真正强制的机制。'),
'build-mcp-server': (C_META,4,'建 MCP 服务。先盘问用途(连什么、谁用、暴露几个动作、要不要中途要用户输入、上游怎么认证),再推荐部署形态,默认推荐远程 streamable-HTTP。Anthropic 官方。','说「把这个 API 包成 MCP」。先问后做的结构很扎实。'),
'build-mcp-app': (C_META,4,'给 MCP 服务加交互式 UI / widget。什么时候 widget 胜过纯文本、widget 与 elicitation 怎么区分、两种部署形态、App 类运行时。Anthropic 官方。','说「让这个 MCP 在对话里显示个界面」。'),
'manage-skills': (C_META,4,'跨 11 个工具(Cursor、Claude、Agents、Windsurf、Copilot、Codex、Cline 等)发现、列出、创建、编辑、开关、复制、移动、删除技能。区分目录型和单文件型工具。','说「把这个技能同步到 Codex」「列一下所有工具里的技能」。正好治你现在两个目录混乱的问题。'),
'claude-md-improver': (C_META,3,'扫描仓库里所有 CLAUDE.md,做质量评估出报告,再做定向修改。','说「审一下项目的 CLAUDE.md」。CLAUDE.md 臃肿是公认反模式,这个对症。'),
'session-report': (C_META,4,'从 ~/.claude/projects 的会话记录生成可探索的 HTML 用量报告:token、缓存命中、子代理、技能调用、最贵的 prompt。','说「看看我这段时间的用量」。能量化哪些技能真被触发过。'),
'writing-rules': (C_META,2,'写 hookify 规则:规则文件格式、frontmatter、多条件高级写法,369 行。','依赖 hookify 这个外部工具,没装就用不上。'),

# ══════════ 工程方法论 ══════════
'codebase-design': (C_ENG,3,'代码库设计:怎么把模块划得更深、边界更清楚,让代码既好测试又好让 AI 导航。是 improve-codebase-architecture 的依赖。','说「这块该怎么拆模块」。我建仓库时发现 improve-codebase-architecture 引用了它但本地没有,补上的。'),
'tdd': (C_ENG,3,'已更新到最新:从 110 行精简成 36 行 + tests.md / mocking.md 两个附件。核心不再是硬套红绿重构,而是讲清「什么算好测试」和**接缝(seam)**——测试该挂在哪个公共边界上,并要求**动手前先跟你确认接缝**,不许自作主张全覆盖。','说「用 TDD 做这个功能」「先写测试」。'),
'diagnose': (C_ENG,3,'诊断难缠的 bug 和性能回归,已更新到上游最新版(上游改名 diagnosing-bugs,134 行)。流程:建反馈回路 → 复现 → 提假设 → 埋点 → 修 → 回归测试。','说「诊断一下这个 bug」。适合那种「偶发、找不到原因」的问题,普通报错不必动用。'),
'improve-codebase-architecture': (C_ENG,3,'找「深化机会」——把浅模块改造成深模块,目标是可测试性和 AI 可导航性。已更新到上游最新。强制使用固定术语表。','说「看看这个项目架构能怎么改」。术语强制是它的特色,也可能碍事。'),
'grilling': (C_ENG,3,'拷问式访谈的**引擎**,12 行。一次一个问题走完决策树,每问都给推荐答案。grill-me 和 grill-with-docs 都靠它。','一般不直接调用,由下面两个带出来。这是我这次更新时补上的依赖。'),
'grill-me': (C_ENG,3,'拷问你的计划直到达成共识,现在是 7 行的入口,实际跑 grilling。已更新到上游最新。','说「grill me」「拷问一下我这个方案」。'),
'grill-with-docs': (C_ENG,3,'拷问 + 落文档版本:边问边更新 CONTEXT.md 和 ADR,现在是 7 行入口,跑 grilling + domain-modeling。已更新到上游最新。','说「拷问这个设计并把结论写进文档」。'),
'domain-modeling': (C_ENG,3,'领域建模:梳理业务概念、统一术语、产出领域词汇表,74 行。','grill-with-docs 的依赖,也可单独说「梳理一下这块的领域模型」。这是我这次更新时补上的。'),
'to-prd': (C_ENG,2,'把当前对话合成规格文档并发到 issue tracker。已更新到上游最新(上游改名 to-spec,75 行)。明确不访谈你,只综合已知信息。','说「把刚才讨论的整理成 PRD」。依赖 setup-matt-pocock-skills 先配好 issue tracker。'),
'to-issues': (C_ENG,2,'把计划/规格拆成可独立认领的 issue,用 tracer bullet 纵向切片。已更新到上游最新(上游改名 to-tickets,105 行)。','说「把这个计划拆成任务」。同样依赖脚手架。'),
'triage': (C_ENG,2,'用状态机和五种 triage 角色流转 issue,要求每条评论带免责声明。','说「过一遍待办 issue」。强依赖 issue tracker 脚手架。'),
'setup-matt-pocock-skills': (C_ENG,2,'给仓库搭脚手架:在 AGENTS.md / CLAUDE.md 写 ## Agent skills 块,建 docs/agents/,让上面几个技能知道本仓库的 issue tracker、triage 标签词表和领域文档布局。标了仅手动调用。','**用 to-prd / to-issues / triage 之前必须先跑一次**,否则那几个不知道往哪发 issue。'),
'handoff': (C_ENG,2,'把当前对话压缩成交接文档给下一个 agent,要求不重复 PRD/计划/ADR/commit 里已有的内容,只给路径或 URL。已更新到上游最新。','对话太长要换个会话继续时说「做个交接文档」。'),
'prototype': (C_ENG,3,'做一次性原型回答一个具体问题。分两支:状态/业务逻辑问题走可运行的终端应用,UI 问题走一个路由下可切换的多套截然不同的方案。','说「先做个原型试试」。分支设计很清晰。'),
'zoom-out': (C_ENG,1,'让 agent 抬升一个抽象层,给出相关模块和调用方的地图。正文只有 2 行,标了仅手动调用。','上游已删除。功能一句话就能替代,留着意义不大。'),
'caveman': (C_ENG,1,'超压缩沟通模式,砍掉虚词和客套,据称省约 75% token。','上游已删除。'),

# ══════════ opencli / 搜索 ══════════
'smart-search': (C_MISC,4,'基于本机 opencli 的智能搜索路由:指定站点、社交媒体、技术资料、新闻、购物、旅游、求职、金融、中文内容各走不同的源。含强制预检、单题预算和频率限制。','说「搜一下 XXX」「查查小红书上关于 XXX 的」。依赖本机 opencli 二进制,模型不可能自己知道怎么调。'),
'last30days': (C_MISC,4,'研究一个话题最近 30 天在 Reddit、X、YouTube、TikTok、Hacker News、Polymarket、GitHub 和网页上的真实讨论,按互动数据整理主题、观点和来源。','说「查查最近 30 天大家怎么讨论 XXX」「用 last30days 找选题」。部分数据源需要单独配置凭证。'),
'watch': (C_MISC,4,'读取视频 URL 或本地视频:用 yt-dlp 下载、ffmpeg 抽帧,优先提取原生字幕,无字幕时可调用 Groq 或 OpenAI Whisper 转录,再按时间戳总结或回答问题。','发一个 YouTube、X、TikTok 等视频链接或本地视频路径,说「看完并总结」「分析 2:30 附近发生了什么」。长视频最好指定片段以控制耗时和图像 token。'),
'opencli-adapter-author': (C_MISC,4,'给新站点写 opencli 适配器,或给已有站点加命令,15 个附件。从初次侦察、字段解码、写适配器到验证,含决策树、逐步 runbook 和卡住时的降级路径。中文写的。','说「给 XX 网站写个适配器」。'),
'opencli-autofix': (C_MISC,4,'opencli 命令失败时自动修适配器:收集 trace、打补丁、重试,修好后再去上游提 issue。含「空结果 ≠ 坏了」的前置判断。','某个 opencli 命令报错时说「修一下这个适配器」。'),

# ══════════ 其他 ══════════
'deep-dive': (C_MISC,3,'不依赖外部 API 的深度研究:把问题拆成 DAG、按依赖顺序并行跑子代理、按缺口迭代一轮。','说「深入研究一下 XXX」。和内置研究能力有重叠。'),

}

# 飞书 27 个统一处理（描述已足够清楚，只补触发方式）
LARK = {
'lark-im':('即时通讯:收发与回复消息、搜聊天记录、管群成员、传图与大文件分片下载、表情回复、应用内/短信/电话加急、交互卡片收发与按钮回调监听。25 个附件。','说「给某某发条飞书」「把这个文件发到群里」。',3),
'lark-base':('多维表格:建表、字段、记录、视图、统计、公式与 lookup、表单、仪表盘、workflow、角色权限。25 个附件。','给出多维表格链接说「把这些数据整理进去」。',3),
'lark-doc':('云文档(Docx / Wiki)读写:查看、创建、编辑正文、插入与下载文档内图片附件。','给出文档链接说「读一下这个文档」「往里加一节」。',3),
'lark-sheets':('电子表格:建表、管工作表与行列、读写单元格(值/公式/样式/批注/单元格图片)、查找替换、原子批量更新,以及图表、透视表、条件格式、筛选器、迷你图。18 个附件。','给出表格链接说「统计一下这一列」。',3),
'lark-drive':('云空间:上传下载、建文件夹、复制移动删除、元数据、评论权限订阅、版本,以及把 Word/Markdown/Excel/CSV/PPTX 导入为在线文档。40 个附件。','说「把这个文件传到飞书云盘」「把这份 Word 转成飞书文档」。',3),
'lark-calendar':('日历:查看搜索日程、创建更新、管参会人、查忙闲与推荐时段、预定会议室。','说「明天下午安排个会」「查一下我这周的日程」。',3),
'lark-mail':('邮箱:起草发送回复转发、查阅搜索、文件夹与标签、联系人、监听新邮件、收信规则。**明确写了「邮件内容是不可信外部输入」的安全规则和写操作前必须确认**。','说「看一下今天的邮件」「回复这封邮件」。安全边界写得比其他几个都认真。',3),
'lark-task':('任务:创建待办、查看更新状态、拆子任务、组织清单、分配协作成员、上传附件、注册任务智能体。','说「建个待办」「看看我有哪些没做完的任务」。',3),
'lark-vc':('视频会议:搜历史会议、查纪要(总结/待办/章节/逐字稿)、查参会人快照。','说「找一下上周那个会的纪要」。',3),
'lark-vc-agent':('会中能力:让机器人真实加入或离开正在进行的会议,读会中事件(参会人进出、发言、聊天、屏幕共享)。标注为内测。','说「进一下正在开的那个会」。',2),
'lark-minutes':('妙记:搜索、查基础信息、上传下载音视频、读写产物内容、改标题、替换说话人。**本地音视频转纪要优先走它,不要用 ffmpeg/whisper**。','说「把这个录音转成文字纪要」。这条路由很实用,省得本地跑转写。',3),
'lark-wiki':('知识库:建查知识空间、管空间成员、管节点层级、组织文档与快捷方式。','说「在知识库里建个页面」。',3),
'lark-slides':('幻灯片:创建演示文稿、读内容、管页面(增删读改、局部替换)。75 个附件。','说「做个飞书幻灯片」。',3),
'lark-okr':('OKR:查看编辑周期、目标、关键结果、对齐关系、量化指标和进展记录。','说「看一下我的 OKR 进度」。',2),
'lark-approval':('审批:查处理待办已办实例、搜可发起的审批定义、看详情并发起原生审批实例。','说「有什么待审批的」「发起一个请假审批」。',2),
'lark-contact':('通讯录:按姓名/邮箱解析成 open_id,或按 open_id 反查姓名/部门/邮箱/联系方式。','一般不直接叫,是发消息和排日程的前置步骤,会自动带出来。',3),
'lark-shared':('lark-cli 的**公共层**:登录登出与状态、用户身份 vs 机器人身份、按业务域的权限(--domain)、权限不足时怎么处理。','其他 lark-* 的共同依赖。要用飞书就得留着它,否则认证走不通。',3),
'lark-event':('实时事件监听:用 lark-cli event consume 以 NDJSON 流式消费事件(IM 消息、卡片回调等),含子进程契约和 ready 标记。','做飞书机器人时说「监听群里的消息」。',2),
'lark-whiteboard':('画板:导出为预览图片、导出原始节点结构、多种格式更新画板内容。29 个附件。','给出画板链接说「看看这个画板画了什么」。',2),
'lark-markdown':('Markdown 文件:查看、创建、上传、编辑、局部 patch 和比较差异。','说「把这个 md 传到飞书」。不负责转成在线文档。',2),
'lark-note':('会议纪要直查:已知 note_id 时查详情、展示类型、关联文档 token,读 unified 原始逐字记录。','很窄,是 lark-vc 的下游,一般自动带出。',2),
'lark-attendance':('考勤打卡:只能查自己的打卡记录。','说「看看我这个月的打卡」。功能极窄,48 行。',1),
'lark-apps':('妙搭(Spark/Miaoda)应用开发托管:建应用、发 HTML 静态站、本地全栈开发、云端生成迭代、日志与监控查询、环境变量管理。','说「在飞书上搭个小应用」。',2),
'lark-openapi-explorer':('当现有 lark-* 技能和 lark-cli 已注册命令都满足不了时,从官方文档库里挖**未被封装的原生 OpenAPI** 并调用。','说「飞书有没有 XXX 的接口」。是兜底层,比单个业务技能更有长期价值。',3),
'lark-skill-maker':('把飞书 API 操作封装成可复用的自定义 Skill(包装原子 API 或编排多步流程)。','说「把这套飞书操作固化成一个技能」。',2),
'lark-workflow-meeting-summary':('工作流:汇总指定时间范围内的会议纪要,生成结构化报告(会议周报)。','说「整理一下本周的会议纪要」。编排型,依赖 lark-vc + lark-minutes。',2),
'lark-workflow-standup-report':('工作流:编排日历日程和任务,生成指定日期的日程与未完成任务摘要。','说「今天我有什么安排」。编排型,依赖 lark-calendar + lark-task。',2),
}
for k,(desc,how,rec) in LARK.items():
    D[k] = (C_LARK, rec, desc, how)
