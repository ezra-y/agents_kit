/**
 * 生成 `manifest.json`：这个包里有哪些文件、多大、哈希是多少。
 *
 * 规则文档：修复清单第 12 节
 *
 * ## 它是给收包的人用的
 *
 * 拿到一个 tar.gz 的人要能回答两个问题：里面到底有什么、有没有被动过。
 * manifest 就是那份清单加指纹。
 *
 * ## 只列「会进发布包」的文件
 *
 * 和 `git archive` 用同一个来源：只看 Git 跟踪、且**没被 `.gitattributes`
 * 标记 `export-ignore`** 的文件。两边不一致的话，manifest 就是在描述一个
 * 不存在的包——那比没有 manifest 更糟，因为人会信它。
 *
 * `output/`（用户要求留在本地仓库的个人简历）仍被 Git 跟踪，但用
 * `export-ignore` 排除出 archive / manifest / 隐私扫描 / 源码包。它只存在于
 * 本地仓库，不是要公开的内容，所以不该出现在收包人的清单里。
 *
 * `manifest.json` 自己不列进去：它的内容取决于清单，清单又包含它，
 * 自己算自己的哈希是算不出来的。
 */
import { execFileSync } from 'node:child_process';
import { exportIgnoredFiles } from "./git-attributes.js";
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
/** 数行数。最后一行没有换行符时也要算一行。 */
export function countLines(text) {
    if (text.length === 0) {
        return 0;
    }
    return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}
/** 会进发布包的文件：Git 跟踪、没被 `export-ignore`、排序过，不含 `manifest.json`。 */
export function trackedFiles(root) {
    const output = execFileSync('git', ['ls-files', '-z'], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
    const all = output
        .split('\0')
        .filter((file) => file !== '' && file !== 'manifest.json');
    const ignored = exportIgnoredFiles(root, all);
    return all.filter((file) => !ignored.has(file)).sort();
}
export function buildManifest(input) {
    const files = [];
    let totalBytes = 0;
    let totalLines = 0;
    for (const file of trackedFiles(input.root)) {
        const buffer = readFileSync(path.join(input.root, file));
        const lines = countLines(buffer.toString('utf8'));
        totalBytes += buffer.length;
        totalLines += lines;
        files.push({
            path: file,
            bytes: buffer.length,
            lines,
            sha256: createHash('sha256').update(buffer).digest('hex'),
        });
    }
    return {
        name: input.name,
        version: input.version,
        date: input.date,
        description: input.description,
        file_count_excluding_manifest: files.length,
        total_bytes_excluding_manifest: totalBytes,
        total_text_lines_excluding_manifest: totalLines,
        files,
    };
}
//# sourceMappingURL=build-manifest.js.map