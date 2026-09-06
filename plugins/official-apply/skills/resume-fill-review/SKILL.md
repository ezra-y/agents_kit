---
name: resume-fill-review
description: 在企业招聘官网填写、保存并检查站内简历。用户要求更新简历、补教育/工作/项目、上传 PDF、检查站内简历，或已经有 recruitment-session 的 runId 时使用。先核对资料，再填写并重新打开服务器简历，最后交独立 Agent 对照原资料、字段全文和截图审查。填写请求停在审查结果，不提交申请。
---

# resume-fill-review

输入为 `taskId`、`runId`、`batchId`、`resumeUrl` 和本次处理范围。按下面顺序执行；调用示例中的值替换为本次真实值。
命令在插件根目录执行；先读配置中的私有数据绝对目录。下文 `<dataRoot>` 指该目录，所有证据都保存在其中。

## 1. 核对任务与资料

### 1.1 读取已有状态

1. 执行 `node bin/applyctl.js task list --json`，用 `taskId` 找到任务；已有运行调用 `apply.get_status { runId }`。
2. 读取该任务绑定的简历、履历记录、材料和已确认答案，按 [私有资料](references/private-resume-data.md) 核对原始材料。
3. 没有可用中文简历时索要，英文可选。已有资料不重问；缺少的必填事实集中询问，选填留空。
4. 在用户指定的公司范围内工作。只读找匹配岗位需要用户已表达这一目的，按已存意向和官网完整 JD 判断；资料不足标“待核实”。

### 1.2 确认可以继续

1. 本批仅处理未投递记录时，跳过已确认提交的任务；结果不确定的任务先核对官网应聘记录，保持原结果，不能当未投递重做。
2. 明确岗位须确认官网仍接受申请、硬条件与用户事实相符；停止招聘或明确不符就记录原因。公司简历入口本身不能证明岗位开放。
3. 没有有效运行或登录已失效，交给 [登录流程](../recruitment-session/SKILL.md)，取得可用 `runId` 后继续。缺少具体岗位不妨碍独立站内简历的填写。

## 2. 读取真实字段并补答案

### 2.1 扫描和解析

依次调用 `apply.inspect_page { runId }`、`apply.resolve_page { runId }`。
外层 `ok: true` 只说明工具调用成功。网站脚本分支检查 `data.preparation.missing/conflicts/skipped` 和缺失材料/记录；通用分支检查 `data.missing`、`data.requiresReviewRuntimeRefs`。
网站脚本返回的 `resolvedKeys` 只有键名，不能据此声称字段内容正确。已知答案与官网选项矛盾时停止该字段，说明需要确认的具体内容。

### 2.2 保存用户回答

收到真实回答后调用 `apply.save_answers { runId, answers: [{ canonicalKey, value, scope }] }`，scope 按私有资料说明选择。
随后再次 `apply.resolve_page { runId }`。新增履历或更换材料按私有资料说明更新任务绑定并建立新运行，旧运行不会自动读到新绑定。
必填缺项暂时无法补齐时记录该公司阻塞，先处理其他公司；同一问题在批次内合并询问。

## 3. 填写并检查当前表单

### 3.1 写入

调用 `apply.fill_page { runId }`。检查 `data.outcome`、`data.fill.failed` 和 `data.preparation.skipped`；通用分支检查每项填写结果。
每个真实项目独立填写，沿用原名称、日期和角色；应用私有 `includeInApplications: false` 偏好。单一描述框同时保留概述和全部详细条目。
官网限制条数或字数时记录具体未填内容；未经用户允许，不通过合并项目或删掉后续段落消除错误。官网没有对应栏目时说明附件承载情况。

### 3.2 校验与失败处理

调用 `apply.validate_page { runId }`。网站脚本检查 `data.validation.valid/issues`；通用分支检查 `data.valid/issues`。失败时只修有问题的字段，再校验。
结构化操作失败且有当前字段引用时，按 [证据与恢复](references/evidence-recovery.md) 调用视觉辅助，验证时提供完整 `expectedValue`，不能只验证非空。
这些校验属于填写者自检，还不算独立审查。

## 4. 保存、重新打开与采集证据

### 4.1 保存草稿

自检通过后调用 `apply.advance { runId, actionKind: "save" }`。明确传 `save`，不用下一步或提交代替。
网站脚本分支检查 `data.saveDraft.attempted/saved`、`data.serverReadback.valid` 和 `data.evidencePath`；通用分支的 `data.saveConfirmation.confirmed` 只证明保存响应，仍须重新打开并读回。
保存失败或无法确认服务器读回时保留“保存/读回待核实”，不能报告完整成功。

### 4.2 交付完整审查材料

按 [证据与恢复](references/evidence-recovery.md) 收集原资料、保存前字段全文、服务器读回全文，以及两阶段完整截图。
多页/折叠卡片/滚动文本框要补齐未显示的内容；完整页面截图不代表文本框里所有段落都已展示。优先读控件完整值，截图辅助核对栏目归属。
把本次 `taskId`、`runId`、最新 `evidencePath` 写入 `<dataRoot>/reviews/<batchId>/index.json`，标为 `pending`；单任务用 taskId 代替 batchId。

## 5. 每 10 家交给独立 Agent 审查

### 5.1 派发与等待

默认每积累 10 家待审记录审一轮，覆盖这 10 家全部记录；尾批不足 10 家、任务结束或真实提交前也立即审查相关记录。
读取 [独立审查提示词](../../agents/resume-field-reviewer.md)，通过当前宿主的子 Agent 工具启动新上下文，传入本批 index 路径和指定的报告路径。工具名称以当前宿主实际提供的为准。
填写者不兼任审查者。没有独立 Agent 能力时保持 `pending` 并说明“独立审查未执行”，不以重新提示自己替代。

### 5.2 处理结果

读取审查者实际生成的逐公司报告；只有全部必需证据可读、字段完整且无未解决差异时，该项才记 `passed`。`needs_fix` 交填写者修复后重新保存、截图、独审；缺证据记 `insufficient_evidence`。
每次修改字段或材料都使该项旧审查失效，重新标 `pending`。报告绑定本次 evidencePath；恢复任务先读 index，不能因任务库显示 completed 就跳过待审项。
每家公司只反馈已保存、独审通过/待审/待修、阻塞和下一步；不把程序自检通过说成独审通过。

## 6. 结束或交接

用户只要求填写时，保存并独审后结束；有问题则如实交付未完成项。用户授权找岗位时，按 [候选岗位记录](../official-apply/references/source-and-candidate-records.md) 收集岗位链接和完整 JD，交用户选择。
用户明确要求真实投递时，将 `taskId`、`runId`、`serverReadback`、`evidencePath` 和通过的独审报告交给 `job-application-submit`；岗位专属字段改动也须先审查。
无需立即交接到下一阶段时，完成证据采集后调用 `apply.close_run { runId }` 释放本次会话；需要修复时重新打开。批次用 `apply.next_work { batchId }` 继续；若重复返回同一已知阻塞项，按登录流程第 2.2 步从本批清单继续其他任务。结束或报告整批等待前，把尾批待审记录审完。
