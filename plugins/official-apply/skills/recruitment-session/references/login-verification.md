# 登录和验证码细节

登录全程复用 `apply.open_task` 返回的同一个 `runId` 和当前页面。只有当前账号、受保护接口或
已确认的登录后专有页面证据才算登录成功；目标网址、HTTP 200、没有登录按钮和页面标题都只能辅助判断。

## 登录态清单与复用

打开任务后先检查当前页面。底层登录状态检查只读取当前页面和已有正向账号证据，不调用 `prepare`、不发短信；页面明确显示登录入口，或适配器已有可靠的未登录/过期证据时，`apply.login` 流程可以按目标 host 和明确登录域名自动复用来源并再次检查。`login_unconfirmed` 会保留当前页面，不继续轮换来源；重复 inspect 已登录时不扫描、不导入。

先查看本机浏览器和项目配置的非敏感元数据：

```bash
node bin/applyctl.js browser login-inventory --json
```

按目标预扫描时传 `--domains <目标域名[,登录域名]>`。项目 profile 的 `.official-apply-web-state.json`
即使没有 `verifiedLogin`，只要域名和状态匹配仍会作为候选；最终是否采用由当前页面的登录适配器确认。

清单会列出实际发现的 Chrome/Edge/Chromium 类配置、Ego、Codex browser、Firefox 档案、
Safari 默认档案及容器 profile，以及已连接 OpenCLI Browser Bridge 的 context。`domainEnumeration` 为 `complete` 才表示 Cookie 域名已读到，
`failed` 表示文件存在但当前只读查询失败，`unsupported` 表示文件已登记但没有可用域名枚举；
Safari 的 `Cookies.binarycookies` 会被登记为状态文件，当前仍不能作为可复用登录态。

文件存在只代表未验证。工具在本机传递登录数据；Agent 读取清单和验证结果，不把 Cookie、浏览器存储或认证凭据的具体值打印到报告。

OpenCLI Bridge 继续使用 OpenCLI 的默认 profile、环境变量和 profile 配置。已配置默认来源时只尝试该 context；显式 `sourceId` 可以覆盖默认来源；没有默认来源且同时发现多个 context 时返回歧义。复制浏览器资料后必须为每个浏览器实例保留不同的 Bridge context 编号，不新增机器 ID 常量。

正式任务不需要先手工选择来源：`apply.login { runId, action: "inspect" }` 在看到登录入口，或取得可靠的未登录、凭据过期证据后，尝试来源复用。返回 `login_unconfirmed` 时，当前候选页会保留，结果带 `sourceId` 和证据；调用 `apply.inspect_page` 或已有 browser_action 检查账号/受保护简历，不要继续轮换来源或直接发短信。返回 `login_state_ambiguous` 时，把返回的 `sourceId` 原样传回同一个 `apply.login` 调用；复用失败会在结果中给出 `reuseFailureReason`。

用户已经登录目标招聘站时，用明确提供的动态 CDP 端点和登录后页面标记：

```bash
node bin/applyctl.js browser login-reuse \
  --cdp-endpoint <动态CDP地址> --from msedge --to <项目profile> \
  --url <目标招聘页> --login-marker "<当前账号的专属页面标记>" \
  --domains <招聘域名[,登录域名]> --json
```

已有 OpenCLI Browser Bridge 连接时，使用连接名和 profile/context ID：

```bash
node bin/applyctl.js browser login-reuse --from bridge \
  --bridge-session <session> --bridge-context <context-id> \
  --to <项目profile> --channel msedge \
  --url <目标招聘页> --login-marker "<当前账号的专属页面标记>" \
  --domains <招聘域名[,登录域名]> --json
```

流程先检查源页面，再将新建源 tab 绑定为当前 tab，确认 document 处于目标 origin 后才导出指定域名的 Cookie 和当前页的 localStorage、sessionStorage；CDP 路径还通过 Playwright 原生接口导出 IndexedDB，Bridge 当前不导出 IndexedDB。
恢复目标 profile 后重新打开页面检查同一标记。CDP 不存在、标签页无法唯一匹配或源页面未
显示登录标记时暂停，不复制整份浏览器 profile；源页面 redirect、未就绪或超时会保留
`source_*` 阶段和脱敏失败原因。源浏览器不关闭。Firefox/Safari 当前只有元数据清单，
没有受支持的活 context 导出路径。

