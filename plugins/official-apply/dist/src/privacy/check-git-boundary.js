/**
 * Git 边界检查：第二道保护。
 *
 * 规则文档：
 * - `docs/02_系统架构与代码落点.md §3.4-3.5`
 * - `docs/10_状态提交安全隐私与错误恢复.md §12.2`
 *
 * `.gitignore` 只是方便，`git add -f` 能绕过它。这个函数负责把绕过行为变成明确失败。
 *
 * 检查四件事：
 * 1. `.local/` 里除 README 外是否已被跟踪。
 * 2. 暂存区是否混入 `.local/` 文件。
 * 3. 公开目录是否出现真实 SQLite 数据库（按文件头判断，不看扩展名）。
 * 4. 被跟踪文件里是否出现 Cookie、Token、私钥或本机绝对路径。
 */
import { execFileSync } from 'node:child_process';
import { openSync, readSync, closeSync, readdirSync, readFileSync, statSync, existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { toRepoRelative } from "../config/paths.js";
import { exportIgnoredFiles } from "./git-attributes.js";
import { fileAllowReason } from "./run-sanitation-audit.js";
const LOCAL_PREFIX = '.local/';
const ALLOWED_TRACKED_LOCAL_FILES = new Set(['.local/README.md']);
/** 扫描真实数据库时跳过的目录。 */
const SCAN_SKIP_DIRS = new Set(['.git', '.local', 'node_modules', 'dist', 'build', 'coverage']);
const SQLITE_HEADER = Buffer.concat([Buffer.from('SQLite format 3', 'latin1'), Buffer.from([0])]);
const MAX_TEXT_SCAN_BYTES = 2 * 1024 * 1024;
/**
 * 行内豁免标记。
 *
 * 隐私扫描器自己的测试样本、脱敏夹具的说明文档等，必须在公开文件里写出「像密钥的字符串」。
 * 在同一行加上这个标记即可豁免。标记是显式的、可被 code review 看见的，不是自动放行。
 */
const ALLOW_MARKER = 'boundary-allow';
/**
 * 命中说明只写模式 id 和行号，绝不回显命中的原始值。
 * 正则本身写成「必须后接真实取值」的形式，所以本文件不会命中自己。
 */
const SENSITIVE_PATTERNS = [
    {
        id: 'authorization_header',
        severity: 'blocking',
        pattern: /authorization\s*[:=]\s*(bearer|basic|token)\s+\S{8,}/i,
        hint: '疑似 Authorization 头或访问令牌',
    },
    {
        id: 'cookie_header',
        severity: 'blocking',
        pattern: /(^|\b)(set-)?cookie["']?\s*[:=]\s*["']?[^\s"'=;]+=[^\s"']{8,}/i,
        hint: '疑似 Cookie 值',
    },
    {
        id: 'api_token',
        severity: 'blocking',
        pattern: /\b(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/,
        hint: '疑似 API Token',
    },
    {
        id: 'private_key_block',
        severity: 'blocking',
        pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
        hint: '疑似私钥文件内容',
    },
    {
        id: 'machine_absolute_path',
        severity: 'blocking',
        pattern: /(?:^|[\s"'(=:])\/(?:Users|home)\/[A-Za-z0-9._-]+\//,
        hint: '疑似本机用户绝对路径',
    },
    {
        id: 'mainland_mobile_number',
        severity: 'warning',
        pattern: /(?<![\d*])1[3-9]\d{9}(?![\d*])/,
        hint: '疑似手机号',
    },
    {
        id: 'mainland_id_number',
        severity: 'warning',
        pattern: /(?<![\dXx])\d{17}[\dXx](?![\dXx])/,
        hint: '疑似身份证号',
    },
];
function runGit(cwd, args) {
    try {
        const stdout = execFileSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
        return { ok: true, stdout };
    }
    catch {
        return { ok: false, stdout: Buffer.alloc(0) };
    }
}
function splitNulList(buffer) {
    return buffer
        .toString('utf8')
        .split('\u0000')
        .filter((entry) => entry.length > 0);
}
function isRealSqliteFile(filePath) {
    let fd;
    try {
        fd = openSync(filePath, 'r');
        const header = Buffer.alloc(SQLITE_HEADER.length);
        const bytesRead = readSync(fd, header, 0, header.length, 0);
        return bytesRead === header.length && header.equals(SQLITE_HEADER);
    }
    catch {
        return false;
    }
    finally {
        if (fd !== undefined) {
            closeSync(fd);
        }
    }
}
function collectDatabasesOutsideLocal(paths) {
    const found = [];
    const walk = (dir) => {
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (SCAN_SKIP_DIRS.has(entry.name)) {
                    continue;
                }
                walk(full);
            }
            else if (entry.isFile() && isRealSqliteFile(full)) {
                found.push(toRepoRelative(paths, full));
            }
        }
    };
    walk(paths.root);
    return found.sort();
}
function looksBinary(content) {
    const window = content.subarray(0, 8192);
    return window.includes(0);
}
function scanSensitiveContent(paths, relativeFiles) {
    const violations = [];
    for (const relative of relativeFiles) {
        const full = path.join(paths.root, relative);
        let content;
        try {
            if (statSync(full).size > MAX_TEXT_SCAN_BYTES) {
                continue;
            }
            content = readFileSync(full);
        }
        catch {
            continue;
        }
        if (looksBinary(content)) {
            continue;
        }
        const text = content.toString('utf8');
        if (fileAllowReason(text, relative) !== undefined) {
            continue;
        }
        const lines = text.split('\n');
        for (const rule of SENSITIVE_PATTERNS) {
            const lineIndex = lines.findIndex((line) => !line.includes(ALLOW_MARKER) && rule.pattern.test(line));
            if (lineIndex >= 0) {
                violations.push({
                    kind: 'sensitive_content_in_tracked_file',
                    path: relative,
                    severity: rule.severity,
                    message: `第 ${lineIndex + 1} 行${rule.hint}（规则 ${rule.id}）；原值已省略`,
                });
            }
        }
    }
    return violations;
}
export function checkGitBoundary(input) {
    const { paths } = input;
    const stagedOnly = input.stagedOnly ?? false;
    const checkedAt = new Date().toISOString();
    const topLevel = runGit(paths.root, ['rev-parse', '--show-toplevel']);
    const isGitRepository = topLevel.ok &&
        existsSync(topLevel.stdout.toString('utf8').trim()) &&
        realpathSync(topLevel.stdout.toString('utf8').trim()) === paths.root;
    const violations = [];
    const databasesOutsideLocal = collectDatabasesOutsideLocal(paths);
    for (const database of databasesOutsideLocal) {
        violations.push({
            kind: 'database_outside_local',
            path: database,
            severity: 'blocking',
            message: '真实 SQLite 数据库出现在 .local/ 之外；数据库只能放 .local/db/',
        });
    }
    if (!isGitRepository) {
        return {
            ok: violations.every((violation) => violation.severity !== 'blocking'),
            checkedAt,
            isGitRepository: false,
            trackedLocalFiles: [],
            stagedLocalFiles: [],
            databasesOutsideLocal,
            violations,
        };
    }
    const hasHead = runGit(paths.root, ['rev-parse', '--verify', '--quiet', 'HEAD']).ok;
    const indexFiles = splitNulList(runGit(paths.root, ['ls-files', '-z']).stdout);
    const stagedFiles = hasHead
        ? splitNulList(runGit(paths.root, ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']).stdout)
        : indexFiles;
    const isForbiddenLocalFile = (file) => file.startsWith(LOCAL_PREFIX) && !ALLOWED_TRACKED_LOCAL_FILES.has(file);
    const trackedLocalFiles = indexFiles.filter((file) => file.startsWith(LOCAL_PREFIX)).sort();
    const stagedLocalFiles = stagedFiles.filter(isForbiddenLocalFile).sort();
    for (const file of stagedLocalFiles) {
        violations.push({
            kind: 'local_file_staged',
            path: file,
            severity: 'blocking',
            message: '暂存区出现 .local/ 私有文件；请执行 git restore --staged 后再提交',
        });
    }
    const contentFiles = stagedOnly ? stagedFiles : indexFiles;
    const exportIgnored = exportIgnoredFiles(paths.root, contentFiles);
    const publishableContentFiles = contentFiles.filter((file) => !exportIgnored.has(file));
    if (!stagedOnly) {
        for (const file of trackedLocalFiles.filter(isForbiddenLocalFile)) {
            violations.push({
                kind: 'local_file_tracked',
                path: file,
                severity: 'blocking',
                message: '.local/ 私有文件已被 Git 跟踪；只有 .local/README.md 允许被跟踪',
            });
        }
        const probe = path.join(LOCAL_PREFIX, 'db', 'private.sqlite');
        const ignored = runGit(paths.root, ['check-ignore', '--no-index', '--quiet', probe]).ok;
        if (!ignored) {
            violations.push({
                kind: 'local_not_ignored',
                path: '.gitignore',
                severity: 'blocking',
                message: '根 .gitignore 不再忽略 .local/；请恢复 /.local/* 与 !/.local/README.md',
            });
        }
        violations.push(...scanSensitiveContent(paths, publishableContentFiles));
    }
    else {
        violations.push(...scanSensitiveContent(paths, publishableContentFiles));
    }
    return {
        ok: violations.every((violation) => violation.severity !== 'blocking'),
        checkedAt,
        isGitRepository: true,
        trackedLocalFiles,
        stagedLocalFiles,
        databasesOutsideLocal,
        violations,
    };
}
//# sourceMappingURL=check-git-boundary.js.map