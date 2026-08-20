# AI Speaking School Plugin

当前版本是 **0.6.0-alpha.3 迁移候选版**，包含四个 skills-only 工作流：

```text
speaking-head-teacher        狗蛋：目标、教材、计划、备课
speaking-live-teacher        小King：GPT Live 上课
speaking-teaching-assistant  小禾：课后复盘与句子状态更新
speaking-learning-analyst    小菜：定时任务与周期评估
```

边界：

```text
0 Hook
0 MCP
不依赖 Project 或仓库 cwd
课堂中不逐轮持久化
```

## 本版本已实现

- 合法的 skills-only Plugin 目录；
- 四份 `SKILL.md`；
- 从 Research 文档改写的运行时 References；
- 交接对象、Pydantic 校验和 JSON Schema；
- 单一 `learner/state/coach.sqlite` 长期事实源；
- `001 + 006/007/008` 新安装迁移链；
- 0.5.4 只读盘点、完整备份、副本迁移、Persona 报告和数据校验工具；
- 两条公开示例、可选的本地教材种子数据与 SQLite 文本检索降级路径；
- 教案提交、课堂登记、课后复盘、周期评估四个角色 CLI；
- 教材只读检索适配器、会话读取适配器、记忆调度、人格事件和任务状态服务；
- References 与原调研文档的审查 HTML。

## 迁移 0.5.4

先暂停旧 Scheduled Tasks 并退出旧插件会话。具体命令见 [0.5.4 数据迁移](references/migration-0.5.4.md)。

迁移工具不会原地修改旧数据库；它先备份数据库和完整数据目录，再在候选副本上应用 `006/007/008`。

## 本地数据

学习档案、课堂记录、数据库、缓存和备份保存在插件目录外。`assets/seed/items.jsonl`
也只在本机使用，不进入 Git。插件没有这份种子数据时仍可启动，内容可从旧数据迁移
或通过教材导入流程写入。

## 仍需接入真实环境

- 将 `session_reader` 接到实际的 Voice 会话读取能力；
- 将 `material_service` 的外部命令接到原 E5 / LanceDB；
- 由 ChatGPT 宿主真实创建 Scheduled Tasks，并把 task ID 登记回来；
- 用真实 GPT Live 连续试课校准 References 和人格。

## 测试

```bash
cd 插件实现/ai-speaking-school
python3 -m pytest -q tests
```

依赖：Python 3.11+、Pydantic 2、PyYAML、pytest。
