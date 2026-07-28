---
name: manage-agents-kit
description: 管理 Ezra 的 ~/agents_kit 私有配置仓库。只要用户要安装、创建、删除、启用、停用、移动、编辑、同步、检查或解释 Agent Skill、rules、agents、hooks、prompts、active.txt、sources.json、metadata.json 或生成清册，就使用本技能；用户说“装这个技能”“全局还是项目级”“删掉这个 skill”“更新技能仓库”“看看有哪些技能”时也必须使用。
---

# 管理 agents_kit

把 `~/agents_kit` 作为唯一事实来源。使用仓库脚本完成确定性操作，不要直接往
`~/.claude/skills`、`~/.agents/skills` 或项目目录复制第三方技能。

## 开始

1. 设 `REPO="${HOME}/agents_kit"`，进入仓库。
2. 读取仓库根目录的 `AGENTS.md`。
3. 运行 `git status --short --branch`，保留用户已有改动，不把无关文件混进提交。
4. 工作区干净时运行 `git pull --rebase origin main`；不干净时不要擅自 rebase。
5. 需要解释架构、排查数据流或修改脚本时，读取 `references/repository.md`。

`docs/skills.md` 和 `docs/index.html` 是生成物。修改它们的源数据，再运行
`scripts/render.py`；不要直接编辑生成物。

## 选择操作

### 查看

```bash
python3 scripts/manage.py list
python3 scripts/manage.py list --active
python3 scripts/manage.py list --category web --json
python3 scripts/doctor.py
```

### 收录 GitHub 技能

先确定安装范围。用户没有说明时，只问“全局还是只装当前项目？”。

从八个一级分类中选择最贴近主题的一个：
`apple web design lark method agent tools backend`。只有无法可靠判断时才询问。

调用一次 `add.py`，同时传入安装范围和清册说明：

```bash
python3 scripts/add.py "<github-url>" \
  --cat tools \
  --scope global \
  --description-zh "<一句准确说明>" \
  --trigger-zh "<用户会怎么说>" \
  --recommendation 3
```

项目级安装改用：

```bash
python3 scripts/add.py "<github-url>" \
  --cat tools \
  --scope project \
  --project-dir "<absolute-project-path>" \
  --description-zh "<一句准确说明>" \
  --trigger-zh "<用户会怎么说>"
```

`add.py` 会优先走 SSH、失败后切 HTTPS；每条网络通道有超时上限。安装阶段只复制
第三方文件，不执行其中的 setup 或运行脚本。运行依赖留到首次真正调用技能时处理。
它会自动完成文档生成、安装和体检，不要随后重复运行 `refresh`。

### 创建自有技能

使用 `skill-creator` 创建并验证技能，把目录放进 `skills/<category>/<name>/`。自有技能
没有上游，不要写进 `sources.json`。然后补清册信息并按需设为常驻：

```bash
python3 scripts/manage.py describe <name> \
  --description "<中文说明>" \
  --trigger "<触发方式>" \
  --recommendation 5
python3 scripts/manage.py activate <name>
```

### 修改

先查 `sources.json`：

- 没有来源登记：直接修改技能源码。
- 有来源登记且修改应长期保留：先运行 `python3 scripts/manage.py detach <name>`，
  明确停止自动同步，再修改。
- 只是跟进上游：使用 `sync.py`，不要手改一份随后又被覆盖的副本。

修改技能正文后运行：

```bash
python3 scripts/manage.py refresh
```

移动目录使用：

```bash
python3 scripts/manage.py move <name> <category>
```

### 启用、停用和删除

```bash
python3 scripts/manage.py activate <name>
python3 scripts/manage.py deactivate <name>
python3 scripts/manage.py remove <name> --yes
```

`remove` 会同时删除技能目录、`active.txt`、`sources.json`、`metadata.json` 和本仓库
创建的全局软链。用户没有明确要求删除时，不要推断删除。

`pull.py` 创建的项目副本不受中央仓库追踪。用户说“从仓库全删”时不扫描项目；用户
明确要求删除机器上的所有副本时，先确定允许搜索的项目根目录，再处理找到的副本。

### 管理 rules、agents、hooks 和 prompts

先读取目标目录自己的 `README.md`，再直接增删改其中的源文件。这四个目录目前只有说明
文件，尚无统一管理脚本：

- `rules/` 和 `agents/` 尚未接入安装流程，不要把“写入仓库”误报成“已经生效”。
- `hooks/` 只有注册进 Claude Code 设置才会生效；注册属于独立写操作。
- `prompts/` 只是素材库，不自动安装。

这些变化不影响技能清册，无需运行 `render.py`；仍需检查 Git diff 和对应目标的格式。

## 收尾

1. `add.py` 和 `manage.py` 的写操作已经自动生成文档、刷新所需链接并体检，不要重复
   运行 `refresh`。只有直接编辑技能源码后才运行 `manage.py refresh`；改过路径时加
   `--link`，手工删除或停用后加 `--prune`。
2. 检查 `git diff --check`、`git diff --stat` 和 `git status`。
3. 只提交本次相关文件。
4. 提交 `agents_kit` 并推送。项目级副本所在的项目仓库只有用户明确要求时才提交。
5. 推送被拒时运行 `git pull --rebase origin main`，解决冲突、复验后再推送；本机
   GitHub 操作优先使用 SSH。
6. 汇报实际完成的范围、技能名、验证结果和 commit SHA。

不要把网络重试、安全扫描、文档生成等临时过程写进通用规则。把稳定步骤留在脚本里，
Skill 只负责选择正确操作并补齐必要输入。
