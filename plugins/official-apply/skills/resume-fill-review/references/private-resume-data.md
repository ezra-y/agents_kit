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

先读取任务绑定的材料、`profile_records` 和已确认答案，再结合当前任务和
`knowledge/field-catalog.yaml` 找缺项。不要把答案表当成全部私有资料。把本批适用的必填项和常见项
集中问一次。除婚姻状况、驾照等目录字段外，真实批次还可能需要学院、成绩排名、部门和任职性质、面试方式、英语
证书或成绩、是否接受调剂或调动、微信、身高等类别。只询问当前任务适用的内容，不要求用户提供
无关敏感信息。`site.custom.*` 只有字段编号时不猜含义，等读取真实表单后再问。

技能等级只记录用户明确给出的程度，不把技能名或项目经历自动换成“精通”。技能可以保存为字符串，或 `{ "name": "技能名", "level": "已确认的等级" }`。学习形式也只复用有明确来源的记录。

事实与职业偏好分开保存。长期事实和偏好使用合适的全局范围；公司特殊问题使用 company 范围，
岗位特殊问题使用 job 范围，单次申请问题使用 application 范围。

还没有 `runId` 时，只把 `src/materials/import-profile.ts` 已支持的通用资料和偏好写入现有
`profile.json`，再运行 `node bin/applyctl.js profile import --file <profile.json>`。当前支持的类别
包括身份和联系资料、婚姻与驾照、地区、英语、目标城市和岗位、面试方式、调剂或调动偏好、作品链接。
微信使用 `basic.wechat`，身高厘米数使用 `basic.heightCm`。学院和成绩等履历内容写回对应教育记录。
`site.custom.*` 只有字段编号时不假装已经保存。

已有 `runId` 且真实表单问到字段时，才使用 `apply.save_answers`，每条回答带上正确 scope。已有
已确认答案不重问。陌生必填问题先记为阻断，与同批问题集中询问；得到答案后保存并复用。具体网站
仍可能出现新的必填问题。

## 私有答案表示含义

私有资料保存事实、偏好、可接受范围和优先级。填写时根据当前网站选项做语义匹配。
教育、工作、项目和奖项数组的原顺序同时表示展示优先级；网站限制记录数量时从前向后选取。

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
