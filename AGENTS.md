# agents_kit

我的 agent 配置库：技能、规则、子代理、hook。同时喂给 Claude Code 和 Codex。

## 目录

| 目录 | 装到哪 | 放什么 |
|---|---|---|
| `skills/` | `~/.claude/skills` + `~/.agents/skills`（软链） | 技能，八个一级分类：`apple` `web` `design` `lark` `method` `agent` `tools` `backend` |
| `rules/` | `~/.claude/rules/`（软链） | 规则片段，可用 `paths:` 限定只在碰特定文件时加载。目前为空 |
| `agents/` | `~/.claude/agents/`（软链） | 子代理定义。目前为空 |
| `hooks/` | 注册进 `settings.json` | 到点强制执行的脚本。目前为空 |
| `prompts/` | 不安装 | 私人提示词素材库，手动复制用。目前为空 |
| `docs/` | 不安装 | 由 `render.py` 生成的文档，别手改 |

## 每个脚本干什么

| 脚本 | 作用 | 读什么 | 写什么 |
|---|---|---|---|
| `scripts/link.py` | 把 `active.txt` 列出的技能软链到 `~/.claude/skills` 和 `~/.agents/skills`。碰到实体目录会删掉换软链（实体副本不随 git pull 更新，软链会）。`--dry-run` 只看不动，`--prune` 顺带清掉本地非常驻的 | `active.txt`、`skills/` | 两个本地技能目录 |
| `scripts/pull.py` | 把某个分类（或单个技能）**拷贝**进当前项目的 `.claude/skills/`，只在那个项目生效。自动带上硬编码的依赖（如 lark → lark-shared）。`--list` 看分类 | `skills/` | 当前项目的 `.claude/skills/` |
| `scripts/add.py` | 收新技能。给 GitHub 链接 → 浅克隆 → 放进 `--cat` 指定的分类 → 登记进 `sources.json` → 自动跑 `render.py` 和 `doctor.py`。`--active` 顺带加进常驻名单（查重）。同名技能会拒绝，用 `--name` 换名 | GitHub | `skills/`、`sources.json`、（可选）`active.txt`、`docs/` |
| `scripts/sync.py` | 跟上游对齐，GitHub Action 每天自动跑。先比 git blob SHA 指纹，没变的不下载；变了的按闸门分流：相似度 ≥90% 且附件数不变 → 直接更新，否则不动、记进报告等人工确认（防上游重构把技能改废）。`--dry-run` 只报告 | `sources.json`、`skills/`、上游仓库 | `skills/`、`.sync-report.json` |
| `scripts/doctor.py` | 体检六项：SKILL.md 格式、重名冲突、active.txt 匹配、技能间引用断裂、本地软链有效性、两个本地目录一致性。有问题退出码 1 | `skills/`、`active.txt`、两个本地目录 | 无（只读） |
| `scripts/render.py` | 重新生成 `docs/skills.md`（GitHub 上翻的索引）和 `docs/index.html`（可搜索的完整清册，内嵌全部 SKILL.md 正文）。`add.py` 和 workflow 会自动带跑，手动改动后才需要自己跑 | `skills/`、`sources.json`、`active.txt`、`scripts/descriptions.py`、`docs/usage.json` | `docs/` |
| `scripts/descriptions.py` | 不是可执行脚本，是**数据文件**：153 个技能的中文说明（说明 + 怎么触发 + 推荐指数），`render.py` 的数据源。没写的技能退回用 SKILL.md 里的英文 description。注意：每条第一个字段（分类常量）是历史遗留，现在分类以目录为准，render.py 不读它 | — | — |

## 每个数据文件是什么

| 文件 | 是什么 | 谁改它 |
|---|---|---|
| `active.txt` | 常驻名单：列在这里的技能才会被 `link.py` 装到本地。一行一个，`#` 后面是注释（记着使用次数）。改完必须跑 `link.py` 才生效 | 你手改，或 `add.py --active` 追加 |
| `sources.json` | 上游登记表：每个技能来自哪个仓库/分支/路径（或飞书 URL）。**`sync.py` 只碰登记过的**；23 个查不到出处的技能故意不登记，永远不会被覆盖。别给它们乱填来源 | `add.py` 写，一般不手改 |
| `docs/usage.json` | 使用统计的一次性快照（2026-07 从 Codex 9.9GB + Claude Code 会话日志解析的），`render.py` 拿它显示"使用"列。**没有配套脚本，不自动更新** —— 想刷新就在会话里让 agent 重新统计一次 | 不改 |
| `.sync-report.json` | `sync.py` 每次跑完的结果报告，workflow 拿它决定要不要开 Issue。已 gitignore | 自动生成 |
| `.github/workflows/sync.yml` | 每天北京时间凌晨 2 点：sync → render → doctor → 小改自动提交，大改开 Issue（label `sync`，会先确保 label 存在） | — |

## 维护规矩

1. **加技能一律走 `add.py`**，手动拷进 `skills/` 的不会进 `sources.json`，以后收不到上游更新，文档也不刷新。
2. **技能名必须全局唯一**。装到本地时分类目录会被拍平成 `~/.claude/skills/<技能名>/`，重名会互相覆盖。`doctor.py` 查这个。
3. **`skills/` 只分一级**，不要建二级目录。分类只是给人看的，装的时候会被拍平，多一级没好处。
4. **动过技能后跑 `render.py`**（`add.py` 已自动带），**改完跑 `doctor.py`**。
5. 新技能在 `scripts/descriptions.py` 补中文说明，格式 `'技能名': (分类常量, 推荐指数 1-5, '说明', '怎么触发'),`。不补不报错，文档退回英文。

## 分类原则

目录只表达**主题**，不表达装没装 —— 装没装由 `active.txt` 决定。主题基本不变，激活状态经常变，让变化频繁的那个用最轻的方式（改一行文本）。
