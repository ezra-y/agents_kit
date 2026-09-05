/**
 * 把通过检查的脱敏样本写到 `fixtures/`。
 *
 * 规则文档：`docs/11 §2.3`、`docs/14 §12`、`fixtures/README.md`
 *
 * 三道闸，缺一不可：
 * 1. 必须经过 `sanitizeFixture()`。
 * 2. 脱敏后**不能仍然可疑**。
 * 3. 必须**人工确认过**（`humanReviewed`）。
 *
 * 三条都满足才允许写进 tracked 目录。
 * 这是「真实观察不能自动直接写进公开目录」（`docs/10 §12.6`）的落点。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isInsideSkillRoot, isInsideLocalRoot, toRepoRelative } from "../config/paths.js";
export function buildFixture(request) {
    const now = request.now ?? new Date().toISOString();
    if (!request.humanReviewed) {
        return {
            fixtureDir: '',
            files: [],
            rejected: 'fixture_not_reviewed: 公开夹具必须经过人工确认',
        };
    }
    if (request.sanitized.stillSuspicious) {
        return {
            fixtureDir: '',
            files: [],
            rejected: `fixture_still_suspicious: ${request.sanitized.suspicions.join('；')}`,
        };
    }
    const safeKey = request.fixtureKey.replace(/[^A-Za-z0-9._-]/g, '_');
    const dir = path.join(request.paths.publicFixturesDir, safeKey);
    // 公开夹具必须在 Skill 内的公开目录，且**绝不能**落在 .local 里。
    if (!isInsideSkillRoot(request.paths, dir) || isInsideLocalRoot(request.paths, dir)) {
        return {
            fixtureDir: '',
            files: [],
            rejected: `fixture_outside_public_dir: ${dir} 不是合法的公开夹具目录`,
        };
    }
    mkdirSync(dir, { recursive: true });
    const files = [];
    const write = (name, content) => {
        const file = path.join(dir, name);
        writeFileSync(file, content, 'utf8');
        files.push(toRepoRelative(request.paths, file));
    };
    write('page.html', request.sanitized.html);
    if (request.sanitized.pageSchema !== undefined) {
        write('expected-page-schema.json', `${JSON.stringify(request.sanitized.pageSchema, null, 2)}\n`);
    }
    if (request.sanitized.networkSamples !== undefined) {
        write('network-schema.json', `${JSON.stringify(request.sanitized.networkSamples, null, 2)}\n`);
    }
    write('manifest.json', `${JSON.stringify({
        version: 1,
        fixtureKey: request.fixtureKey,
        builtAt: now,
        sanitized: true,
        humanReviewed: true,
        redactions: request.sanitized.redactions,
        note: '本夹具已脱敏并经过人工确认，可以进入 Git。',
    }, null, 2)}\n`);
    return { fixtureDir: toRepoRelative(request.paths, dir), files };
}
//# sourceMappingURL=build-fixture.js.map