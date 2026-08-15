# agent-trajectory

[English](README.md) | 中文

**看清你的 AI agent 每一轮到底做了什么——每次调用、每个工具、每个 token。**

`agent-trajectory` 把 Claude Code 或 Codex 会话日志（其他宿主可先转换成
`agent-trajectory/v1` JSON）变成一个轨迹查看器：逐轮的工具调用流水账（参数、结果、耗时、
状态）、可缩放的时间轴、上下文窗口用量曲线，以及可选的**教学档**——由 AI
给每一步写注解：这一轮想干什么、关键调用为什么走这一步、以及一段包含失败
和弯路的剧情复述。

为想学习 agent 底层原理的人而做，也适合任何想审查 agent 在自己机器上干了
什么的人。

## 亮点

- **两个档位。** *原始档*纯解析日志，零模型调用，秒出。*教学档*在其上生成
  AI 注解（轮目标、每步为什么、轮故事线），严格基于解析出的事件来写，
  不允许编造。
- **时间轴总览。** 每个事件是压缩时间轴上的一个色块（空闲段折叠成 `≈`），
  下方是上下文用量曲线——你能看着上下文一点点涨满，以及压缩(compaction)
  在哪里把它砍掉。点色块跳转，滚轮缩放。
- **实时模式。** `serve.py` 盯着会话日志，agent 一边干活页面一边更新。
  本地、实时、零依赖。
- **一键问 AI。** 鼠标停在任何一步上按"问AI"，问题进入抽屉笔记本。实时
  模式下由本地 CLI（`claude -p` / `codex exec` / 通过
  `$AGENT_TRAJECTORY_ASK_CMD` 自定义）在页面里直接回答；静态页面则一键
  复制、随处粘贴。
- **单文件输出。** 一个 HTML 文件，不联网、免构建、明暗双主题、可打印成
  PDF，发给谁都能打开。
- **宿主无关。** 适配器把各家日志翻译成同一个 JSON schema，查看器只认
  schema。新增宿主 = 写一个解析函数。

## 快速开始

```sh
# 实时查看当前会话（在你的项目目录里运行）
python3 serve.py --open

# 或者：生成一个静态 HTML
python3 parse_trajectory.py -o /tmp/traj.json
python3 render.py --data /tmp/traj.json -o trajectory.html
```

只需 Python 3.9+ 标准库。所有数据都留在你的机器上。

### 作为 Agent Skill 使用

这个仓库同时就是一个 skill：`SKILL.md` 告诉宿主 agent（Claude Code、Codex
或任何支持 skill 的宿主）怎么跑整条流水线，以及教学档的注解 JSON 怎么写。
装到你的 agent 读取 skill 的位置，然后说"看看这个会话的轨迹"或要"教学档"
即可。

## 工作原理

```
会话日志 (JSONL)             注解 (教学档，AI 生成)
      │                              │
parse_trajectory.py ──► 轨迹 JSON (agent-trajectory/v1)
      │                              │
      └── render.py ── 静态 HTML ◄───┘
      └── serve.py ─── 实时 HTML + /api/trajectory + /api/ask + /export
```

按宿主自动发现会话（当前工作目录的最新会话）：

| 宿主 | 默认位置 | 覆盖方式 |
|---|---|---|
| Claude Code | `~/.claude/projects/<munged-cwd>/*.jsonl` | `$CLAUDE_CONFIG_DIR` |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl`（按 cwd 匹配） | `$CODEX_HOME` |
| 任意文件 | — | `--session <path>` / `$AGENT_TRAJECTORY_SESSION` |

## 归一化 schema 与新增适配器

事件结构见 [README.md](README.md#the-normalized-schema-agent-trajectoryv1)。
新增宿主三步：在 `parse_trajectory.py` 里写 `parse_<host>()`（参考现有两个
适配器，各约 100 行）、按需注册进 `discover()`、在 `tests/test_parse.py`
加一个 fixture 测试。查看器、实时服务、注解、导出全部无需改动。

## 设计规范

字体、颜色 token 和工具类别色板见 [DESIGN.md](DESIGN.md)。类别色板
（MCP / Shell / Skill / File / Web / Agent）在明暗两套模式下都通过了
色盲安全与对比度校验，且类别颜色永远伴随文字标签出现。

## 开发

```sh
python3 -m unittest discover -s tests   # 8 个测试，<1 秒
```

几条用血泪换来的工程决策，记在 [README.md](README.md#development) 的
Development 一节：不用无限循环 CSS 动画（会卡死内嵌预览的截图管线）、
时间轴用虚拟化 canvas（超宽单层会拖垮合成器）、空闲时间压缩、以及两家
token 口径的差异（Anthropic 是相加，OpenAI 的 cached 是子集）。

## 许可证

[MIT](LICENSE)