成功输出必须同时包含 `sourceLoginVerified: true` 和 `targetLoginVerified: true`，并有
`sourceBackend`、`targetProfileDir`、`verifiedAt`。只有 Cookie 或状态文件存在时不能算成功。
典型结果会是 `{"sourceBackend":"opencli_browser_bridge","sourceLoginVerified":true,"targetLoginVerified":true,"targetChannel":"msedge"}`；
若任一标记为 `false`，命令失败且不能把 profile 当成已登录。
登录标志应选已确认仅在登录后出现的内容，并结合目标私有页面核对；公共导航标题、没有登录按钮、Cookie 或 Storage 存在都不能单独证明登录。已验证的目标配置由后续 `open_task` 通过 `profileName` 和 `channel` 复用。候选来源未确认时会清掉目标档案旧的 `verifiedLogin`，避免旧账号证明跟着新 Cookie 保存。

米哈游的 `Jobs-Token` 缺失、已过期或受保护接口明确拒绝时，返回需要登录并保留具体原因；表单已经打开时返回 `sms_ready`。只有页面或接口无法读取、返回结构未知时，才保持 `login_unconfirmed`。Token 存在本身不能算登录成功。

## 验证码脚本的启动配置

验证码会话脚本和 Moka 登录态迁移脚本共用主程序启动器，读取同一份 dataRoot 与 browserChannel 配置；Edge 的 channel 是 msedge，无须额外安装 Chrome。显式 --channel 优先于环境变量和配置。
默认浏览器档案为 captcha-<taskId>，不同任务分开；用 --profile-name 可指定已有档案。新档案没有旧登录态时按真实页面完成登录，不把档案存在当成已登录。
同一档案被占用时返回 browser_profile_in_use，先复用仍在运行的会话，或使用明确的独立档案。不要删除锁文件、关闭用户浏览器或盲目安装备用浏览器。
脚本收到 quit 或输入通道关闭时，会完成已收到的命令后关闭自己创建的会话；SIGINT/SIGTERM 会立即终止本脚本会话。仅在所选浏览器未安装时尝试备用 Chromium；备用也缺失会保留两层错误说明，不掩盖最初原因。

文中 `.local/` 指配置的 dataRoot；运行命令时替换为该绝对路径，不能在当前目录新建另一份。用于改进和复测的验证码案例长期保留在下述案例目录。

## 用案例改进验证码能力

三个验证码会话入口在每次求解时输出 `CASE`（案例目录），自动保存到
`.local/evidence/sites/<host>/captcha/case-*/`。每个案例包含实际输入图片、求解器和操作脚本快照、
求解参数与原始输出、置信度、已取得的动作数据及网站响应摘要。短信验证码不进入案例。
读取到验证结果后立即保存；后续登录检查失败也能看到该结果。进程中断留下 `in_progress`
（未结束），不把它记为验证通过。案例会占用磁盘，不按临时文件自动清理。

遇到失败，先读该案例判断是识别、拖动还是网站拒绝，再改对应代码。修改后离线重跑该案例和
已有标注案例。复测只重新求解图片，不向网站提交旧验证码，也不能代替新题的真实验证。

```bash
node skills/recruitment-session/scripts/replay-captcha-cases.mjs <案例目录>
node skills/recruitment-session/scripts/replay-captcha-cases.mjs <案例根目录> --solver-dir <新版求解器目录>
node skills/recruitment-session/scripts/replay-captcha-cases.mjs <案例目录> --baseline
```

默认使用当前求解器；`--baseline` 使用案例保存的旧求解器。结果另写为 `replay-*.json`，
保留旧输出，并显示新输出是否改变，不覆盖原始记录。

