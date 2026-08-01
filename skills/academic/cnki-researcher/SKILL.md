---
name: cnki-researcher
description: Orchestrate CNKI research workflows across search, advanced search, result parsing, paper detail extraction, journal search, journal indexing, issue TOC browsing, download, and Zotero export. Use proactively when Codex needs 完整知网文献调研、检索-筛选-详情-期刊级别-导出联动、或用户用自然语言提出 CNKI 研究任务。
---

# CNKI 研究编排

把多个 CNKI skill 组合成完整研究流程。此 skill 负责判断用户意图、选择子 skill、管理浏览器页面、处理验证码和登录边界。

## 可用子 skill

- `$cnki-search`：关键词检索论文。
- `$cnki-advanced-search`：按作者、题名、期刊、年份、来源类别做高级检索。
- `$cnki-parse-results`：解析当前检索结果页。
- `$cnki-navigate-pages`：翻页或排序。
- `$cnki-paper-detail`：提取论文详情、摘要、关键词、基金、分类号。
- `$cnki-journal-search`：检索期刊。
- `$cnki-journal-index`：查询期刊收录、核心、CSSCI、CSCD、SCI、EI、影响因子。
- `$cnki-journal-toc`：浏览期刊某年某期目录。
- `$cnki-download`：在用户有权限时触发 PDF/CAJ 下载。
- `$cnki-export`：导出引用、批量写入 Zotero。

## Codex 浏览器约定

- 优先使用 Codex Browser/in-app browser；如果环境提供的是 Chrome DevTools MCP 或 Playwright，也可使用等价能力。
- 进入页面优先直接导航 URL，少点链接，因为 CNKI 常打开新标签页。
- 如果必须点击导致新标签页，切换到目标标签页后继续；不要关闭用户可能还需要的标签页。
- 页面加载慢时等待关键文本或关键选择器，不要连续快速刷新。

## 验证码、登录与权限

CNKI 可能显示腾讯滑块验证码。识别到“拖动下方拼图完成验证”或 `#tcaptcha_transform_dy` 可见时：

1. 立即停止自动操作。
2. 告诉用户：`CNKI 正在显示滑块验证码，请在浏览器中手动完成验证，完成后告诉我继续。`
3. 用户确认后再继续当前步骤。

下载和全文访问必须依赖用户自己的登录与机构/个人权限。不得绕过登录、验证码、付费墙或下载限制。

## 常见工作流

### 文献检索

```text
用户：检索“生成式人工智能 教育评价”的文献
步骤：$cnki-search → $cnki-parse-results → 汇总结果
```

### 精确筛选

```text
用户：找 2020-2025 年 CSSCI 中关于数字治理的论文
步骤：$cnki-advanced-search → $cnki-parse-results → 视需要排序/翻页
```

### 论文详情

```text
用户：看第 3 篇的摘要和关键词
步骤：从结果中取第 3 篇 href → $cnki-paper-detail
```

### 期刊级别核验

```text
用户：这篇论文发表的期刊是不是核心/CSSCI？
步骤：$cnki-paper-detail 取得期刊名 → $cnki-journal-index → 汇总判断依据
```

### 期刊目录

```text
用户：查看《计算机学报》2025 年 01 期目录
步骤：$cnki-journal-search → $cnki-journal-toc
```

### Zotero 导出

```text
用户：把当前页前 10 篇加入 Zotero
步骤：确认 Zotero 已启动 → $cnki-export 批量导出 → 运行 push_to_zotero.py
```

## 输出习惯

- 默认用中文回复。
- 对检索结果使用编号列表，保留标题、作者、来源、日期、被引、下载。
- 对“是否核心/收录”类结论，明确列出页面证据和指标；需要严格年份版本时提醒进一步核验。
- 对下载/导出结果，说明已触发浏览器下载或已写入 Zotero；失败时给出可执行的下一步。
