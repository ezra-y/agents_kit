# agents_kit

这是 Ezra 的私有 Agent 配置仓库，也是 Claude Code 与 Codex 共用技能的唯一事实来源。

## 仓库内容

| 路径 | 内容 | 去向 |
|---|---|---|
| `skills/` | Agent Skill，按八个主题分一级目录 | 常驻项软链到 `~/.claude/skills` 与 `~/.agents/skills` |
| `rules/` | 会话规则片段；目前只有说明文件 | 尚未接入安装脚本 |
| `agents/` | Claude Code 子代理定义；目前只有说明文件 | 尚未接入安装脚本 |
| `hooks/` | Hook 源码与配置素材；目前只有说明文件 | 需要显式注册进 Claude Code 设置 |
| `prompts/` | 私人提示词素材；目前只有说明文件 | 不自动安装 |
| `scripts/` | 收录、管理、安装、同步、生成和体检命令 | AI 与维护者执行 |
| `docs/` | 自动生成的技能清册 | GitHub 与本地浏览 |

技能分类固定为：

`apple web design lark method agent tools backend`

分类只用于浏览。安装时会拍平成 `<技能名>/SKILL.md`，因此技能目录名必须全局唯一。

## 状态文件

| 文件 | 含义 | 修改方式 |
|---|---|---|
| `active.txt` | 全局常驻技能名集合 | `manage.py activate/deactivate`，或编辑后运行 `link.py --prune` |
| `sources.json` | 上游来源与同步所有权 | `add.py` 写入，`manage.py remove/move/detach` 维护 |
| `metadata.json` | 中文说明、触发方式、推荐指数 | `manage.py describe` |
| `.sync-report.json` | 最近一次同步报告 | `sync.py` 生成，Git 忽略 |

有 `sources.json` 登记的技能由上游维护；没有登记的技能视为本地自有或来源不明。
需要长期修改上游技能时，先用 `manage.py detach` 停止自动同步。

## 生成文件

`docs/skills.md` 是纯 Markdown 清册，`docs/index.html` 是可搜索并展开全文的静态清册。
两者都由 `render.py` 覆盖生成。不要直接编辑 `docs/`，应修改：

- 技能正文：`skills/<分类>/<技能>/`
- 常驻状态：`active.txt`
- 上游来源：`sources.json`
- 中文清册信息：`metadata.json`

## 脚本

| 脚本 | 作用 |
|---|---|
| `scripts/add.py` | 从 GitHub 收录技能，登记来源和清册信息，并按 scope 留库、全局安装或复制到项目 |
| `scripts/manage.py` | 列出、启停、删除、移动、脱离上游、修改清册信息、统一刷新 |
| `scripts/link.py` | 按 `active.txt` 建立全局软链；`--prune` 清理本仓库管理的非常驻项 |
| `scripts/pull.py` | 将分类或单个技能复制到当前项目 `.claude/skills/` |
| `scripts/sync.py` | 检查登记过的上游，小改自动更新，大改写报告等待确认 |
| `scripts/render.py` | 从仓库状态生成两个清册 |
| `scripts/doctor.py` | 检查格式、重名、引用、登记和本地软链；CI 用 `--repo-only` |

## 正常流程

### 收录 GitHub 技能

用户未说明范围时，先问装全局还是只装当前项目。然后一次调用：

```bash
python3 scripts/add.py "<GitHub URL>" \
  --cat <分类> \
  --scope <global|project|library> \
  --project-dir "<项目绝对路径>" \
  --description-zh "<中文说明>" \
  --trigger-zh "<触发方式>" \
  --recommendation <1-5>
```

项目路径只在 `scope=project` 时需要。`add.py` 优先通过 SSH 拉取，失败后切 HTTPS；
每条通道有超时上限。安装阶段不执行第三方技能脚本。它会自动生成文档、完成对应安装
并体检，不要随后重复运行 `refresh`。

### 创建本地技能

使用 `skill-creator` 初始化并验证，放到 `skills/<分类>/<技能名>/`。不要写入
`sources.json`。然后：

```bash
python3 scripts/manage.py describe <技能名> \
  --description "<中文说明>" \
  --trigger "<触发方式>" \
  --recommendation <1-5>
python3 scripts/manage.py activate <技能名>
```

### 管理已有技能

```bash
python3 scripts/manage.py list [--active] [--category web] [--json]
python3 scripts/manage.py activate <技能名>
python3 scripts/manage.py deactivate <技能名>
python3 scripts/manage.py remove <技能名> --yes
python3 scripts/manage.py move <技能名> <分类>
python3 scripts/manage.py detach <技能名>
python3 scripts/manage.py refresh [--link|--prune]
```

删除只在用户明确要求时执行。`remove` 必须同时清理技能目录、常驻项、来源、清册元数据
和本仓库创建的全局软链。

项目副本不受中央仓库追踪。项目级安装仍要提交并推送 `agents_kit`；只有用户明确要求时
才提交项目仓库中的 `.claude/skills/` 副本。

### 管理其他配置

修改 `rules/`、`agents/`、`hooks/` 或 `prompts/` 前先读目标目录的 `README.md`。
它们目前没有统一管理脚本，也不进入技能清册。写入 `rules/` 或 `agents/` 不等于已经
安装；Hook 只有注册进 Claude Code 设置后才生效。

### 同步上游

日常同步由 `.github/workflows/sync.yml` 每天北京时间 02:00 执行。

```bash
python3 scripts/sync.py --dry-run
python3 scripts/sync.py
```

上游 `SKILL.md` 未变化时跳过下载。变化后，相似度至少 90% 且附件数不变才自动更新；
其他情况保留本地版本并写入报告。

## 完成标准

1. `add.py` 和 `manage.py` 的写操作自带生成与体检。只有直接编辑源码后才运行
   `manage.py refresh`；路径变化时加 `--link`，手工删除或停用时加 `--prune`。
2. `doctor.py` 退出码为 0。
3. `git diff --check` 通过。
4. 只暂存当前任务文件，不覆盖或提交用户的无关改动。
5. 工作区干净时用 `git pull --rebase origin main` 同步；推送被拒后也用 rebase，
   不创建无意义的 merge commit。
6. 提交并推送仓库；本机 GitHub 操作优先走 SSH。
