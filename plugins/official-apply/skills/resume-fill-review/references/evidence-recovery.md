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
在 `<dataRoot>/evidence/sites/<host>/resume-save/<runId>-<time>/` 建立本次目录，记录本次修改范围，保存后显式打开真实简历 URL，读取实际控件完整值。保存前已读值直接复用；文字无法说明的栏目、选中状态或附件才补截图。
截图命名仍使用 before-save.png 和 server-readback.png；只提供视口截图的电脑工具需滚动覆盖各栏目，依次编号，不能把一张视口图称为全页截图。
例如持有同一页面的 Playwright 工具可用 `page.locator('textarea').evaluateAll(nodes => nodes.map(node => node.value))` 读取全文、`page.screenshot({path, fullPage:true})` 截图；不是持有该页面的环境不能照搬局部变量 page。
已有通用扫描快照在 `<dataRoot>/runs/<runId>/snapshots/`，可读其中的 schema.fields，但要检查是否覆盖所需栏目和全文。
工具只暴露当前视口、不能读取完整字段或无法重新打开时，记录 insufficient_evidence，不能用自检结果补造全文。按独立审查提示词提供源资料和保存后实际内容；不声称通用分支已自动生成 review-data.json。

## 独立审查清单与恢复

批次顺序和分工以 [批次执行合同](../SKILL.md#批次执行合同)为唯一依据。每批仅维护 `index.json`（名单、阶段与证据位置）和 `report.json`（一次初审及后续返修结果）。原始履历、网页字段和截图保留原位置，用路径引用；不按待审、返修、已审再复制目录或材料。审查者交付初审后，由主控统一追加返修记录；子代理交回结果，不并发写共享文件。

批前固定名单（通常10家）与运行版本。示意如下，items须包含本批完整名单：

```json
{
  "batchId": "实际批次",
  "runtimeVersion": "本批固定版本",
  "phase": "filling",
  "items": [{
    "taskId": "实际任务",
    "runId": "实际运行或null",
    "attemptRecorded": false,
    "fillOutcome": null,
    "evidencePath": null,
    "sourcePaths": [],
    "supplementalEvidence": [],
    "acceptedExceptions": [],
    "reviewStatus": "pending",
    "reportPath": "report.json"
  }]
}
```

- 首次处理结果为saved、partial或blocked；三种均计入处理家数。只有实际结果和证据齐全才设attemptRecorded=true。部分填写明确已填范围、是否保存；未登录仅附阻塞证据。
- acceptedExceptions按具体字段记录允许的空值、暂填值或自由选项，以及两表记录ID/原文或用户授权。仅对应字段接受例外，不能豁免整份简历。
- 全部items的attemptRecorded=true才进入reviewing并派一次整批审查。9/10家有结果时继续收集第10家，不提前派审。用户明确停止或真实尾批时记录结束原因，审实际范围；不要把暂时忙碌称为尾批。
- 一份初审报告覆盖本批所有taskId，包括部分填写和未登录项。报告完成才进入repairing。每个真实问题对应一条修复项，包含字段、预期值和原证据位置。
- 返修结果只追加到同一report.json的items[].repairResults，以issueId关联初审问题，保留初审原文；index仅更新阶段和结果状态，不重复保存返修明细。记录本次修改的实际保存值与结果证据。现有读回确认后沿用初审，不默认再生成整份AI审查报告；具体缺证或意外变化才交原审查者定点处理。
- 全部修复项已明确处理、剩余外部阻塞已记录、两表已同步后，phase=closed。恢复任务先读该phase；前批仍在reviewing/repairing时，不派下一批，也不发版。

原始源资料、初审结果和最新保存证据都保留引用；补证不覆盖原失败记录。仅补截图或字段值时复用原保存证明，不再填写或保存一次。填写状态与审查状态分开：部分内容可以核对通过，官网仍未保存时继续标部分填写。

## 批量浏览器会话脚本

需要在同一个页面连续执行多步时，用 JSONL（每行一个 JSON 对象）启动轻量会话脚本。它复用正式 MCP 的 `apply.*` 工具和同一个 `runId` 页面，输入从管道传入，不受终端单行 4KB 限制：

```bash
node skills/resume-fill-review/scripts/browser-session.mjs \
  --evidence-dir "$dataRoot/runs/browser-session-check" <<'JSONL'
{"tool":"apply.open_task","args":{"taskId":"实际任务","headless":true,"channel":"chromium","profileName":"实际档案"}}
{"operation":"evaluate","runId":"上一步返回的 runId","expression":"document.body.innerText"}
{"operation":"locator","runId":"上一步返回的 runId","selector":"button","method":"screenshot","arguments":[{}]}
JSONL
```

当前运行页面已经出现拼图验证码时，在同一 JSONL 会话中调用明确的求解操作：

```json
{"operation":"solve_jigsaw","runId":"上一步返回的 runId","maxAttempts":1}
```

该操作只复用这个 runId 的活页面，不会再启动浏览器或占用新的 profile。返回值中的 caseDirectory 指向本次取图、求解输入、拖动轨迹和验证结果；求解失败也会保留 case.json，不能把失败结果当成验证码通过。

每行输出一条结果，截图会写入 `<dataRoot>` 并只返回 `screenshotPath`，不会把二进制 `Buffer`（二进制数据）打印或重复写进 JSON。包含密码、验证码或带凭据链接的请求要加 `"sensitive":true`；参数、表达式、网址和返回内容都会从终端及长期记录中省略，只保留成功标记、错误代码及 `redacted:true`。手机号和履历内容可按正常证据保留。需要判断敏感操作是否成功时，另读不含凭据的页面提示和字段状态。输入结束后脚本会关闭 MCP 会话和浏览器；页面仍需用 `apply.close_run` 提前关闭时，照常发送该工具调用。

已有完整来源、不需要把大结果再次打印时，在命令顶层加 `"brief":true`。终端只返回成功/错误摘要和 `evidence` 文件名，非敏感结果仍完整保存在该文件中。核对字段内容时读取完整证据，摘要不代替 `source.payload` 或服务器字段值。

登录档案保留登录状态，不保证保留未保存的表单。结束或中断控制进程前，记录未保存字段的完整值及必要截图；进程退出后，只有实际检查过网站恢复结果，才能声称草稿仍然保留。

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

## 阻塞记录

本批报告记录每家公司实际阻塞及证据引用，两张用户表只同步简短结果。已有 `.local/阻断记录_真实站点.md` 保留为历史记录，不在处理每家公司时再重复维护一份总表。解决后在同批报告追加结果，原失败证据保留。

## 恢复命令

```bash
node bin/applyctl.js doctor
node bin/applyctl.js status --run <id>
node bin/applyctl.js privacy audit
node bin/applyctl.js local backup
```

失败后先读取 `apply.get_status` 和现有 blocker。先执行可行修复；同一阻断反复出现且
没有继续路径时，再交给用户。
