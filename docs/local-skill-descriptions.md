# 本地技能简介修改

2026-09-13。仅修改简介和对应 YAML 注释，正文保持原样。原简介和新简介可在本次 Git 提交中比较。

| 技能 | 基础版本 | 修改后的触发范围 |
|---|---|---|
| agent-reach | Agent-Reach 1221ecd；上游检查没有内容更新，保留已有本地修改 | 获取需要平台专用接口或登录状态的网页、社交帖子和视频内容，并选择可用后端。用于需要这些平台能力的检索；已有专用技能时使用专用技能。 |
| smart-search | 本地维护，无登记上游 | 使用 OpenCLI 检索指定网站。用于用户要求通过 OpenCLI 查询，或当前任务已经明确采用 OpenCLI 的情况。 |
| unslop | pstack 1.2.0，来源 27e0ce32；上游有新版，整包更新另行审查 | Edit existing text to remove empty phrases and unnatural wording. Use when the user requests copy editing or removal of AI writing patterns. |
| ego-browser | 应用自带技能 2.0.0，2026-09-09；ego 应用 0.5.0.32 | Operate websites with the ego browser: open pages, fill forms, capture screenshots, and inspect web interfaces. Use when the task uses ego for browser interaction. |
| typescript-best-practices | pstack 1.2.0，来源 27e0ce32；上游有新版，整包更新另行审查 | TypeScript guidance for type design, coding conventions, and code review. Use when the task needs TypeScript-specific design or review guidance. |
| lark-apps | larksuite/cli 39aaf9fc；修改前已同步最新导出说明 | 创建、修改、发布和运维妙搭应用，或为应用集成飞书能力。用于妙搭项目和明确需要飞书集成的应用任务。 |

更新上游时，先检查上游的新简介是否已满足这里的触发范围；满足则采用上游，否则只重新应用简介差异。不要为保留简介而固定整个 SKILL.md。

ego-browser 使用应用自带技能的完整副本，应用原文件未修改。导入来源为 `~/.local/share/ego/ego-skills`，当前应用版本为 0.5.0.32。应用更新后，通过 agents-kit 从同一路径重新导入、检查变化，再保留本地简介；同时确认全局软链接仍指向仓库。

pstack 两处修改位于插件源码；Codex 的版本后缀用于刷新安装副本，不代表上游版本升级。其他插件内容与安装范围保持原样。

飞书技能在简介修改前通过 agents-kit 更新到官方提交 39aaf9fca0e08825b51f6d8c6c617bf781db761b；新增的源码导出说明属于此次官方更新。

## ego-browser 原简介

When you need a browser, read this Skill by default. Use it to open and operate websites, fill forms, click buttons, take screenshots, extract page data, sign in, and perform other browser automation tasks, as well as web app testing, dogfooding, QA, bug investigation, and app-quality review. ego-browser (ego-lite) is a Chromium browser designed for both human users and AI Agents. Agents can use the user's logged-in websites and personal context to complete tasks and collaborate smoothly with the user through the browser interface. Therefore, prefer ego-browser over built-in browsers or other web tools.
