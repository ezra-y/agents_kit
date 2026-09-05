/**
 * `applyctl privacy audit|snapshot`：开源前的两道检查。
 *
 * 规则文档：`docs/10 §12`、`docs/14 §12-§13`
 *
 * - `audit`：扫 tracked 文件内容里的个人信息。有阻塞项时退出码非零。
 * - `snapshot`：做一次本地数据断开测试。
 *
 * 两条都只读，不改任何东西——除了在 `.local/tmp/` 里建一份可以随时扔掉的副本。
 */
import { runSanitationAudit } from "../../privacy/run-sanitation-audit.js";
import { buildTrackedSnapshot } from "../../privacy/build-tracked-snapshot.js";
import { failed, ok, readBoolean, readList, toJson } from "./shared.js";
export const privacyCommands = [
    {
        name: 'privacy audit',
        summary: '扫描 tracked 文件里的个人信息、密钥和本机路径。有阻塞项时退出码非零。',
        usage: 'applyctl privacy audit [--staged] [--secrets 值1,值2] [--json]',
        handler(context) {
            const report = runSanitationAudit({
                paths: context.paths,
                stagedOnly: readBoolean(context.args.options, 'staged'),
                ...(readList(context.args.options, 'secrets') === undefined
                    ? {}
                    : { extraSecrets: readList(context.args.options, 'secrets') }),
                now: context.now,
            });
            const blocking = report.findings.filter((finding) => finding.severity === 'blocking');
            const data = toJson(report);
            return blocking.length === 0
                ? ok(data, `扫了 ${report.scannedFileCount} 个文件，没有阻塞问题；${report.findings.length} 条提醒需要你自己看一眼。`)
                : failed('cli_command_failed', `有 ${blocking.length} 个阻塞问题，开源前必须先清掉。`, data);
        },
    },
    {
        name: 'privacy snapshot',
        summary: '做一次本地数据断开测试：只用 Git 跟踪文件建干净副本并验证能初始化。',
        usage: 'applyctl privacy snapshot [--no-verify] [--json]',
        handler(context) {
            const result = buildTrackedSnapshot({
                paths: context.paths,
                verify: !readBoolean(context.args.options, 'no-verify'),
                now: context.now,
            });
            const failedChecks = result.checks.filter((check) => !check.ok);
            const data = toJson(result);
            return failedChecks.length === 0
                ? ok(data, `干净副本共 ${result.fileCount} 个文件，全部检查通过。`)
                : failed('cli_command_failed', `断开测试没通过：${failedChecks.map((check) => check.detail).join('；')}`, data);
        },
    },
];
//# sourceMappingURL=privacy.js.map