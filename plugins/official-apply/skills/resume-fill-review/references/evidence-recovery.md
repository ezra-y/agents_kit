# 保存、证据、视觉辅助与恢复

## 保存

保存草稿与最终提交分开。保存前先运行 `apply.validate_page`。
网站出现“稍后再说”“仍有未填写项”这类提示时，根据用户已保存的空值规则处理，
并记录仍为空的字段。`apply.advance { actionKind: "save" }` 保存后自动重新打开服务器简历；
实际调用保存接口后还会自动写入
`.local/evidence/sites/<host>/resume-save/run-<time>/`，包含保存前截图、服务器读回截图和
`result.json`。未调用保存接口时不生成伪证据。
服务器字段读回一致作为最终成功证据。

## 视觉兜底

普通输入框、下拉、单选、复选、日期和文件上传使用 Playwright 结构化操作。
结构化方法已有失败证据时，才使用局部视觉兜底：

```text
apply.build_visual_fallback
→ 宿主只在允许区域执行一次动作
→ apply.verify_visual_fallback
```

视觉操作后用 DOM、ARIA 或字段值验证；截图作为辅助证据。

## 隐私和证据

- 真实答案、简历、Cookie、截图、网络观察和运行记录进入 `.local/`。
- `knowledge/`、公共 PageScript、fixtures 和 Git 只保存脱敏结构与通用规则。
- 证据按 `.local/evidence/sites/<域名>/` 隔离。
- 旧失败证据不删除；问题解决后更新状态并追加最终证据。

## 阻断总表

所有公司的阻断清单只维护在 `.local/阻断记录_真实站点.md`。每个卡点使用一条 Markdown
复选框；真实修复并验证后，在原条目勾选并补日期和结果。站点截图、网络记录和运行日志继续
按域名放在 `.local/evidence/`，作为总表条目的详细证据。

## 恢复命令

```bash
node bin/applyctl.js doctor
node bin/applyctl.js status --run <id>
node bin/applyctl.js privacy audit
node bin/applyctl.js local backup
```

失败后先读取 `apply.get_status` 和现有 blocker。先执行可行修复；同一阻断反复出现且
没有继续路径时，再交给用户。
