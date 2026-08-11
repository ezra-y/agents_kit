# 给本地 Agent 的执行 Prompt

你正在修改我的本地仓库 `/Users/ezra/agents_kit`。请把我提供的 `ai-speaking-coach-plugin` 包安全集成成一个 **Codex/ChatGPT Plugin（内含 Skill）**，不要继续把口语 Hook 安装到用户级绝对路径。

## 目标

1. 清理 `~/.codex/hooks.json` 里所有命令包含 `coach_mode_hook.py` 或 `ai-speaking-coach` 的旧口语 Hook，但保留其他 Hook。
2. 先为被修改文件创建带 UTC 时间戳的备份。
3. 把插件放到 `/Users/ezra/agents_kit/plugins/ai-speaking-coach`。
4. 合并 `/Users/ezra/agents_kit/.agents/plugins/marketplace.json`，添加本插件，保留其他插件条目。
5. 从 `/Users/ezra/agents_kit/skills/ai-building/ai-speaking-coach` 迁移 mutable state 到 macOS 的 `~/Library/Application Support/ai-speaking-coach`。先不复制模型与 LanceDB 缓存，除非重建失败。
6. 不要直接删除旧 Skill。迁移和新插件验证成功后，把旧目录移动到一个明确的 legacy backup 目录，避免同名 Skill 重复触发；告诉我移动后的路径。
7. Bootstrap 新插件隔离运行时，安装 retrieval extra，重建 726 条语料的 E5/LanceDB 索引。
8. 运行全部测试、JSON/YAML 校验、Python 编译、Hook 烟雾测试和 `coachctl.py doctor`。
9. 不要伪造 ChatGPT Scheduled task ID，不要声称你已经在桌面端安装/启用插件或信任 Hook。把这些宿主操作列为最后的人工步骤。

## 推荐执行方式

先找到我解压后的插件目录，然后运行：

```bash
python3 scripts/install_repo_plugin.py \
  --repo /Users/ezra/agents_kit \
  --old-skill /Users/ezra/agents_kit/skills/ai-building/ai-speaking-coach \
  --clean-stale-user-hooks
```

这是 dry-run。把报告给我看，确认只会删除 4 个旧口语 Hook、不会碰其他 Hook 后，再运行同一命令并加 `--apply`。

然后运行包级与 Skill 级测试：

```bash
cd /Users/ezra/agents_kit/plugins/ai-speaking-coach
python3 -m pytest -q tests

cd skills/ai-speaking-coach
PYTHONPATH=src python3 -m pytest -q tests
```

再在新插件的 Skill 目录运行：

```bash
python3 scripts/coachctl.py bootstrap --retrieval --rebuild-index
python3 scripts/coachctl.py doctor --json
```

## 必须验证的 Hook 行为

- `hooks/hooks.json` 中所有命令只能通过 `${PLUGIN_ROOT}` 定位插件，不能出现 `/Users/ezra`、`agents_kit/skills/...` 或其他机器绝对路径。
- `UserPromptSubmit` 和 `Stop` 必须在 dispatcher 内部过滤，因为这两个事件的 matcher 不负责过滤。
- 无关 `UserPromptSubmit`：退出码 0，stdout 为空。
- 无关 `Stop`：退出码 0，stdout 是合法空 JSON `{}`。
- Plugin 被移动到临时目录后，Hook 仍能通过新的 `PLUGIN_ROOT` 工作。
- 运行时缺失时，激活口语课只注入 bootstrap 指引，不能阻断会话。
- `SessionEnd` 不做依赖探测或长任务，只做轻量 interrupted recovery。

## 必须验证的课程行为

- `exit_check` 的所有结果只能路由到 `CORE_COMPLETE`。
- `CORE_COMPLETE` 不自动 finalize；老师询问继续 extension 还是下课。
- extension 结束用 `EXTENSION_COMPLETE`，仍不等于整节课自动结束。
- 每个模块退出前必须成功写 checkpoint。
- 学习者在完整对话中明确表达结束意图时，同一轮 finalize；重复 finalize 不产生重复记录。
- 有错时直接说明并要求完整重说；禁止先说 Great/Perfect 再纠错。
- 老师人格可改，但不能关闭纠错、checkpoint、真实证据和 finalization。
- 周期评估只能由 text model 基于 evidence packet 执行，major 目标调整必须等我确认。

## Scheduled tasks

代码只生成和保存 desired plan。最后请给我两段可直接交给 ChatGPT Scheduled 的 prompt 和 RRULE：

1. 口语课提醒：按我设置的时间检查/准备当天教案并邀请我开启 Work/Codex Voice，不得标记出勤或已学习。
2. 周期评估：默认每 14 天检查一次，且至少 3 节 completed session 才评估；在 text mode 生成和验证报告，major change 等待确认。

只有 ChatGPT 宿主创建任务并返回真实 `task_id` 后，才运行：

```bash
python3 scripts/coachctl.py run scheduled_tasks.py register \
  --kind class_reminder --task-id '<REAL_HOST_TASK_ID>' --host-confirmed
python3 scripts/coachctl.py run scheduled_tasks.py register \
  --kind periodic_assessment --task-id '<REAL_HOST_TASK_ID>' --host-confirmed
python3 scripts/coachctl.py run scheduled_tasks.py status
```

## 最终报告

给我：修改文件、备份路径、迁移文件数、测试结果、doctor 结果、仍需人工完成的插件安装/Hook trust/Scheduled 创建步骤。发现失败就停在失败处，保留旧 Skill 和备份，不要用假成功掩盖。
