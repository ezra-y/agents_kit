---
name: cnki-journal-index
description: Query CNKI journal indexing and evaluation data, including 北大核心, CSSCI, CSCD, SCI, EI, AMI, Scopus, ISSN/CN, sponsor, publication cycle, paper count, and impact factors. Use when Codex needs 判断期刊级别、查询是否核心/CSSCI/CSCD/EI/SCI、核对期刊收录和评价指标。
---

# CNKI 期刊收录查询

从知网期刊详情页提取期刊收录、基本信息和评价指标。若用户只给刊名，先用 `$cnki-journal-search` 找到详情页。

## Codex 工具约定

- 优先使用 Codex Browser/in-app browser；也可使用等价浏览器自动化工具。
- 如果用户给出 `navi.cnki.net/knavi/detail` URL，直接导航。
- 若需要从搜索结果进入详情页，注意新标签页并切换到详情页。
- 遇到验证码时暂停并让用户手动完成。

## 流程

1. 解析输入：期刊名或期刊详情 URL。
2. 若是期刊名，先调用 `$cnki-journal-search`，选择最匹配的详情页 URL。
3. 打开详情页，执行下方脚本。
4. 若页面有“更多介绍”，需要详细收录年份时再点击展开并读取快照。

```javascript
() => {
  const captcha = document.querySelector('#tcaptcha_transform_dy');
  if (captcha && captcha.getBoundingClientRect().top >= 0) return { error: 'captcha' };

  const body = document.body.innerText;
  const titleElement = document.querySelector('h3.titbox, h3.titbox1');
  const titleText = titleElement?.innerText?.trim() || '';
  const titleParts = titleText.split('\n').map((part) => part.trim()).filter(Boolean);
  const nameCN = titleParts[0] || '';
  const nameEN = titleParts[1] || '';

  const tagText = body.match(/Chinese.*?\n\n([\s\S]*?)\n\n基本信息/)?.[1]
    || (nameCN ? body.match(new RegExp(nameCN + '[\\s\\S]*?\\n\\n([\\s\\S]*?)\\n\\n基本信息'))?.[1] : '')
    || '';
  const knownTags = ['北大核心', 'CSSCI', 'CSCD', 'SCI', 'EI', 'CAS', 'JST', 'WJCI', 'AMI', 'Scopus', '卓越期刊', '网络首发'];
  const indexedIn = knownTags.filter((tag) => tagText.includes(tag) || body.includes(tag));

  const moreIntro = Array.from(document.querySelectorAll('a'))
    .find((a) => a.innerText?.includes('更多介绍'));

  return {
    nameCN,
    nameEN,
    indexedIn,
    sponsor: body.match(/主办单位[：:]\s*(.+?)(?=\n)/)?.[1] || '',
    frequency: body.match(/出版周期[：:]\s*(\S+)/)?.[1] || '',
    issn: body.match(/ISSN[：:]\s*(\S+)/)?.[1] || '',
    cn: body.match(/CN[：:]\s*(\S+)/)?.[1] || '',
    collection: body.match(/专辑名称[：:]\s*(.+?)(?=\n)/)?.[1] || '',
    paperCount: body.match(/出版文献量[：:]\s*(.+?)(?=\n)/)?.[1] || '',
    impactComposite: body.match(/复合影响因子[：:]\s*([\d.]+)/)?.[1] || '',
    impactComprehensive: body.match(/综合影响因子[：:]\s*([\d.]+)/)?.[1] || '',
    hasMoreIntro: !!moreIntro,
    rawTagText: tagText.substring(0, 200),
    url: location.href
  };
}
```

## 输出格式

```text
## {nameCN} ({nameEN})

收录：{indexedIn}

ISSN：{issn} | CN：{cn}
主办单位：{sponsor}
出版周期：{frequency}
专辑：{collection}
出版文献量：{paperCount}

复合影响因子：{impactComposite}
综合影响因子：{impactComprehensive}
```

不要把“页面出现某个词”绝对解释为正式入选年份；若用户要求严格判定某版核心/CSSCI/CSCD，展开“更多介绍”或结合官方目录核验后再下结论。

## 常见收录标签

| 标签 | 含义 |
| --- | --- |
| 北大核心 | 北京大学中文核心期刊 |
| CSSCI | 中文社会科学引文索引 |
| CSCD | 中国科学引文数据库 |
| SCI | Science Citation Index |
| EI | Engineering Index |
| AMI | 中国人文社会科学期刊 AMI 综合评价 |
| Scopus | Elsevier Scopus |

## 稳定选择器

| 数据 | 位置 |
| --- | --- |
| 期刊标题 | `h3.titbox, h3.titbox1` |
| 基本信息 | 正文文本中的 `主办单位`、`ISSN`、`CN`、`出版周期` |
| 评价指标 | 正文文本中的 `复合影响因子`、`综合影响因子` |
| 更多介绍 | 链接文本包含 `更多介绍` |
| 统计与评价 | tab 文本包含 `统计与评价` |
