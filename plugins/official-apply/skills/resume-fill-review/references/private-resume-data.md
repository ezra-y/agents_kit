# 私有简历和答案

## 首次导入简历

先复用已登记的简历、履历和答案。进入浏览器填写前必须有一份可用中文简历；没有时向用户索要。
英文简历是可选补充。

通过命令从简历生成 `profile.json`。

```bash
node bin/applyctl.js init
node bin/applyctl.js resume prepare --file ~/简历.pdf
```

读取返回的 `sourceTextPath`。第一轮忠实提取全部原文内容，保留原有教育、工作、项目、奖项等
结构，生成 profile、逐字段证据和不确定项。没有原文依据的内容不补写。
第二轮使用新的 subagent 独立对照原文复核；没有 subagent 时使用新的独立提示。
PDF 有多栏、覆盖高亮或字段对应不清时，对照渲染页面核对，不根据线性提取文字猜对应关系。
复核器删除无证据内容，并修正分类和抄录错误；新事实需要原文或用户信息支持。

把第二轮结果写入 `.local/tmp/final-profile.json`：

```json
{
  "profile": {},
  "warnings": []
}
```

然后导入：

```bash
node bin/applyctl.js resume finalize --id resume_xxx --file .local/tmp/final-profile.json
node bin/applyctl.js resume show --id resume_xxx
```

系统生成私有 `profile.json` 和 `profile.md`，并返回 `materialId` 与全部
`profileRecordIds`。简历、结构化履历、材料和答案沿用现有 `private.sqlite`、profile 和 material
流程，不创建另一份数据库。

## 补齐本批资料

同一批次准备一次资料，后续公司复用。先将用户新确认的通用事实通过现有 `profile import` 或 `apply.save_answers` 写入正式资料；`preferences.json` 用于选项含义，不单独保存一份只供审核读取的新事实。已有 confirmedFacts 时，将适用值同步到正式字段后再填写。填写者和审核者使用同一份已合并资料及来源，新增回答只更新受影响字段。任务绑定不同时补读差异记录，不重新提取整份 PDF。

先读取任务绑定的材料、`profile_records` 和已确认答案，再结合当前任务和 `knowledge/field-catalog.yaml` 找缺项。履历内容按任务绑定的记录读取，答案按字段的使用范围和确认要求读取。教育绩点、排名和日期属于具体教育记录，通过学历、学校或日期对应到真实履历记录编号；数组位置不作为记录身份。

把本批适用且确实缺少的必填事实集中问一次。真实表单可能需要学院、成绩排名、部门和任职性质、面试方式、英语证书或成绩、调剂或调动偏好、微信、身高等类别。只询问当前任务适用的内容。`site.custom.*` 只有字段编号时，先读取真实表单的题意。

证书名称、考试成绩和熟练程度分别使用各自已确认的字段。证书的文字值与上传文件分别检查；已有文字答案却无法匹配官网选项时，说明具体选项差异。上传控件需要对应真实文件。

### 未填写字段处理

逐项保留问题名称、`canonicalKey`、`reason` 和 `suggestedScope`。`no_mapping` 先识别题意与控件；`scope_mismatch` 先匹配使用范围及具体履历记录；`format_conflict` 核对官网选项；需要确认的原因按原文说明。`no_answer` 先核对本任务的 `source.payload` 和已确认答案；已有资料却未匹配时进入能力演进，确认必填事实确实缺少后再集中询问用户。

技能等级只记录用户明确给出的程度，不把技能名或项目经历自动换成“精通”。技能可以保存为字符串，或 `{ "name": "技能名", "level": "已确认的等级" }`。学习形式也只复用有明确来源的记录。

事实与职业偏好分开保存。长期事实和偏好使用合适的全局范围；公司特殊问题使用 company 范围，
岗位特殊问题使用 job 范围，单次申请问题使用 application 范围。

