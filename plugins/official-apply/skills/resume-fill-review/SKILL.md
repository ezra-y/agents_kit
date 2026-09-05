---
name: resume-fill-review
description: 在企业招聘官网填写、保存并审查站内简历。用户要求更新简历、补教育/工作/项目、上传 PDF、检查站内简历，或已经有 recruitment-session 的 runId 时使用。读取官网真实字段，调用 PageScript 填写，保存后重新打开服务器简历并检查结构和语义。
---

# resume-fill-review

使用 `recruitment-session` 提供的 `runId` 完成站内简历。

## 流程

1. 读取任务绑定的私有简历、材料和已确认答案。没有可用中文简历时，在打开填写页前向用户索要；
   英文简历可选。
2. 首次使用或简历变更时，按 [私有简历和答案](references/private-resume-data.md) 导入；已有有效资料时
   直接查缺项，并补齐本批适用的常见资料。
3. 读取当前公司官网的字段、必填规则、选项、重复卡片、上传控件和页面实现版本。
4. 按栏目映射私有资料并填写全部可确定内容；官网解析附件只用于辅助，不直接作为最终数据。
5. 读回当前表单并保存，再重新打开服务器简历，检查结构、语义、附件和完整截图。

## 填写原则

- 官网字段和选项决定表单结构。
- 同一招聘系统的不同公司可能使用不同页面版本和请求格式。PageScript 必须根据当前页面
  的真实字段和官网请求生成数据，不能直接套用另一家公司的请求。
- 教育、工作、项目和奖项保持原记录类型。每个真实项目独立填写，沿用原项目名和起止时间。
- 单一描述框同时写入概述和详细条目；保存后逐条核对原文，不能只检查“字段非空”。
- 先读取私有资料中的项目选择偏好；`includeInApplications: false` 的记录保留在资料库，当前网申不填写。
- 项目所需日期和角色从原简历、本地资料和已有证据中拆出；没有证据时不编造。
- 某栏目要求源资料没有的必填值时，先使用官网支持且语义不变的等价栏目保存记录。
  没有等价栏目时保留在附件，并把该字段记为阻断。
- 官网缺少对应栏目时，内容保留在附件简历。
- 官网限制记录数量时，按私有资料顺序填写可容纳的独立记录；其余记录保留在附件简历，
  并在审查结果中写明栏目容量和剩余数量。
- 作品链接使用真实 URL。
- 已确认的答案直接复用。当前任务适用的常见缺项一次询问；陌生必填问题记为阻断，与同批缺项
  集中询问，保存后按正确范围复用。

一个真实页面使用一个完整 PageScript。辅助函数负责数据准备、控件操作和站点格式转换。
优先用 Playwright 读取页面结构和网络请求。发现稳定的站内接口后，可以由 PageScript
直接写入，但仍需使用当前页面的登录态，并在保存后重新读取服务器数据。

## MCP 连接

Agent 使用同一个 `runId` 调用：

- `apply.inspect_page`：扫描当前页面的字段、选项、按钮、错误和页面结构。
- `apply.resolve_page`：理解字段含义，并从私有简历和已存答案中准备填写数据。
- `apply.save_answers`：保存用户补充的信息，供当前或后续任务复用。
- `apply.fill_page`：通过当前页面的 PageScript 写入已经确定的数据。
- `apply.validate_page`：重新读取页面，检查填写结果、报错和缺失字段。
- `apply.advance`：执行保存、下一步或上一步，但不执行最终提交。
- `apply.build_visual_fallback`：结构化填写失败时，生成交给 Computer Use 的最小操作。
- `apply.verify_visual_fallback`：视觉操作完成后重扫页面，确认动作真的生效。
- `apply.get_status`：读取当前任务、页面进度和阻断原因。
- `apply.close_run`：审查结束后关闭指定浏览器会话。

保存站内简历时使用 `apply.advance { actionKind: "save" }`。共享核心调用 PageScript 保存，
再用原 `runId` 重新打开服务器简历并校验。PageScript 使用 Playwright 操作页面。

## 审查输出

```text
reviewed
serverReadback
sectionCounts
semanticIssues
evidencePath
```

用户只要求简历时，服务器读回和审查通过后结束。用户明确要求申请岗位时，把 `taskId`、
`runId`、`serverReadback` 和 `evidencePath` 交给 `job-application-submit`。

用户已授权按求职意向查看岗位时，填写完成后只读收集该官网展示的具体推荐岗位、链接和完整 JD，
按 [招聘来源和候选岗位记录](../official-apply/references/source-and-candidate-records.md) 交给用户选择。
这一步不提交申请。

交给投递 Skill 前，必须确认当前任务已有明确岗位，而且岗位来自用户提供的来源或用户明确
授权的代选结果。公司入口、招聘项目名称和职位列表不能当成明确岗位，也不能在本 Skill
中自行补选岗位。

首次导入或更新私有资料时，读取
[references/private-resume-data.md](references/private-resume-data.md)。
需要保存证据、视觉辅助、备份和恢复时，读取
[references/evidence-recovery.md](references/evidence-recovery.md)。
