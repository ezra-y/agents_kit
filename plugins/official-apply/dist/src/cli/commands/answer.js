/**
 * `applyctl answer`：把用户的回答写进 private.sqlite。
 *
 * 规则文档：`docs/09 §5.1`、`docs/03 §4-§6`
 *
 * 回答文件里是真实答案，所以这条命令**只往 `.local/` 写**。
 * scope 由文件里每条回答自己带，CLI 不替用户猜作用域。
 */
import { readFileSync } from 'node:fs';
import { saveUserAnswers } from "../../answers/save-user-answers.js";
import { describeError, failed, ok, readString, usageError } from "./shared.js";
/** 回答文件的最小格式检查。缺 scope 就直接报错，不默默存成全局。 */
export function parseAnswerFile(raw) {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed)
        ? parsed
        : parsed.answers;
    if (!Array.isArray(list)) {
        throw new Error('回答文件要么是一个数组，要么是 { "answers": [...] }');
    }
    return list.map((item, index) => {
        const answer = item;
        if (typeof answer.canonicalKey !== 'string' || answer.canonicalKey === '') {
            throw new Error(`第 ${index + 1} 条回答缺少 canonicalKey`);
        }
        if (answer.value === undefined) {
            throw new Error(`第 ${index + 1} 条回答缺少 value`);
        }
        if (answer.scope === undefined || typeof answer.scope.type !== 'string') {
            throw new Error(`第 ${index + 1} 条回答缺少 scope；作用域必须由你指定，系统不替你猜`);
        }
        return answer;
    });
}
export const answerCommands = [
    {
        name: 'answer',
        summary: '从 JSON 文件读入回答并按指定 scope 保存。',
        usage: 'applyctl answer --run <runId> --file <answers.json> [--json]',
        requiredOptions: ['run', 'file'],
        handler(context) {
            const runId = readString(context.args.options, 'run');
            const file = readString(context.args.options, 'file');
            if (runId === undefined || file === undefined) {
                return usageError('缺少 --run 或 --file。');
            }
            let answers;
            try {
                answers = parseAnswerFile(readFileSync(file, 'utf8'));
            }
            catch (error) {
                return failed('cli_invalid_option', `回答文件读不了：${describeError(error)}`);
            }
            const result = saveUserAnswers({ paths: context.paths, runId, answers, now: context.now });
            return ok(result, `已保存 ${result.savedAnswerIds.length} 条回答。`);
        },
    },
];
//# sourceMappingURL=answer.js.map