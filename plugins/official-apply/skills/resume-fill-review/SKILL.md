---
name: resume-fill-review
description: 在企业招聘官网填写、保存并检查站内简历。用户要求更新简历、补教育/工作/项目、上传 PDF、检查站内简历，或已经有 recruitment-session 的 runId 时使用。先核对资料，再填写并重新打开服务器简历，最后交独立 Agent 对照原资料、字段全文和截图审查。填写请求停在审查结果，不提交申请。
---

# resume-fill-review

输入为 `taskId`、`runId`、`batchId`、`resumeUrl` 和本次处理范围。按下面顺序执行；调用示例中的值替换为本次真实值。
命令在插件根目录执行；先读配置中的私有数据绝对目录。下文 `<dataRoot>` 指该目录，所有证据都保存在其中。
`task run` 是旧的一键页面执行入口，不包含下面的表格选行、表二收尾和独立审查，不能用它替代本流程。当前宿主未提供 apply 工具时，使用可用浏览器工具逐步完成相同动作与读回；缺少某步能力要说明，不能跳过。

## 1. 核对任务与资料

### 1.1 读取已有状态

1. 运行 `python3 skills/recruitment-link/scripts/table-locations.py --data-root <dataRoot> show`，先确认第一张来源表与第二张结果表。按 [表格筛选与收尾](../recruitment-link/references/fill-selection.md) 读取当前表格，生成允许填写的行清单。
2. 只为清单中的 eligible 行查找已关联 taskId/runId，再用 `apply.get_status { runId }` 读状态。task list 用于查关联记录，不根据最近运行时间、历史登录成功或旧失败清单选择公司。
3. 按 [私有资料](references/private-resume-data.md) 读取当前行绑定的简历、履历和答案。没有可用中文简历时索要；缺少必填事实集中询问，选填留空。
4. 没有第二张表时先按登记/创建流程补齐结果存放位置；不把“以后有推荐岗位再建表”作为省略保存结果的理由。

### 1.2 确认可以继续

1. 本批仅处理未投递记录时，跳过已确认提交的任务；结果不确定的任务先核对官网应聘记录，保持原结果，不能当未投递重做。
2. 明确岗位须确认官网仍接受申请、硬条件与用户事实相符；停止招聘或明确不符就记录原因。公司简历入口本身不能证明岗位开放。
3. 没有有效运行或登录已失效，交给 [登录流程](../recruitment-session/SKILL.md)，取得可用 `runId` 后继续。缺少具体岗位不妨碍独立站内简历的填写。

## 2. 读取真实字段并补答案

### 2.1 扫描和解析

依次调用 `apply.inspect_page { runId }`、`apply.resolve_page { runId }`。
外层 `ok: true` 只说明工具调用成功。网站脚本分支检查 `data.preparation.missing/conflicts/skipped` 和缺失材料/记录；通用分支检查 `data.missing`、`data.requiresReviewRuntimeRefs`。
工具返回空页面、无字段或找不到下一步时，先按 [入口与页面恢复](../recruitment-link/references/entry-recovery.md) 检查实际页面，按结果回到来源查找、视觉操作或能力演进；再继续解析。
网站脚本返回的 `resolvedKeys` 只有键名，不能据此声称字段内容正确。已知答案与官网选项矛盾时停止该字段，说明需要确认的具体内容。

### 2.2 保存用户回答

收到真实回答后调用 `apply.save_answers { runId, answers: [{ canonicalKey, value, scope }] }`，scope 按私有资料说明选择。
随后再次 `apply.resolve_page { runId }`。新增履历或更换材料按私有资料说明更新任务绑定并建立新运行，旧运行不会自动读到新绑定。
必填缺项暂时无法补齐时记录该公司阻塞，先处理其他公司；同一问题在批次内合并询问。

## 3. 填写并检查当前表单

### 3.1 写入

