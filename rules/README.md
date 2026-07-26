# rules

规则片段，软链到 `~/.claude/rules/`。每次会话加载（或只在碰匹配文件时加载）。

- `coding/` 编码规范。建议加 `paths:` frontmatter 限定文件类型，这样写 Swift 时不会加载 TypeScript 的规矩
- `workflow/` 日常任务规范，一般不限定路径

带路径限定的写法：

```markdown
---
paths:
  - "src/**/*.{ts,tsx}"
---
# TypeScript 规范
- 接口一律做输入校验
```

**放这里 vs 放技能**：每次都该记得的事实和规范放这里；多步流程放 `skills/`。
