---
name: cnki-navigate-pages
description: Navigate CNKI search result pages or change sorting order. Use when Codex needs 知网结果翻页、跳到指定页、上一页/下一页、按发表时间/被引/下载/相关度/综合排序，并继续解析新的结果页。
---

# CNKI 结果翻页与排序

在当前知网检索结果页执行翻页或排序操作。操作后通常继续使用 `$cnki-parse-results` 读取新页面结果。

## Codex 工具约定

- 使用 Codex Browser/in-app browser 或等价浏览器自动化工具在当前页面执行 JavaScript。
- 不需要重新导航，除非当前页不是知网结果页。
- 遇到验证码时暂停，让用户在浏览器中手动完成。

## 输入

从用户请求中识别：

- 翻页：`next`、`previous`、`page N`、`第 N 页`。
- 排序：发表时间、被引、下载、相关度、综合。

## 翻页脚本

把 `ACTION_HERE` 替换为 `"next"`、`"previous"` 或 `"page 3"`。

```javascript
async () => {
  const captcha = document.querySelector('#tcaptcha_transform_dy');
  if (captcha && captcha.getBoundingClientRect().top >= 0) return { error: 'captcha' };

  const action = "ACTION_HERE";
  const pageLinks = document.querySelectorAll('.pages a');
  const previousPageMark = document.querySelector('.countPageMark')?.innerText;

  if (action === 'next') {
    const next = Array.from(pageLinks).find((a) => a.innerText.trim() === '下一页');
    if (!next) return { error: 'no_next_page' };
    next.click();
  } else if (action === 'previous') {
    const previous = Array.from(pageLinks).find((a) => a.innerText.trim() === '上一页');
    if (!previous) return { error: 'no_previous_page' };
    previous.click();
  } else {
    const pageNumber = action.replace(/\D/g, '');
    const target = Array.from(pageLinks).find((a) => a.innerText.trim() === pageNumber);
    if (!target) {
      return {
        error: 'page_not_found',
        available: Array.from(pageLinks).map((a) => a.innerText.trim()).filter(Boolean)
      };
    }
    target.click();
  }

  await new Promise((resolve, reject) => {
    let tries = 0;
    const check = () => {
      const currentPageMark = document.querySelector('.countPageMark')?.innerText;
      if (currentPageMark && currentPageMark !== previousPageMark) resolve();
      else if (++tries > 30) reject(new Error('timeout: page change'));
      else setTimeout(check, 500);
    };
    setTimeout(check, 1000);
  });

  const captchaAfterAction = document.querySelector('#tcaptcha_transform_dy');
  if (captchaAfterAction && captchaAfterAction.getBoundingClientRect().top >= 0) return { error: 'captcha' };

  return {
    action,
    total: document.querySelector('.pagerTitleCell')?.innerText?.match(/([\d,]+)/)?.[1] || '0',
    page: document.querySelector('.countPageMark')?.innerText || '?',
    url: location.href
  };
}
```

## 排序脚本

把 `SORT_HERE` 替换为 `"relevance"`、`"date"`、`"citations"`、`"downloads"` 或 `"comprehensive"`。

```javascript
async () => {
  const captcha = document.querySelector('#tcaptcha_transform_dy');
  if (captcha && captcha.getBoundingClientRect().top >= 0) return { error: 'captcha' };

  const sortBy = "SORT_HERE";
  const idMap = {
    relevance: 'FFD',
    date: 'PT',
    citations: 'CF',
    downloads: 'DFR',
    comprehensive: 'ZH'
  };

  const liId = idMap[sortBy];
  if (!liId) return { error: 'invalid_sort', valid: Object.keys(idMap) };

  const option = document.querySelector('#orderList li#' + liId);
  if (!option) return { error: 'sort_option_not_found' };

  const previousPageMark = document.querySelector('.countPageMark')?.innerText;
  option.click();

  await new Promise((resolve, reject) => {
    let tries = 0;
    const check = () => {
      const currentPageMark = document.querySelector('.countPageMark')?.innerText;
      if (currentPageMark && currentPageMark !== previousPageMark) resolve();
      else if (++tries > 30) reject(new Error('timeout: sort'));
      else setTimeout(check, 500);
    };
    setTimeout(check, 1000);
  });

  return {
    sortBy,
    total: document.querySelector('.pagerTitleCell')?.innerText?.match(/([\d,]+)/)?.[1] || '0',
    page: document.querySelector('.countPageMark')?.innerText || '?',
    activeSort: document.querySelector('#orderList li.cur')?.innerText?.trim(),
    url: location.href
  };
}
```

## 汇报

```text
已切换：{action 或 sortBy}
当前页：{page}，总结果：{total}。
```

## 稳定选择器

| 数据 | 选择器 |
| --- | --- |
| 页码链接 | `.pages a` |
| 当前页 | `.pages a.cur` |
| 页码计数 | `.countPageMark` |
| 排序列表 | `#orderList li` |
| 相关度 | `li#FFD` |
| 发表时间 | `li#PT` |
| 被引 | `li#CF` |
| 下载 | `li#DFR` |
| 综合 | `li#ZH` |
| 当前排序 | `#orderList li.cur` |
