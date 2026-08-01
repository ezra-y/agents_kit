---
name: cnki-download
description: Trigger authorized CNKI paper PDF or CAJ downloads from a paper detail page. Use when Codex needs 在用户已登录且有下载权限时下载知网论文、优先 PDF、必要时 CAJ，或根据论文 URL 打开详情页后触发浏览器下载。
---

# CNKI 文献下载

在用户已经登录 CNKI 且拥有下载权限时，从论文详情页触发 PDF/CAJ 下载。

## 合规边界

- 不绕过登录、验证码、机构授权、付费墙或下载限制。
- 不批量规避访问频控；下载多篇文献时要放慢节奏，并让用户确认权限。
- 若页面提示未登录、无权限、验证码或付费，暂停并让用户在浏览器中处理。

## Codex 工具约定

- 优先使用 Codex Browser/in-app browser；也可使用等价浏览器自动化工具。
- 如果用户给出论文详情 URL，直接导航到 URL。
- 下载通过点击页面已有下载链接触发，文件保存位置由浏览器设置决定。

## 输入

识别：

- 论文详情 URL，可为空。
- 下载格式偏好：`pdf`、`caj`；未说明时优先 PDF。

## 下载脚本

把 `FORMAT` 替换为 `"pdf"` 或 `"caj"`。

```javascript
async () => {
  await new Promise((resolve, reject) => {
    let tries = 0;
    const check = () => {
      if (document.querySelector('.brief h1')) resolve();
      else if (++tries > 30) reject(new Error('timeout: paper detail'));
      else setTimeout(check, 500);
    };
    check();
  });

  const captcha = document.querySelector('#tcaptcha_transform_dy');
  if (captcha && captcha.getBoundingClientRect().top >= 0) {
    return { error: 'captcha', message: 'CNKI 正在显示滑块验证码，请手动完成后继续。' };
  }

  const format = "FORMAT";
  const pdfLink = document.querySelector('#pdfDown') || document.querySelector('.btn-dlpdf a');
  const cajLink = document.querySelector('#cajDown') || document.querySelector('.btn-dlcaj a');
  const notLoggedIn = document.querySelector('.downloadlink.icon-notlogged')
    || document.querySelector('[class*="notlogged"]');

  if (notLoggedIn) {
    return { error: 'not_logged_in', message: '下载需要登录，请先在浏览器中登录知网账号。' };
  }

  const title = document.querySelector('.brief h1')?.innerText?.trim()
    ?.replace(/\s*网络首发\s*$/, '') || '';

  if (format === 'pdf' && pdfLink) {
    pdfLink.click();
    return { status: 'downloading', format: 'PDF', title };
  }
  if (format === 'caj' && cajLink) {
    cajLink.click();
    return { status: 'downloading', format: 'CAJ', title };
  }
  if (pdfLink) {
    pdfLink.click();
    return { status: 'downloading', format: 'PDF', title };
  }
  if (cajLink) {
    cajLink.click();
    return { status: 'downloading', format: 'CAJ', title };
  }

  return {
    error: 'no_download_link',
    message: '未找到 PDF/CAJ 下载链接，可能无权限或页面结构已变化。',
    hasPDF: !!pdfLink,
    hasCAJ: !!cajLink
  };
}
```

## 汇报

- `status: downloading`：说明“已触发 {format} 下载：{title}，请在浏览器下载列表中查看。”
- `error: not_logged_in`：提醒用户登录 CNKI。
- `error: captcha`：提醒用户手动完成验证码。
- `error: no_download_link`：说明当前页面没有可用下载入口，并建议检查权限或切换格式。

## 稳定选择器

| 数据 | 选择器 |
| --- | --- |
| PDF 下载 | `#pdfDown` 或 `.btn-dlpdf a` |
| CAJ 下载 | `#cajDown` 或 `.btn-dlcaj a` |
| 下载区 | `.download-btns` |
| 未登录 | `.downloadlink.icon-notlogged` 或 `[class*="notlogged"]` |
| 标题 | `.brief h1` |
