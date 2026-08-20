# 角色交接契约

## 1. 交接原则

```text
上游先写业务对象，再写 handoff；
下游只消费 status=completed 且通过校验的对象；
上游失败或跳过时必须留下原因；
同一 idempotency_key 重跑不能重复写入；
对象版本必须可追溯；
没有可靠上游结果，下游不得猜。
```

Scheduled Task 是顺序编排器，不把 Skill 当 RPC 服务调用。

## 2. S1 → S2：准备上课

前置：

```text
lesson_plan.status = ready
教案通过校验
教材引用可读取
```

交接：

```text
from_role: head_teacher
to_role: live_teacher
action: teach_lesson
artifacts: lesson_plan
```

失败：教案未 ready 时，小King不临场重造整课。

## 3. S2 → S3：登记课堂

前置：小King已获得当前 `voice_session_id`。

交接：

```text
写入 class_run(status=review_pending)
from_role: live_teacher
to_role: teaching_assistant
action: review_class
artifacts: class_run + lesson_plan
```

S2 不判断掌握度，不在课堂中逐轮写数据库。

## 4. S3 → S1：复盘后备课

T-30 固定顺序：

```text
读取最早的 review_pending class_run
→ 读取完整会话、教案和教材
→ 生成并校验 lesson_review_delta
→ 应用 item_learning_state 和记忆调度变化
→ class_run 标为 reviewed / unreadable
→ 写 handoff 给狗蛋
→ 狗蛋重新读取最新状态后备课
```

交接：

```text
from_role: teaching_assistant
to_role: head_teacher
action: prepare_next_lesson
artifacts: lesson_review_delta
```

特殊情况：

```text
第一节课或没有 class_run：S3 skipped，S1仍可准备 L001；
昨天没上：不推进课次；
partial：只应用已确认证据；
unreadable：不更新学习表现，狗蛋准备安全复习或沿用原课。
```

## 5. S4 → S1：周期调整

前置：达到时间条件并有足够 reviewed 课堂。

```text
S4 生成 cycle_review
KEEP / DEFER：保存后结束
ADJUST / REPLAN：写 handoff 给狗蛋
狗蛋修改计划并把教学响应写回 cycle_review
```

交接：

```text
from_role: learning_analyst
to_role: head_teacher
action: revise_plan
artifacts: cycle_review
```

## 6. 用户可见消息

```text
S3完成后不提前说“课件已准备”；
S1完成并校验 lesson_plan 后，T-30 统一发送“上节复盘 + 今日课件”；
T0 只在 lesson_plan ready 时提醒上课；
T14 只展示用户能理解的周期变化，不倾倒内部字段。
```
