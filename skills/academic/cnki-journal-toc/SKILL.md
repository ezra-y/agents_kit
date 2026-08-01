---
name: cnki-journal-toc
description: Browse CNKI journal issues and extract a specific issue table of contents, with optional authorized original TOC PDF download. Use when Codex needs 查看某期刊某年某期目录、列出该期论文题名作者页码、打开原版目录浏览，或在用户有权限时触发目录 PDF 下载。
---

# CNKI 期刊目录浏览

在知网期刊详情页选择年份和期号，提取该期论文目录；必要时打开“原版目录浏览”并触发授权下载。

## 合规边界

- 目录 PDF 下载仅点击页面已有入口，不绕过登录、验证码或权限。
- 若用户没有指定期号，先展示可用年份和期号，不要随意下载。

## Codex 工具约定

- 优先使用 Codex Browser/in-app browser；也可使用等价浏览器自动化工具。
- 若当前页不是期刊详情页，先用 `$cnki-journal-search` 定位期刊。
- 期刊详情页和原版目录阅读页可能打开新标签页，必要时进行标签页切换。

## 输入

提取：

- 期刊名或期刊详情 URL。
- 年份，如 `2025`。
- 期号，如 `01期`，执行脚本时转换为 `No.01`。
- 是否请求“原版目录”或“下载”。

## 目录提取脚本

把 `YEAR` 替换为年份，把 `ISSUE` 替换为 `No.01` 这类格式。

```javascript
async () => {
  const year = "YEAR";
  const issue = "ISSUE";

  const captcha = document.querySelector('#tcaptcha_transform_dy');
  if (captcha && captcha.getBoundingClientRect().top >= 0) return { error: 'captcha' };

  const groups = document.querySelectorAll('#yearissue0 dl.s-dataList');
  let target = null;
  for (const group of groups) {
    if (group.querySelector('dt')?.innerText?.trim() === year) {
      target = Array.from(group.querySelectorAll('dd a'))
        .find((a) => a.innerText.trim() === issue);
      break;
    }
  }

  if (!target) {
    const available = Array.from(groups).map((group) => ({
      year: group.querySelector('dt')?.innerText?.trim(),
      issues: Array.from(group.querySelectorAll('dd a')).map((a) => a.innerText.trim())
    })).filter((item) => item.year);
    return { error: 'issue_not_found', year, issue, available: available.slice(0, 8) };
  }

  target.click();

  await new Promise((resolve, reject) => {
    let tries = 0;
    const check = () => {
      const rows = document.querySelectorAll('#CataLogContent dd.row');
      if (rows.length > 0) resolve();
      else if (++tries > 30) reject(new Error('timeout: issue toc'));
      else setTimeout(check, 500);
    };
    setTimeout(check, 1000);
  });

  const papers = Array.from(document.querySelectorAll('#CataLogContent dd.row')).map((row, index) => ({
    no: index + 1,
    title: row.querySelector('span.name a')?.innerText?.trim() || '',
    url: row.querySelector('span.name a')?.href || '',
    authors: row.querySelector('span.author')?.innerText?.trim()?.replace(/;$/, '') || '',
    pages: row.querySelector('span.company')?.innerText?.trim() || '',
    encryptId: row.querySelector('b[name="encrypt"]')?.id || ''
  }));

  const tocButton = document.querySelector('a.btn-preview:not(.btn-back)');

  return {
    issueLabel: document.querySelector('span.date-list')?.innerText?.trim() || `${year} ${issue}`,
    paperCount: papers.length,
    papers,
    tocUrl: tocButton?.href || null,
    url: location.href
  };
}
```

## 输出格式

```text
## {journalName} - {issueLabel}

共 {paperCount} 篇论文：

1. {title}（{pages}）
   作者：{authors}
```

如果返回 `issue_not_found`，列出 `available` 中可用年份和期号，让用户选择。

## 原版目录 PDF

用户明确要求下载时：

1. 点击文本为“原版目录浏览”的链接，或直接打开脚本返回的 `tocUrl`。
2. 切换到 `kns.cnki.net/reader/report` 阅读页。
3. 找到文本为“下载”的链接并点击。
4. 告诉用户下载已触发，请在浏览器下载列表中查看。

若下载按钮要求登录或无权限，提示用户在浏览器中登录或确认机构权限。

## 稳定选择器

| 数据 | 选择器 |
| --- | --- |
| 年份与期号区域 | `#yearissue0` |
| 年份组 | `#yearissue0 dl.s-dataList` |
| 年份标签 | `dl.s-dataList dt` |
| 期号链接 | `dl.s-dataList dd a` |
| 当前期号标签 | `span.date-list` |
| 论文条目 | `#CataLogContent dd.row` |
| 论文题名 | `dd.row span.name a` |
| 作者 | `dd.row span.author` |
| 页码 | `dd.row span.company` |
| 原版目录浏览 | `a.btn-preview:not(.btn-back)` |
