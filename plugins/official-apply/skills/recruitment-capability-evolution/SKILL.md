---
name: recruitment-capability-evolution
description: 演进企业招聘自动化能力。真实站点暴露出重复人工操作、现有 Skill 或 PageScript 不适用、共享核心缺少能力，或 Agent 需要新增或调整 MCP 工具时使用。查看当前能力边界，选择合适代码位置，完成真实站验证后继续原任务；不参与普通网申阶段调度。
---

# recruitment-capability-evolution

只负责演进 Skill、脚本、MCP、共享核心和 PageScript。普通网申直接使用对应业务 Skill，
不经过本 Skill。

## 当前 MCP

| MCP 工具 | 当前能力 | 主要使用阶段 |
| --- | --- | --- |
| `apply.open_task` | 打开任务页面，创建后续步骤复用的 `runId`。 | 登录与会话 |
| `apply.login` | 在原页面检查登录，发起短信登录或提交验证码。 | 登录与会话 |
| `apply.open_resume` | 在当前账号和 `runId` 中找到简历编辑页。 | 登录与会话 |
| `apply.inspect_page` | 只读扫描字段、按钮、上传控件和页面类型。 | 简历、岗位申请 |
| `apply.resolve_page` | 映射官网字段，从私有资料找答案并列出缺失。 | 简历、岗位申请 |
| `apply.save_answers` | 按指定作用范围保存用户补充答案并确认字段映射。 | 简历 |
| `apply.fill_page` | 将已确定的答案写入当前页，不执行最终提交。 | 简历、岗位申请 |
| `apply.validate_page` | 读回填写值、页面报错和新增条件字段；通用页面成功后保存本机填写候选和 Recipe。 | 简历、岗位申请 |
| `apply.advance` | 开始申请、保存、下一步或上一步；保存接口明确成功后才验证候选保存动作。 | 简历、岗位申请 |
| `apply.submit` | 预检并签发一次性令牌，用户确认后只提交一次；保存截图、网络证据、结果和运行摘要。 | 最终提交 |
| `apply.get_status` | 只读返回运行位置、缺失内容、阻断和下一步。 | 登录、简历、提交 |
| `apply.build_visual_fallback` | 结构化操作失败后生成局部 Computer Use 操作请求。 | 简历视觉辅助 |
| `apply.verify_visual_fallback` | 用 DOM 和 ARIA 读回验证视觉操作是否生效。 | 简历视觉辅助 |
| `apply.approve_host` | 为当前任务单独批准一个需要跳转的新域名。 | 链接、登录 |
| `apply.close_run` | 关闭指定运行的浏览器页面，并生成 `.local/runs/<runId>/summary.json`。 | 会话结束 |
| `apply.list_open_runs` | 只读列出仍然打开的运行和页面。 | 会话恢复 |

## 当前 Skill 脚本

| Skill | 脚本 | 当前能力 |
| --- | --- | --- |
| `recruitment-link` | `table-locations.py`、`plan-fill.py` | 登记/创建工作表，按当前飞书行与提交证据筛选允许填写的记录。 |
| `recruitment-session` | `solve-rotation-captcha.py`、`rotation-captcha-login-session.mjs` | 在当前挑战过期前完成取图、下载、角度计算、单次拖动和接口验证；服务端换题后重新计算。 |
| `recruitment-session` | `solve-overlay-rotation-captcha.py`、`overlay-rotation-login-session.mjs` | 对背景加透明圆片的旋转题读取当前图片，按验证码引擎的角度和轨道关系完成单次拖动并读取验证接口。 |
| `recruitment-session` | `solve-jigsaw-captcha.py`、`jigsaw-captcha-session.mjs` | 按验证码引擎处理一类拼图题，识别亮/暗缺口、计算横向距离、单次拖动并监听验证接口；不计算角度。 |
| `recruitment-session` | `migrate-moka-session.mjs` | 在 Moka 企业站之间只迁移五个已验证有用的会话 Cookie，自动备份目标状态，并要求在目标站重新验证登录。 |
| `resume-fill-review` | 无 | 通过 MCP、共享核心和 PageScript 填写与审查。 |
| `job-application-submit` | 无 | 通过 MCP 和提交核心完成预检、确认与单次提交。 |
| 可选外部 `qiuzhao-feed` | 以外部 Skill 为准 | 用户明确找秋招且已安装时使用，不是主插件的内置依赖。 |

## 演进边界

