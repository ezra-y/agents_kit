---
name: cnki-advanced-search
description: Perform advanced CNKI searches with field filters such as subject, title, keyword, author, journal, year range, and source category (SCI/EI/CSSCI/北大核心/CSCD). Use when Codex needs 精确筛选知网文献、限定作者/期刊/年份/来源类别，或普通关键词检索不够准确。
---

# CNKI 高级检索

使用知网旧版高级检索页执行字段化查询。该页面仍提供来源类别复选框，适合筛选 `SCI`、`EI`、`CSSCI`、`北大核心`、`CSCD` 等来源。

## Codex 工具约定

- 优先使用 Codex Browser/in-app browser；也可使用等价的 Chrome DevTools MCP 浏览器工具。
- 将“导航”映射为打开 URL；将“执行脚本”映射为在当前页面运行 JavaScript。
- 遇到验证码、登录页、权限限制时，暂停并让用户手动处理。

## 输入解析

从用户自然语言中提取：

- 主题词、篇名词、关键词：默认用主题 `SU`，明确说“篇名/标题”时用 `TI`，明确说“关键词”时用 `KY`。
- 作者：填入 `#au_1_value1`。
- 期刊/来源：填入 `#magazine_value1`。
- 年份范围：填入起止年份。
- 来源类别：仅使用 `SCI`、`EI`、`hx`、`CSSCI`、`CSCD`；其中 `hx` 表示北大核心。

## 流程

1. 打开 `https://kns.cnki.net/kns/AdvSearch?classid=7NS01R8M`。
2. 将脚本顶部配置改为用户条件后执行。
3. 若搜索成功，再调用 `$cnki-parse-results` 或直接读取当前结果页。

```javascript
async () => {
  const query = "KEYWORDS";
  const fieldType = "SU";        // SU=主题, TI=篇名, KY=关键词, TKA=篇关摘, AB=摘要
  const query2 = "";
  const fieldType2 = "KY";
  const rowLogic = "AND";        // AND=并且, OR=或者, NOT=不含
  const sourceTypes = ["CSSCI"]; // SCI, EI, hx, CSSCI, CSCD
  const startYear = "";
  const endYear = "";
  const author = "";
  const journal = "";

  await new Promise((resolve, reject) => {
    let tries = 0;
    const check = () => {
      if (document.querySelector('#txt_1_value1')) resolve();
      else if (++tries > 30) reject(new Error('timeout: advanced form'));
      else setTimeout(check, 500);
    };
    check();
  });

  const captcha = document.querySelector('#tcaptcha_transform_dy');
  if (captcha && captcha.getBoundingClientRect().top >= 0) return { error: 'captcha' };

  const selects = Array.from(document.querySelectorAll('select')).filter((select) => select.offsetParent !== null);

  if (sourceTypes.length > 0) {
    const all = document.querySelector('#gjAll');
    if (all && all.checked) all.click();
    for (const type of sourceTypes) {
      const checkbox = document.querySelector('#' + type);
      if (checkbox && !checkbox.checked) checkbox.click();
    }
  }

  selects[0].value = fieldType;
  selects[0].dispatchEvent(new Event('change', { bubbles: true }));
  const input = document.querySelector('#txt_1_value1');
  input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true }));

  if (query2) {
    selects[5].value = rowLogic;
    selects[5].dispatchEvent(new Event('change', { bubbles: true }));
    selects[6].value = fieldType2;
    selects[6].dispatchEvent(new Event('change', { bubbles: true }));
    const input2 = document.querySelector('#txt_2_value1');
    input2.value = query2;
    input2.dispatchEvent(new Event('input', { bubbles: true }));
  }

  if (author) {
    const authorInput = document.querySelector('#au_1_value1');
    if (authorInput) {
      authorInput.value = author;
      authorInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  if (journal) {
    const journalInput = document.querySelector('#magazine_value1');
    if (journalInput) {
      journalInput.value = journal;
      journalInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  if (startYear) {
    selects[14].value = startYear;
    selects[14].dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (endYear) {
    selects[15].value = endYear;
    selects[15].dispatchEvent(new Event('change', { bubbles: true }));
  }

  document.querySelector('div.search')?.click();

  await new Promise((resolve, reject) => {
    let tries = 0;
    const check = () => {
      if (document.body.innerText.includes('条结果')) resolve();
      else if (++tries > 40) reject(new Error('timeout: results'));
      else setTimeout(check, 500);
    };
    setTimeout(check, 2000);
  });

  const captchaAfterSearch = document.querySelector('#tcaptcha_transform_dy');
  if (captchaAfterSearch && captchaAfterSearch.getBoundingClientRect().top >= 0) return { error: 'captcha' };

  return {
    query,
    fieldType,
    query2,
    fieldType2,
    rowLogic,
    sourceTypes,
    startYear,
    endYear,
    author,
    journal,
    total: document.querySelector('.pagerTitleCell')?.innerText?.match(/([\d,]+)/)?.[1] || '0',
    page: document.querySelector('.countPageMark')?.innerText || '1/1',
    url: location.href
  };
}
```

## 汇报

```text
高级检索完成：{query}（字段：{fieldType}，来源：{sourceTypes}）
共 {total} 条结果，当前页 {page}。
```

## 稳定选择器

| 字段 | 选择器 |
| --- | --- |
| 第一行字段类型 | `selects[0]` |
| 第一行关键词 | `#txt_1_value1` |
| 行间逻辑 | `selects[5]` |
| 第二行字段类型 | `selects[6]` |
| 第二行关键词 | `#txt_2_value1` |
| 作者 | `#au_1_value1` |
| 文献来源 | `#magazine_value1` |
| 起止年份 | `selects[14]` / `selects[15]` |
| 全部期刊 | `#gjAll` |
| SCI/EI/北大核心/CSSCI/CSCD | `#SCI` / `#EI` / `#hx` / `#CSSCI` / `#CSCD` |
| 检索按钮 | `div.search` |

旧版地址 `kns.cnki.net/kns/AdvSearch` 是关键；新版 `kns8s/AdvSearch` 通常没有完整来源类别复选框。
