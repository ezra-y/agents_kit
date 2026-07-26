# agents

子代理定义，软链到 `~/.claude/agents/`。

一个 `.md` 文件就是一个子代理，有自己独立的上下文窗口和工具权限：

```markdown
---
name: my-reviewer
description: 什么时候把活派给它
model: sonnet
tools: ["Read", "Grep", "Glob"]
---
你是……（它的系统提示）
```

`tools` 决定它能用什么。只给读工具就能保证它改不了代码。

**候选**：代码评审类任务适合做成子代理 —— 要读一大堆代码，放子代理里跑不占主对话上下文。
