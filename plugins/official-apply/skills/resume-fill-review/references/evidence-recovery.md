# 保存、证据、视觉辅助与恢复

所有运行文件使用配置解析出的绝对 `<dataRoot>`：材料、截图、会话、临时图片、审查报告和表格登记集中在此处。文中的 `.local/` 都是这个目录的简称，不相对于终端当前目录。可复用脚本随插件发布，私有运行数据不写入会被更新替换的插件安装缓存，也不写到桌面或其他项目。
工具能指定输出位置时直接传 `<dataRoot>` 下的绝对路径；宿主强制生成临时截图时，将本任务需要保留的文件归档到此目录并引用归档路径，能清理的本任务临时副本在结束后清理，不移动或删除宿主管理的文件。

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

evidencePath 是相对本次运行的插件根目录返回的路径；按插件根目录解析成绝对路径，不能按终端当前目录或再次拼 dataRoot。确认它位于已配置的数据目录后写入审查清单。
真实内容只在私有证据中保存。外部报告只提供结果和必要差异，不把整份个人资料写入公共日志。
review-data 包含 source.payload、beforeSave 和 serverReadback；source 尚未经过网站字段转换。
serverReadback.reopened=false 表示未能重新打开，不能把当前页面当成服务器读回。截图失败也会标明；逐项核实文件可读，不能只看 evidencePath 存在。
单张截图不保证所有控件内部文本可见。文本框全文、折叠卡片、分页、附件与子页面按需补齐，补充文件和原始材料路径一并加入 index 条目的 supplementalEvidence。

## 只补当前页面证据

已手动保存、只缺字段全文或截图时，调用 `apply.inspect_page { runId, captureEvidence: true }`。
`data.reviewEvidence` 返回绝对 evidencePath、字段数、截图数和 errors。目录中的 review-page.json 保存当前可见控件全文，page.png 和 scroll-*.png 覆盖页面及内部滚动区。
先检查 errors，再打开截图核实栏目覆盖。折叠栏目先通过实际页面展开，再补采。把该目录加入原 index 条目的 supplementalEvidence。
该操作不改表单、不点击保存、不重新加载页面；证据范围是当前视图。保存响应及服务器复开的证明沿用原证据，不能用补采动作替代。

## 通用页面保存路径

没有匹配网站脚本时，advance 返回的保存响应确认不包含自动重新打开或上述证据包。
在 `<dataRoot>/evidence/sites/<host>/resume-save/<runId>-<time>/` 建立本次目录，保存前后分别用当前宿主可用的浏览器工具读取实际控件完整值并完整截图；保存后显式打开真实简历 URL，再读回。
截图命名仍使用 before-save.png 和 server-readback.png；只提供视口截图的电脑工具需滚动覆盖各栏目，依次编号，不能把一张视口图称为全页截图。
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
修改材料或字段后，把原报告加入 supplementalEvidence，复审受影响项；全量保存还要比较其他字段是否变化。只有补截图时，保留已核对的保存结果并只补证据，核实同一内容版本后复审缺证部分。新报告引用沿用的旧报告和证据，任务恢复时读取清单中尚未解决的动作。

## 视觉操作

填写、选择、上传、翻页、草稿保存和验证码都遵循：先用匹配脚本或当前页面的结构化工具，缺少适配或操作失败时转 Computer Use（电脑操作）。视觉方式完成后仍须保存、重新打开、核对全文和独立审查。

1. 读取当前宿主电脑操作工具的实际说明，确认它能控制目标页面。复用当前浏览器、账号和页面；不为视觉操作另建另一种浏览器的填写程序。
2. 浏览器截图/坐标工具能控制无头页面时继续无头。只有桌面工具时使用配置中同款浏览器的可见窗口；若工具不能将现有无头会话显示出来，先保存已填内容和可用会话状态，再关闭本任务旧会话，用同一配置/档案重开并检查真实登录。不能继承的未保存内容和验证码须重新读取，不能关闭用户原有浏览器。
3. 获取新截图，确认目标控件后执行点击、输入、拖动或滚动。多步表单逐页处理；不得对旧截图连续盲点。普通“确认/提交”按钮先核实实际用途，最终投递仍走提交流程。
4. 能读 DOM/控件值时读回完整 expectedValue；视觉独有控件通过操作后截图及保存后重新打开核实。读不到文本框全文时滚动/展开补齐，仍缺证据则明确待核实，不能宣布完整通过。
5. 无电脑操作工具、无法控制当前页面或视觉操作也失败，才连同实际工具结果交能力演进诊断；同一问题已诊断则复用记录。用户缺失事实、网站拒绝或宿主权限要求仍需如实处理，换操作方式不扩大权限。

已有当前字段 runtimeRef 时可复用 MCP 的局部辅助：

```text
apply.build_visual_fallback { runId, runtimeRef, goal }
→ 宿主只在允许区域执行一次动作
→ apply.verify_visual_fallback { runId, runtimeRef, expectedValue }
```

没有 runtimeRef 时直接按上述宿主电脑操作步骤处理，不把该辅助工具的前置条件当作全部视觉操作的限制。runtimeRef 必须来自本次实际扫描。expectedValue 传完整期望值，避免默认只验证非空。视觉操作后用 DOM、ARIA 或字段值验证；截图作为辅助证据。

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
