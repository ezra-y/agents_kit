# 表格位置、创建和回写

## 1. 固定存放位置

登记文件为 `<dataRoot>/tables/locations.json`。它只保存表格文件路径/链接及真实列映射，招聘内容、用户简历和登录态不进入插件包。
`sources` 指招聘来源和本次公司范围；`candidates` 指具体岗位及后续进度。可以分别登记文件或链接，不要求两张表属于同一平台。

```bash
python3 skills/recruitment-link/scripts/table-locations.py --data-root <dataRoot> show
```

show 是只读操作。没有登记文件时返回空 tables，不自动创建表格或搜索。用户明确更换位置时才重新登记对应角色。

## 2. 登记已有文件或链接

### 本地文件

先检查文件存在并读取表头。CSV 使用本工具；xlsx 使用当前可用的表格工具；SQLite/JSON 是外部招聘数据来源，用对应读取工具读取，不假装是 CSV。
用宿主文件工具把描述保存为私有临时 descriptor.json，再登记：

```json
{"kind":"file","location":"/绝对路径/招聘来源.csv","name":"我的招聘来源","keyField":"来源链接"}
```

```bash
python3 skills/recruitment-link/scripts/table-locations.py --data-root <dataRoot> register --role sources --file <descriptor.json>
python3 skills/recruitment-link/scripts/table-locations.py --data-root <dataRoot> read-local --role sources --offset 0 --limit 20
```

keyField 必须是实际存在且能唯一标记一条记录的列。发现重复键时先确认原行身份，不凭公司名覆盖。

### 飞书或其他链接

飞书用当前可用连接器；有 lark-cli 时先读 `lark-cli skills read lark-base`，认证问题读 lark-shared。按下面顺序读取：

```bash
lark-cli base +url-resolve --as user --url <用户链接> --json
lark-cli base +table-list --as user --base-token <真实Base编号> --json
lark-cli base +field-list --as user --base-token <真实Base编号> --table-id <真实表编号> --json
lark-cli base +record-list --as user --base-token <真实Base编号> --table-id <真实表编号> --offset 0 --limit 100 --format json
```

读取列表时 `data.fields` 对应 `data.data` 的列，`data.record_id_list` 对应行；检查 has_more 后继续 offset 分页。仅需要某几列时重复传 --field-id。
同一 Base 有多张表时，根据用户指定的用途选；名称相似不等于用途已确认。记录真实 ID、链接和必要的 fieldMap：

```json
{"kind":"feishu","location":"https://用户域名/base/真实Base编号","name":"用户实际表名","baseToken":"真实Base编号","tableId":"真实表编号","fieldMap":{"公司":"实际公司列","岗位链接":"实际岗位链接列","检查结果":"实际检查结果列"}}
```

register 用法同上。只有普通外部页面链接、还没解析为飞书坐标时，可登记 `{ "kind":"link", "location":"https://实际来源页面", "name":"来源名" }`；用浏览器/网页读取工具打开。普通链接登记不代表有写权限或能直接更新网页。
用户希望把这类只读来源整理成自己的工作表时，按偏好创建本地表或飞书表。create-local 或新表 register 会把原 link 保存在登记文件的 externalSources，再把对应 tables 位置设为新工作表；之后读取外部链接，结果只写用户工作表。
飞书成功信封判断 `ok:true`；认证失效则保留位置并处理连接，不能另建重复表格。其他宿主提供等价飞书工具时读取其实际参数定义，不要求安装相同 CLI。

## 3. 没有表格时创建

### 3.1 用户选择本地

```bash
python3 skills/recruitment-link/scripts/table-locations.py --data-root <dataRoot> create-local --role sources
```

创建 `<dataRoot>/tables/招聘来源.csv` 并自动登记，默认只有表头。需要候选表时把 role 改成 candidates，生成候选岗位.csv。
模板为插件中的 `skills/recruitment-link/assets/table-schemas.json`。脚本只创建缺失文件，重跑保留已有行和用户选择。用户已有其他登记位置时先复用，不在默认目录再造一份。
本地默认 CSV 可用 Excel/Numbers 打开。用户明确要 xlsx 时，使用当前表格工具按同一模板创建，再用 register 登记实际文件；本工具只读写 CSV。

### 3.2 用户选择飞书

读取 `lark-cli skills read lark-base references/lark-base-field-json.md` 和当前命令 --help，再读取模板中对应角色的 fields 数组。
新建 Base 与来源表：

