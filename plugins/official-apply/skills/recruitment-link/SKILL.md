---
name: recruitment-link
description: 获取企业招聘官网的稳定岗位或简历链接。用户给出公司、岗位表、飞书 Base、招聘汇总、官网首页，或现有链接失效时使用。先复用已有官网链接；缺失时从官网导航、页面源码和网络路由中找到，并创建或更新任务。
---

# recruitment-link

把岗位来源变成后续阶段可重复使用的官网任务。

## 流程

1. 读取用户给出的链接、岗位表、飞书 Base 和已有任务。
2. 验证链接属于企业招聘官网，并识别它是公司入口、简历入口还是明确岗位。
3. 链接缺失或失效时，使用官网导航和 Playwright 观察前端路由与网络请求。
4. 为本次来源生成一个 `batchId`，同批任务共用它，再保存稳定官网 URL、来源证据和任务绑定。

用户明确要求发现最新秋招时调用 `qiuzhao-feed`。用户已经提供岗位来源时直接处理现有来源。

## 岗位来源边界

- 公司招聘首页、职位列表或“校园招聘”这类汇总项不等于明确岗位。
- 用户只要求登录、填写或检查站内简历时，只寻找账号和简历入口，不进入职位选择。
- 只有来源中已有明确岗位，或用户明确要求代选岗位时，才能从职位列表选择岗位并创建明确
  岗位任务。
- “处理若干家公司”或“投若干家公司”本身不代表授权 Agent 自行决定具体岗位。
- 需要具体岗位但当前来源没有时，把“缺少明确岗位”写入现有任务记录并继续下一家公司；
  不用猜测补齐。

## 运行入口

- 外部岗位表和连接器负责读取来源。
- `applyctl task import` / `task add` 写入任务。
- Playwright 负责官网路由和接口发现。
- `apply.approve_host` 记录任务需要的明确跳转域名。

## MCP

- `apply.approve_host`：任务必须跳到新的招聘域名时，记录用户批准并放行该域名。

任务导入目前使用 `applyctl` 命令行，不经过 MCP。

公司入口写成 `taskKind: company_resume`，不写岗位来源和证据。明确岗位写成
`taskKind: job_application`，并按真实来源写入 `jobSelectionSource` 和
`jobSelectionEvidence`。同一次来源生成的任务使用同一个 `batchId`。

## 输出

```text
taskId
batchId
companyName
taskKind
jobUrl
resumeUrl（已发现时）
linkPurpose（company_entry / resume_entry / exact_job）
jobSelectionSource（明确岗位时）
jobSelectionEvidence（来源中的明确岗位或用户明确授权）
sourceEvidence
```

用户还要登录或填写简历时，把 `taskId` 和官网 URL 交给 `recruitment-session`。用户只要
岗位链接时在本 Skill 结束。批量交接必须同时传递 `batchId`，后续每完成或阻断一家公司
后用它调用 `apply.next_work`。

需要处理 qiuzhao-feed、有限志愿或批量任务时，读取
[references/source-routing.md](references/source-routing.md)。
