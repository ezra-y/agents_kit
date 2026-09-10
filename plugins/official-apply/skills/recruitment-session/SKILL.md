---
name: recruitment-session
description: 为企业招聘官网准备登录状态并找到站内简历入口。用户要求登录招聘站、复用 Chrome/Edge 登录态、处理短信或图片验证码、进入个人中心或“我的简历”时使用。输出长期 runId、简历 URL 和匹配的 PageScript。
---

# recruitment-session

从 `taskId` 建立可继续填写的浏览器会话。登录成功后回到用户要求的阶段，登录不代表投递授权。

## 1. 打开任务并检查登录
### 1.1 复用已有状态

已有 runId 先调用 `apply.get_status { runId }`，用 `apply.list_open_runs {}` 确认仍有活跃会话；没有活跃 run 时调用 `apply.open_task { taskId, browserMode: "persistent", headless: true }`，首次并行可传 `profileName: taskId`。
open_task 后固定调用同一 run 的 `apply.login { runId, action: "inspect" }`。先只读检查当前页面和已有正向账号证据；页面看见登录入口，或已有可靠的未登录/过期证据时，流程可以自动复用匹配来源并再次检查。检查和复用不会发送短信；`login_unconfirmed` 会保留当前页面，不继续换来源。
登录来源当前有效但导入失败时，保留源会话并按 [登录态清单与复用](references/login-verification.md#登录态清单与复用) 排查；`loginStateSource` 旧入口只复制 Cookie，不代表已完成登录验证。

### 1.2 检查真实登录结果

open_task 未成功打开页面、跳转异常或页面与工具读数矛盾时，先按 [入口与页面恢复](../recruitment-link/references/entry-recovery.md) 分流，拿到可用页面后继续本节。
每次处理目标网站，都在本次实际会话调用 `apply.login { runId, action: "inspect" }`；不得只读历史 run、报告或 Cookie 文件判断已登录。只有账号 id、受保护接口成功返回，或已确认只在登录后出现的页面证据，才返回 `logged_in`。
`login_required` 和 `sms_ready` 表示当前页面看见登录入口/短信表单，或适配器已有可靠的未登录/过期证据。`login_unconfirmed` 表示当前页面还没有可靠证据；保持同一个 runId，调用 `apply.inspect_page` 或已有 browser_action 检查账号/受保护简历后再继续，不要直接 `begin_sms`，也不要把它当成登录失败。
登录成功以当前目标网址和登录后页面标志为准。换域名、恢复会话或再次出现登录页时重新检查；历史测试成功只证明当时可用。清单按来源表选择，不按“哪些公司以前登录过”选择。

## 2. 完成能够自动处理的登录

### 2.1 短信、邮箱和图片验证码

读取 [登录与验证码](references/login-verification.md)。在用户已授权的范围内复用手机号、已登录邮箱和可用验证码工具。
短信路径为：先看到 `login_required` 或 `sms_ready`，再调用 `apply.login { runId, action: "begin_sms", phone }`；确认已发送后读取本次验证码，再调用 `apply.login { runId, action: "submit_sms_code", code }`。如果结果是 `login_unconfirmed`，先回到当前页面检查，不发送短信。
邮箱代码通过当前可用的浏览器工具读取用户已登录的邮箱；只取本次请求之后、对应服务的代码。图片验证码先用匹配脚本；无适用脚本或脚本失败，再用 Computer Use（电脑操作），按参考文档验证实际结果。
每次完成验证后在同一 runId 调用 `apply.login { runId, action: "inspect" }`。支持正向账号判断的站点返回 `logged_in` 后继续；弱站点仍为 `login_unconfirmed` 时，记录当前账号或受保护简历证据，若已在简历页就调用 `apply.resolve_page`，需要入口就调用 `apply.open_resume`，不要反复调用登录检查直到它改变状态。

并行执行时，任务交接须提供主控实际可接收消息的目标和工具。短信协调请求通过该消息工具发送；普通进度文字不等于主控已收到。短信使用窗口只覆盖发送、收码和提交验证码，结束后立即释放，继续填写无需占用窗口。等待协调期间保持进行中，不把尚未发送短信记成官网阻塞。

### 2.2 阻塞与继续

`nextAction: recover_entry` 表示继续检查当前入口。`login_unconfirmed` 需要补充当前账号或受保护简历证据；`login_required` 表示已确认需要登录，但登录表单尚未出现，先找到入口再明确调用 `begin_sms`。按 [入口与页面恢复](../recruitment-link/references/entry-recovery.md) 在同一会话继续，不把这两种结果当成工具损坏。只有 `unsupported` 或明确登录工具错误才按工具能力问题分流。

没有登录态但能够登录时继续尝试；用户已授权注册且官网提示未注册时，继续官网正常注册流程，再验证登录。出现验证码不能直接判为阻塞。先完成第 2.1 节的脚本和电脑操作路径，再判断是否缺少验证码、邮箱登录或实际工具能力，并记录具体原因和所需用户动作。
入口失效回到 recruitment-link；可见页面读不到或缺动作按入口与页面恢复检查。确属环境或脚本能力问题时交给 [能力演进](../recruitment-capability-evolution/SKILL.md)，修复后继续；权限和网站明确拒绝按实际证据处理。
按 [证据与恢复](../resume-fill-review/references/evidence-recovery.md) 更新已有阻塞记录，验证码值和登录令牌不进入长期资料。
调用 `apply.next_work { batchId }` 寻找下一项。部分入口失败不会更新调度状态；若它再次返回同一已知阻塞 taskId，读取 `node bin/applyctl.js task list --json`，按本批已确认范围选择其他未处理任务并用 open_task 打开，保留当前阻塞，不反复循环。
只有本批实际任务都已完成或逐项有明确阻塞，才报告整批结束/等待；Markdown 阻塞记录本身不会驱动程序自动跳过。

## 3. 打开真实简历入口

### 3.1 查找并进入

调用 `apply.open_resume { runId }`，保存返回的 resumeUrl 和 PageScript 信息。PageScript 是当前网站的填写脚本。
职位列表和岗位详情不等于简历入口。先检查个人中心、账号菜单、路由和接口；除非用户明确要求代选岗位，否则不为进入申请表而自行选择岗位。
按入口与页面恢复确认现有导航和真实页面请求后，仍没有独立简历入口且需要具体岗位时，记录“简历入口依赖明确岗位”，处理下一家公司。
跳转到需要用户允许的新招聘域名时，依实际授权调用 `apply.approve_host`，不用登录操作扩大公司范围。

### 3.2 交接

记录本次实际成功使用的 `loginMethod`（手机/邮箱/其他）。仅复用已有登录态且无法确定原方式时记“未确认”，不根据简历中的手机/邮箱猜测，不为补列强制退出重登；已确认的同账号历史登录方式可沿用，但不能据此判定当前仍登录。
用户还要填写时，把 `taskId`、`batchId`、`runId`、`resumeUrl`、`pageScriptId`、`loginStatus`、`loginMethod` 和 `blockers` 交给 `resume-fill-review`，完成该公司的填写后再处理下一家。
用户只要登录或寻找入口时在此结束；不执行填写和提交。会话不再需要时调用 `apply.close_run { runId }` 释放本次资源。

## 按需使用的会话工具

Playwright 负责结构化页面和状态读回；Computer Use（电脑操作）负责当前宿主支持的视觉验证码或桌面短信界面。工具是否可用以实际环境为准。
Moka 跨企业会话迁移按登录参考文档中的 `scripts/migrate-moka-session.mjs` 执行，迁移后再次 inspect；其他网站不套用 Moka 的 Cookie 规则。
## 4. 统一登录态清单与活会话复用

本节命令是查看和明确指定来源的诊断入口，常规任务不需要先手工运行它们：

```bash
node bin/applyctl.js browser login-inventory --json
```

需要预扫描具体来源时加 `--domains <目标域名[,登录域名]>`；清单中的状态文件即使没有验证元数据，也只能在当前页面再次检查后尝试。

Cookie、Storage、IndexedDB 或 profile 文件存在，只能记为未验证状态。每次采用前仍须在
目标招聘页调用 `apply.login inspect`。

OpenCLI Browser Bridge 沿用 OpenCLI 自己的 profile 配置、环境变量和默认 profile。已有默认来源时优先只尝试它；显式 `sourceId` 可以覆盖默认选择；没有默认来源且发现多个 context 时返回明确歧义。复制浏览器资料后，Bridge context 编号必须区分浏览器实例，不新增机器 ID 常量配置。

需要明确指定活 browser 来源做诊断时，才用动态 CDP 端点复用活 context：

```bash
node bin/applyctl.js browser login-reuse \
  --cdp-endpoint <动态CDP地址> --from msedge --to <项目profile> \
  --url <目标招聘页> --login-marker "个人中心" \
  --domains <招聘域名[,登录域名]> --json
```

需要明确指定 Browser Bridge 来源时改用 `--bridge-session`、`--bridge-context`：

```bash
node bin/applyctl.js browser login-reuse --from bridge --bridge-session <session> --bridge-context <context> \
  --to <项目profile> --channel msedge --url <目标招聘页> --login-marker "个人中心" \
  --domains <招聘域名[,登录域名]> --json
```

命令只导出用户指定域名的 Cookie、localStorage、sessionStorage 和 Playwright 支持的
IndexedDB，恢复到新的项目 profile 后重新检查登录标记。源浏览器不重启、不关闭，失败时
保留源状态并报告发生阶段和具体脱敏原因；源 tab 必须绑定到目标 tab 并确认处于目标 origin，
否则不读取 Storage。Firefox/Safari 当前只进清单，不把整档数据库复制器伪装成可用复用。
