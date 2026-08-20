# rules

规则片段的仓库事实源。

- `coding/` 编码规范。建议加 `paths:` frontmatter 限定文件类型，这样写 Swift 时不会加载 TypeScript 的规矩
- `workflow/` 日常任务规范，一般不限定路径
- `codex/` Codex 专用规则。全局规则同步到 `~/.codex/AGENTS.md`，不写入 Claude 配置

Claude 规则软链到 `~/.claude/rules/`。Codex 当前使用单个全局
`~/.codex/AGENTS.md`，因此同步时只复制规则正文，不复制来源 frontmatter。

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
