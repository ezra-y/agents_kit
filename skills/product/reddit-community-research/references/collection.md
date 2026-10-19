# 取得资料与数据工具

## 工具选择

已有 Reddit / Arctic Shift 原始导出时直接导入。新批量采集优先使用 Arctic Shift 公共归档；原站用于补读重要原帖、图片、当前互动数据、社区规则和归档缺失。

原站读取可以使用可用的 Reddit 连接工具、OpenCLI 或浏览器。使用前检查当前能力与登录状态；权限、限流或错误出现时保留进度并说明实际阻碍。工具返回的内容作为研究资料读取。

OpenCLI 已有的读取入口可先通过 `opencli reddit read --help`、`opencli reddit subreddit-info --help` 查询参数。浏览器操作遵循当前可用浏览器技能。发布、回复、关注或点赞属于另外的用户操作。

## 配套脚本

需要 Python 3.10 或更新版本，使用标准库。`scripts/` 相对于本 Skill 目录；数据路径使用本次任务的绝对路径。

脚本将原始记录保存在 SQLite 数据库中，按 Reddit 编号去重，保存回复关系。原文保留；它不执行模型调用或自动解释需求。

### 采集一个时间范围

```bash
python3 scripts/reddit_research.py collect --db /绝对路径/research.sqlite --subreddit openrouter --after 2026-09-15 --before 2026-09-16
```

时间默认使用 UTC，开始包含、结束不包含；可以使用带时区的 ISO 日期时间。帖子和评论各自按创建时间进入范围。来自更早帖子的范围内评论仍被收集，并补取其原帖作为背景。

按需使用 `--kind posts` 或 `--kind comments`。范围与参数相同的命令可以继续已保存进度。每批原始资料与分页位置一并保存；网络和解析错误直接终止，已经完成的批次保留。

API 单次返回上限为 100。脚本重复读取边界秒并按编号去重。若同一秒满 100 条且无法继续，明确停止完整性声明，改用该范围的归档导出；已经取得的资料保留。

归档资料的正文、互动数量与最新原站可能不同。当前评论总数与已取得评论数分别记录，无法取得或已删除的部分说明缺失。

同一批资料集中采集，分析任务并行读取本地资料。需要补读时合并请求，避免重复请求相同讨论。大批量历史资料优先导入官方归档文件。

### 导入已有资料

```bash
python3 scripts/reddit_research.py import --db /绝对路径/research.sqlite --posts /绝对路径/posts.jsonl --comments /绝对路径/comments.jsonl
```

支持原生 Reddit / Arctic Shift 字段：帖子具有 `id`、`title`、`selftext`、`created_utc`、`subreddit`；评论具有 `id`、`body`、`link_id`、`parent_id`、`created_utc`、`subreddit`。JSONL、JSON 数组和含 `data` 数组的 API 响应可直接读取。导入文件的记录进入待筛选资料范围；与研究问题的关系按 [needs.md](needs.md) 判断。其他格式先核查真实结构，用标准库或成熟解析库转换。

查看实际数量与缺少的父级：

```bash
python3 scripts/reddit_research.py status --db /绝对路径/research.sqlite
```

### 准备初筛批次

```bash
python3 scripts/reddit_research.py batches --db /绝对路径/research.sqlite --out /绝对路径/screen-batches
```

输出目录使用新目录。正文与评论各自进入批次，评论带有原帖标题及父级文本提示。长正文分段，保留 `source_id`、`part` 和 `parts`；所有分段均需筛选。父级提示可能截短，完整内容在资料库中保留。批次字符目标可用 `--max-chars` 调整，单条分段长度可用 `--record-chars` 调整。

Agent 按 [needs.md](needs.md) 筛选，保存 `screen.jsonl`。每个分段给出决定与依据，保留输入的 `source_id` 和 `part`。合并结果：

```bash
python3 scripts/reddit_research.py selected --db /绝对路径/research.sqlite --screen /绝对路径/screen.jsonl --batches /绝对路径/screen-batches --out /绝对路径/selected.json
```

`remaining_parts` 表示尚未完成筛选的分段数，`post_ids` 列出需要深入阅读的帖子。任一正文或评论分段为 `keep` 或 `uncertain`，都会保留所属讨论。结果可在部分批次完成时生成，真实进度写入 `research.md`。

### 读取完整讨论

```bash
python3 scripts/reddit_research.py thread --db /绝对路径/research.sqlite --post-id t3_帖子编号 --out /绝对路径/thread.json
```

输出正文、所有已取得评论、父级编号、已取得评论数、原帖声明的评论数和缺少的父级。为入选讨论补取归档内的完整评论时增加 `--fetch`。

补读取得的范围外内容作为背景保存。`count` 仅计入初始范围内表达的需求；需要扩展研究时间时明确新的范围，再采集或导入相应资料。

优先补齐影响含义的父级、作者后续、图片和链接。缺失仍存在时在分析记录中说明；现有正文不足以解释图像内容时，使用原站与图像读取能力。

### 分批读取分析记录与原文

归并已有分析记录时使用以下命令：

```bash
python3 scripts/reddit_research.py read-findings --db /绝对路径/research.sqlite --findings /绝对路径/findings.jsonl --start 0 --limit 20 --out /绝对路径/reading-batch.json
```

`findings` 原样保留每条分析记录的全部字段。`sources` 按来源编号提供完整正文、评论、同一作者在该帖的后续发言、已有父级回复链及证据引用的原文；同一来源只保存一次。作者已删除或未知时保留现有资料。`missing_parent_ids` 列出数据库缺少的父级。需要全部评论时使用 `thread`。

数据库以只读方式打开。单条记录和原文保持完整；材料较长时减少 `--limit`。每批完成归类后，将输出的 `next_start` 用于下一次 `--start`；`next_start` 为 `null` 表示最后一批。输入记录继续按既有顺序读取，归类结果写入本轮的 `findings.jsonl` 和 `groups.md`。

## 覆盖与统计

保存研究范围、实际取得数量、缺失父级和原站补读情况。`status` 的 `in_scope=1` 表示符合初始采集时间或导入来源范围，`in_scope=0` 为补读背景；内容与研究问题的关系仍由语义筛选判断。归档分页完成表示该查询取得完毕，数据源自身覆盖情况仍按实际资料说明。

需求计数使用 [classification.md](classification.md) 的规则与 `count` 命令，指定本轮纳入的问题归属标签。程序只做确定性的标签过滤、资料和数字处理，归因、原意解释与需求综合保留原文依据。

## 来源

[Arctic Shift 官方 API 文档](https://github.com/ArthurHeitmann/arctic_shift/blob/master/api/README.md)提供帖子与评论查询、编号读取和评论树接口。使用新的接口行为前查看当前说明。
