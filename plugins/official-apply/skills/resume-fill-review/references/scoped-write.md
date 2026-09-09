# 局部写入

网站脚本在 `resolve_page` 时读取服务器原始简历，生成本轮写入计划。计划只在同一个 `runId` 的当前会话中复用，不把页面 runtime 数据、Cookie 或认证 token 写入工具结果或长期记录。

## 默认补空

```json
{"tool":"apply.resolve_page","args":{"runId":"实际运行"}}
{"tool":"apply.fill_page","args":{"runId":"实际运行","writeScope":{"mode":"fill_missing"}}}
{"tool":"apply.validate_page","args":{"runId":"实际运行"}}
{"tool":"apply.advance","args":{"runId":"实际运行","actionKind":"save"}}
```

`fill_missing` 只把原始服务器字段中的 `null`、`undefined` 和空字符串补成已确认资料。`0` 和 `false` 是已有值，不能当作空值。服务器已有的非空字段、未知字段、自定义字段、附件和额外经历记录都沿用保存前基线。

## 按清单返修

先读 `resolve_page` 的 `data.writeScope.fields`。字段路径来自当前服务器简历；重复记录的路径包含身份选择器，例如：

```text
basicInfo.birthDate
educationInfo[school=%E6%B8%85%E5%8D%8E%E5%A4%A7%E5%AD%A6].startDate
career_list[company=Example].description
```

真实调用直接复用工具返回的字符串，不手工改写编码，也不使用数组下标。然后只传审查清单中明确的路径：

```json
{"tool":"apply.fill_page","args":{"runId":"实际运行","writeScope":{"mode":"repair","fields":["educationInfo[school=%E6%B8%85%E5%8D%8E%E5%A4%A7%E5%AD%A6].startDate","educationInfo[school=%E6%B8%85%E5%8D%8E%E5%A4%A7%E5%AD%A6].endDate"]}}}
{"tool":"apply.validate_page","args":{"runId":"实际运行"}}
{"tool":"apply.advance","args":{"runId":"实际运行","actionKind":"save"}}
```

返修值仍来自当前绑定的原始资料和已经确认的回答。工具不会接受要写入的新值。字段路径不存在、来源值无法生成、重复身份不能唯一配对、或保存后目标外字段变化时，填写和保存会失败并返回具体路径或记录原因。

## 保存和读回

`fill_page` 生成的保存前基线和目标路径会贯穿 `validate_page`、`advance save`、重新打开和服务器读回。保存后不能重新读取服务器再生成一份新基线来掩盖目标外变化。校验分两部分进行：原始资料到候选载荷的转换检查，以及目标字段和目标外保存前字段的服务器读回检查。

`resolve_page` 或 `fill_page` 返回的 `writeScope.planRef` 指向私有 `<dataRoot>/runs/<sourceRunId>/write-plan.json`。如果进程重启或重新打开了同一份简历，调用 `apply.open_task { "taskId": "...", "forceNewRun": true }` 创建新的 runId，再进入同一网站页面，把这个引用传给 `apply.validate_page` 或 `apply.advance { "actionKind": "save" }` 的 `writePlanPath`。工具会检查计划的任务、网站身份和 PageScript 身份，允许新的 runId 继续读回；不会自动用当前页面重建基线。计划文件权限为私有文件权限，只保留脱敏简历字段和实际写入载荷，不包含页面 runtime 数据、Cookie 或认证 token。

没有支持写入范围的其他 PageScript 或通用页面会返回 `mcp_write_scope_unsupported`，调用方应记录阻塞并转视觉操作或能力演进，不调用整页填写碰运气。
