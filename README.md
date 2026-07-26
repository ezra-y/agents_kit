# agents_kit

我的 agent 配置库。Claude Code 和 Codex 共用一套。

**153 个技能** · 常驻 **64** 个 · **130** 个能自动跟上游更新

完整清册看 [docs/index.html](docs/index.html)（能搜索、能展开每个技能的全文），
想在 GitHub 上直接翻就看 [docs/skills.md](docs/skills.md)。

---

## 第一次装

```bash
git clone <这个仓库> ~/agents_kit
cd ~/agents_kit
python3 scripts/link.py
```

跑完之后 `~/.claude/skills` 和 `~/.agents/skills` 里会出现 64 个**快捷方式**，指向这个仓库里的技能。

之后想更新，一条命令：

```bash
cd ~/agents_kit && git pull
```

**不用再跑 link.py。** 因为装的是快捷方式不是复制品，仓库内容一变，装好的技能立刻就是新的。

---

## 日常怎么用

### 我看到个好技能，想收进来

```bash
python3 scripts/add.py https://github.com/某人/某仓库/tree/main/skills/某技能 --cat web
```

`--cat` 是放哪个分类，八选一：`apple` `web` `design` `lark` `method` `agent` `tools` `backend`。

它会自动：下载 → 放进分类目录 → 记进 `sources.json`（这样以后会跟着上游更新）→ 重新生成文档 → 体检。

想顺便设成常驻，加 `--active`，然后跑一次 `link.py`。

### 我想改常驻名单

编辑 `active.txt`，加一行或删一行（井号开头是注释），然后：

```bash
python3 scripts/link.py
```

想把没列在名单里的旧快捷方式一并清掉，加 `--prune`。

### 我要做个 iOS 项目，想临时用一批技能

在项目目录里：

```bash
python3 ~/agents_kit/scripts/pull.py apple
```

技能会被**复制**到这个项目的 `.claude/skills/`，只在这个项目生效。
不知道有哪些分类就 `pull.py --list`。

> 这里用复制不用快捷方式，因为项目可能要提交给别人，快捷方式指向的是你本机路径，对别人是死链。

### 我怀疑哪儿坏了

```bash
python3 scripts/doctor.py
```

会查：SKILL.md 格式、重名冲突、名单和实际对不对得上、快捷方式失效没、技能之间的引用断没断、两个目录一致不一致。

### 我改了技能的中文说明

编辑 `scripts/descriptions.py`，然后：

```bash
python3 scripts/render.py
```

`docs/skills.md` 和 `docs/index.html` 会重新生成。

---

## 六个脚本

| 脚本 | 干什么 | 什么时候跑 |
|---|---|---|
| `link.py` | 按 `active.txt` 把技能装到本地（建快捷方式） | 改了名单之后 |
| `pull.py` | 把某一类技能复制进当前项目 | 做特定项目时 |
| `add.py` | 加新技能，自动归类、登记、更新文档、体检 | 收技能时 |
| `sync.py` | 跟 130 个上游对齐 | **不用手动跑**，GitHub 每天自动 |
| `doctor.py` | 体检 | 改完东西随手跑 |
| `render.py` | 重新生成 `docs/` 下的文档 | 改了说明之后（`add.py` 会自动带跑） |

---

## 自动同步是怎么回事

`.github/workflows/sync.yml` 每天北京时间凌晨 2 点跑一次：

1. 按 `sources.json` 检查那 130 个技能的原作者有没有更新
2. **改动小的**（相似度 ≥90% 且附件数没变）→ 直接更新并提交
3. **改动大的** → 不动本地文件，开一个 Issue 等你确认

第 3 条是有教训的。之前 `grill-with-docs` 上游从 89 行重构成 7 行空壳，依赖的技能本地没有，盲目自动更新会直接把技能弄废。

另外 **23 个技能没写进 `sources.json`** —— 那些是查不到出处的，同步脚本永远不碰它们，只有本地这一份。

---

## 目录

| 目录 | 装到哪 | 放什么 |
|---|---|---|
| `skills/` | `~/.claude/skills` + `~/.agents/skills` | 技能，八个分类 |
| `rules/` | `~/.claude/rules/` | 规则片段，可按文件类型限定加载 |
| `agents/` | `~/.claude/agents/` | 子代理定义 |
| `hooks/` | 注册进 `settings.json` | 到点强制执行的脚本 |
| `prompts/` | 不装 | 私人素材库，手动复制用 |

后四个目录现在是空的，各有一个 README 说明该往里放什么。等真有内容了再填。

`skills/` 下**只分一级**：

```
apple/    44     web/     34     lark/    27     method/   16
design/   14     agent/   10     tools/    4     backend/   4
```

分类只是给你自己看的 —— 装到本地时会被拍平，Claude 只认 `~/.claude/skills/<技能名>/SKILL.md` 这一层。所以**技能名必须全局唯一**，分类怎么归都不影响使用。
