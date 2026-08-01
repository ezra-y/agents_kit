---
name: cnki-journal-search
description: Search CNKI journal navigation by journal name, ISSN, CN number, or sponsor and return structured journal candidates. Use when Codex needs 查找知网期刊、确认 ISSN/CN、获取影响因子、主办单位、被引/下载数据，或为收录查询和期刊目录浏览定位期刊详情页。
---

# CNKI 期刊检索

在知网期刊导航中按刊名、ISSN、CN 号或主办单位检索期刊，并返回候选列表。

## Codex 工具约定

- 优先使用 Codex Browser/in-app browser；也可使用等价浏览器自动化工具。
- 期刊详情页常打开新标签页；若浏览器工具支持标签页管理，必要时切换到新标签页。
- 遇到验证码时暂停并让用户手动完成。

## 输入

从用户请求中提取期刊名、ISSN、CN 号或主办单位。若像 `1000-1234`，按 ISSN；若像 `11-1234/...`，按 CN 号。

## 流程

1. 打开 `https://navi.cnki.net/knavi`。
2. 执行脚本，把 `QUERY_HERE` 替换为检索词。
3. 优先返回期刊 tab 的结果。

```javascript
async () => {
  const query = "QUERY_HERE";

  await new Promise((resolve, reject) => {
    let tries = 0;
    const check = () => {
      if (document.querySelector('input.researchbtn')) resolve();
      else if (++tries > 30) reject(new Error('timeout: journal search form'));
      else setTimeout(check, 500);
    };
    check();
  });

  const captcha = document.querySelector('#tcaptcha_transform_dy');
  if (captcha && captcha.getBoundingClientRect().top >= 0) return { error: 'captcha' };

  const select = document.querySelector('select');
  if (select) {
    if (/^\d{4}-\d{3}[\dXx]$/.test(query)) select.value = 'ISSN';
    else if (/^\d{2}-\d{4}/.test(query)) select.value = 'CN';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const input = document.querySelector('input[placeholder*="检索词"]');
  if (input) {
    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  document.querySelector('input.researchbtn')?.click();

  await new Promise((resolve, reject) => {
    let tries = 0;
    const check = () => {
      if (document.body.innerText.includes('条结果')) resolve();
      else if (++tries > 30) reject(new Error('timeout: journal results'));
      else setTimeout(check, 500);
    };
    check();
  });

  const journalTab = Array.from(document.querySelectorAll('li a'))
    .find((a) => a.innerText.trim() === '期刊');
  journalTab?.click();
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const body = document.body.innerText;
  const countMatch = body.match(/共\s*(\d+)\s*条结果/) || body.match(/找到\s*(\d+)\s*条结果/);
  const results = [];

  document.querySelectorAll('a[href*="knavi/detail"]').forEach((link) => {
    const text = link.innerText?.trim();
    if (!text || text.length < 2) return;

    const parent = link.closest('li, .list-item') || link.parentElement?.parentElement;
    const parentText = parent?.innerText || '';
    results.push({
      name: text.split('\n')[0]?.trim(),
      url: link.href,
      issn: parentText.match(/ISSN[：:]\s*(\S+)/)?.[1] || '',
      cn: parentText.match(/CN[：:]\s*(\S+)/)?.[1] || '',
      cif: parentText.match(/复合影响因子[：:]\s*([\d.]+)/)?.[1] || '',
      aif: parentText.match(/综合影响因子[：:]\s*([\d.]+)/)?.[1] || '',
      citations: parentText.match(/被引次数[：:]\s*([\d,]+)/)?.[1] || '',
      downloads: parentText.match(/下载次数[：:]\s*([\d,]+)/)?.[1] || '',
      sponsor: parentText.match(/主办单位[：:]\s*(.+?)(?=\n|ISSN)/)?.[1]?.trim() || ''
    });
  });

  return {
    query,
    count: countMatch ? Number.parseInt(countMatch[1], 10) : results.length,
    results
  };
}
```

## 输出格式

```text
期刊检索“{query}”：共 {count} 条。

1. {name}
   ISSN：{issn} | CN：{cn}
   复合影响因子：{cif} | 综合影响因子：{aif}
   主办单位：{sponsor}
```

若只有一个高可信结果，后续可直接把 `url` 交给 `$cnki-journal-index` 或 `$cnki-journal-toc`。

## 稳定选择器

| 数据 | 选择器 |
| --- | --- |
| 检索按钮 | `input.researchbtn` |
| 检索框 | `input[placeholder*="检索词"]` |
| 期刊 tab | `li a` 文本为 `期刊` |
| 期刊详情链接 | `a[href*="knavi/detail"]` |
