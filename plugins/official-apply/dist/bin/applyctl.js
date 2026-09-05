#!/usr/bin/env node
/**
 * `applyctl` 可执行入口。
 *
 * 规则文档：`docs/02_系统架构与代码落点.md §4`、`docs/09 §5`
 *
 * 这个文件故意写得很短：它只负责把 argv 交给 `runCli()`、
 * 把 JSON 打到 stdout、把退出码交给 shell。
 * 任何判断都不在这里。
 *
 * 注意路径：Skill 根目录由 `getSkillPaths()` 从**本文件的位置**推出来，
 * 不是从 `process.cwd()`。所以在任何目录下调用都指向同一个 `.local/`。
 */
import { runCli } from "../src/cli/run-cli.js";
const result = await runCli({ argv: process.argv.slice(2) });
process.stdout.write(result.stdout.endsWith('\n') ? result.stdout : `${result.stdout}\n`);
process.exit(result.exitCode);
//# sourceMappingURL=applyctl.js.map