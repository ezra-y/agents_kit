/**
 * 注册 init、doctor、task、run、answer、status、local、knowledge 和 fixture 命令。
 *
 * 规则文档：
 * - `docs/09_Codex与ClaudeCode共用实现.md §5`
 * - `docs/02_系统架构与代码落点.md §12`
 * - `docs/12_MVP实施顺序与验收清单.md 阶段13`
 *
 * 这个文件只是一张表。它不解析参数、不碰文件系统、不含业务判断，
 * 所以可以在任何环境下安全地构造出来（`applyctl --help` 也要能用）。
 */
import { initCommands } from "./commands/init.js";
import { doctorCommands } from "./commands/doctor.js";
import { taskCommands } from "./commands/task.js";
import { taskImportCommands } from "./commands/task-import.js";
import { submitCommands } from "./commands/submit.js";
import { answerCommands } from "./commands/answer.js";
import { statusCommands } from "./commands/status.js";
import { localCommands } from "./commands/local.js";
import { knowledgeCommands } from "./commands/knowledge.js";
import { fixtureCommands } from "./commands/fixture.js";
import { privacyCommands } from "./commands/privacy.js";
import { materialCommands } from "./commands/material.js";
import { resultsCommands } from "./commands/results.js";
import { approveCommands } from "./commands/approve.js";
import { resumeCommands } from "./commands/resume.js";
import { browserCommands } from "./commands/browser.js";
import { batchCommands } from "./commands/batch.js";
/** 验收清单点名要有的命令组（`docs/12 阶段13`）。 */
export const COMMAND_GROUPS = [
    'init',
    'doctor',
    'task',
    'run',
    'answer',
    'status',
    'local',
    'knowledge',
    'fixture',
    'privacy',
    'material',
    'profile',
    'resume',
    'browser',
    'batch',
];
export function registerCliCommands() {
    const commands = [
        ...initCommands,
        ...doctorCommands,
        ...taskCommands,
        ...taskImportCommands,
        ...submitCommands,
        ...answerCommands,
        ...statusCommands,
        ...localCommands,
        ...knowledgeCommands,
        ...fixtureCommands,
        ...privacyCommands,
        ...materialCommands,
        ...resultsCommands,
        ...approveCommands,
        ...resumeCommands,
        ...browserCommands,
        ...batchCommands,
    ];
    return {
        commands,
        /**
         * 最长前缀匹配。
         *
         * `applyctl local backup --label x` 的路径是 `['local','backup','--label','x']`，
         * 先试两段（命中 `local backup`），再试一段。子命令天然优先于父命令。
         */
        find(path) {
            const words = path.filter((word) => !word.startsWith('-'));
            for (let length = Math.min(words.length, 2); length >= 1; length -= 1) {
                const name = words.slice(0, length).join(' ');
                const hit = commands.find((command) => command.name === name);
                if (hit !== undefined) {
                    return hit;
                }
            }
            return undefined;
        },
    };
}
//# sourceMappingURL=register-cli-commands.js.map