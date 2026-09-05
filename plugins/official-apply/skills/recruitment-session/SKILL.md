---
name: recruitment-session
description: 为企业招聘官网准备登录状态并找到站内简历入口。用户要求登录招聘站、复用 Chrome/Edge 登录态、处理短信或图片验证码、进入个人中心或“我的简历”时使用。输出长期 runId、简历 URL 和匹配的 PageScript。
---

# recruitment-session

从 `taskId` 建立一个可继续填写的真实浏览器会话。

## 流程

1. 使用 Playwright persistent profile 打开任务。
2. 复用已有登录态；需要时迁移目标域名 Cookie或执行站点短信登录。
3. 在个人中心、账号菜单、前端路由和网络接口中找到站内简历入口。
4. 进入真实编辑页，匹配 PageScript，并保存 `runId`、`batchId` 和稳定 URL。
5. 每完成或阻断一家公司后调用 `apply.next_work { batchId }`，继续处理返回的任务。

找简历入口时调用 `apply.open_resume`。职位列表和岗位详情不属于简历入口；除非用户明确
要求代选岗位，否则不能为了进入申请表而选择一个岗位。官网没有独立简历入口时，继续检查
个人中心路由和简历接口；仍找不到就记录该公司“简历入口依赖明确岗位”，然后处理下一家。
只有 `apply.next_work` 返回 `waiting_for_user` 时，才能说明整批都在等待用户。

## Playwright 与 Computer Use

- Playwright 负责浏览器会话、结构化页面、网络观察和状态读回。
- Computer Use 负责图片、点选、滑块验证码，以及 Mac“信息”等桌面界面。
- 验证码完成后继续使用同一个 `runId` 检查登录结果。

## MCP 连接

Agent 调用：

- `apply.open_task`：打开任务页面并创建可连续使用的 `runId`。
- `apply.next_work`：完成或阻断一家公司后，读取同批下一项可继续的工作。
- `apply.login`：在原页面检查登录状态，或执行短信登录等登录动作。
- `apply.open_resume`：在当前账号中找到并打开站内简历编辑页。
- `apply.get_status`：读取当前任务、页面、登录状态和阻断原因。
- `apply.approve_host`：用户允许跳转到新的招聘域名后，记录并放行该域名。
- `apply.list_open_runs`：列出当前仍在运行的浏览器会话。
- `apply.close_run`：关闭指定会话并释放浏览器页面。

MCP 持有浏览器页面并调用共享登录核心。Agent 按本 Skill 的步骤调用 MCP。

## 会话入口

- `persistent`：正式默认入口，登录状态保存在项目 profile。
- `attach_existing`：调用方提供有效动态 CDP 地址时的实验性接管入口。
- 浏览器扩展后台标签：登录态只存在于用户浏览器时的辅助入口。
- Computer Use：验证码和桌面视觉入口。

登录成功后调用 `apply.open_resume`。它在原 `runId` 中进入当前账号的简历编辑页并匹配
PageScript。

同一 Moka 招聘系统的另一个企业站尚未登录时，先运行
`scripts/migrate-moka-session.mjs`，只迁移已验证有用的五个会话 Cookie。迁移后仍要用
`apply.login { action: "inspect" }` 验证目标站登录状态，不能只凭 Cookie 数量判断成功。

底层测试使用内部临时浏览器 helper；正式入口处理真实站点会话。

## 输出

```text
taskId
batchId
runId
siteHost
resumeUrl
pageScriptId
loginStatus
blockers
```

用户还要填写或检查简历时，把 `runId`、`resumeUrl` 和 `pageScriptId` 交给
`resume-fill-review`。用户只要登录或寻找入口时在本 Skill 结束。

需要短信、Mac“信息”、浏览器后台邮箱、旋转图片或其他视觉验证码时，读取
[references/login-verification.md](references/login-verification.md)。
