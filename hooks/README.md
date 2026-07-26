# hooks

到点自动执行的命令，注册在 `settings.json` 里（不是往目录里丢文件就生效）。

这是整个体系里**唯一能强制执行**的机制 —— 技能和子代理都是模型自己决定用不用，hook 到点就跑，模型拦不住。

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{ "type": "command", "command": "npx prettier --write $CLAUDE_FILE_PATH" }]
    }]
  }
}
```

触发时机：`PreToolUse`（可拦截）、`PostToolUse`、`SessionStart`、`Stop`。

**有明确痛点再配** —— 比如老忘跑格式化、怕 AI 乱删文件。没痛点硬配是给自己添堵。
