# agents_kit

Ezra 的私有 Agent 配置仓库。Claude Code 和 Codex 共用一套技能，并从这里统一安装、
更新和删除。

完整清册：

- [docs/skills.md](docs/skills.md)：适合在 GitHub 上快速浏览的纯记录。
- [docs/index.html](docs/index.html)：可搜索、筛选并展开每份 `SKILL.md` 全文。

## 仓库里有什么

| 目录 | 内容 |
|---|---|
| `skills/` | Agent Skill，分为 `apple web design lark method agent tools backend` |
| `rules/` | 每次会话或按文件路径加载的规则；目前只有说明文件 |
| `agents/` | Claude Code 子代理；目前只有说明文件 |
| `hooks/` | 需要注册进设置的自动化 Hook；目前只有说明文件 |
| `prompts/` | 不安装的私人提示词素材；目前只有说明文件 |
| `scripts/` | 收录、管理、安装、同步、生成和体检命令 |
| `docs/` | 自动生成的技能清册 |

根目录中的三个状态文件：

- `active.txt`：哪些技能全局常驻。
- `sources.json`：每个外部技能来自哪里，供自动同步使用。
- `metadata.json`：中文说明、触发方式和推荐指数。

## 第一次安装

```bash
git clone <仓库地址> ~/agents_kit
cd ~/agents_kit
python3 scripts/link.py
```

`link.py` 会把 `active.txt` 中的技能软链到：

- `~/.claude/skills`
- `~/.agents/skills`

因为使用软链，之后执行 `git pull` 就能更新已经安装的技能。

## 常用命令

### 查看

```bash
python3 scripts/manage.py list
python3 scripts/manage.py list --active
python3 scripts/doctor.py
```

### 收录并全局安装 GitHub 技能

```bash
python3 scripts/add.py "<GitHub URL>" \
  --cat tools \
  --scope global \
  --description-zh "<中文说明>" \
  --trigger-zh "<触发方式>" \
  --recommendation 3
```

项目级安装使用 `--scope project --project-dir "<项目路径>"`。只收进仓库但不安装使用
`--scope library`。

### 管理已有技能

```bash
python3 scripts/manage.py activate <技能名>
python3 scripts/manage.py deactivate <技能名>
python3 scripts/manage.py move <技能名> <分类>
python3 scripts/manage.py detach <技能名>
python3 scripts/manage.py remove <技能名> --yes
```

`detach` 会取消上游登记，把技能改为本地维护。`remove` 会删除技能本体、登记、清册信息
和本仓库创建的全局软链。

### 临时复制到项目

```bash
cd <项目目录>
python3 ~/agents_kit/scripts/pull.py <分类或技能名>
```

项目中使用副本而不是软链，避免把只在本机有效的绝对路径提交给别人。

### 修改后刷新

```bash
python3 scripts/manage.py refresh
```

改过常驻名单或移动技能后使用 `--link`；删除或停用后使用 `--prune`。

## 自动同步

`.github/workflows/sync.yml` 每天北京时间 02:00 按 `sources.json` 检查上游。

- `SKILL.md` 没变：跳过。
- 相似度至少 90% 且附件数不变：自动更新。
- 其他变化或错误：保留本地版本并创建 Issue 等待确认。

`docs/skills.md` 和 `docs/index.html` 都由 `render.py` 生成，不要直接编辑。
