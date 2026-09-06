# 保存、证据、视觉辅助与恢复

## 网站脚本保存路径

先调用 `apply.validate_page { runId }`，再调用 `apply.advance { runId, actionKind: "save" }`。
网站脚本保存后会重新打开服务器简历并校验；调用过保存方法时，把证据写入返回的 evidencePath：

```text
<dataRoot>/evidence/sites/<host>/resume-save/run-<time>/
  before-save.png       保存前完整页面截图
  server-readback.png   重新打开成功后的完整页面截图
  result.json           保存动作与原脚本校验结果
  review-data.json      原始填写资料、两阶段实际字段全文及采集问题
```

真实内容只在私有证据中保存。外部报告只提供结果和必要差异，不把整份个人资料写入公共日志。
review-data 包含 source.payload、beforeSave 和 serverReadback；source 尚未经过网站字段转换。
serverReadback.reopened=false 表示未能重新打开，不能把当前页面当成服务器读回。截图失败也会标明；逐项核实文件可读，不能只看 evidencePath 存在。
单张截图不保证所有控件内部文本可见。文本框全文、折叠卡片、分页、附件与子页面按需补齐，补充文件和原始材料路径一并加入 index 条目的 supplementalEvidence。

## 通用页面保存路径

没有匹配网站脚本时，advance 返回的保存响应确认不包含自动重新打开或上述证据包。
保存前后分别用当前宿主可用的浏览器工具读取实际控件完整值并完整截图；保存后显式打开真实简历 URL，再读回。
例如持有同一页面的 Playwright 工具可用 `page.locator('textarea').evaluateAll(nodes => nodes.map(node => node.value))` 读取全文、`page.screenshot({path, fullPage:true})` 截图；不是持有该页面的环境不能照搬局部变量 page。
已有通用扫描快照在 `<dataRoot>/runs/<runId>/snapshots/`，可读其中的 schema.fields，但要检查是否覆盖所需栏目和全文。
工具只暴露当前视口、不能读取完整字段或无法重新打开时，记录 insufficient_evidence，不能用自检结果补造全文。按独立审查提示词要求提供相同三方证据；不声称通用分支已自动生成 review-data.json。

## 独立审查清单与恢复

填写者用文件工具维护 `<dataRoot>/reviews/<batchId>/index.json`，复用同一批清单，不新增数据库或后台服务：

```json
{"batchId":"实际批次", "items":[{"taskId":"实际任务", "runId":"实际运行", "evidencePath":"绝对路径", "sourcePaths":[], "supplementalEvidence":[], "reviewStatus":"pending", "reportPath":null}]}
```

每次保存后立刻更新该项最新 evidencePath，并设 pending。一次只由填写者写清单；审查者写单独的 report-<轮次>.json。
积累 10 家或遇到尾批/结束/提交前时，按 SKILL.md 第 5 步派独立 Agent 审查全部待审项。提示词位于插件根目录 agents/resume-field-reviewer.md，它是派发任务使用的提示词文件，不会仅因放入 agents/ 就自动运行。
报告必须来自实际独立调用，并覆盖本轮每个 taskId 和最新 evidencePath。核对后写回 reviewStatus 和 reportPath；丢项、旧路径、报告未生成均保持 pending。
修改材料或字段使旧报告失效；修复后重新保存并使用新证据再次审查。任务恢复时先读清单，避免因底层任务状态 completed 而漏掉待审项。

## 视觉兜底

普通输入框、下拉、单选、复选、日期和文件上传使用 Playwright 结构化操作。
结构化方法已有失败证据时，才使用局部视觉兜底：

```text
apply.build_visual_fallback { runId, runtimeRef, goal }
→ 宿主只在允许区域执行一次动作
→ apply.verify_visual_fallback { runId, runtimeRef, expectedValue }
```

runtimeRef 必须来自本次实际扫描。expectedValue 传完整期望值，避免默认只验证非空。视觉操作后用 DOM、ARIA 或字段值验证；截图作为辅助证据。

## 隐私和证据

- 真实答案、简历、Cookie、截图、网络观察和运行记录进入 `.local/`。
- `knowledge/`、公共 PageScript、fixtures 和 Git 只保存脱敏结构与通用规则。
- 证据按 `.local/evidence/sites/<域名>/` 隔离。
- 旧失败证据不删除；问题解决后更新状态并追加最终证据。

## 阻断总表

所有公司的阻断清单只维护在 `.local/阻断记录_真实站点.md`。每个卡点使用一条 Markdown
复选框；真实修复并验证后，在原条目勾选并补日期和结果。站点截图、网络记录和运行日志继续
按域名放在 `.local/evidence/`，作为总表条目的详细证据。

## 恢复命令

```bash
node bin/applyctl.js doctor
node bin/applyctl.js status --run <id>
node bin/applyctl.js privacy audit
node bin/applyctl.js local backup
```

失败后先读取 `apply.get_status` 和现有 blocker。先执行可行修复；同一阻断反复出现且
没有继续路径时，再交给用户。
