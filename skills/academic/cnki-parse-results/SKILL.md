---
name: cnki-parse-results
description: Parse the current CNKI search results page into structured paper data. Use when Codex is already on a CNKI results page and needs 提取题名、作者、来源、日期、数据库类型、被引、下载、导出 ID，或为翻页、详情、下载、Zotero 导出复用结果。
---

# CNKI 结果页解析

从当前知网检索结果页提取结构化论文数据。此 skill 不负责发起检索；若还没有结果页，先使用 `$cnki-search` 或 `$cnki-advanced-search`。

## Codex 工具约定

- 使用 Codex Browser/in-app browser 或等价浏览器自动化工具读取当前页面。
- 优先执行 JavaScript 解析 DOM；若 DOM 变化导致空结果，再用页面快照/可访问性树兜底解析。
- 遇到腾讯滑块验证码时暂停，让用户手动完成后继续。

## 前置条件

当前浏览器页面应满足：

- URL 属于 `cnki.net`。
- 页面正文包含“条结果”。
- 页面不是验证码、登录提示或错误页。

## 解析脚本

```javascript
() => {
  const captcha = document.querySelector('#tcaptcha_transform_dy');
  if (captcha && captcha.getBoundingClientRect().top >= 0) return { error: 'captcha' };

  const rows = document.querySelectorAll('.result-table-list tbody tr');
  const checkboxes = document.querySelectorAll('.result-table-list tbody input.cbItem');
  const papers = Array.from(rows).map((row, index) => {
    const nameCell = row.querySelector('td.name');
    const titleLink = nameCell?.querySelector('a.fz14');
    const authorCell = row.querySelector('td.author');
    const sourceCell = row.querySelector('td.source');
    const dateCell = row.querySelector('td.date');
    const dataCell = row.querySelector('td.data');
    const quoteCell = row.querySelector('td.quote');
    const downloadCell = row.querySelector('td.download');

    return {
      number: index + 1,
      title: titleLink?.innerText?.trim() || '',
      url: titleLink?.href || '',
      exportId: checkboxes[index]?.value || '',
      authors: Array.from(authorCell?.querySelectorAll('a.KnowledgeNetLink') || [])
        .map((a) => a.innerText?.trim())
        .filter(Boolean),
      journal: sourceCell?.querySelector('a')?.innerText?.trim() || '',
      date: dateCell?.innerText?.trim() || '',
      database: dataCell?.innerText?.trim() || '',
      citations: quoteCell?.innerText?.trim() || '',
      downloads: downloadCell?.innerText?.trim() || '',
      isOnlineFirst: !!nameCell?.querySelector('.marktip')
    };
  });

  const totalText = document.querySelector('.pagerTitleCell')?.innerText || '';
  const totalMatch = totalText.match(/([\d,]+)/);

  return {
    papers,
    totalCount: totalMatch ? totalMatch[1] : 'unknown',
    pageInfo: document.querySelector('.countPageMark')?.innerText || ''
  };
}
```

## 输出格式

```text
当前知网结果页：共 {totalCount} 条，页码 {pageInfo}。

1. {title} {isOnlineFirst ? "[网络首发]" : ""}
   作者：{authors}
   来源：{journal} | 日期：{date} | 类型：{database}
   被引：{citations} | 下载：{downloads}
```

## 快照兜底

若脚本返回空数组，用页面快照查找重复结构：

`checkbox` → 序号 → 标题链接（URL 含 `kcms2/article/abstract`）→ 作者链接 → 来源链接 → 日期 → 数据库类型。

兜底结果中若拿不到 `exportId`，说明后续批量导出可能不可用，应提示用户只能进入详情页单篇导出。

## 稳定选择器

| 数据 | 选择器 |
| --- | --- |
| 表格行 | `.result-table-list tbody tr` |
| 导出 ID | `input.cbItem` |
| 标题 | `td.name a.fz14` |
| 作者 | `td.author a.KnowledgeNetLink` |
| 来源 | `td.source a` |
| 日期 | `td.date` |
| 数据库类型 | `td.data` |
| 被引 | `td.quote` |
| 下载 | `td.download` |
| 网络首发 | `td.name .marktip` |
| 总数 | `.pagerTitleCell` |
| 页码 | `.countPageMark` |
