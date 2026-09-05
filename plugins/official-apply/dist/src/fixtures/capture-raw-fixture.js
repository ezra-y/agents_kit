/**
 * 把原始 HTML、ARIA、schema 和网络样本放入 `.local/fixtures-raw/`。
 *
 * 规则文档：`docs/11_测试夹具调试与效率指标.md §2.3`、`ARCHITECTURE.md §5`
 *
 * 这里保存的是**未脱敏**的真实样本，里面很可能有姓名、手机号和申请编号。
 * 所以只能落在 `.local/fixtures-raw/`，而且这个目录默认不进 Git。
 *
 * 想让它变成可公开的夹具，必须走 `sanitizeFixture()` → 人工审核 → `buildFixture()`。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isInsideLocalRoot, toRepoRelative } from "../config/paths.js";
export function captureRawFixture(request) {
    const now = request.now ?? new Date().toISOString();
    const safeKey = request.fixtureKey.replace(/[^A-Za-z0-9._-]/g, '_');
    const dir = path.join(request.paths.rawFixturesDir, safeKey);
    if (!isInsideLocalRoot(request.paths, dir)) {
        throw new Error(`learning_outside_local: ${dir} 不在 ${request.paths.localRoot} 内`);
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const files = [];
    const write = (name, content) => {
        const file = path.join(dir, name);
        writeFileSync(file, content, { encoding: 'utf8', mode: 0o600 });
        files.push(toRepoRelative(request.paths, file));
    };
    write('page.html', request.html);
    if (request.ariaSnapshot !== undefined) {
        write('page.aria.yml', request.ariaSnapshot);
    }
    write('page-schema.json', `${JSON.stringify(request.pageSchema, null, 2)}\n`);
    if (request.networkSamples !== undefined && request.networkSamples.length > 0) {
        write('network-samples.json', `${JSON.stringify(request.networkSamples, null, 2)}\n`);
    }
    write('manifest.json', `${JSON.stringify({
        version: 1,
        fixtureKey: request.fixtureKey,
        runId: request.runId,
        capturedAt: now,
        sanitized: false,
        warning: '未脱敏原始样本。绝不能直接进入 Git 或公开目录。',
    }, null, 2)}\n`);
    return { rawDir: toRepoRelative(request.paths, dir), files };
}
//# sourceMappingURL=capture-raw-fixture.js.map