# Plugin 清单

共 **3** 个完整 Plugin。

| Plugin | 上游目标 | Claude | Codex | 内嵌 Skill | 来源 |
|---|---|---|---|---|---|
| `ai-speaking-school` | — | unsupported | full | `speaking-head-teacher`, `speaking-learning-analyst`, `speaking-live-teacher`, `speaking-teaching-assistant` | 本地维护 |
| `claude-md-management` | claude | full | review | `claude-md-improver` | [github.com/anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) |
| `mcp-server-dev` | claude | full | review | `build-mcp-app`, `build-mcp-server`, `build-mcpb` | [github.com/anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) |

平台 manifest 是各自的权威源文件；`agents-kit marketplace build` 只生成根 Marketplace 索引。
内嵌 Skill 是否能脱离 Plugin 安装，以 `agents-kit.plugin.json` 的 `standalone` 声明为准。
