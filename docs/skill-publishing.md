# Agent Skill 发布平台与操作指南

更新时间：2026-08-02

本文面向已经有一个可运行 Skill、准备公开分发的作者。它回答四个问题：

1. 哪些地方是真正的发布平台；
2. 各平台通过什么方式发布；
3. 怎样判断发布是否成功；
4. 更新 Skill 后，哪些平台需要手动发新版本。

平台变化很快，不存在永久固定的“全平台清单”。本文优先覆盖官方渠道、活跃的
公共目录，以及有明确作者入口的平台。

## 一、先分清四种状态

| 状态 | 含义 | 可以对外说“已发布”吗 |
|---|---|---|
| 公开可见 | 有公开详情页，未登录也能打开 | 可以 |
| 已提交待审核 | 平台已返回提交记录，但目录中还没有公开详情页 | 不可以，只能说“已提交” |
| 已被索引 | 平台从 GitHub 或安装记录抓取到了 Skill | 可以说“已被该目录索引” |
| 仅准备材料 | 仓库、压缩包或表单内容已经准备好，但尚未提交 | 不可以 |

验收时不要只看“提交成功”的提示。至少再做一次未登录访问，或调用平台的查询
命令，确认公开条目、版本和安全状态。

## 二、推荐发布顺序

按下面的顺序处理，能减少重复填表和版本混乱：

1. **GitHub**：唯一源代码事实源。
2. **Claude Plugin Directory**：Claude Code 与 Claude Cowork 的官方审核渠道。
3. **ClawHub**：OpenClaw 的官方公共注册表，也可被 Hermes Agent 搜索和安装。
4. **AgentSkill.sh**：从 GitHub 直接导入，覆盖多种 Agent。
5. **skills.sh**：通过 `skills` CLI 的安装记录进入公共索引。
6. **OpenAI Plugins**：身份验证通过后提交 ChatGPT/Codex 相关 Skill。
7. **其他目录**：按受众和维护成本选择，不必为了数量创建大量无人维护的账号。

这里的关键判断是：**GitHub 管源码，注册表管发现和版本，官方目录管审核与信任。**
不要把某个聚合站当成唯一文件存储位置。

## 三、发布前准备

### 1. 最小目录

单 Skill 仓库：

```text
my-skill/
├── SKILL.md
├── README.md
├── LICENSE
├── scripts/       # 可选
├── references/    # 可选
└── assets/        # 可选
```

多 Skill 或 Claude 插件仓库：

```text
my-marketplace/
├── .claude-plugin/
│   └── marketplace.json
└── skills/
    └── my-skill/
        ├── .claude-plugin/
        │   └── plugin.json
        └── SKILL.md
```

不同平台查找 `SKILL.md` 的深度不同。最稳妥的做法是：

- 单 Skill 仓库把 `SKILL.md` 放在仓库根目录；
- 多 Skill 仓库在提交时提供包含该 Skill 的 GitHub 子目录链接；
- 不把开发报告、内部返修记录和临时输出打进发布包。

### 2. 必查内容

- `SKILL.md` 的 `name` 使用稳定的 `kebab-case` 名称。
- `description` 同时说明“做什么”和“什么时候触发”。
- README 提供自然语言快速开始，不依赖作者电脑上的绝对路径。
- 有明确许可证；脚本和引用材料的许可证不互相冲突。
- 仓库不包含 API Key、Cookie、个人路径、未授权论文或其他私有材料。
- 运行本地测试、打包检查和依赖安全检查。
- 对外版本使用语义化版本，例如 `1.2.0`，不要使用开发中的 `v85` 一类名字。

### 3. GitHub Release 是否必须

通常**不必须**。

- GitHub、AgentSkill.sh 和 skills.sh 直接读取仓库。
- Claude 官方目录读取插件信息并走审核。
- ClawHub 自己保存语义化版本。
- 只有平台明确要求压缩包、固定版本归档或 Release URL 时，才创建 GitHub
  Release。

## 四、核心发布渠道

### 1. GitHub

**发布方式**：公开仓库。

```bash
git add <本次文件>
git commit -m "release: prepare skill 1.0.0"
git push origin main
```

随后设置：

- 中文或英文仓库简介；
- `agent-skill`、`agent-skills`、`claude-code`、`codex` 等相关 Topics；
- README、许可证和稳定安装命令；
- 如需固定快照，再创建 tag 或 GitHub Release。

**验收**：

```bash
gh repo view OWNER/REPO \
  --json url,description,repositoryTopics,isPrivate
```

确认 `isPrivate` 为 `false`，README 中的相对链接和图片可以从 GitHub 打开。

### 2. Claude Plugin Directory

**入口**：<https://platform.claude.com/plugins/submissions>

这是 Claude Code 与 Claude Cowork 的官方插件目录提交通道。提交前准备：

- `.claude-plugin/plugin.json`；
- 多插件仓库再提供 `.claude-plugin/marketplace.json`；
- 公开仓库、简介、作者、许可证和图标；
- 插件名称与仓库中的实际路径一致。

操作：