```bash
lark-cli base +base-create --as user --name 网申助手 --table-name 招聘来源 --fields '<sources.fields的实际JSON数组>' --json
```

在用户已指定的 Base 中补建表：

```bash
lark-cli base +table-create --as user --base-token <真实Base编号> --name 候选岗位 --fields '<candidates.fields的实际JSON数组>' --json
```

fields 是 JSON 数组本身，不是文件名；用 Python subprocess 参数数组或结构化工具传递 JSON，避免把长 JSON 手工拼进 shell。
先用 --dry-run 检查请求；实际创建返回后立即保存 Base/表的真实编号并 register，再用 table-list/field-list 验证表名与字段。不能把 dry-run 的占位编号当成创建成功。
创建结果不确定时先查现有表，不能立即重复创建。新建表意图已明确时直接执行，不再重复问是否建表。

需要减少可见列时，用 `+view-create --json '{"name":"选岗位","type":"grid"}'` 创建视图，再用 `+view-set-visible-fields --json '{"visible_fields":["公司","岗位","岗位链接","用户选择","检查结果"]}'`，两者都传真实 base-token/table-id，后者加返回的 view-id。
已有表优先保留原列和视图，用 fieldMap 适配；确实缺少当前功能所需字段且用户已要求该功能时，用 `+field-create --json '<模板中对应字段对象>'` 补列。不要把历史“处理”复选框当成“确认投递”。

## 4. 把外部数据或搜索结果放进表

本地 CSV：把实际字段对象写到私有 patch.json，调用下面命令，然后 read-local 核对更新后的值。

```bash
python3 skills/recruitment-link/scripts/table-locations.py --data-root <dataRoot> upsert-local --role sources --file <patch.json>
```

按已登记 keyField 更新同一行；新增记录的用户选择设“待决定”。更新旧行只传发生变化的字段，保留用户选择和其他列；不要每次重置为待决定。
飞书先按来源链接/岗位链接找到已有行。已存在用 `+record-upsert --as user --base-token <id> --table-id <id> --record-id <实际行ID> --json '<仅变化字段的对象>'`；不存在时省略 record-id 才是新增。
`record-upsert` 不会按链接自动去重。新增后立即记录返回行 ID；批量创建每次最多 200 条，形状为 `--json '{"create_records":[字段对象,...]}'`，命令为 `+record-batch-create`。
写入前按 CLI 提示读取 cell-value 和对应 record-upsert/batch-create 参考；完整 JD 保存全文，不能用截断摘要冒充。

## 5. 将执行结果写回原行

导入任务时在 externalRowId 保存原行身份：飞书用 `feishu:<baseToken>:<tableId>:<recordId>`；文件使用 read-local 返回的 externalRowIds，它包含绝对文件路径和稳定主键；其他文件读取工具按同样格式生成 `json.dumps(["file", 绝对路径, keyValue], ensure_ascii=False)`，不能仅用行号或主键值，以免不同表的同值行覆盖任务。随批次保存对应表格角色和文件路径；切换默认表不改变旧批次的原行归属。
将每批原表描述及 `{externalRowId,role,recordId或keyValue}` 保存在 `<dataRoot>/tables/batches/<batchId>.json`，使用普通文件工具写入；恢复时先读这份绑定，不从当前默认位置猜旧任务来源。
已有任务从 runtime.sqlite 的 application_tasks.external_row_id/source 读取原身份；没有原表行身份时，先按实际链接确认唯一行再补绑定。找不到就报告“待关联原行”，不随便覆盖同名公司。

填写、独审、阻塞、真实提交分别写清。只填写就记录已填写/已保存/独审结果，不能写已投递；提交结果以官网实际读回为准。
本地用该批原表路径及 keyField 读取后更新；默认位置仍相同时可直接 upsert-local。默认位置已变化时用文件工具更新批次原文件，不覆盖新默认登记。
飞书用该批保存的 Base/表/行 ID 调用 record-upsert，只传必要结果；随后用 `+record-get --as user --base-token <id> --table-id <id> --record-id <id> --format json` 读回核对。
验证码值和登录令牌不回写。更新失败保留本地结果并报告“表格待同步”，不能把网页操作成功说成表格已更新。
这里由活跃 Agent 执行读写，没有后台同步服务；不需要用户再次提供已登记的位置。
