import { finalizeResumeProfile, showResumeParse } from "../../resume/finalize-resume-profile.js";
import { prepareResumeParse } from "../../resume/prepare-resume-parse.js";
import { describeError, failed, ok, readString, usageError } from "./shared.js";
export const resumeCommands = [
    {
        name: 'resume prepare',
        summary: '登记简历并提取本地文字，准备宿主模型的第一轮解析。',
        usage: 'applyctl resume prepare --file <resume.pdf|txt|md> [--json]',
        requiredOptions: ['file'],
        async handler(context) {
            const file = readString(context.args.options, 'file');
            if (file === undefined) {
                return usageError('缺少 --file。');
            }
            try {
                const result = await prepareResumeParse({
                    paths: context.paths,
                    filePath: file,
                    now: context.now,
                });
                return ok(result, result.alreadyPrepared
                    ? `这份简历已经准备过，沿用 ${result.parseId}。`
                    : `简历文字已准备到 ${result.sourceTextPath}。`);
            }
            catch (error) {
                return failed('cli_command_failed', describeError(error));
            }
        },
    },
    {
        name: 'resume finalize',
        summary: '校验第二轮最终 JSON，生成可读版并自动导入履历。',
        usage: 'applyctl resume finalize --id <resume_id> --file <final-profile.json> [--json]',
        requiredOptions: ['id', 'file'],
        handler(context) {
            const parseId = readString(context.args.options, 'id');
            const file = readString(context.args.options, 'file');
            if (parseId === undefined || file === undefined) {
                return usageError('缺少 --id 或 --file。');
            }
            try {
                const result = finalizeResumeProfile({
                    paths: context.paths,
                    parseId,
                    finalProfileFilePath: file,
                    now: context.now,
                });
                return ok(result, `简历解析完成，导入 ${result.profileRecordIds.length} 条履历记录。`);
            }
            catch (error) {
                return failed('cli_command_failed', describeError(error));
            }
        },
    },
    {
        name: 'resume show',
        summary: '查看简历解析状态和生成文件。',
        usage: 'applyctl resume show --id <resume_id> [--json]',
        requiredOptions: ['id'],
        handler(context) {
            const parseId = readString(context.args.options, 'id');
            if (parseId === undefined) {
                return usageError('缺少 --id。');
            }
            try {
                const result = showResumeParse(context.paths, parseId);
                return ok(result, `简历解析状态：${result.status}。`);
            }
            catch (error) {
                return failed('cli_command_failed', describeError(error));
            }
        },
    },
];
//# sourceMappingURL=resume.js.map