# 0.5.4 数据迁移

迁移只在数据库副本上执行。原数据库和完整数据目录备份必须保留。

## 1. 只读盘点

```bash
python3 tools/migrate_0_5_4.py inventory \
  --data-root "$HOME/Library/Application Support/ai-speaking-coach" \
  --output /path/to/inventory.json
```

检查数据库版本、旧表行数、教材 hash、Persona、旧任务 ID、E5 模型和索引信息。

## 2. 迁移副本

```bash
python3 tools/migrate_0_5_4.py migrate \
  --data-root "$HOME/Library/Application Support/ai-speaking-coach" \
  --candidate /path/to/candidate/coach.sqlite \
  --backup /path/to/backups/coach-before-0.6.sqlite \
  --data-backup /path/to/backups/ai-speaking-coach-before-0.6.tar.gz \
  --old-runtime-stopped \
  --report /path/to/migration-report.json
```

先暂停旧 Scheduled Tasks 并退出旧插件会话，再传入 `--old-runtime-stopped`。工具使用 SQLite backup API 备份原库，同时归档完整数据目录，然后复制数据库备份作为候选库并应用 `006/007/008`。

## 3. 切换前校验

```bash
python3 tools/migrate_0_5_4.py validate \
  --data-root "$HOME/Library/Application Support/ai-speaking-coach" \
  --candidate /path/to/candidate/coach.sqlite
```

只有下列条件全部通过才切换：

```text
learner_profile、content_items、review_state、sessions、session_items、errors 行数一致
content_items hash 一致
006/007/008 已应用
没有生成不存在的学习证据
没有迁入 Persona 数值
foreign_key_check 为空
integrity_check = ok
```

## 4. 切换和观察

让新插件指向候选库，重建 LanceDB，重新创建 T-30/T0/T14。确认新任务成功后再禁用旧任务。

至少验证一节课堂、一次小禾复盘、一次狗蛋备课、一次到期复习和一次小菜周期评估。旧表先停止写入，不立即删除。
