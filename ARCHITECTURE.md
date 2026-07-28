# agents_kit 架构

本文件记录稳定设计。生成区块由 `agents-kit docs build` 更新。

<!-- BEGIN GENERATED -->

## 当前事实

- 技能：155
- 常驻：66
- 来源记录：132
- metadata：155
- 分类：agent(9), apple(44), backend(4), design(14), lark(27), method(17), tools(6), web(34)

## 状态所有权

- `agents-kit.json`：分类、安装目标和默认策略
- `active.txt`：全局常驻技能名
- `sources.json`：provider 来源记录
- `metadata.json`：中文清册和依赖

<!-- END GENERATED -->

## 设计目标

仓库只提供一个公开入口 `scripts/agents-kit`。用户按业务对象记命令：
`source`、`skill`、`global`、`project`、`docs`、`check`。内部代码按稳定职责拆分，
不把每个动作做成单独脚本。

## 数据流

```text
外部来源
  -> sources.py 获取并生成 SkillSnapshot
  -> skills.py 修改中央技能库和登记
  -> ChangeSet 描述后续影响
  -> installation.py / docs.py / checks.py 收尾
```

`SkillSnapshot` 是来源层与技能层之间的固定接口。`ChangeSet` 是业务修改与安装、
生成、体检之间的固定接口。两者都定义在 `models.py`。

## 模块边界

| 模块 | 职责 | 不负责 |
|---|---|---|
| `scripts/agents-kit` | 参数解析、命令编排、输出 | 保存业务状态 |
| `models.py` | 共享数据结构 | I/O |
| `repository.py` | 发现仓库、读写状态、锁、原子落盘、内容哈希 | 业务流程 |
| `sources.py` | Git、HTTP、本地来源识别、获取、候选发现 | 修改仓库状态 |
| `skills.py` | 导入、更新、移动、重命名、删除、metadata | 全局或项目安装 |
| `installation.py` | 全局软链接和项目副本 | 修改技能正文 |
| `docs.py` | 纯渲染、write-if-changed、文档过期检查 | 修改事实状态 |
| `checks.py` | 只读验证状态、依赖、引用、文档和安装 | 自动修复 |

依赖方向保持单向：

```text
入口 -> 业务模块 -> repository/models
checks -> docs 的纯渲染 API / installation 的只读计划
skills -> models 中的 SkillSnapshot
```

## 来源模型

`sources.json` 的每条记录包含：

- `provider`：来源适配器 ID。
- `locator`：provider 自己解释的定位数据。
- `content_mode`：`directory` 或 `skill_file`。
- `policy`：`review` 或 `pinned`。
- `resolved`：最近确认的 revision 和内容哈希。
- 可选 `source_name`：上游名称与本地名称不同时使用。

`directory` 管理整个技能目录，适用于 Git 和压缩包。`skill_file` 只管理
`SKILL.md`，适用于直接 HTTP 文件；更新时保留本地附件。增加新来源时，只扩展
`sources.py` 的 provider 注册和对应测试，不修改技能、安装和文档流程。

## 写入模型

写操作先完成来源解析和参数校验，再取得仓库锁。JSON、文本和单文件技能更新使用
临时文件加 `os.replace`；整目录安装使用同目录临时目录再替换。Git 负责历史恢复，
仓库不实现第二套事务或回滚系统。

安装层只删除自己能证明由本仓库管理的链接。遇到同名实体目录或外部链接时停止并报告，
不自动覆盖。

## 生成内容

`docs.py` 从事实状态生成：

- `docs/skills.md`
- `docs/cli.md`
- 本文件的生成区块
- 未跟踪的 `build/docs/index.html`

相同输入必须生成相同内容；内容未变化时不得重写文件。CI 检查前三项是否过期，
并把 HTML 作为 artifact 上传。

## 不变量

1. 技能固定放在 `skills/<分类>/<技能名>/SKILL.md`。
2. 技能名在全部分类中唯一。
3. metadata 必须覆盖全部技能，active 和 sources 只能引用存在的技能。
4. 全局安装由 `active.txt` 决定，项目安装不写回中央状态。
5. 体检只报告问题，不修改仓库。