1. 登录 Claude Console。
2. 打开 `Plugin submissions`。
3. 选择 `New submission`。
4. 阅读并接受目录条款。
5. 填写插件信息和提交说明。
6. 提交后回到列表检查状态。

**验收**：

- `Submitted and pending review` 只表示已提交；
- 只有目录中出现公开详情页，才算正式上架；
- 提交不保证被收录，审核期间不要反复创建同名提交。

官方插件说明：

- <https://code.claude.com/docs/en/plugins>
- <https://code.claude.com/docs/en/plugin-marketplaces>
- <https://code.claude.com/docs/en/plugins-reference>

### 3. ClawHub

**入口**：<https://clawhub.ai>

**发布方式**：官方 CLI，支持版本、变更说明和安全扫描。

```bash
npm install -g clawhub
clawhub login
clawhub whoami

clawhub skill publish ./my-skill \
  --slug my-skill \
  --name "My Skill" \
  --version 1.0.0 \
  --changelog "Initial release"
```

先试运行或发布后检查：

```bash
clawhub inspect my-skill --json
```

**验收**：

- `latestVersion.version` 是刚发布的版本；
- `moderation.verdict` 为 `clean`；
- `https://clawhub.ai/<作者>/skills/<slug>` 未登录可访问。

注意：ClawHub 上发布的 Skill 使用平台规定的 `MIT-0` 分发条件。发布前确认这与
你的授权预期一致。

官方文档：

- <https://docs.openclaw.ai/tools/clawdhub>
- <https://github.com/openclaw/clawhub/blob/main/docs/cli.md>

### 4. AgentSkill.sh

**入口**：<https://agentskill.sh/submit>

**发布方式**：粘贴 GitHub 仓库或 `SKILL.md` 的直接地址。

1. 选择 `GitHub Repository`。
2. 输入 `https://github.com/OWNER/REPO`。
3. 点击 `Analyze & Import`。
4. 检查扫描到的 Skill 数量和导入数量。

一个仓库中有多个 `SKILL.md` 时，平台会扫描并分别导入。默认每天同步一次。
需要即时同步时，可在 GitHub 仓库设置 push webhook：

```text
https://agentskill.sh/api/webhooks/github
```

**验收**：

```text
https://agentskill.sh/@<作者>/<skill-name>
```

公开页能打开才算成功。GitHub 账号连接只用于所有权徽章和分析，不是基础导入的
必要条件。

### 5. skills.sh

**入口**：<https://skills.sh>

skills.sh 没有普通作者上传表单。它由 `skills` CLI 的匿名安装记录驱动索引和
排行。先确保 GitHub 仓库可安装，再至少运行一次：

```bash
npx skills add https://github.com/OWNER/REPO --skill my-skill
```

公开详情页通常为：

```text
https://skills.sh/OWNER/REPO/my-skill
```

README 徽章：

```markdown
[![skills.sh](https://skills.sh/b/OWNER/REPO)](https://skills.sh/OWNER/REPO)
```

**验收**：详情页出现 Skill 名称、仓库和安装命令。不要把“加了徽章”当作已被
索引。

官方说明：<https://skills.sh/docs>

### 6. OpenAI Plugins

**入口**：<https://platform.openai.com/plugins>

操作顺序：

1. 在组织设置中完成个人或企业身份验证。
2. 等待状态从 `Identity in review` 变为通过。
3. 回到 Plugins 页面，选择 `Create plugin`。
4. 纯 Skill 选择 `Skills only`。
5. 提交插件包和目录信息。
6. 在插件页面检查是否产生提交记录。

`Identity in review` 是**身份审核**，不是 Skill 内容审核。Plugins 页面只有
`Create plugin`、没有提交条目时，不能说 Skill 已经提交。

## 五、其他活跃目录

这些渠道可以增加曝光，但维护价值通常低于核心渠道。

