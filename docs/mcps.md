# MCP 清单

共 **4** 个 · 全局启用 **4** 个

| MCP | 说明 | 分发 | 版本 | 目标 | 启用 | 上游 |
|---|---|---|---|---|:--:|---|
| `context7` | 查询最新、指定版本的开发文档和代码示例 | `@upstash/context7-mcp` | `3.2.5` | codex, claude | ● | [github.com/upstash/context7](https://github.com/upstash/context7) |
| `evalview` | 为 Agent 和 Skill 建立行为快照并检测回归 | `evalview` | `0.8.1` | codex, claude | ● | [github.com/hidai25/eval-view](https://github.com/hidai25/eval-view) |
| `firecrawl` | 搜索、抓取和整理网页内容，免 Key 模式支持搜索与单页抓取 | `mcp-remote` | `0.1.38` | codex, claude | ● | [github.com/firecrawl/firecrawl-mcp-server](https://github.com/firecrawl/firecrawl-mcp-server) |
| `github` | 读取 GitHub 仓库、Issue、PR 和 Actions 状态 | `github-mcp-server` | `1.7.0` | codex, claude | ● | [github.com/github/github-mcp-server](https://github.com/github/github-mcp-server) |

客户端配置由 `agents-kit mcp apply --all` 从 `mcps.json` 收敛。
仓库只保存凭据来源，不保存凭据值。
