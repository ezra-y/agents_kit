---
name: cnki-export
description: Export CNKI citation metadata from a paper detail page or search results page, output GB/T 7714 text, save RIS/EndNote-style data, or push items to Zotero through the local Zotero Connector API. Use when Codex needs 导出知网引用、批量保存检索结果、写入 Zotero、生成 GB/T 7714 引文，或复用结果页 exportId。
---

# CNKI 引用导出与 Zotero

从知网详情页或检索结果页调用导出 API，获取 `GBTREFER`、`ELEARNING`、`EndNote` 数据；可输出 GB/T 7714 引文、保存引用文件，或通过本 skill 附带脚本写入 Zotero。

## 合规边界

- 只导出页面/API 已提供的引用元数据；不下载或抓取受限全文。
- Zotero 写入使用本机 `http://127.0.0.1:23119/connector`，需要 Zotero 桌面端已启动。
- 若 CNKI 出现验证码、登录或权限限制，暂停并让用户手动处理。

## Codex 工具约定

- 优先使用 Codex Browser/in-app browser；也可使用等价浏览器自动化工具执行页面脚本。
- 运行 Zotero 推送脚本时，使用当前 skill 文件夹下的 `scripts/push_to_zotero.py`；不要使用旧文档中的硬编码绝对路径。
- 临时 JSON 文件使用 UTF-8 编码，内容可以是单篇对象 `{}` 或多篇数组 `[]`。

## 模式选择

| 场景 | 推荐模式 |
| --- | --- |
| 当前在论文详情页 | 单篇导出 |
| 当前在搜索结果页且要保存多篇 | 批量导出 |
| 还没检索 | 先用 `$cnki-search` 或 `$cnki-advanced-search` |
| 只要引用文本 | 输出 `GBTREFER` |
| 要写入 Zotero | 保存 JSON 后运行 `scripts/push_to_zotero.py` |

## 单篇导出脚本

在论文详情页执行：

```javascript
async () => {
  const captcha = document.querySelector('#tcaptcha_transform_dy');
  if (captcha && captcha.getBoundingClientRect().top >= 0) return { error: 'captcha' };

  const url = document.querySelector('#export-url')?.value;
  const params = document.querySelector('#export-id')?.value;
  const uniplatform = new URLSearchParams(window.location.search).get('uniplatform') || 'NZKPT';
  if (!url || !params) return { error: 'not_on_paper_detail_page' };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      filename: params,
      displaymode: 'GBTREFER,elearning,EndNote',
      uniplatform
    })
  });
  const data = await response.json();
  if (data.code !== 1) return { error: data.msg || 'export_failed' };

  const result = {};
  for (const item of data.data) {
    result[item.mode] = item.value[0];
  }

  const body = document.body.innerText;
  result.pageUrl = window.location.href;
  result.issn = body.match(/ISSN[：:]\s*(\S+)/)?.[1] || '';
  result.dbcode = document.querySelector('#paramdbcode')?.value || '';
  result.dbname = document.querySelector('#paramdbname')?.value || '';
  result.filename = document.querySelector('#paramfilename')?.value || '';

  return result;
}
```

## 批量导出脚本

在检索结果页执行。`input.cbItem` 的值就是详情页 `#export-id`，可直接调用导出 API。

```javascript
async () => {
  const API_URL = 'https://kns.cnki.net/dm8/API/GetExport';
  const captcha = document.querySelector('#tcaptcha_transform_dy');
  if (captcha && captcha.getBoundingClientRect().top >= 0) return { error: 'captcha' };

  const checkboxes = document.querySelectorAll('.result-table-list tbody input.cbItem');
  const rows = document.querySelectorAll('.result-table-list tbody tr');
  if (checkboxes.length === 0) return { error: 'no_results_on_page' };

  const papers = [];
  for (let index = 0; index < checkboxes.length; index += 1) {
    const exportId = checkboxes[index].value;
    const paperUrl = rows[index]?.querySelector('td.name a.fz14')?.href || '';

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        filename: exportId,
        displaymode: 'GBTREFER,elearning,EndNote',
        uniplatform: 'NZKPT'
      })
    });
    const data = await response.json();
    if (data.code !== 1) continue;

    const result = {};
    for (const item of data.data) result[item.mode] = item.value[0];
    result.pageUrl = paperUrl;
    result.issn = result.ENDNOTE?.match(/%@\s*([^\s<]+)/)?.[1] || '';
    result.dbcode = 'CJFQ';
    result.dbname = '';
    result.filename = '';
    papers.push(result);
  }

  return papers;
}
```

只导出指定序号时，在循环中加入索引过滤，例如 `[0, 2, 4]` 表示第 1、3、5 条。

## 写入 Zotero

1. 将导出脚本返回值写入 UTF-8 JSON 临时文件。
2. 从本 skill 目录运行：

```powershell
python .\scripts\push_to_zotero.py C:\path\to\papers.json
```

如果当前工作目录不是 skill 目录，使用绝对路径指向 `skills/cnki-export/scripts/push_to_zotero.py`。脚本支持：

- 单篇对象 `{}`。
- 多篇数组 `[]`。
- 已构造好的 Zotero `items`。
- `--list` 查看 Zotero 当前选中分类。

## 输出

单篇：

```text
已导出引用：
标题：{title}
GB/T 7714：{GBTREFER}
```

批量：

```text
已导出 {count} 篇论文，可写入 Zotero 或保存引用文件。
1. {title}
```

## API 与选择器

| 数据 | 值 |
| --- | --- |
| 导出 API | `https://kns.cnki.net/dm8/API/GetExport` |
| 详情页导出 URL | `#export-url` |
| 详情页导出 ID | `#export-id` |
| 结果页导出 ID | `input.cbItem` |
| 结果页标题链接 | `td.name a.fz14` |
| displaymode | `GBTREFER,elearning,EndNote` |
| uniplatform | `NZKPT` |
