/**
 * 从 Git 读取 `export-ignore` 属性事实，不维护自己的目录清单。
 *
 * `.gitattributes` 是「哪些文件只留在本地仓库、不进发布副本」的唯一事实源。
 * `git archive` 已经按它排除内容；这里把同一份事实暴露给隐私审计和
 * 副本检查，两边用 Git 自己算出来的同一份清单，避免第二套硬编码目录。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
/**
 * 挑出 `files` 里被 `export-ignore` 排除的路径。
 *
 * 目录规则（如 `/output/`）只对「带尾斜杠的目录路径」报告 set，
 * `git check-attr` 查里面的文件永远返回 unspecified。所以每个文件要往上
 * 查所有祖先目录（带尾斜杠），任何一个祖先命中 `set` 就算被排除——
 * 这正是 `git archive` 的行为。文件本身的规则（如 `*.html`）直接命中。
 *
 * 查询失败时报错前查不到就返回空集：**不跳过任何文件**，失败方向是
 * 多扫而不是漏扫。
 */
export function exportIgnoredFiles(root, files) {
    const ignored = new Set();
    if (files.length === 0) {
        return ignored;
    }
    const candidates = new Set();
    for (const file of files) {
        candidates.add(file);
        let dir = path.posix.dirname(file);
        while (dir !== '.') {
            candidates.add(dir);
            candidates.add(`${dir}/`);
            dir = path.posix.dirname(dir);
        }
    }
    let output;
    try {
        output = execFileSync('git', ['check-attr', '--stdin', '-z', 'export-ignore'], {
            cwd: root,
            input: `${[...candidates].join('\u0000')}\u0000`,
            maxBuffer: 64 * 1024 * 1024,
        });
    }
    catch {
        return ignored;
    }
    const attrSet = new Set();
    const parts = output
        .toString('utf8')
        .split('\u0000')
        .filter((part) => part !== '');
    let index = 0;
    while (index + 2 < parts.length) {
        const pathName = parts[index];
        const value = parts[index + 2];
        if (pathName !== undefined && value === 'set') {
            attrSet.add(pathName);
        }
        index += 3;
    }
    for (const file of files) {
        if (attrSet.has(file)) {
            ignored.add(file);
            continue;
        }
        let dir = path.posix.dirname(file);
        while (dir !== '.') {
            if (attrSet.has(dir) || attrSet.has(`${dir}/`)) {
                ignored.add(file);
                break;
            }
            dir = path.posix.dirname(dir);
        }
    }
    return ignored;
}
//# sourceMappingURL=git-attributes.js.map