还没有 `runId` 时，只把 `src/materials/import-profile.ts` 已支持的通用资料和偏好写入现有
`profile.json`，再运行 `node bin/applyctl.js profile import --file <profile.json>`。当前支持的类别
包括身份和联系资料、婚姻与驾照、地区、英语、目标城市和岗位、面试方式、调剂或调动偏好、作品链接。
`profile.json` 的基本资料使用 `basic.wechat`、`basic.heightCm`、`basic.englishCertificate`；导入后对应 `person.contact.wechat`、`person.physical.height_cm`、`qualification.english.certificate`。学院和成绩等履历内容写回对应教育记录。
`site.custom.*` 只有字段编号时不假装已经保存。

已有 `runId` 且真实表单问到字段时，才使用 `apply.save_answers`，每条回答带上正确 scope。 履历回答使用 `{ "type": "profile_record", "key": "<真实履历记录ID>" }`，保存接口统一处理前缀；其他范围优先沿用工具返回的 `suggestedScope`。scope 形状为 `{ "type": "global", "key": "user" }`；公司、岗位、单次申请分别使用 company/job/application 与真实范围 key。已有
已确认答案不重问。陌生必填问题先记为阻断，与同批问题集中询问；得到答案后保存并复用。具体网站
仍可能出现新的必填问题。

## 私有答案表示含义

只有年份的资料不能补造月份，多个年份不能任选一个。最高学历、本科或硕士限定的问题只读取唯一对应的已绑定记录；无法唯一确定时保持待核实。

校验使用控件实际选中值：自定义菜单的搜索输入框为空仍可能已有选项；年月范围和“至今”按完整日期状态读取。日期比较按官网精度，学历按层级和真实选项匹配。遇到 `value_mismatch` 时核对实际控件、原资料和官网选项，修复对应字段后重新读回。上传使用任务已登记的材料；重新扫描附件引起的字段变化后继续填写。

私有资料保存事实、偏好、可接受范围和优先级。填写前一并读取 `<dataRoot>/preferences.json`（存在时）的 fieldOptions；它按 canonicalKey 保存用户确认的选项选择范围、含义和限制，与履历一起交给审查者。没有该文件就沿用已确认资料，不新造默认偏好。
填写时先读官网实际选项，再按字段对应的授权范围选择。已有近似档位或非关键渠道选择授权时，使用该授权完成匹配并记录所选值，无需再次要求字面一致；授权只作用于指定字段，不扩展到证书、分数、学历等事实。
教育、工作、项目和奖项数组的原顺序同时表示展示优先级；网站限制记录数量时从前向后选取。

同一奖项多次获得且每次年份都已明确时，在原奖项记录的 `values.years` 保存年份数组；后续填写转换按数组展开为多条同名奖项记录，各自写入对应年份。保留原始记录和其他字段，不根据年份猜作品或把其中一个年份覆盖掉另一个；当展示字段尾部的次数标记与 `years` 数量一致时，派生记录可移除该次数标记，避免每条记录重复显示总次数；单个 `date` 只表示一次获奖，明确的 `years` 优先用于展开。

- `["北京", "广州", "上海"]` 表示城市优先级。
- “产品”可以映射到网站的“产品类”。
- “线上、线下均可，线上优先”应先选网站最接近的线上选项。
- “AI 或互联网”可以映射到“互联网/电子商务”。

先读取网站选项，再做语义匹配。遇到明显冲突、两个差异很大的候选都可能正确，
或选择会产生用户没表达过的重要承诺时询问。

“本地保存”只说明资料存放位置。宿主云模型处理资料或向招聘官网填写时可能发生相应传输；反馈中
说明本次实际使用了哪些路径，不承诺资料永远不会上传。

## 更新资料

使用同一私有 `profile.json` 更新事实和偏好，再重新导入：

```bash
node bin/applyctl.js profile import --file <skill-root>/.local/profiles/<resume-id>/profile.json
```

任务绑定当前 `resumeMaterialId` 和完整 `profileRecordIds`。新增本科、经历或项目后，
更新任务绑定并创建新 run，让新会话读取最新资料快照。

## 导入任务

```bash
node bin/applyctl.js init
node bin/applyctl.js task import --file ~/岗位队列.csv
node bin/applyctl.js task list
```

支持 CSV、JSON 和 JSONL。CLI 输出 JSON：

- `0`：成功
- `1`：执行失败
- `2`：用法错误