确认正确答案后，在 `case.json` 对应的 `solverRuns` 项增加 `expected`。例如确认缺口横坐标为
110、允许误差1像素时，填写 `"expected": {"targetX": {"value": 110, "tolerance": 1}}`。
角度比较可设置 `period: 360`，使359度和1度按2度差比较。标签必须来自可核实的依据，
不能直接把求解器本次输出当标准答案。

有标签时，复测报告 `passed`（通过）或 `failed`（失败）；无标签时报告 `unlabelled`
（未确认答案）。输出变化、较高置信度和命令正常退出都不能单独证明识别更准确。
未取得求解输入的记录报告 `no_solver_input`，用于定位取图或启动失败，不计入准确率。

已有图片可导入，原文件保持不动：

```bash
node skills/recruitment-session/scripts/import-captcha-case.mjs --type jigsaw -- --background <背景图绝对路径> --piece <拼图片绝对路径>
```

另外支持 `rotation`（圆环旋转，传 `--inner` 和 `--outer`）与 `overlay_rotation`
（覆盖旋转，传 `--piece` 和 `--background`）。已知来源页可加 `--page-url`；未知来源存入
`unattributed`（来源未确认）。离线导入不补造当时的网站响应或成功结论。

## 短信登录

```text
apply.login { runId, action: "inspect" }
→ logged_in：返回用户要求的填写或检查阶段
→ login_required（当前页面看见登录入口或适配器确认未登录/过期）或 sms_ready（当前页面看见短信表单）：
  apply.login { runId, action: "begin_sms", phone: "<用户授权的手机号>" }
→ login_unconfirmed：
  保留当前 runId 和候选页，调用 apply.inspect_page 检查账号或受保护简历；不要发送短信
→ code_sent：
  读取 requestedAt 之后最新验证码
  apply.login { runId, action: "submit_sms_code", code: "<验证码>" }
→ logged_in：返回用户要求的填写或检查阶段
```

`begin_sms` 先点击网页上的“短信登录”，确认标签已经选中，再填写可见手机号框。
用按钮倒计时、验证码挑战或页面错误判断发送结果。
提交后若弱站点仍返回 `login_unconfirmed`，记录当前账号或受保护简历证据；已在简历页就调用 `apply.resolve_page`，需要入口就调用 `apply.open_resume`，不要重复登录检查或自行声明成功。

## Mac“信息”

用户授权读取短信后，用 Computer Use 打开 `com.apple.MobileSMS`：

- 搜索当前服务名，例如“百度”。
- 读取本次 `requestedAt` 之后最新的一条。
- 验证码仅用于本次登录调用。
- Mac 尚未同步时请用户提供本次验证码。

手机号和验证码作为临时调用参数，长期资料和证据保留脱敏结果。

用户已授权通过本机短信库读取时，`text` 为空还需检查 `attributedBody` 中的正文，不能据此断言没有短信。只读取本次请求之后且能明确匹配当前服务的代码；别的服务的短信即使时间相近也不能采用。没有倒计时或可用短信只能说明尚未确认发送，只有实际接口错误才能说明接口失败。

## 浏览器后台验证码

验证码或邮箱代码位于用户已登录的 Chrome/Edge 时，优先使用外部浏览器扩展集成的
后台标签读取，保持用户前台标签不变。读取后继续操作原申请标签和原 `runId`。

浏览器扩展只能读取、无法稳定点击或填写时，重连一次。再次失败就记录
`browser_extension_mutation_blocked`，并改用同一站点的 Playwright 页面。邮箱本身未登录时，
保留申请页，请用户完成邮箱登录或提供本次验证码。

## Moka 登录态迁移

`apply.login inspect` 和 `apply.open_resume` 会自动尝试复用已验证登录。目前覆盖
`app.mokahr.com` 同域名下的企业站，沿用各公司的独立浏览器档案。

登录检查成功、且账号联系方式与已确认资料匹配时，程序立即在现有登录快照中记下账号和
验证时间。旧登录失效后，按验证时间查找同域名、同账号的来源，只把服务器会话凭据传入
目标档案。在目标公司重新检查账号，成功才保存；来源失效或账号不匹配时恢复原凭据。
工具结果的 `reusedFromProfile` 表示实际采用的来源档案，不包含登录令牌。

