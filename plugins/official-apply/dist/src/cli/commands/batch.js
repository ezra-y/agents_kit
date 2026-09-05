import { describeNextBatchWork, getNextBatchWork } from "../../tasks/get-next-batch-work.js";
import { ok, readString, usageError } from "./shared.js";
export const batchCommands = [
    {
        name: 'batch next',
        summary: '读取批次中下一项可继续的工作。',
        usage: 'applyctl batch next --batch <batchId> [--json]',
        requiredOptions: ['batch'],
        handler(context) {
            const batchId = readString(context.args.options, 'batch');
            if (batchId === undefined) {
                return usageError('缺少 --batch <batchId>。');
            }
            const result = getNextBatchWork(batchId, context.paths);
            return ok(result, describeNextBatchWork(result, batchId));
        },
    },
];
//# sourceMappingURL=batch.js.map