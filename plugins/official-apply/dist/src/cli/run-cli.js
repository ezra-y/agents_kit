/**
 * 解析参数、初始化依赖并调用共享核心。
 *
 * 规则文档：
 * - `docs/09_Codex与ClaudeCode共用实现.md §5`
 * - `docs/02_系统架构与代码落点.md §4`（路径唯一规则）
 *
 * 两件事只在这里做一次：
 *
 * 1. **解析路径。** `getSkillPaths()` 只在这里调用，结果往下传。
 *    单条命令不许自己拼路径，也不许用 `process.cwd()`——
 *    用户可能从任何目录调用 Skill。
 * 2. **决定输出。** 输出永远是一段 JSON（`docs/09 §5.1`），
 *    不掺杂给人看的散乱文本。
 *
 * `--data-root` 这类「换一个数据根」的参数会被明确拒绝：
 * 真实答案、简历和运行记录只能待在 Skill 自己的 `.local/` 里。
 */
import { getSkillPaths } from "../config/paths.js";
import { registerCliCommands } from "./register-cli-commands.js";
import { describeError, toJson } from "./commands/shared.js";
/** 明确拒绝的参数：它们都想把数据写到 Skill 之外。 */
const FORBIDDEN_OPTIONS = ['data-root', 'local-root', 'home', 'storage-root'];
/**
 * 开关型参数，后面不跟值。
 *
 * 必须显式列出来。否则 `--headless extra` 里的 `extra` 会被当成
 * `--headless` 的值吃掉，位置参数就永远传不进来。
 * 与其让解析器去猜，不如把这份清单摆明。
 */
export const BOOLEAN_OPTIONS = new Set([
    'json',
    'help',
    'headless',
    'staged',
    'git-boundary',
    'overwrite',
    'reviewed',
    'pretty',
    'confirm',
    'no-verify',
    'dry-run',
    'all',
    'staged',
]);
/**
 * 解析 `--key value`、`--flag` 和位置参数。
 *
 * 规则很小气，因为 CLI 是给自动化用的：
 * `--key=value` 也支持，但不做缩写、不做类型推断。
 */
export function parseCliArgs(argv, valueOptions = new Set()) {
    const path = [];
    const options = {};
    const positionals = [];
    let seenOption = false;
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index] ?? '';
        if (!token.startsWith('-')) {
            // 选项出现之前的裸词是命令路径，之后的是位置参数。
            if (seenOption) {
                positionals.push(token);
            }
            else {
                path.push(token);
            }
            continue;
        }
        seenOption = true;
        const body = token.replace(/^--?/, '');
        const equals = body.indexOf('=');
        if (equals >= 0) {
            options[body.slice(0, equals)] = body.slice(equals + 1);
            continue;
        }
        const next = argv[index + 1];
        const isBoolean = BOOLEAN_OPTIONS.has(body) && !valueOptions.has(body);
        if (!isBoolean && next !== undefined && !next.startsWith('-')) {
            options[body] = next;
            index += 1;
        }
        else {
            options[body] = true;
        }
    }
    return { path, options, positionals };
}
function helpResult(registry) {
    return {
        ok: true,
        exitCode: 0,
        data: toJson({
            usage: 'applyctl <command> [options]',
            commands: registry.commands.map((command) => ({
                name: command.name,
                summary: command.summary,
                usage: command.usage,
            })),
        }),
        message: 'applyctl 的全部命令。所有命令都输出 JSON。',
    };
}
export async function runCli(request) {
    const registry = request.registry ?? registerCliCommands();
    // 第一遍解析只为了找出是哪条命令。
    const firstPass = parseCliArgs(request.argv);
    const matched = registry.find(firstPass.path);
    // 第二遍带上这条命令声明的「必须带值」选项，再解析一次。
    // 这样 `task add --json <file>` 里的 --json 才不会被当成输出开关。
    const valueOptions = new Set(matched?.valueOptions ?? []);
    const args = valueOptions.size === 0 ? firstPass : parseCliArgs(request.argv, valueOptions);
    const compact = args.options['json'] === true;
    const finish = (result) => ({
        exitCode: result.exitCode,
        stdout: compact ? JSON.stringify(result) : `${JSON.stringify(result, null, 2)}\n`,
        result,
    });
    if (args.path.length === 0 || args.options['help'] === true) {
        return finish(helpResult(registry));
    }
    const forbidden = FORBIDDEN_OPTIONS.find((name) => args.options[name] !== undefined);
    if (forbidden !== undefined) {
        return finish({
            ok: false,
            exitCode: 2,
            data: null,
            errorCode: 'cli_data_root_not_allowed',
            message: `不支持 --${forbidden}。本机私有数据只能放在 Skill 自己的 .local/ 里。`,
        });
    }
    const command = matched;
    if (command === undefined) {
        return finish({
            ok: false,
            exitCode: 2,
            data: toJson({ availableCommands: registry.commands.map((item) => item.name) }),
            errorCode: 'cli_unknown_command',
            message: `没有这个命令：${args.path.join(' ')}`,
        });
    }
    const missing = (command.requiredOptions ?? []).filter((name) => args.options[name] === undefined);
    if (missing.length > 0) {
        return finish({
            ok: false,
            exitCode: 2,
            data: toJson({ usage: command.usage }),
            errorCode: 'cli_missing_option',
            message: `缺少必填参数：${missing.map((name) => `--${name}`).join('、')}`,
        });
    }
    // 路径只解析这一次。往下所有命令都用同一份。
    const paths = request.paths ?? getSkillPaths();
    const now = request.now ?? new Date().toISOString();
    try {
        return finish(await command.handler({ paths, args, now }));
    }
    catch (error) {
        return finish({
            ok: false,
            exitCode: 1,
            data: toJson({ command: command.name }),
            errorCode: 'cli_command_failed',
            message: describeError(error),
        });
    }
}
//# sourceMappingURL=run-cli.js.map