| 平台 | 发布方式 | 验收方式 | 备注 |
|---|---|---|---|
| [SkillsMD](https://skillsmd.dev/) | 首页 `Submit Skill`，填写 `owner/repo`、Skill 名和简介；邮箱可不填 | 保存提交 ID，等待公开条目 | 审核制 |
| [Awesome Skills](https://www.awesomeskills.dev/en/submit) | 粘贴公开 GitHub URL | 公开详情页 | 提交时可能要求 Turnstile 验证 |
| [verified-skill](https://verified-skill.com/submit) | GitHub 登录后提交仓库，自动做静态和意图扫描 | 查看验证分数和公开页 | 会创建 GitHub OAuth 授权 |
| [skills-hub.ai](https://skills-hub.ai/publish) | 登录后通过网页或 CLI 发布 | 用户名下的版本页 | 会创建账号或 GitHub OAuth 授权 |
| [SkillMD.com](https://skillmd.com/publish) | 登录后上传单个 `SKILL.md` 或 ZIP | `My skills` 和公开页 | 不是 GitHub 自动同步 |
| [SkillMD.ai](https://skillmd.ai/submit/) | 邮箱创建账号，提交正文、ZIP 或 GitHub URL | 作者后台和公开页 | 会向邮箱发送登录信息 |
| [mdskills.ai](https://www.mdskills.ai/submit) | GitHub、Google 或邮箱登录后提交 | 公开目录页 | 登录后才能看到完整表单 |
| [SkillHub](https://useskillhub.com/publish) | 申请 publisher 权限，准备 `skillhub.json`，预检后按版本送审 | publisher 工作区中的审核状态 | 流程较重，适合需要调用权限和运行记录的 Skill |
| [PolySkill](https://polyskill.ai/) | 注册 agent 获取 API Key，再向 `/api/skills` 发布 manifest | REST 查询 `@author/skill` | Alpha；API Key 只显示一次 |
| [SkillRegistry](https://skillregistry.io/upload) | 登录后上传，等待审核 | 目录公开页 | 需要账号 |
| [ColdIQ Skills](https://coldiq.com/skills/submit) | 填仓库、分类、作者名和邮箱 | 邮件和目录页 | 受众偏销售与增长 |

需要 GitHub OAuth、API Key、邮箱或新账号的平台，应该由作者明确决定是否授权。
不要为了“多一个平台”把长期凭据散落在多个网站。

## 六、不应误判为独立公共发布的平台

### Hermes Agent

Hermes 可以从 GitHub、skills.sh、ClawHub 和 Claude marketplace 风格仓库安装
Skill。普通社区 Skill 发布到 ClawHub 或公开 GitHub 后，Hermes 已经可以使用。

只有想进入 Hermes 随安装附带的官方或可选 Skill 集时，才需要向 Hermes 仓库
贡献代码并走 PR。它不是每个 Skill 都必须重复提交的独立商店。

官方说明：

- <https://hermes-agent.ai/features/skill-marketplace>
- <https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/skills.md>

### agentregistry

[agentregistry](https://aregistry.ai/docs/skills/publish/) 是可自托管的团队注册表，
适合公司内部审批、版本和部署，不是一个统一的公共消费市场。`arctl skill
publish` 默认发布到你运行的 registry 实例。

### 自动抓取目录

SkillsMP、部分 Claude marketplace 聚合站会抓取公开 GitHub 仓库。它们没有可靠
的作者提交状态。可以检查是否被抓取，但不要把“可能会自动出现”写成发布完成。

### 当前不可用的入口

- OmniSkill Registry 在 2026-08-02 实测列表接口和提交接口均报网络/JSON 错误，
  暂时无法验收发布。
- skillsdir.dev 的提交链接指向已不存在的 GitHub 仓库，暂时不作为有效渠道。

## 七、更新版本时怎么做

1. 先更新 GitHub 源码并推送。
2. 运行测试，记录新版本号和变更说明。
3. ClawHub 手动发布新的语义化版本。
4. Claude/OpenAI 已上架时，按各自后台提交更新。
5. AgentSkill.sh 等待每日同步，或重新导入/配置 webhook。
6. skills.sh 在新版本被安装后更新索引快照。
7. 审核型目录只在内容确实变化时提交新版本，不为 README 标点反复送审。

## 八、发布完成检查表

```text
[ ] GitHub 仓库公开，README、LICENSE 和图片可访问
[ ] SKILL.md 路径能被目标平台识别
[ ] 安装命令在干净目录中跑通
[ ] 没有密钥、个人路径、私有材料和开发内部名
[ ] 官方目录状态已区分“待审核”和“已上架”
[ ] ClawHub 版本正确，安全状态为 clean
[ ] AgentSkill.sh 公开详情页可访问
[ ] skills.sh 详情页可访问
[ ] 每个平台的公开 URL、版本和提交 ID 已记录
```

## 九、当前两个示例 Skill 的发布状态

核验时间：2026-08-02。

| 平台 | Academic PDF Translation | Fruit Picker |
|---|---|---|
| GitHub | [公开仓库](https://github.com/Ezra-Y/academic-pdf-translation) | [公开仓库](https://github.com/Ezra-Y/fruit-picker) |
| Claude Plugin Directory | 已提交，等待审核 | 已提交，等待审核 |
| ClawHub | [1.1.0，clean](https://clawhub.ai/ezra-y/skills/academic-pdf-translation) | [1.0.2，clean](https://clawhub.ai/ezra-y/skills/fruit-picker) |
| AgentSkill.sh | [公开可见](https://agentskill.sh/@ezra-y/academic-pdf-translation) | [公开可见](https://agentskill.sh/@ezra-y/fruit-picker) |
| skills.sh | [已索引](https://skills.sh/ezra-y/academic-pdf-translation/academic-pdf-translation) | [已索引](https://skills.sh/ezra-y/fruit-picker/fruit-picker) |
| SkillsMD | 已提交，ID `9efd5916` | 已提交，ID `60b35dc8` |
| OpenAI | 身份审核中，Skill 尚未提交 | 身份审核中，Skill 尚未提交 |

这张表记录的是核验时的事实状态。目录审核通过后，应把“已提交”更新为公开
链接；不能只改文字而不验证链接。
