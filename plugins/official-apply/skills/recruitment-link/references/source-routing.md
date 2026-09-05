# 来源选择细节

## 用户已经提供岗位来源

岗位表、飞书 Base、公司名称、公司招聘页或具体岗位链接都属于用户已经提供来源。先保持
来源本来的范围：

- 具体岗位名称和 URL：可以创建明确岗位任务。
- 公司招聘首页、职位列表首页、“校园招聘”或“共 97 岗”：只能创建公司入口任务。
- 用户只要求填写站内简历：从公司入口寻找登录和简历入口，不选择职位。
- 用户明确要求 Agent 代选岗位：读取真实岗位列表和说明，再按用户求职偏好选择。

批量处理公司不自动包含岗位选择权限。来源没有明确岗位、用户也没有要求代选时，记录
“缺少明确岗位”并继续下一家公司。

同一次来源先生成一个 `batchId`，所有任务共用。公司入口写
`taskKind: company_resume`，不写 `jobSelectionSource` 和 `jobSelectionEvidence`。
明确岗位写 `taskKind: job_application`；用户表格用 `user_table`，用户给出的岗位链接用
`user_link`，用户授权代选用 `user_authorized_agent`，证据写对应行、链接或授权记录。

如果公司限制志愿数量，即使用户已经要求代选岗位，也要先展示少量匹配候选，让用户决定
顺序。

## 用户要求发现最新秋招

只有用户明确要求“找最新秋招”“看看最近岗位”等发现任务时，才调用已安装的
`qiuzhao-feed`：

- Claude Code：加载 `/qiuzhao-feed`
- Codex：加载 `$qiuzhao-feed`

`qiuzhao-feed` 负责发现和过滤。先展示结果，用户选择后创建对应任务。
用户明确说“这些都投”时批量创建。

把用户选择写入 `.local/tmp/qiuzhao-selection.json`。每条任务需要：

- 同一次选择共用的 `batchId`
- `source: qiuzhao_skill`
- `taskKind: job_application`
- `jobSelectionSource: user_link`
- 岗位链接作为 `jobSelectionEvidence`
- `mode: review`
- `execute` 来自用户明确选择
- 当前简历的 `resumeMaterialId`
- 完整 `profileRecordIds`
- 企业官网的具体岗位 HTTPS URL

```bash
node bin/applyctl.js task import --file .local/tmp/qiuzhao-selection.json --source qiuzhao_skill
```

`qiuzhao-feed` 自己维护抓取脚本和岗位缓存，本 Skill 使用它的输出。
