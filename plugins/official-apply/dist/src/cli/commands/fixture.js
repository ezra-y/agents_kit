/**
 * `applyctl fixture`：把抓到的页面脱敏成可公开的测试夹具。
 *
 * 规则文档：`docs/11 §2-§4`、`docs/14 §4`
 *
 * 三道闸门都在 `sanitizeFixture()` 和 `buildFixture()` 里，
 * CLI 只负责读文件、传参、报结果，不放宽任何一道。
 * 特别是 `--reviewed`：没有它，`buildFixture()` 会拒绝写入。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { sanitizeFixture } from "../../fixtures/sanitize-fixture.js";
import { buildFixture } from "../../fixtures/build-fixture.js";
import { describeError, failed, ok, readString, usageError } from "./shared.js";
export const fixtureCommands = [
    {
        name: 'fixture sanitize',
        summary: '对一份 HTML 做脱敏，并报告仍然可疑的内容。',
        usage: 'applyctl fixture sanitize --input <page.html> [--output <clean.html>] [--json]',
        requiredOptions: ['input'],
        handler(context) {
            const input = readString(context.args.options, 'input');
            if (input === undefined) {
                return usageError('缺少 --input <page.html>。');
            }
            let html;
            try {
                html = readFileSync(input, 'utf8');
            }
            catch (error) {
                return failed('cli_invalid_option', `读不了输入文件：${describeError(error)}`);
            }
            const result = sanitizeFixture({ html });
            const output = readString(context.args.options, 'output');
            if (output !== undefined) {
                writeFileSync(output, result.html, { encoding: 'utf8', mode: 0o600 });
            }
            return ok({
                redactions: result.redactions,
                stillSuspicious: result.stillSuspicious,
                suspicions: result.suspicions ?? [],
                ...(output === undefined ? {} : { outputPath: output }),
            }, result.stillSuspicious
                ? '仍然疑似含有敏感内容，这份夹具还不能公开。'
                : '脱敏完成。发布前仍需你本人过一遍。');
        },
    },
    {
        name: 'fixture build',
        summary: '把脱敏结果写进 fixtures/；必须显式加 --reviewed。',
        usage: 'applyctl fixture build --input <page.html> --key <fixtureKey> --reviewed [--json]',
        requiredOptions: ['input', 'key'],
        handler(context) {
            const input = readString(context.args.options, 'input');
            const fixtureKey = readString(context.args.options, 'key');
            if (input === undefined || fixtureKey === undefined) {
                return usageError('缺少 --input 或 --key。');
            }
            let html;
            try {
                html = readFileSync(input, 'utf8');
            }
            catch (error) {
                return failed('cli_invalid_option', `读不了输入文件：${describeError(error)}`);
            }
            const sanitized = sanitizeFixture({ html });
            const result = buildFixture({
                paths: context.paths,
                fixtureKey,
                sanitized,
                humanReviewed: context.args.options['reviewed'] === true,
                now: context.now,
            });
            if (result.rejected !== undefined) {
                return failed('cli_command_failed', result.rejected, result);
            }
            return ok(result, `夹具已写入 ${result.fixtureDir}。`);
        },
    },
];
//# sourceMappingURL=fixture.js.map