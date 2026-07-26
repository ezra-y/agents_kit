# agents_kit

我的 agent 配置库：技能、规则、子代理、hook。同时喂给 Claude Code 和 Codex。

## 目录

| 目录 | 装到哪 | 放什么 |
|---|---|---|
| `skills/` | `~/.claude/skills` + `~/.agents/skills`（软链） | 技能，按主题分目录 |
| `rules/` | `~/.claude/rules/`（软链） | 规则片段，可用 `paths:` 限定只在碰特定文件时加载 |
| `agents/` | `~/.claude/agents/`（软链） | 子代理定义 |
| `hooks/` | 注册进 `settings.json` | 到点强制执行的脚本 |
| `prompts/` | 不安装 | 私人提示词素材库，手动复制用 |

## 维护规矩

新增技能一律走 `scripts/add.py`，它会同时更新 `sources.json`。手动拷进 `skills/` 会导致同步漏掉它。

`sources.json` 记录每个技能的上游来源。**不在这个文件里的技能，`sync.py` 永远不碰** —— 那些是自有的或查不到出处的，只有本地这一份。

`active.txt` 决定哪些技能常驻本地。改完必须跑 `scripts/link.py` 才生效。

改动任何技能后跑 `scripts/doctor.py`，它会查断裂引用、重名冲突、软链失效。

## 分类原则

目录只表达**主题**，不表达装没装 —— 装没装由 `active.txt` 决定。一个技能的主题基本不变，激活状态经常变，所以让变化频繁的那个用最轻的方式（改一行文本）。
