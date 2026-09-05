/**
 * 打开运行状态库。
 *
 * 规则文档：`docs/10_状态提交安全隐私与错误恢复.md`
 *
 * 只放任务、run 状态、动作日志、恢复点和提交保护。
 * 它可以被清理，但不能与长期答案或字段知识混用。
 */
import { openSkillDatabase } from "./migrate-databases.js";
export function openRuntimeDatabase(input) {
    return openSkillDatabase(input.paths, 'runtime');
}
//# sourceMappingURL=open-runtime-database.js.map