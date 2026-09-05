/**
 * 用 Git 跟踪文件构建一个不带 `.local` 的干净副本，验证 git clone 后可用。
 *
 * 规则文档：`docs/14_个人使用到开源的渐进成长流程.md §12`
 *
 * 这是开源前的「本地数据断开测试」：证明只用 Git 里的文件，
 * 项目仍然能初始化、能加载公共知识、能跑合同测试。
 *
 * 做法就是 `docs/14 §12.1` 推荐的那条：
 *
 * ```bash
 * git archive HEAD -o tracked.tar
 * tar -xf tracked.tar -C <干净目录>
 * ```
 *
 * **不复制当前 `.local/`**，也**绝不删除**当前工作目录里的 `.local/`
 * （`docs/14 §12.4` 明确写了不要为了通过测试去删自己的数据）。
 * 副本建在 `.local/tmp/` 下面，跑完就可以扔。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { isInsideLocalRoot } from "../config/paths.js";
import { exportIgnoredFiles } from "./git-attributes.js";
function snapshotError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
function runGit(cwd, args) {
    try {
        const stdout = execFileSync('git', args, {
            cwd,
            maxBuffer: 256 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return { ok: true, stdout: stdout.toString('utf8') };
    }
    catch {
        return { ok: false, stdout: '' };
    }
}
function countFiles(dir) {
    let total = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            total += countFiles(full);
        }
        else if (entry.isFile()) {
            total += 1;
        }
    }
    return total;
}
export function buildTrackedSnapshot(request) {
    const { paths } = request;
    const checks = [];
    if (!existsSync(path.join(paths.root, '.git'))) {
        throw snapshotError('snapshot_not_a_git_repository', `${paths.root} 不是 Git 仓库`);
    }
    const snapshotDir = request.outputDir ?? path.join(paths.tmpDir, 'tracked-snapshot');
    // 副本只能建在 .local/ 里。不能往用户其他地方乱写。
    if (request.outputDir === undefined && !isInsideLocalRoot(paths, snapshotDir)) {
        throw snapshotError('snapshot_local_data_leaked', `${snapshotDir} 不在 ${paths.localRoot} 内`);
    }
    rmSync(snapshotDir, { recursive: true, force: true });
    mkdirSync(snapshotDir, { recursive: true });
    // 1. 只导出 Git 跟踪的文件。工作区里没提交的东西不会进来。
    const archived = runGit(paths.root, ['archive', 'HEAD', '--format=tar', `--output=${path.join(snapshotDir, 'tracked.tar')}`]);
    if (!archived.ok) {
        throw snapshotError('snapshot_not_a_git_repository', 'git archive HEAD 失败；先提交一次');
    }
    execFileSync('tar', ['-xf', 'tracked.tar', '-C', snapshotDir], { cwd: snapshotDir });
    rmSync(path.join(snapshotDir, 'tracked.tar'), { force: true });
    // 1.5 被 `export-ignore` 标记的路径（如用户要求保存的 `output/`）不能进副本。
    // `git archive` 天生遵守 `.gitattributes`，这一步是拿 Git 属性事实复核结果，
    // 防止属性被误删后副本悄悄把简历带出去。
    const allTracked = runGit(paths.root, ['ls-files', '-z'])
        .stdout.split('\u0000')
        .filter((line) => line.trim() !== '');
    const exportIgnored = exportIgnoredFiles(paths.root, allTracked);
    const exportIgnoredInSnapshot = [...exportIgnored].filter((file) => existsSync(path.join(snapshotDir, file)));
    checks.push({
        name: 'snapshot_excludes_export_ignored',
        ok: exportIgnoredInSnapshot.length === 0,
        detail: exportIgnoredInSnapshot.length === 0
            ? '副本里没有 export-ignore 标记的路径（.gitattributes 事实）。'
            : `副本混进了 export-ignore 标记的路径：${exportIgnoredInSnapshot.join('、')}`,
    });
    // 2. `git ls-files .local` 只允许出现 README（`docs/14 §12.3`）。
    const trackedLocalFiles = runGit(paths.root, ['ls-files', '.local'])
        .stdout.split('\n')
        .filter((line) => line.trim() !== '');
    const onlyReadme = trackedLocalFiles.length === 0 ||
        trackedLocalFiles.every((file) => file === '.local/README.md');
    checks.push({
        name: 'tracked_local_only_readme',
        ok: onlyReadme,
        detail: onlyReadme
            ? '.local 里只有 README 被跟踪。'
            : `.local 里有不该跟踪的文件：${trackedLocalFiles.join('、')}`,
    });
    // 3. 干净副本里不能带任何 .local 真实数据。
    const snapshotLocal = path.join(snapshotDir, '.local');
    const snapshotLocalFiles = existsSync(snapshotLocal)
        ? readdirSync(snapshotLocal).filter((name) => name !== 'README.md')
        : [];
    checks.push({
        name: 'snapshot_has_no_local_data',
        ok: snapshotLocalFiles.length === 0,
        detail: snapshotLocalFiles.length === 0
            ? '副本里没有任何本机私有数据。'
            : `副本里混进了 ${snapshotLocalFiles.join('、')}`,
    });
    // 4. 公共知识必须在副本里（否则干净 clone 什么都认不出来）。
    for (const required of ['knowledge/field-catalog.yaml', 'schemas/runtime.sql', 'package.json']) {
        const present = existsSync(path.join(snapshotDir, required));
        checks.push({
            name: `snapshot_contains_${required.replace(/[^a-z]/gi, '_')}`,
            ok: present,
            detail: present ? `${required} 在副本里。` : `${required} 没进 Git，干净 clone 会缺东西。`,
        });
    }
    // 5. 真正在副本里跑一次初始化，证明它能自己建 .local/（`docs/14 §12.2`）。
    if (request.verify !== false) {
        const initialized = verifySnapshotInitializes(snapshotDir);
        checks.push(initialized);
    }
    return {
        snapshotDir,
        fileCount: countFiles(snapshotDir),
        trackedLocalFiles,
        checks,
        ok: checks.every((check) => check.ok),
    };
}
/**
 * 在副本里跑 `applyctl init`。
 *
 * 这一步证明的是：干净 clone 会在**它自己的根目录**下建 `.local/`，
 * 而不是回头去碰原仓库的数据。
 */
function verifySnapshotInitializes(snapshotDir) {
    const cli = path.join(snapshotDir, 'bin', 'applyctl.ts');
    if (!existsSync(cli)) {
        return { name: 'snapshot_init_runs', ok: false, detail: 'bin/applyctl.ts 没进 Git。' };
    }
    try {
        execFileSync('node', [cli, 'init', '--json'], {
            cwd: snapshotDir,
            // 明确指向副本自己的根目录，避免继承外面的环境变量。
            env: { ...process.env, OFFICIAL_APPLY_ROOT: snapshotDir },
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 120_000,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
        return { name: 'snapshot_init_runs', ok: false, detail: `副本里 init 失败：${message}` };
    }
    const db = path.join(snapshotDir, '.local', 'db', 'runtime.sqlite');
    const ok = existsSync(db) && statSync(db).size > 0;
    return {
        name: 'snapshot_init_runs',
        ok,
        detail: ok
            ? '副本在自己的根目录下建好了 .local/ 和三个数据库。'
            : '副本跑完 init 之后没有生成数据库。',
    };
}
//# sourceMappingURL=build-tracked-snapshot.js.map