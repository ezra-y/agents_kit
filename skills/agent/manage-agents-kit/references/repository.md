# agents_kit 仓库结构

## 目录

| 路径 | 角色 | 安装位置或消费者 |
|---|---|---|
| `skills/` | Agent Skill 本体，按八个主题分一级目录 | `link.py` 链到 `~/.claude/skills` 和 `~/.agents/skills` |
| `rules/` | 每次会话或按路径加载的规则片段；目前只有说明文件 | 尚未接入安装脚本 |
| `agents/` | Claude Code 子代理定义；目前只有说明文件 | 尚未接入安装脚本 |
| `hooks/` | Hook 源码和配置素材；目前只有说明文件 | 需要显式注册进 Claude Code 设置 |
| `prompts/` | 不自动安装的私人提示词素材；目前只有说明文件 | 人工取用 |
| `docs/` | 生成的技能清册 | GitHub 和本地浏览器 |
| `scripts/` | 仓库管理命令 | AI 或维护者执行 |

`skills/` 只允许八个一级分类：

`apple web design lark method agent tools backend`

分类只服务仓库浏览。安装时目录会拍平，因此技能目录名必须全局唯一。

## 根数据文件

### `active.txt`

常驻技能名集合。`link.py` 只为这里的名字建立全局软链。它不记录调用次数，也不表达
主题分类。

### `sources.json`

上游所有权登记。每条记录包含来源类型、仓库或 URL、分支、上游路径和本地分类。

- 有登记：`sync.py` 可以跟踪上游。
- 无登记：视为本地自有或来源不明，自动同步不得覆盖。
- 删除、移动技能时同步更新该文件。

### `metadata.json`

面向清册的人工元数据：

```json
{
  "skills": {
    "skill-name": {
      "recommendation": 4,
      "description": "中文说明",
      "trigger": "用户会怎么触发"
    }
  }
}
```

缺少条目时，`render.py` 回退到 `SKILL.md` 的英文 `description`。推荐指数是
1 到 5 的整数，表达这份技能占用上下文是否划算，不是代码质量评分。

### `AGENTS.md` 与 `CLAUDE.md`

`AGENTS.md` 是跨 Agent 的仓库维护契约。`CLAUDE.md` 引用它，只补 Claude Code
特有约束。稳定的目录、数据流和命令规则写在这里，不记录单次事故。

### `README.md`

给人看的快速入口。它说明安装和常用命令，不承担 AI 的完整维护流程。

## 脚本

### `scripts/add.py`

从 GitHub 收录技能。它：

1. 解析仓库、分支和技能路径。
2. 优先 SSH、再用 HTTPS，在有限时间内浅克隆。
3. 自动定位唯一的 `SKILL.md`。
4. 忽略 `.git`、Python 缓存后复制技能。
5. 登记 `sources.json`，可同时写 `metadata.json`。
6. 根据 scope 留在库中、全局软链或复制到项目。
7. 重建文档并体检。

安装过程中不执行第三方技能的脚本。

### `scripts/manage.py`

管理已经进入仓库的技能：

- `list`：查看。
- `activate` / `deactivate`：修改常驻集合和软链。
- `remove`：删除本体、登记、元数据和全局链接。
- `move`：在八个分类间移动并修复来源分类与软链。
- `detach`：停止跟踪上游，把技能转为本地维护。
- `describe`：结构化修改中文清册信息。
- `refresh`：重建文档、按需刷新链接并体检。

### `scripts/link.py`

把 `active.txt` 中的技能软链到两个全局目录。`--prune` 只移除由本仓库管理但已不再
常驻的条目，包括技能删除后留下的断链；不会删除其他插件安装的内容。

### `scripts/pull.py`

把一个分类或单个技能复制到当前项目的 `.claude/skills/`。项目使用副本，因为仓库中
的绝对软链提交给别人后会失效。部分组合会自动带上硬编码依赖。

### `scripts/sync.py`

按 `sources.json` 检查上游：

1. 先比较远端 `SKILL.md` 的 Git blob SHA。
2. 变化后才下载仓库。
3. 相似度至少 90% 且附件数不变时自动更新。
4. 大改、路径消失或下载失败写入 `.sync-report.json`，等待人工确认。

### `scripts/render.py`

读取 `skills/`、`active.txt`、`sources.json` 和 `metadata.json`，覆盖生成：

- `docs/skills.md`：纯 Markdown 清册。
- `docs/index.html`：可搜索、筛选并展开全文的静态页面。

不要直接编辑这两个输出。

### `scripts/doctor.py`

检查 `SKILL.md` 格式、重名、常驻集合、技能引用、全局软链一致性，以及来源和元数据
是否留下无对应技能的登记。退出码非零表示需要处理；CI 使用 `--repo-only` 跳过本机
软链检查。

## 自动同步

`.github/workflows/sync.yml` 每天北京时间 02:00 运行：

```text
sources.json -> sync.py -> skills/
skills/ + active.txt + sources.json + metadata.json -> render.py -> docs/
test_manage.py + doctor.py --repo-only -> 自动提交小改 / 为大改创建 Issue
```

`.sync-report.json` 是一次运行的临时产物，已被 Git 忽略。

## 主要数据流

```text
GitHub URL
  -> add.py
  -> skills/ + sources.json + metadata.json
  -> active.txt 或项目副本
  -> link.py / pull.py

skills/ + active.txt + sources.json + metadata.json
  -> render.py
  -> docs/skills.md + docs/index.html

sources.json + 上游仓库
  -> sync.py
  -> 小改更新 skills/
  -> 大改写报告并开 Issue
```

## 修改边界

- 修改生成文档的源数据，不直接改 `docs/`。
- 修改有上游登记的技能前，先决定继续跟随上游还是 `detach` 后本地维护。
- 不把本地自有技能伪造来源写进 `sources.json`。
- 不提交第三方技能生成的缓存、下载文件或临时输出。
- 工作区已有无关改动时，只暂存本任务文件；需要 rebase 且工作区不干净时先停下判断。