先按当前网页实际值列出空白字段/缺失卡片及已存在内容，仅对空白部分写入；不能把“任务未完成”理解为整页重填。已有值与资料冲突时记录差异，未经用户要求不覆盖；选项匹配按私有资料中的已确认偏好执行。
`apply.fill_page { runId }` 没有 empty_only 参数，也不保证保留非空字段；仅在本次目标栏目为空且已确认脚本不会覆盖其他内容时调用。已有内容的页面用当前浏览器工具逐字段补空并读回；无适用脚本或结构化操作失败时，先按 [视觉操作](references/evidence-recovery.md#视觉操作) 使用 Computer Use。视觉路径仍失败时，再按 [能力演进](../recruitment-capability-evolution/SKILL.md) 在现有浏览器接口下补最小能力并验证；确实不能处理才停止该页，不调用整页脚本碰运气。
调用填写工具后检查 `data.outcome`、`data.fill.failed`、`data.preparation.skipped` 或实际字段读回；任务行筛选返回的 fillMode 只是写入范围要求，不是现有 MCP 参数。
官网分设工作与实习栏目时，同一段经历按已确认的任职性质只进入一个栏目；只有合并栏目时才统一填写，不能把一段实习复制到两栏。
所有用户选中的项目逐条完整填写，沿用原名称、日期和角色；应用私有 `includeInApplications: false` 排除标记，不因名称含 Skill 等词自行删选。按实际栏目承载项目内容：默认将概述、详细条目和明确的职责内容完整放进项目描述，选填的“项目中职责”留空；只有一个叙述框时全部放在那里。官网将职责标为必填或用户明确要求分开时，再用资料明确的职责填写，缺少事实集中问。bullets 是条目排版，不代表职责，不按关键词拆分。
官网限制条数或字数时记录具体未填内容；未经用户允许，不通过合并项目或删掉后续段落消除错误。官网没有对应栏目时说明附件承载情况。

### 3.2 校验与失败处理

调用 `apply.validate_page { runId }`。网站脚本检查 `data.validation.valid/issues`；通用分支检查 `data.valid/issues`。失败时只修有问题的字段，再校验。
结构化操作失败时，按 [视觉操作](references/evidence-recovery.md#视觉操作) 使用 Computer Use；有当前字段引用时可调用局部视觉辅助，验证提供完整 `expectedValue`，不能只验证非空。无字段引用不代表电脑操作不可用。
遇到浏览器/页面/字段操作/脚本/保存/读回等技术问题，宣布技术阻塞前必须先调用一次 [能力演进](../recruitment-capability-evolution/SKILL.md) 诊断和尝试修复；成功后继续原阶段，仍失败再记录具体阻塞。同一问题复用已有演进记录，不无限重复。缺用户事实或权限时不通过代码猜补或绕过。
这些校验属于填写者自检，还不算独立审查。

## 4. 保存、重新打开与采集证据

### 4.1 保存草稿

填完后完成当前栏目和整页的保存/暂存，并重新打开确认内容仍在；不要停在仅填入未保存的状态。
自检通过后调用 `apply.advance { runId, actionKind: "save" }`。明确传 `save`，不用下一步或提交代替。
网站脚本分支检查 `data.saveDraft.attempted/saved`、`data.serverReadback.valid` 和 `data.evidencePath`；通用分支的 `data.saveConfirmation.confirmed` 只证明保存响应，仍须重新打开并读回。
保存失败或无法确认服务器读回时保留“保存/读回待核实”，不能报告完整成功。

### 4.2 交付完整审查材料

按 [证据与恢复](references/evidence-recovery.md) 收集原资料、保存前字段全文、服务器读回全文，以及两阶段完整截图。
多页/折叠卡片/滚动文本框要补齐未显示的内容；完整页面截图不代表文本框里所有段落都已展示。优先读控件完整值，截图辅助核对栏目归属。
按表格筛选与收尾第 3 节立即把保存结果写入第二张表并读回，同时写入登录阶段确认的登录方式，记录其真实 recordId；第一张表先记已保存或部分填写，独审前不勾完成。
把本次 `taskId`、`runId`、最新 `evidencePath` 写入 `<dataRoot>/reviews/<batchId>/index.json`，标为 `pending`；单任务用 taskId 代替 batchId。

## 5. 每 10 家交给独立 Agent 审查

### 5.1 派发与等待

默认每积累 10 家待审记录审一轮，覆盖这 10 家全部记录；尾批不足 10 家、任务结束或真实提交前也立即审查相关记录。
读取 [独立审查提示词](../../agents/resume-field-reviewer.md)，通过当前宿主的子 Agent 工具启动新上下文，将已读取的私有 preferences.json 路径加入 index 的 sourcePaths，传入本批 index 路径、待审任务和指定的报告路径；字段取舍与通过标准直接使用该提示词，填写者只提交证据和修改说明，不替审查者预先指定结论。工具名称以当前宿主实际提供的为准。
填写者不兼任审查者。没有独立 Agent 能力时保持 `pending` 并说明“独立审查未执行”，不以重新提示自己替代。

### 5.2 处理结果

按报告中需要做的事继续：内容差异 `needs_fix` 才修改对应字段、保存读回；已核实的官网限制只记录未承载内容及影响。内容已核对、仅缺截图时保留 `insufficient_evidence`，表中写“内容已核对，截图待补”，只补采证，不重新填写整页；所需证据齐全后才记 `passed`。
修改使受影响项重新标 `pending`，保留旧报告于 supplementalEvidence，并交代本次修改及保存范围。局部更新只复审受影响字段和关联项；整份简历重写时还需检查其他字段是否改变。新报告引用未受影响项的旧证据，不重复审查同一材料。报告绑定实际 evidencePath；恢复先读 index，不能因任务库显示 completed 就跳过待审项。
每家公司只反馈已保存、独审通过/待审/待修、阻塞和下一步；不把程序自检通过说成独审通过。

## 6. 结束或交接

独审后按表格筛选与收尾第 3 节更新第二张表的同一行；确认完整且独审通过、结果表写回成功后，才勾选第一张表的处理完成并读回。写回失败记“表格待同步”，不能宣布该公司已全部完成。
用户只要求填写时，保存并独审后结束；有问题则如实交付未完成项。用户授权找岗位时，按 [候选岗位记录](../official-apply/references/source-and-candidate-records.md) 收集岗位链接和完整 JD，交用户选择。
用户明确要求真实投递时，将 `taskId`、`runId`、`serverReadback`、`evidencePath` 和通过的独审报告交给 `job-application-submit`；岗位专属字段改动也须先审查。
无需立即交接到下一阶段时，完成证据采集后调用 `apply.close_run { runId }` 释放本次会话；需要修复时重新打开。批次用 `apply.next_work { batchId }` 继续；若重复返回同一已知阻塞项，按登录流程第 2.2 步从本批清单继续其他任务。结束或报告整批等待前，把尾批待审记录审完。
