<h1 align="center">agent-trajectory</h1>

<p align="center"><a href="README.md">English</a> | 中文</p>

<p align="center"><img src="assets/trajectory-overview.png" alt="会话轨迹总览"></p>

<p align="center"><strong>看清你的 AI agent 每一轮到底做了什么——每次调用、每个工具、每个 token。</strong></p>

<p align="center">界面与交互基于 <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> 的轨迹视图。</p>

<hr>

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
- **实时模式。** `serve.py` 盯着会话日志，agent 一边干活页面一边更新。
  本地、实时、零依赖。
- **一键问 AI。** 鼠标停在任何一步上按"问AI"，问题进入抽屉笔记本。实时
  模式下由本地 CLI（`claude -p` / `codex exec` / 通过
  `$AGENT_TRAJECTORY_ASK_CMD` 自定义）在页面里直接回答；静态页面则一键
  复制、随处粘贴。
- **单文件输出。** 一个 HTML 文件，不联网、免构建、明暗双主题、可打印成
  PDF，发给谁都能打开。

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

## 归一化 schema（`agent-trajectory/v1`）

```jsonc
{
  "schema": "agent-trajectory/v1",
  "host": "claude-code",
  "session": { "id": "...", "path": "...", "cwd": "...", "title": "..." },
  "context_window": 200000,          // 宿主报告该值时使用，单位为 token
  "turns": [{
    "index": 1,
    "user_text": "...",              // 用户提出的问题
    "started": 1755200000000, "ended": 1755200600000,
    "subagent_events": 0,            // 旁路流量只计数，不展开
    "events": [{
      "id": "t1e3",                  // 注解使用的稳定锚点
      "kind": "tool",                // tool | assistant | thinking | user_note
                                     // | context | system | compaction
      "ts": 1755200001000,
      "tool": "Bash", "args": "{...}", "result": "...",
      "status": "ok",                // ok | error | null（没有记录结果）
      "duration_ms": 2000,
      "context_tokens": 129097       // 本次请求后的上下文用量
    }],
    "stats": { "events": 20, "tool_calls": 17, "errors": 1,
               "duration_ms": 681000, "context_end": 129097 }
  }]
}
```

注解是独立的 JSON，以轮次索引和事件 ID 为键。准确格式和真实性规则见
`SKILL.md`：注解必须基于解析出的事件，不能掩盖失败。

## 新增宿主适配器

1. 在 `parse_trajectory.py` 中编写返回上述 schema 的 `parse_<host>(path)`。
   可以参考各约 100 行的 `parse_claude` 和 `parse_codex`。
2. 如果可以自动发现会话，在 `discover()` 中注册适配器。
3. 在 `tests/test_parse.py` 中添加一个 fixture 测试。

查看器、实时服务、注解和导出无需修改。

## 设计规范

字体、颜色 token 和工具类别色板见 [DESIGN.md](DESIGN.md)。类别色板
（MCP / Shell / Skill / File / Web / Agent）在明暗两套模式下都通过了
色盲安全与对比度校验，且类别颜色永远伴随文字标签出现。

## 致谢

本项目的界面结构和交互方式，包括双层总览与步骤详情面板，基于
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
的轨迹视图。DeepSeek Harness 是 DeepSeek AI 开发并以 MIT 许可证发布的
开源 agent harness。`agent-trajectory` 在此基础上适配了可移植的
Claude Code 与 Codex 会话日志，与 DeepSeek AI 没有隶属关系。

## 许可证

[MIT](LICENSE)
