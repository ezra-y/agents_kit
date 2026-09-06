# 登录和验证码细节

登录全程复用 `apply.open_task` 返回的同一个 `runId` 和当前页面。登录成功以目标网址和
登录后页面标志为准。

## 验证码脚本的启动配置

三个验证码会话脚本共用主程序启动器，读取同一份 dataRoot 与 browserChannel 配置；Edge 的 channel 是 msedge，无须额外安装 Chrome。显式 --channel 优先于环境变量和配置。
默认浏览器档案为 captcha-<taskId>，不同任务分开；用 --profile-name 可指定已有档案。新档案没有旧登录态时按真实页面完成登录，不把档案存在当成已登录。
同一档案被占用时返回 browser_profile_in_use，先复用仍在运行的会话，或使用明确的独立档案。不要删除锁文件、关闭用户浏览器或盲目安装备用浏览器。
脚本收到 quit 或输入通道关闭时，会完成已收到的命令后关闭自己创建的会话；SIGINT/SIGTERM 会立即终止本脚本会话。仅在所选浏览器未安装时尝试备用 Chromium；备用也缺失会保留两层错误说明，不掩盖最初原因。

## 短信登录

```text
apply.login { runId, action: "inspect" }
→ logged_in：返回用户要求的填写或检查阶段
→ login_required：
  apply.login { runId, action: "begin_sms", phone: "<用户授权的手机号>" }
→ code_sent：
  读取 requestedAt 之后最新验证码
  apply.login { runId, action: "submit_sms_code", code: "<验证码>" }
→ logged_in：返回用户要求的填写或检查阶段
```

`begin_sms` 先点击网页上的“短信登录”，确认标签已经选中，再填写可见手机号框。
用按钮倒计时、验证码挑战或页面错误判断发送结果。

## Mac“信息”

用户授权读取短信后，用 Computer Use 打开 `com.apple.MobileSMS`：

- 搜索当前服务名，例如“百度”。
- 读取本次 `requestedAt` 之后最新的一条。
- 验证码仅用于本次登录调用。
- Mac 尚未同步时请用户提供本次验证码。

手机号和验证码作为临时调用参数，长期资料和证据保留脱敏结果。

## 浏览器后台验证码

验证码或邮箱代码位于用户已登录的 Chrome/Edge 时，优先使用外部浏览器扩展集成的
后台标签读取，保持用户前台标签不变。读取后继续操作原申请标签和原 `runId`。

浏览器扩展只能读取、无法稳定点击或填写时，重连一次。再次失败就记录
`browser_extension_mutation_blocked`，并改用同一站点的 Playwright 页面。邮箱本身未登录时，
保留申请页，请用户完成邮箱登录或提供本次验证码。

## Moka 登录态迁移

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
不包含值。迁移后必须打开目标站并调用 `apply.login inspect`。目标站没有显示登录入口，
且 `apply.open_resume` 能进入简历页，才算迁移成功。

## 图片、滑块和风控

默认由 Agent 操作验证码。视觉验证码优先使用 Computer Use 点击；Computer Use 无法定位
当前窗口时，使用同一 Playwright 页面操作。两种入口都失败后请用户接管。

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
Computer Use 或用户处理。

## 圆片覆盖旋转

这类题的完整背景已经包含正确方向的圆形区域，页面再覆盖一张带透明边缘的旋转圆片。
先按圆片在背景中的真实中心裁出目标区域，再比较圆片内部纹理；不要调用内外环接缝算法。
识别到 JCAP 的 `#img-back-div`、`#img-rotate-div` 和 `#slider-div` 时，优先执行快速会话：

```bash
OFFICIAL_APPLY_PHONE=<phone> node \
  skills/recruitment-session/scripts/overlay-rotation-login-session.mjs \
  --task-id <taskId> \
  --profile-name <profileName> \
  --auto
```

快速会话会读取当前题的背景和圆片、调用求解器、按官网滑轨宽度把角度换算成距离，在一次
按压中完成拖动，并读取 `/cgi-bin/api/check` 和 `apply.login` 的结果。服务端换题后必须
重新取图和求解。

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
`0°` 自动改成拖满全程。其他引擎没有这个确定关系时，才在同一次按压内做小距离校准。

证据按站点放在 `.local/evidence/sites/<host>/captcha/`。保存当前题目的脱敏运行结果、
求解 JSON 和验证结果；不要保存短信验证码或完整手机号。

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

Computer Use 能控制当前页面时可以直接拖动；宿主拒绝控制该网址时，使用 Playwright
登录脚本：

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
监听验证接口。没有真实样本或置信度低时不猜，交给 Computer Use 或用户。

## 登录成功判据

同时检查目标网址和登录后页面标志。Cookie、头像缓存和浏览器 profile 作为辅助证据。
