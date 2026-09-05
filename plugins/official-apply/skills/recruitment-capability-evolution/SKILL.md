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
| `recruitment-link` | 无 | 使用岗位来源、Playwright、CLI 和 MCP 获取并保存链接。 |
| `recruitment-session` | `solve-rotation-captcha.py`、`rotation-captcha-login-session.mjs` | 在当前挑战过期前完成取图、下载、角度计算、单次拖动和接口验证；服务端换题后重新计算。 |
| `recruitment-session` | `solve-overlay-rotation-captcha.py`、`overlay-rotation-login-session.mjs` | 对背景加透明圆片的旋转题读取当前图片，按验证码引擎的角度和轨道关系完成单次拖动并读取验证接口。 |
| `recruitment-session` | `solve-jigsaw-captcha.py`、`jigsaw-captcha-session.mjs` | 按验证码引擎处理一类拼图题，识别亮/暗缺口、计算横向距离、单次拖动并监听验证接口；不计算角度。 |
| `recruitment-session` | `migrate-moka-session.mjs` | 在 Moka 企业站之间只迁移五个已验证有用的会话 Cookie，自动备份目标状态，并要求在目标站重新验证登录。 |
| `resume-fill-review` | 无 | 通过 MCP、共享核心和 PageScript 填写与审查。 |
| `job-application-submit` | 无 | 通过 MCP 和提交核心完成预检、确认与单次提交。 |
| `qiuzhao-feed` | `fetch_render.py` | 下载秋招数据，按行业、关键词和截止日期筛选，并生成本地 HTML。 |

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

## 演进方式

- Agent 可以直接修改并验证任务范围内可撤销的本地能力，然后继续原任务。
- 先观察真实页面和已有 Evidence，再修改能解决问题的最小范围。
- 先读 `.local/runs/<runId>/summary.json`。它汇总执行路线、扫描次数、提问次数、失败控件、耗时、保存和提交结果；原始日志只在需要定位细节时读取。
- 未知页面第一次成功后保存本机填写候选。填写候选由页面读回验证；保存动作必须另有明确成功的保存接口证据，不能因为按钮点过或页面变化就启用。
- 同站再次出现时优先使用已验证候选。候选不匹配就退回通用扫描；多次失败后再写正式站点 PageScript。
- 保留日志、截图、Evidence、`taskId` 和可继续使用的 `runId`。
- 使用真实站点完成操作和读回；验证通过后再把探索代码移入正式位置。
- 运行相关测试和 Skill 校验，并为一项完整改动创建一个 Git commit。
- 当前任务中确实无法处理时，才在统一阻断文档中记录证据、尝试和恢复条件。

能力演进不会扩大外部操作权限。最终提交、撤回申请和发送消息继续使用原有确认规则。

规划尚未覆盖的提交能力时，读取
[references/deferred-submission.md](references/deferred-submission.md)。
