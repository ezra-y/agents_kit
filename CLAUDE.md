@AGENTS.md

## 维护这个仓库时的规矩

**加技能一律走 `scripts/add.py`**，别手动往 `skills/` 里拷。手动拷的不会进 `sources.json`，
以后收不到上游更新，文档也不会刷新。

**技能名必须全局唯一。** 装到本地时分类目录会被拍平成 `~/.claude/skills/<技能名>/`，
重名会互相覆盖。`doctor.py` 查这个。

**动过技能之后跑 `scripts/render.py`**，否则 `docs/` 下的文档会跟实际对不上。
`add.py` 已经自动带跑了，手动改动才需要自己跑。

**改完跑 `scripts/doctor.py`。** 它查六件事：SKILL.md 格式、重名、`active.txt` 匹配、
技能间引用、软链有效性、两个本地目录一致性。

**别给那 23 个不在 `sources.json` 里的技能乱填来源。** 它们查不到出处，
`sync.py` 设计成完全不碰它们；填了会导致被上游内容覆盖。

**新技能在 `scripts/descriptions.py` 补中文说明**，格式：

```python
'技能名': (分类常量, 推荐指数 1-5, '说明', '怎么触发'),
```

没补不报错，`render.py` 会退回用 SKILL.md 的英文 description，但文档质量会掉。

## 目录约定

`skills/` **只分一级**，八个：`apple` `web` `design` `lark` `method` `agent` `tools` `backend`。

不要再建二级目录 —— 之前试过 `apple/api-reference/` 这种，没有好处：装到本地时分类层
本来就会被拍平，多一级只是给人看的额外负担。

`rules/` `agents/` `hooks/` `prompts/` 目前是空的，各有 README 说明用途，往里加东西前先读。