| 新需求的形状 | 通常放在哪里 |
| --- | --- |
| 流程顺序、停止条件、工具选择或注意事项变化 | 对应 `SKILL.md` 或 Reference |
| 可以独立运行、输入输出明确、会被重复使用的小程序 | Skill 的 `scripts/` |
| 某个招聘网站特有的字段、控件、请求和页面行为 | 对应 PageScript |
| 多个站点或步骤共用的数据、状态、证据和业务逻辑 | 共享 TypeScript 核心 |
| Agent 需要稳定调用，并且涉及 `runId`、活页面、数据库或跨阶段状态 | MCP 工具和共享核心 |
| 规律还没有确认的探索代码 | `.local/tmp`，真实站验证后再决定位置 |

脚本适合独立计算和转换。MCP 适合 Agent 在正式流程中调用并继续使用结果。一个站点刚出现的
特殊操作通常先放 PageScript；当它变成跨站或跨阶段的稳定能力时，再考虑提升到共享核心或
MCP。这里是选择依据，不要求所有情况使用同一种结构。

## 缺少能力时如何继续

1. 这是业务流程宣布技术阻塞前必经的一次诊断。先读当前 run 的 summary 和失败证据，区分启动环境、页面变化、缺脚本、局部操作/保存/读回错误，以及用户事实或权限问题；不一概判成缺脚本。
2. 先尝试匹配的已验证 PageScript，再查 `node bin/applyctl.js knowledge recipes --host <host> --json` 和 `knowledge candidates`。已有脚本仍需匹配当前页面，不凭历史 verified 标签宣布本次有效。
3. 没有适用能力时，在用户当前任务范围内自己补最小脚本，不要求用户先写提示词或手动开发。通用扫描已可完成的页面继续复用；固定重复操作才沉淀为 PageScript。
4. 开发位置读 `~/.config/official-apply/config.json` 的 developmentRoot，或已明确的当前源码工作区；读取该仓库 AGENTS.md，在独立分支/工作树修改。安装缓存不是源码，不直接改缓存。只有运行包而没有源码时，可继续生成本机 JSON 候选；需要改共享代码时一次询问源码位置，不编造 src 路径。
5. 按下面的浏览器合同实现。先用已有测试与脱敏样本检查，再在用户已授权的当前页面验证必要动作，保存前后读回；只填写授权不能用真实投递做测试。
6. 在现有问题/阻断记录中写明本次诊断、修复尝试与结果。修复成功回到原阶段；仍失败才确认具体技术阻塞。同一问题复用记录，不无限重新演进。验证通过的本地改动可在当前任务继续使用；保留具体测试、当前运行与证据。源码补丁留在开发分支，汇总审查前不合入 main、不发布到插件仓库。不存在源码或依赖缺失导致无法验证时如实记录，先继续其他可处理公司。

## 统一浏览器合同

- 正式 PageScript 接收共享运行时传入的 Playwright page 与结构化资料，复用同一 runId/page；不在每个站点脚本里自行启动 Chrome、Edge 或 Ego。
- 浏览器型号读取用户配置 browserChannel，新建默认无头，有窗口也允许；不把当前用户的浏览器、账号、验证码或个人答案写成站点常量。
- 独立会话脚本通过 bin/launch.js 读取同一配置与源码/发行包模块。已经有当前页面时优先在该页面调用验证码求解与控件操作；需要重新建会话时明确旧/新 runId 和真实登录检查，不假定新浏览器继承旧题或旧登录态。
- Ego 可用于环境允许的页面观察与临时交互，但正式复用脚本仍遵循上述 page 接口，不另写一套只依赖 ego-browser 全局函数的填写程序。临时观察得到的选择器和页面证据交回正式脚本。
- 保留用户已有字段，按授权只补空或修正指定项；沿用原保存/提交分离与一次性提交授权。工具明确拒绝时不得通过新脚本移除限制或绕过权限。

## 提交代码，之后汇总审查

- 每个独立、可验证的改动完成后，检查 git diff，只 git add 本次修改文件并 git commit。较大工作按可验证阶段提交，避免一次积攒大量未提交代码；未验证的进度必须标明，不能当成已验证能力使用。
- 提交说明写清问题、改动、验证命令与实际结果、未覆盖部分及私有证据位置。个人资料、Cookie、截图和原始请求留在私有目录，不加入代码提交。
- 这里的 commit 是代码提交，不是岗位投递。完成后继续当前已授权的任务，不为每次提交自动唤起另一模型审查。
- 不创建定时代码审查、轮询或额外模型调用。等用户要求汇总审查时，再按明确基线集中读取新增提交与未提交差异，由用户指定的审查者决定是否合入正式版本。简历内容的独立审查仍按填写 Skill 执行。

能力演进不会扩大外部操作权限。最终提交、撤回申请和发送消息继续使用原有确认规则。

规划尚未覆盖的提交能力时，读取
[references/deferred-submission.md](references/deferred-submission.md)。
