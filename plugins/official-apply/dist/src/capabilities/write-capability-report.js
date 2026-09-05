/**
 * 把能力报告写到 `.local/runs/capabilities.json`。
 *
 * 规则文档：
 * - `docs/09_Codex与ClaudeCode共用实现.md §13`
 * - `docs/10_状态提交安全隐私与错误恢复.md §13`（敏感值日志规则）
 *
 * 两条硬规则：
 * 1. 报告只能落在 `.local/` 内。
 * 2. 报告里不能出现 Cookie、Token 和本机绝对路径。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { isInsideLocalRoot } from "../config/paths.js";
export const CAPABILITY_REPORT_FILENAME = 'capabilities.json';
const REDACTED = '[已脱敏]';
/** 只替换掉取值部分，保留「哪一类东西被脱敏了」这个信息，方便排查。 */
const VALUE_REDACTIONS = [
    [/(authorization\s*[:=]\s*(?:bearer|basic|token)\s+)\S+/gi, `$1${REDACTED}`],
    [/((?:set-)?cookie\s*[:=]\s*)[^\s]+/gi, `$1${REDACTED}`],
    [/\b(?:sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g, REDACTED],
    [/\beyJ[A-Za-z0-9_-]{10,}/g, REDACTED],
];
/**
 * 脱敏一段说明文字。
 *
 * 先把本机路径换成占位符，再把疑似凭证换成 `[已脱敏]`。
 * 顺序不能反：先换路径，报告里才不会残留 `/Users/<name>/...`。
 */
export function redactReportText(paths, text) {
    let output = text.split(paths.root).join('<skill-root>');
    const home = homedir();
    if (home !== '' && home !== '/') {
        output = output.split(home).join('<home>');
    }
    for (const [pattern, replacement] of VALUE_REDACTIONS) {
        output = output.replace(pattern, replacement);
    }
    return output;
}
function redactReport(paths, report) {
    let redactedFields = 0;
    const redactOne = (value) => {
        const next = redactReportText(paths, value);
        if (next !== value) {
            redactedFields += 1;
        }
        return next;
    };
    const details = report.details?.map((detail) => detail.failureReason === undefined
        ? detail
        : { ...detail, failureReason: redactOne(detail.failureReason) });
    return {
        report: {
            ...report,
            notes: report.notes.map(redactOne),
            ...(details === undefined ? {} : { details }),
            ...(report.blockingFailures === undefined
                ? {}
                : { blockingFailures: report.blockingFailures.map(redactOne) }),
        },
        redactedFields,
    };
}
export function writeCapabilityReport(input) {
    const { paths } = input;
    const filePath = path.join(paths.runsDir, CAPABILITY_REPORT_FILENAME);
    if (!isInsideLocalRoot(paths, filePath)) {
        throw new Error(`capability_report_outside_local: ${filePath} 不在 ${paths.localRoot} 内`);
    }
    const { report, redactedFields } = redactReport(paths, input.report);
    const body = `${JSON.stringify(report, null, 2)}\n`;
    mkdirSync(paths.runsDir, { recursive: true });
    writeFileSync(filePath, body, { encoding: 'utf8', mode: 0o600 });
    return { filePath, bytesWritten: Buffer.byteLength(body, 'utf8'), redactedFields };
}
//# sourceMappingURL=write-capability-report.js.map