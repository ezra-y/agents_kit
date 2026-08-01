---
name: cnki-search
description: Search CNKI (中国知网) papers by keyword and return structured paper results. Use when Codex needs 检索知网论文、按主题找文献、获取题名/作者/来源/日期/被引/下载量，或为后续下载、详情页解析、Zotero 导出准备结果。
---

# CNKI 关键词检索

按关键词打开知网检索页，提交查询，并从结果页提取结构化论文列表。

## Codex 工具约定

- 优先使用 Codex Desktop 的 Browser/in-app browser 浏览器自动化能力；若当前环境只提供 Chrome DevTools MCP，也可使用同等的 `navigate_page`、`evaluate_script`、`take_snapshot` 能力。
- 将“导航”理解为在浏览器中打开指定 URL；将“执行脚本”理解为在当前页面运行 JavaScript 并读取返回值。
- 若没有可用浏览器工具，不要编造结果；提示用户启用 Browser 插件或提供可访问的浏览器自动化工具。
- CNKI 登录、下载权限、验证码都必须由用户手动处理；不得尝试绕过验证码或付费限制。

## 输入

从用户请求中提取中文或英文关键词。若用户给出多个主题，优先组合为一个简洁查询词；若需要字段过滤，改用 `$cnki-advanced-search`。

## 流程

1. 打开 `https://kns.cnki.net/kns8s/search`。
2. 在页面执行下方脚本，把 `YOUR_KEYWORDS` 替换为实际关键词。
3. 若返回 `error: "captcha"`，暂停并让用户在浏览器中手动完成验证。
4. 用编号列表汇报结果，并保留每条结果的 `href` 和 `exportId` 供详情、下载或导出使用。

```javascript
async () => {
  const query = "YOUR_KEYWORDS";

  await new Promise((resolve, reject) => {
    let tries = 0;
    const check = () => {
      if (document.querySelector('input.search-input')) resolve();
      else if (++tries > 30) reject(new Error('timeout: search input'));
      else setTimeout(check, 500);
    };
    check();
  });

  const captcha = document.querySelector('#tcaptcha_transform_dy');
  if (captcha && captcha.getBoundingClientRect().top >= 0) return { error: 'captcha' };

  const input = document.querySelector('input.search-input');
  input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('input.search-btn')?.click();

  await new Promise((resolve, reject) => {
    let tries = 0;
    const check = () => {
      if (document.body.innerText.includes('条结果')) resolve();
      else if (++tries > 30) reject(new Error('timeout: results'));
      else setTimeout(check, 500);
    };
    check();
  });

  const captchaAfterSearch = document.querySelector('#tcaptcha_transform_dy');
  if (captchaAfterSearch && captchaAfterSearch.getBoundingClientRect().top >= 0) return { error: 'captcha' };

  const rows = document.querySelectorAll('.result-table-list tbody tr');
  const checkboxes = document.querySelectorAll('.result-table-list tbody input.cbItem');
  const results = Array.from(rows).map((row, index) => {
    const titleLink = row.querySelector('td.name a.fz14');
    const authors = Array.from(row.querySelectorAll('td.author a.KnowledgeNetLink') || [])
      .map((a) => a.innerText?.trim())
      .filter(Boolean);
    return {
      n: index + 1,
      title: titleLink?.innerText?.trim() || '',
      href: titleLink?.href || '',
      exportId: checkboxes[index]?.value || '',
      authors: authors.join('; '),
      journal: row.querySelector('td.source a')?.innerText?.trim() || '',
      date: row.querySelector('td.date')?.innerText?.trim() || '',
      citations: row.querySelector('td.quote')?.innerText?.trim() || '',
      downloads: row.querySelector('td.download')?.innerText?.trim() || ''
    };
  });

  return {
    query,
    total: document.querySelector('.pagerTitleCell')?.innerText?.match(/([\d,]+)/)?.[1] || '0',
    page: document.querySelector('.countPageMark')?.innerText || '1/1',
    results
  };
}
```

## 输出格式

```text
知网检索“{query}”：共 {total} 条结果，当前页 {page}。

1. {title}
   作者：{authors}
   来源：{journal} | 日期：{date}
   被引：{citations} | 下载：{downloads}
```

用户要打开某篇论文时，直接导航到该条结果的 `href`，不要点击结果页链接，因为知网常会打开新标签页。

## 稳定选择器

| 数据 | 选择器 |
| --- | --- |
| 搜索框 | `input.search-input` |
| 搜索按钮 | `input.search-btn` |
| 总数 | `.pagerTitleCell` |
| 页码 | `.countPageMark` |
| 结果行 | `.result-table-list tbody tr` |
| 标题链接 | `td.name a.fz14` |
| 作者 | `td.author a.KnowledgeNetLink` |
| 来源 | `td.source a` |
| 日期 | `td.date` |
| 被引 | `td.quote` |
| 下载 | `td.download` |
| 导出 ID | `.result-table-list tbody input.cbItem` |