第一次启用时，先对现有有效档案调用一次 `apply.login inspect` 或打开简历以登记来源。
之后成功的登录和复用都会更新记录。历史“已验证”不代表永远有效，每次采用仍需现场检查。
没有可用来源时继续原有登录流程。自动复用安排在填写前；填写中不自动刷新，保留未保存内容。

这沿用 [auto-browser 的命名登录档案复用流程](https://github.com/LvcidPsyche/auto-browser/blob/main/examples/login-and-save-profile.md)，
并补入本项目需要的来源选择、目标账号验证和失败恢复。

一个 Moka 企业站已经短信登录，另一个 Moka 企业站仍要求登录时，优先迁移已验证有用的
最小会话状态：

```bash
node skills/recruitment-session/scripts/migrate-moka-session.mjs \
  --from-profile <已登录 profile> \
  --to-profile <目标 profile> \
  --target-host <目标企业域名>
```

脚本只复制 `connect.sid`、`moka-token`、`moka-apply`、`csrfCk` 和 `locale`，不复制分析
Cookie、Local Storage 或其他企业数据；写入前自动备份目标状态，输出只包含 Cookie 名称，
不包含值。迁移后必须打开目标站并调用 `apply.login inspect`。目标站返回当前账号或受保护简历的可靠证据，
才算迁移成功；没有登录入口或能进入简历页只能记为未确认。

## 图片、滑块和风控

验证码是待处理步骤，本身不是停止理由。先识别当前题型，使用下文匹配的脚本；无适用脚本、脚本报错或验证未通过时，转 Computer Use（电脑操作），不要直接请求用户接管。
电脑操作按 [视觉操作步骤](../../resume-fill-review/references/evidence-recovery.md#视觉操作) 执行：读取当前截图、定位、点击/输入/拖动，再检查本题验证响应和登录状态。没有字段 runtimeRef 也可以使用宿主实际提供的电脑操作工具，不为调用辅助工具编造字段引用。
两条路径仍无法完成时，技术问题先经过一次能力演进；最后记录具体原因，例如当前工具无拖动能力、验证码无法取得或网站持续拒绝，不能只写“有验证码”。

出现图片、滑块或安全验证时保留浏览器和 `runId`。已获得的登录和验证码处理授权在本批内复用；仅在当前宿主工具明确要求额外确认时请求确认，并说明具体要求。使用工具在当前窗口操作。

第一次定位超时后重新 `inspect`，确认登录模式、可见控件和页面错误。完成可行的重试后
再记录阻断，并保留页面和 `runId`。

## 三种拖动题不能混用

| 类型 | 当前题输入 | 当前题输出 |
| --- | --- | --- |
| 旋转验证码 | 内圆原图、外环原图 | 顺时针角度 |
| 圆片覆盖旋转 | 完整背景、透明圆片、圆片中心 | 顺时针角度 |
| 拼图验证码 | 背景图、拼图初始位置、缺口位置 | 横向距离 |

内外环角度、圆片覆盖角度和横向距离不能互相替代。三种算法、校准方式和脚本互不通用。

## 旋转图片验证码

旋转验证码优先走 Playwright 和确定性脚本，不先用 Computer Use 猜角度。

一道旋转验证码通常可以对当前内圆和外环原图计算一次目标角度。这里的“一次”只表示当前
这一道题：只要服务端更换了内圆图、外环图或题目 token，上一题的角度立即失效，必须重新
取两张原图并重新计算。

识别到 `verifycenter` 内外环结构时，优先使用快速会话脚本：

```bash
OFFICIAL_APPLY_PHONE=<phone> node \
  skills/recruitment-session/scripts/rotation-captcha-login-session.mjs \
  --task-id <taskId> \
  --login-url <company-login-url> \
  --auto
```

多屏调试时加 `--headed`，并按当前机器设置
`OFFICIAL_APPLY_WINDOW_POSITION=x,y` 和 `OFFICIAL_APPLY_WINDOW_SIZE=w,h`。

带 `--auto` 时脚本启动后立即执行快速流程；不带时可以手动执行 `fast`。这一条命令会在
当前挑战过期前连续完成：

```text
点击获取验证码
→ 读取当前题内外环 URL
→ 下载两张原图
→ 计算当前题角度
→ 同一次按压内校准并拖动
→ 读取 /captcha/verify 的业务 code 和 message
```

不要把取图、下载、求解和拖动拆成多轮人工命令。飞书挑战可能在这些轮次之间过期，并返回
`NotFoundChallengeId`。

1. 从验证码 iframe、Canvas 或网络响应读取当前题目的内圆图和外环图。
2. 把当前题目的图片保存在 `.local/tmp/`，不要复用上一题图片。
3. 运行：

```bash
python3 skills/recruitment-session/scripts/solve-rotation-captcha.py \
  --inner .local/tmp/captcha-inner.png \
  --outer .local/tmp/captcha-outer.png
```

脚本返回顺时针角度、相关分数和置信度。`high` 可以直接继续；`medium` 先重新读取图片并
计算一次；`low` 改用 Computer Use 查看，不按低置信度结果盲目拖动。

拖动距离根据当前控件实时计算，不保存固定像素值：

1. 读取滑块起点、可用轨道宽度、内圆和外环当前 CSS 旋转角。
2. 按下滑块后先移动一小段，但不要松开。
3. 重新读取内圆与外环角度，计算“相对旋转角度/像素”。
4. 用脚本目标角度减去当前相对角度，换算剩余距离。
5. 在同一次按压中继续移动到目标位置，再松开。

松开后检查验证码接口结果、iframe 是否消失，以及短信按钮是否开始倒计时。失败时先确认
服务端是否换题。已经换题就必须重新取图、重新计算，不能沿用旧角度、旧 token 或旧坐标。
连续两次使用新题自动求解仍失败时，在现有阻断总表记录站点、题型和服务端结果，再交给
Computer Use 处理；仍无法完成才说明所需用户动作。

## 圆片覆盖旋转

这类题的背景可能已经包含正确方向的圆形区域，也可能把目标圆洞涂成白色，再覆盖一张带透明边缘的旋转圆片。
先按圆片在背景中的真实中心裁出目标区域；白洞题比较洞外缘的连续纹理，普通题比较圆片内部纹理。
JCAP 使用 `#img-back-div`、`#img-rotate-div` 和 `#slider-div`；Dingxiang 使用同页的
`.dx_captcha_rotate_*` 控件。两者都优先执行快速会话：

```bash
OFFICIAL_APPLY_PHONE=<phone> node \
  skills/recruitment-session/scripts/overlay-rotation-login-session.mjs \
  --task-id <taskId> \
  --profile-name <profileName> \
  --auto
```

快速会话会读取当前题的背景和圆片、调用求解器、按当前控件的滑轨和 CSS 旋转变化完成一次
按压，并读取对应验证码接口和 `apply.login` 的结果。JCAP 的验证路径是 `/cgi-bin/api/check`；
Dingxiang 使用当前页面实际返回的验证路径。服务端换题后必须重新取图和求解。

如果验证码已经在已有 `runId` 的页面中打开，优先在同一 JSONL 会话调用
`{"operation":"solve_overlay_rotation","runId":"当前runId"}`。结果包含
`loginStatus` 和 `caseDirectory`；只有 `loginStatus.data.stage` 为 `code_sent` 或
`logged_in` 才算通过，验证码接口响应本身不能代替登录确认。没有可复用页面时，继续使用上面的独立会话命令。

```bash
python3 skills/recruitment-session/scripts/solve-overlay-rotation-captcha.py \
  --piece .local/tmp/captcha-circle.png \
  --background .local/tmp/captcha-background.jpg
```

圆片不在背景中心时，增加 `--center-x` 和 `--center-y`，坐标使用原图像素。脚本输出：

```text
clockwiseDegrees
counterClockwiseImageRotation
confidence
score
scoreGap
```

JCAP 官方脚本使用：

```text
圆片角度 = 滑块距离 / 可用轨道距离 × 360°
```

因此直接读取当前轨道和滑块宽度换算。`0°` 是轨道起点，接近 `360°` 才是轨道终点；不得把
`0°` 自动改成拖满全程。Dingxiang 先小幅移动并读取圆片 CSS 角度变化和实际滑块位置，再按
这次题目的实测比例继续拖动，不能套用 JCAP 的比例。

案例按站点放在 `.local/evidence/sites/<host>/captcha/`，包含原图、求解输入输出和验证结果；
不保存短信验证码或完整手机号。

## 拼图滑块验证码

拼图验证码只计算横向距离，不读取或输出角度。脚本先识别验证码引擎，再调用对应引擎
适配器，不按招聘公司写判断。当前路由包括：

- 网易易盾：背景图加透明拼图片，已真实验证通过。
- 顶象基础滑块：画布里的描边圆片加暗圆目标，已能识别圆心、页面缩放和轨迹；OPPO
  真实接口仍返回业务码 `502`，尚未验证通过。
- 联合式透明拼图：背景图加等高透明拼图片，按拼图片实际位移校准页面缩放；验证接口
  返回业务码 `0` 表示通过。
- 画布拼图：背景和拼图片分别绘制在两个 Canvas 中，按当前画布截图识别缺口，再根据
  拼图片与滑块的实际位移校准横向距离。

先使用匹配的 Playwright 登录脚本；脚本不适用或失败再转 Computer Use。宿主明确拒绝的操作不得通过换工具绕过：

```bash
OFFICIAL_APPLY_PHONE=<phone> node \
  skills/recruitment-session/scripts/jigsaw-captcha-session.mjs \
  --task-id <taskId> \
  --auto
```

带 `--auto` 时脚本自动完成短信触发和当前拼图；不带时可以依次执行
`sms <phone>`、`auto`、`code <sms-code>`。拼图快速流程会：

1. 按页面结构识别当前拼图引擎。
2. 优先下载引擎提供的原始背景和透明拼图 PNG，用透明蒙版做模板匹配。
3. 引擎没有原始资源时，才截取页面并同时搜索变亮和变暗的缺口。
4. 两种算法都可用时比较目标位置；低置信度且位置不一致时停止，不盲拖。
5. 按住滑块先移动 20 像素，读取拼图实际位移并校准页面缩放。
6. 在同一次按压中移动剩余距离，松开后读取验证码接口和短信发送接口的结果。

如果验证码已经在另一个正式 runId 页面中打开，不要再启动这个独立 CLI。改用
skills/resume-fill-review/scripts/browser-session.mjs，在同一 JSONL 会话发送：

```json
{"operation":"solve_jigsaw","runId":"当前运行的 runId","maxAttempts":1}
```

它复用 server.pageOf(runId) 返回的活页面，继续使用本节同一套引擎检测、Python 求解、缩放校准、拖动轨迹和案例记录；不会另开浏览器或 profile。返回的 caseDirectory 仍应保留，失败时先读取其中的 case.json 和原图，再决定下一步。

求解器同时识别变亮和变暗的缺口。验证码通过后，部分网站会自动发送短信；此时等待短信
按钮倒计时，不得再次点击发送。脚本从页面打开时就监听验证码和短信接口；失败时先读取
HTTP 状态、业务 `code` 和 `message`，再判断是超时、位置错误还是风控。脚本最多处理两道
新题。

顶象暗圆题使用圆形专用扫描：在源圆片同一高度寻找暗圆，不使用矩形边缘结果；拖动前先
测量页面缩放，并使用更慢的停顿轨迹。连续新题仍返回 `502` 时停止重试并记录风控结果。
服务端换题后重新截图计算；不复用旧距离、截图或 token。

## 点击文字验证码

点击文字是第三类独立题型。遇到真实题时同时截取提示文字和验证码图片，视觉识别器输出
“字符顺序 + 图片坐标 + 置信度”，再映射到当前 DOM 边界依次点击。脚本同样从页面打开时
监听验证接口。没有真实样本或置信度低时不盲点，先交给 Computer Use；仍无法完成才说明所需用户动作。

## 登录成功判据

同时检查目标网址和登录后页面标志。Cookie、头像缓存和浏览器 profile 作为辅助证据。
