# 共享对象与字段

> 原则：只固定四个角色完成交接所必需的字段。教学方法仍由各角色 Reference 决定。

## 1. `lesson_plan`：狗蛋 → 小King

用途：让小King无需重新备课即可直接上课。

| 字段 | 含义 |
|---|---|
| `lesson_id` | 本课唯一 ID |
| `learner_id` | 学习者 ID |
| `course_plan_id` | 所属课程计划 |
| `plan_version` | 教案版本；修改后递增 |
| `status` | `draft / ready / superseded` |
| `created_at` | 创建时间 |
| `target_minutes` | 预计课时 |
| `lesson_goal` | 本课要完成的真实沟通结果 |
| `curriculum_refs` | 本课引用的教材章节或材料 |
| `review_item_ids` | 本课应复习的项目 |
| `new_item_ids` | 本课首次引入的项目 |
| `steps` | 按顺序执行的课堂环节 |
| `source_review_ids` | 本教案依据的上一课复盘 |
| `teacher_persona_version` | 本课使用的小King人格版本 |

每个 `step` 至少包含：

```text
step_id
purpose
learner_task
teacher_actions
completion_signal
materials
optional
time_hint_minutes
fallback
```

字段只承载教案内容，不把课堂方法改写成大量枚举。

## 2. `class_run`：小King → 小禾

用途：让小禾准确定位上一节真实课堂。

| 字段 | 含义 |
|---|---|
| `class_run_id` | 本次上课记录 ID |
| `lesson_id` | 使用的教案 |
| `lesson_plan_version` | 实际使用的教案版本 |
| `voice_session_id` | 当前 GPT Live 会话 ID |
| `started_at` | 开课时间 |
| `status` | 默认 `review_pending`，后续可变为 `reviewed / unreadable / abandoned` |
| `note` | 提前结束、音频异常等事实备注 |

S2 在开课时登记一次即可。课堂中不逐轮写状态。

## 3. `lesson_review_delta`：小禾 → 狗蛋

用途：把完整课堂转成句子状态、记忆调度和下一课输入。

| 字段 | 含义 |
|---|---|
| `review_id` | 复盘 ID |
| `class_run_id` | 对应课堂 |
| `lesson_id` | 对应教案 |
| `reviewed_at` | 复盘时间 |
| `completion` | `completed / partial / unreadable` |
| `item_updates` | 每个教材项目的证据和状态变化 |
| `error_updates` | 本课值得长期跟踪的错误 |
| `persona_change_events` | 用户明确提出的长期教师偏好 |
| `planning_signals` | 给狗蛋的下一课信号 |
| `user_summary` | 给用户看的短摘要 |
| `limitations` | 转录缺失、证据不足等限制 |

每个 `item_update` 至少包含：

```text
item_id
observations
status_before
status_after
grade
next_review_at
reason
```

`observations` 保存事实，例如：

```text
教师示范
跟读
提示后说出
独立说出
自我修复
纠错后完整重说
换条件迁移
延迟提取
未出现
```

记忆算法根据证据计算 `grade / status_after / next_review_at`。模型不能直接凭整体印象修改复习日期。

`planning_signals` 至少包含：

```text
due_item_ids
reinforce_item_ids
transfer_item_ids
candidate_material_ids
lesson_direction
note
```

狗蛋备课时仍应重新查询最新状态，不只依赖这份信号的缓存。

## 4. `cycle_review`：小菜 → 狗蛋

用途：决定当前课程路线保持、局部调整、重做或暂缓判断。

| 字段 | 含义 |
|---|---|
| `cycle_review_id` | 周期评估 ID |
| `period_start / period_end` | 评估周期 |
| `reviewed_class_run_ids` | 纳入分析的课堂 |
| `decision` | `keep / adjust / replan / defer` |
| `evidence_summary` | 最可靠的长期证据 |
| `progress_signals` | 稳定进步和迁移表现 |
| `bottlenecks` | 重复阻塞点 |
| `limitations` | 数据限制 |
| `recommendations` | 给狗蛋的方向建议 |
| `requires_head_teacher` | 是否需要继续调用狗蛋 |
| `head_teacher_response` | 狗蛋完成调整后写入的教学响应 |

小菜给方向与证据；狗蛋负责具体修改课程计划。

## 5. `persona_change_event`

用途：S1 和 S3 共同维护小King长期人格，不互相覆盖完整人格文件。

```text
event_id
source
requested_at
scope: temporary / persistent
instruction
status: proposed / confirmed / applied / rejected
effective_from
```

只有用户明确表达的长期偏好才写 `persistent`。课堂中的“现在慢一点”默认只在本节生效。

## 6. `handoff`

用途：记录一个角色完成什么、交给谁、下一个动作是什么。

```text
handoff_id
workflow_run_id
from_role
to_role
action
status: completed / skipped / failed
artifacts
created_at
idempotency_key
note
skip_reason
error
```

`handoff` 不承载整份教学内容，只引用上面四类业务对象。
