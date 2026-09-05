/**
 * 打一个可以交出去的源码包。
 *
 * 规则文档：`docs/14_个人使用到开源的渐进成长流程.md §12`、修复清单第 12 节
 *
 * ## 为什么用 `git archive` 而不是 `tar` 整个目录
 *
 * `tar` 打整个目录要靠一长串 `--exclude` 才能躲开 `.local/`、
 * `node_modules/`、`.git/`。**漏一条就是一次泄漏**，而且漏了不会报错，
 * 只会让包变大——大到你注意到的时候，包可能已经发出去了。
 *
 * `git archive HEAD` 反过来：它只装 Git 跟踪的文件。
 * 没被跟踪的东西**根本进不来**，不需要记得排除它们。
 * 这是「默认安全」和「记得排除」的区别。
 *
 * ## 还是要再查一遍
 *
 * `git archive` 已经足够安全了，但万一有人手滑 `git add` 了一个
 * Cookie 数据库，它照样会打进去。所以打完之后再按名字查一遍，
 * 命中就**删包并报错**，不是警告——一个带 Cookie 的包不该留在硬盘上。
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { isInsideLocalRoot, toRepoRelative } from "../config/paths.js";
/**
 * 绝对不能出现在源码包里的东西。
 *
 * 每一条都对应一次真实的泄漏方式，不是凭空列的：
 * 浏览器 profile 里有登录态，`settings.local.json` 里有本机路径和 token，
 * `__MACOSX` 和 `.DS_Store` 是 macOS 打包时顺手塞进去的垃圾。
 */
const FORBIDDEN_ENTRIES = [
    {
        id: 'local_data',
        why: '.local/ 里是真实简历、答案、Cookie 和运行记录',
        // 两个例外：
        // - `.local/README.md` 是说明文件，本来就该跟踪。
        // - `.local/` 这个**目录条目**本身。tar 列表里会有它，
        //   因为里面有个该跟踪的文件；拦它是误判，而误判会让打包永远过不去。
        match: (entry) => entry.startsWith('.local/') && entry !== '.local/README.md' && entry !== '.local/',
    },
    {
        id: 'node_modules',
        why: '依赖应该由 npm install 装，不该跟着包走',
        match: (entry) => entry.split('/').includes('node_modules'),
    },
    {
        id: 'git_dir',
        why: '.git/ 里有全部历史，包括可能已经删掉的敏感文件',
        match: (entry) => entry.split('/')[0] === '.git',
    },
    {
        id: 'local_settings',
        why: 'settings.local.json 里有本机路径和可能的 token',
        match: (entry) => entry.endsWith('.claude/settings.local.json'),
    },
    {
        id: 'browser_state',
        why: '浏览器 profile 里有登录态',
        match: (entry) => /(^|\/)(Cookies|History|Login Data|Web Data|Local Storage|IndexedDB)(-journal)?$/.test(entry),
    },
    {
        id: 'macos_junk',
        why: 'macOS 打包垃圾，泄漏本机目录结构',
        match: (entry) => entry.includes('__MACOSX') || entry.endsWith('.DS_Store'),
    },
    {
        id: 'dist',
        why: 'dist/ 是编译产物，收包方自己 npm run build 就有',
        match: (entry) => entry.split('/')[0] === 'dist',
    },
];
/**
 * 挑出包里不该有的条目。
 *
 * 纯函数，因为它是**安全关键**的一条：判错了就是把 Cookie 发出去。
 * 拆开才测得动各种真实路径形状。
 */
export function findForbiddenEntries(entries) {
    const hits = [];
    for (const entry of entries) {
        for (const rule of FORBIDDEN_ENTRIES) {
            if (rule.match(entry)) {
                hits.push({ entry, rule: rule.id, why: rule.why });
                break;
            }
        }
    }
    return hits;
}
function packageError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
export function packageSource(request) {
    const { paths } = request;
    const ref = request.ref ?? 'HEAD';
    const outputDir = request.outputDir ?? path.join(paths.tmpDir, 'packages');
    // 包本身也算产物，只能落在 .local/ 里。
    if (!isInsideLocalRoot(paths, outputDir)) {
        throw packageError('package_outside_local', `${outputDir} 不在 ${paths.localRoot} 内；产物只能放 .local/`);
    }
    mkdirSync(outputDir, { recursive: true });
    const stamp = (request.now ?? new Date().toISOString()).replace(/[:.]/g, '-');
    const archivePath = path.join(outputDir, `official-apply-source-${stamp}.tar.gz`);
    try {
        execFileSync('git', ['archive', '--format=tar.gz', '-o', archivePath, ref], {
            cwd: paths.root,
            stdio: ['ignore', 'ignore', 'pipe'],
        });
    }
    catch (error) {
        throw packageError('package_git_archive_failed', `git archive ${ref} 失败：${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    }
    // 列一遍内容再查。git archive 只装跟踪文件，但有人手滑 git add
    // 过一个 Cookie 数据库的话，它照样会进来。
    const listed = execFileSync('tar', ['-tzf', archivePath], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
    const entries = listed.split('\n').map((line) => line.trim()).filter((line) => line !== '');
    const forbidden = findForbiddenEntries(entries);
    if (forbidden.length > 0) {
        // 带敏感内容的包不该留在硬盘上，哪怕一秒钟。
        rmSync(archivePath, { force: true });
        throw packageError('package_contains_forbidden', `源码包里有 ${forbidden.length} 个不该出现的条目，已删除该包：\n` +
            forbidden.map((hit) => `  - ${hit.entry}（${hit.why}）`).join('\n'));
    }
    const bytes = statSync(archivePath).size;
    const sha256 = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
    const topLevel = [
        ...new Set(entries.map((entry) => entry.split('/')[0] ?? '').filter((name) => name !== '')),
    ].sort();
    return {
        archivePath: toRepoRelative(paths, archivePath),
        sha256,
        bytes,
        fileCount: entries.filter((entry) => !entry.endsWith('/')).length,
        topLevel,
        forbidden,
        ok: true,
    };
}
//# sourceMappingURL=package-source.js.map