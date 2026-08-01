---
name: cnki-paper-detail
description: Extract full metadata from a CNKI paper detail page, including title, authors, affiliations, abstract, keywords, fund, classification, source, publication info, and citation network counts. Use when Codex needs 查看某篇知网论文详情、整理摘要关键词、引用前核对元数据，或从搜索结果 URL 进入详情页解析。
---

# CNKI 论文详情提取

从知网论文详情页提取完整元数据。可从用户给出的论文 URL 开始，也可解析当前已经打开的详情页。

## Codex 工具约定

- 优先使用 Codex Browser/in-app browser；也可使用等价浏览器自动化工具。
- 如果用户给出 URL，直接导航到该 URL；不要从结果页点击标题链接。
- 遇到验证码或登录限制时暂停，让用户在浏览器中手动处理。

## 输入

识别用户是否提供了包含 `kcms2/article/abstract` 或 `KCMS/detail` 的知网论文 URL。

- 有 URL：先打开 URL，等待详情页正文出现。
- 无 URL：假设当前页就是论文详情页；如果不是，提示用户提供论文链接或先检索。

## 解析脚本

```javascript
() => {
  const captcha = document.querySelector('#tcaptcha_transform_dy');
  if (captcha && captcha.getBoundingClientRect().top >= 0) return { error: 'captcha' };

  const brief = document.querySelector('.brief');
  if (!brief) return { error: 'paper_detail_not_found' };

  const title = brief.querySelector('h1')?.innerText?.trim()
    ?.replace(/\s*附视频\s*$/, '')
    ?.replace(/\s*网络首发\s*$/, '') || '';

  const authorH3s = brief.querySelectorAll('h3.author');
  const authors = [];
  const authorSection = authorH3s[0];
  if (authorSection) {
    authorSection.querySelectorAll('a').forEach((link) => {
      const raw = link.innerText?.trim() || '';
      const affiliationNumber = raw.match(/(\d+)$/)?.[1] || '';
      authors.push({
        name: raw.replace(/\d+$/, '').trim(),
        affiliationNumber
      });
    });
  }

  const affiliations = [];
  if (authorH3s.length > 1) {
    authorH3s[1].querySelectorAll('a').forEach((link) => {
      affiliations.push(link.innerText?.trim());
    });
  }

  const keywords = Array.from(document.querySelectorAll('p.keywords a') || [])
    .map((a) => a.innerText?.replace(/;$/, '').trim())
    .filter(Boolean);

  const citationInfo = {};
  document.querySelectorAll('ul.module-tab.tpl_lieteratures li').forEach((li) => {
    const id = li.getAttribute('data-id');
    const text = li.innerText?.trim() || '';
    const count = text.match(/(\d+)/)?.[1] || '0';
    if (id) {
      citationInfo[id] = {
        label: text.replace(/\d+/, '').trim(),
        count: Number.parseInt(count, 10)
      };
    }
  });

  return {
    title,
    authors,
    affiliations,
    abstract: document.querySelector('.abstract-text')?.innerText?.trim() || '',
    keywords,
    fund: document.querySelector('p.funds')?.innerText?.trim() || '',
    classification: document.querySelector('.clc-code')?.innerText?.trim() || '',
    journal: document.querySelector('.doc-top a')?.innerText?.trim() || '',
    pubInfo: document.querySelector('.head-time')?.innerText?.trim() || '',
    isOnlineFirst: !!brief.querySelector('.icon-shoufa'),
    toc: document.querySelector('.catalog-list, .catalog-listDiv')?.innerText?.trim() || '',
    citationInfo,
    url: location.href
  };
}
```

## 输出格式

```text
## {title} {isOnlineFirst ? "[网络首发]" : ""}

作者：{authors}
机构：{affiliations}
来源：{journal}
出版信息：{pubInfo}

摘要：
{abstract}

关键词：{keywords}
基金：{fund}
分类号：{classification}
```

## 快照兜底

若脚本失败，用页面快照解析：

- 标题：一级 heading。
- 作者：URL 含 `kcms2/author/detail` 的链接。
- 机构：URL 含 `kcms2/organ/detail` 的链接。
- 摘要：跟随“摘要：”的正文。
- 关键词：URL 含 `kcms2/keyword/detail` 的链接。
- 基金：跟随“基金资助：”的文本。
- 分类号：跟随“分类号：”的文本。

## 稳定选择器

| 数据 | 选择器 |
| --- | --- |
| 主信息区 | `.brief` |
| 标题 | `.brief h1` |
| 作者 | `.brief h3.author:first-of-type a` |
| 机构 | `.brief h3.author:nth-of-type(2) a` |
| 摘要 | `.abstract-text` |
| 关键词 | `p.keywords a` |
| 基金 | `p.funds` |
| 分类号 | `.clc-code` |
| 来源 | `.doc-top a` |
| 网络首发 | `.brief .icon-shoufa` |
| 引文网络 | `ul.module-tab.tpl_lieteratures li` |
