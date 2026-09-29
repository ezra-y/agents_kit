# 数据与工具

批次保存到 `<dataRoot>/recommendations/<batchId>/batch.json`。个人资料与抓取结果不进入插件包。下面定义数据形状，实际值从官网和现有资料读取。

| 字段 | 内容 |
|---|---|
| `title` | 文档标题 |
| `materialSummary` | 本批使用的简历名称与必要材料；只描述用户可辨认的版本 |
| `orderPolicy` | 多志愿时的顺序规则，使用用户在确认行填写的志愿数字，推荐顺序独立保留 |
| `companies` | 公司数组 |
| 公司 `name / maxApplications / submittedBefore` | 公司名、本批岗位共同适用的确定投递上限（未知或分项目时为 null）、本批以外已提交数量 |
| 公司 `limitSource / jobs` | 名额依据与按推荐顺序排列的岗位数组 |
| 公司 `limitStatus / limitText / limitSourceUrl / limitCheckedAt` | 规则查询状态、包含项目和时间范围的展示文字、官网链接、核实时间，见官网投递规则参考 |
| 公司 `submittedScope / submittedSourceUrl / submittedCheckedAt / submittedEvidencePath` | 已有投递数量的查询范围、官网入口、核实时间及私有证据文件 |
| 公司或岗位 `remainingApplications` | 官网已确认的剩余次数；分项目保存，不跨范围相减 |
| 公司 `loginProfileName` | 本次验证成功的本机登录档案，交给后续 `open_task` 的 `profileName`；账号验证时间沿用该档案的 `verifiedLogin` |
| 岗位 `title / url / jd / score` | 官网名称、具体职位链接、完整 JD、0～100 适配度 |
| 岗位 `limitText / maxApplications / submittedBefore` | 岗位所属项目的具体规则、上限与本批以外已提交数量；同一 preferenceScope 使用同一范围的数字，公司共同限制仍生效 |
| 岗位 `city / salary / recruitmentType / eligibility / deadline` | 已核实的短字段，未知可省略 |
| 岗位 `organization` | 官网标注的招聘单位或部门，集团共用入口时尤其需要展示 |
| 岗位 `preferenceRank / preferenceScope` | 用户填写的正整数志愿（未选为 null）、官网明确独立的招聘项目；未设置项目时按公司排序 |
| 岗位 `source / checkedAt` | 原文来源与核实时间 |
| 岗位 `status / taskId / recordId` | 实际执行状态与已有任务、表格行关联 |
| `table` | 本批原表描述，沿用位置登记中的 baseToken、tableId、fieldMap |
| `document` | `bind` 保存的真实文档 ID、URL、确认块与发布时的申请内容 |

`status` 使用待选择、待投递、处理中、已提交、需要处理、提交结果待核实。取消选择只取消尚未执行的意愿，不撤回官网申请。`submittedBefore` 不重复包含本批已提交的岗位。

命令使用 Python 标准库。输入 JSON 使用标准解析器，文档使用 XML 解析器。

```bash
python3 skills/job-recommendation/scripts/recommendations.py validate --batch <batch.json>
python3 skills/job-recommendation/scripts/recommendations.py render --batch <batch.json> --output <draft.xml>
python3 skills/job-recommendation/scripts/recommendations.py records --batch <batch.json> --output <records.json>
```

`render` 生成可读草稿，可根据内容调整版式。绑定文档后只作局部更新，生成器不重建已有确认项。已有文档的姓名、岗位、地点、材料等内容变更由代理核对并重新确认。

表格字段包括公司、岗位、岗位链接、完整JD、适配度、推荐顺序、工作地点、薪资、招聘类型、届别要求、截止日期、可投数量、投递规则、已选数量、当前入口已投数量、确认投递、投递志愿、提交状态和阅读文档。可投数量保存对应范围的上限，投递规则保留该数量的项目和时间条件。当前入口已投数量来自已验证账号的官网记录，未知时留空；查询范围不足以覆盖适用名额规则时，继续核实后再判断剩余次数。`records` 返回逐岗位对象以及已知 recordId，不执行远端写入。

按 recruitment-link 的表格位置与创建参考，先读取实际字段，再补充缺少的当前功能字段；字段名字可以映射。已有记录按准确岗位链接关联，保存返回的 recordId。逐行或批量写入后读回。官网事实、评分、文档确认及执行结果各自更新，不覆盖无关字段。

用 lark-doc 完成草稿初始化、格式检查与创建。成功后保存返回的文档 ID，再读取：

```bash
lark-cli docs +fetch --as user --doc <documentId> --detail full --doc-format xml --format json
python3 skills/job-recommendation/scripts/recommendations.py bind --batch <batch.json> --snapshot <完整fetch响应.json> --url <文档URL>
python3 skills/job-recommendation/scripts/recommendations.py choices --batch <batch.json> --snapshot <最新完整fetch响应.json> --output <choices.json>
```

`bind` 通过确认行中的真实岗位链接绑定服务端 block ID，初次绑定要求投递志愿留空。已有批次再次 bind 时保留未变化的关联与用户选择；新增岗位绑定新的空白确认项。申请内容变化后用 lark-doc 局部替换为新的空白确认块，再 bind，旧发布内容保存在 previousBindings，随后由用户重新确认。

`choices` 通过保存的 block ID 读取用户选择，返回 selected、按志愿排序的 ready、blocked，并更新本地镜像；ready 携带 preferenceRank 和 preferenceScope。重复数字或不连续的数字暂停整个志愿组，保留推荐列表原顺序。资料待核实等执行问题保留用户的已选状态，只有 ready 可交给后续流程。空选择输出空数组；用户仍可更改尚未提交的选择。表格不反向决定文档授权。

每次执行 `choices` 都重新 fetch 完整文档。批次和读回响应一起保留，恢复时从这些文件读取。`choices` 只产出下一步候选；真实提交状态始终用已有任务库和官网结果再次检查。
