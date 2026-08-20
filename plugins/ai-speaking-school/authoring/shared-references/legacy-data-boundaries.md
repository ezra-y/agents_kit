# 旧版数据使用边界

新系统继续使用：

```text
learner/state/coach.sqlite
```

它是唯一长期学习事实源。命令输入和输出可以使用 JSON，但不能把 JSON 文件维护成第二套学习状态。

## 保留的数据

- `learner_profile`：已有用户资料；
- `content_items`：教材与 726 条内容；
- `review_state`：旧复习状态和时间；
- `sessions`、`session_items`、`errors`：历史课程、逐句学习和错误；
- E5 模型可以复用；LanceDB 是派生索引，可以根据教材和模型 revision 重建。

## 角色边界

- 狗蛋把旧 `course.md` 当参考，不直接当新课程计划；
- 小King的人格来自 `SKILL.md` 和用户确认的自然语言偏好事件，旧 Persona 数值不能覆盖它；
- 小禾保留旧句子状态的历史含义，不为缺失的支援、纠错或迁移证据补值；
- 小菜把旧周期评估当历史背景，旧 `minor / major` 映射不能直接决定当前结论；
- 旧 Scheduled Task ID 不进入新任务状态，只登记宿主新建的 T-30、T0、T14 ID。

Hook、coach mode、逐轮 checkpoint、旧 Persona 档位和 `runtime/coach-mode.sqlite` 不进入新主链路。

迁移由 `tools/migrate_0_5_4.py` 在数据库副本上完成。角色运行时不自动迁移原库。
