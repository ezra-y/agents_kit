import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildRunSummary } from "./build-run-summary.js";
import { isInsideLocalRoot, toRepoRelative } from "../config/paths.js";
export function writeRunSummary(input) {
    const summary = buildRunSummary(input);
    const dir = path.join(input.paths.runsDir, input.runId);
    const file = path.join(dir, 'summary.json');
    if (!isInsideLocalRoot(input.paths, file)) {
        throw new Error(`run_summary_outside_local: ${file}`);
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
    });
    if (process.platform !== 'win32') {
        chmodSync(file, 0o600);
    }
    return {
        summaryPath: toRepoRelative(input.paths, file),
        summary,
    };
}
//# sourceMappingURL=write-run-summary.js.map