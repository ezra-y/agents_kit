---
name: recruitment-session
description: 为企业招聘官网准备登录状态并找到站内简历入口。用户要求登录招聘站、复用 Chrome/Edge 登录态、处理短信或图片验证码、进入个人中心或“我的简历”时使用。输出长期 runId、简历 URL 和匹配的 PageScript。
---

# recruitment-session

从 `taskId` 建立可继续填写的浏览器会话。登录成功后回到用户要求的阶段，登录不代表投递授权。

## 1. 打开任务并检查登录

### 1.1 复用已有状态

已有 runId 先调用 `apply.get_status { runId }`，用 `apply.list_open_runs {}` 确认仍有活跃会话。
新建浏览器默认 headless:true，可正常读取字段、填写、保存和截图；headless:false 的可见窗口也允许，按实际操作需要选择。接管用户已有窗口不改变其显示状态。
没有活跃会话则调用 `apply.open_task { taskId, browserMode: "persistent", headless: true }`，保存返回的 runId。
需要复用用户 Chrome/Edge 登录态时，在 open_task 中提供已确认的 `channel`、`loginStateSource`、`loginStateSourceProfile` 和目标 `loginStateDomains`。Edge 对应 msedge；不要假定所有用户都用 Edge、默认浏览器档案或 163 邮箱。
`attach_existing` 仅在已有有效动态 `cdpEndpoint` 时使用；不编造地址，不关闭用户原来的浏览器窗口。

### 1.2 检查真实登录结果

每次处理目标网站，都在本次实际会话调用 `apply.login { runId, action: "inspect" }`；不得只读历史 run、报告或 Cookie 文件判断已登录。已登录则进入第 3 步；需要登录则进入第 2 步。
登录成功以当前目标网址和登录后页面标志为准。换域名、恢复会话或再次出现登录页时重新检查；历史测试成功只证明当时可用。清单按来源表选择，不按“哪些公司以前登录过”选择。

## 2. 完成能够自动处理的登录

### 2.1 短信、邮箱和图片验证码

读取 [登录与验证码](references/login-verification.md)。在用户已授权的范围内复用手机号、已登录邮箱和可用验证码工具。
短信路径为 `apply.login { runId, action: "begin_sms", phone }`，确认已发送后读取本次验证码，再调用 `apply.login { runId, action: "submit_sms_code", code }`。
邮箱代码通过当前可用的浏览器工具读取用户已登录的邮箱；只取本次请求之后、对应服务的代码。图片验证码先用匹配脚本；无适用脚本或脚本失败，再用 Computer Use（电脑操作），按参考文档验证实际结果。
每次完成验证后在同一 runId 调用 `apply.login { runId, action: "inspect" }`，成功才继续。

### 2.2 阻塞与继续

没有登录态但能够登录时继续尝试；出现验证码不能直接判为阻塞。先完成第 2.1 节的脚本和电脑操作路径，再判断是否缺少验证码、邮箱登录或实际工具能力，并记录具体原因和所需用户动作。
启动环境、页面加载或站点操作脚本出现技术问题时，宣布阻塞前先调用一次 [能力演进](../recruitment-capability-evolution/SKILL.md) 诊断和尝试修复，成功后继续；同一问题保留处理记录。工具权限或网站明确拒绝如实记录，不通过另写浏览器绕过。
按 [证据与恢复](../resume-fill-review/references/evidence-recovery.md) 更新已有阻塞记录，验证码值和登录令牌不进入长期资料。
调用 `apply.next_work { batchId }` 寻找下一项。部分入口失败不会更新调度状态；若它再次返回同一已知阻塞 taskId，读取 `node bin/applyctl.js task list --json`，按本批已确认范围选择其他未处理任务并用 open_task 打开，保留当前阻塞，不反复循环。
只有本批实际任务都已完成或逐项有明确阻塞，才报告整批结束/等待；Markdown 阻塞记录本身不会驱动程序自动跳过。

## 3. 打开真实简历入口

### 3.1 查找并进入

调用 `apply.open_resume { runId }`，保存返回的 resumeUrl 和 PageScript 信息。PageScript 是当前网站的填写脚本。
职位列表和岗位详情不等于简历入口。先检查个人中心、账号菜单、路由和接口；除非用户明确要求代选岗位，否则不为进入申请表而自行选择岗位。
没有独立简历入口且需要具体岗位时，记录“简历入口依赖明确岗位”，处理下一家公司。
跳转到需要用户允许的新招聘域名时，依实际授权调用 `apply.approve_host`，不用登录操作扩大公司范围。

### 3.2 交接

记录本次实际成功使用的 `loginMethod`（手机/邮箱/其他）。仅复用已有登录态且无法确定原方式时记“未确认”，不根据简历中的手机/邮箱猜测，不为补列强制退出重登；已确认的同账号历史登录方式可沿用，但不能据此判定当前仍登录。
用户还要填写时，把 `taskId`、`batchId`、`runId`、`resumeUrl`、`pageScriptId`、`loginStatus`、`loginMethod` 和 `blockers` 交给 `resume-fill-review`，完成该公司的填写后再处理下一家。
用户只要登录或寻找入口时在此结束；不执行填写和提交。会话不再需要时调用 `apply.close_run { runId }` 释放本次资源。

## 按需使用的会话工具

Playwright 负责结构化页面和状态读回；Computer Use（电脑操作）负责当前宿主支持的视觉验证码或桌面短信界面。工具是否可用以实际环境为准。
Moka 跨企业会话迁移按登录参考文档中的 `scripts/migrate-moka-session.mjs` 执行，迁移后再次 inspect；其他网站不套用 Moka 的 Cookie 规则。
