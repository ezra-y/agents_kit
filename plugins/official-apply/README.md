# official-apply

企业招聘官网网申执行器。官网页面字段是唯一事实源，填写和最终提交严格分开。

## 安装

```bash
npm install --omit=dev
node bin/applyctl.js init
node bin/applyctl.js doctor
```

## 入口

```bash
node bin/applyctl.js --help
node bin/applyctl-mcp.js
```

私有数据使用 `OFFICIAL_APPLY_DATA_DIR` 或 `~/.config/official-apply/config.json` 中的 dataRoot。
安装默认 `~/.local/share/official-apply`，开发模式默认代码根目录的 `.local/`。
升级插件保留同一份数据；不要把私人数据复制进插件包。
最终提交必须由用户明确确认；结果不确定时不得重复提交。
