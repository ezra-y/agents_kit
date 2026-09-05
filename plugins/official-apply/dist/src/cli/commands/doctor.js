/**
 * `applyctl doctor`：输出平台能力和 Git 边界状态。
 *
 * 规则文档：`docs/12 阶段13`、`docs/10 §12`
 *
 * 这是出问题时第一个要跑的命令。它只读不写（能力报告除外），
 * 而且**边界检查有阻塞项时退出码非零**，这样 CI 和钩子能直接用。
 */
import { probeCapabilities } from "../../capabilities/probe-capabilities.js";
import { writeCapabilityReport } from "../../capabilities/write-capability-report.js";
import { checkGitBoundary } from "../../privacy/check-git-boundary.js";
import { findStrayBrowsers } from "../../capabilities/find-stray-browsers.js";
import { detectQiuzhaoSkill } from "../../capabilities/detect-qiuzhao-skill.js";
import { failed, ok, readBoolean, readString, toJson } from "./shared.js";
export const doctorCommands = [
    {
        name: 'doctor',
        summary: '检查平台能力和 Git 边界；发现阻塞问题时退出码非零。',
        usage: 'applyctl doctor [--cdp-endpoint <url>] [--git-boundary] [--staged] [--json]',
        async handler(context) {
            const stagedOnly = readBoolean(context.args.options, 'staged');
            const boundaryOnly = readBoolean(context.args.options, 'git-boundary');
            const cdpEndpoint = readString(context.args.options, 'cdp-endpoint');
            const boundary = checkGitBoundary({ paths: context.paths, stagedOnly });
            const blocking = boundary.violations.filter((violation) => violation.severity === 'blocking');
            const qiuzhaoSkill = detectQiuzhaoSkill({ paths: context.paths });
            const qiuzhaoUnavailable = !qiuzhaoSkill.claudeCode.available && !qiuzhaoSkill.codex.available;
            const qiuzhaoNote = qiuzhaoUnavailable
                ? ' qiuzhao-feed 未安装。这不影响使用用户岗位表进行投递；只有“查找最新秋招”功能不可用。'
                : '';
            // --git-boundary 只做边界检查，不启动浏览器。钩子里用得上。
            if (boundaryOnly) {
                const data = { gitBoundary: toJson(boundary), qiuzhaoSkill: toJson(qiuzhaoSkill) };
                return blocking.length === 0
                    ? ok(data, `Git 边界检查通过。${qiuzhaoNote}`)
                    : failed('cli_command_failed', `Git 边界有 ${blocking.length} 个阻塞问题。${qiuzhaoNote}`, data);
            }
            const capabilities = await probeCapabilities({
                paths: context.paths,
                now: context.now,
                ...(cdpEndpoint === undefined ? {} : { existingChromeEndpoint: cdpEndpoint }),
            });
            const written = writeCapabilityReport({ paths: context.paths, report: capabilities.report });
            // 测试留下的孤儿浏览器。没有窗口，所以完全看不见，
            // 只会让机器越来越慢——一次被强杀的完整 verify 能留下上百个。
            const stray = findStrayBrowsers(context.paths);
            const data = {
                skillRoot: context.paths.root,
                capabilities: toJson(capabilities.report),
                capabilityReportPath: written.filePath,
                gitBoundary: toJson(boundary),
                qiuzhaoSkill: toJson(qiuzhaoSkill),
                strayTestBrowsers: stray.length,
            };
            const strayNote = stray.length === 0
                ? ''
                : ` 另外有 ${stray.length} 个测试留下的孤儿浏览器在跑（看不见但占内存），` +
                    '跑 npm run sweep:browsers 清掉。';
            return blocking.length === 0
                ? ok(data, `能力探测和 Git 边界检查都通过了。${strayNote}${qiuzhaoNote}`)
                : failed('cli_command_failed', `Git 边界有 ${blocking.length} 个阻塞问题。${strayNote}${qiuzhaoNote}`, data);
        },
    },
];
//# sourceMappingURL=doctor.js.map