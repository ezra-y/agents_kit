/**
 * 扫描 tracked 文件和 Git 暂存区中的个人信息、密钥和本机路径。
 *
 * 规则文档：
 * - `docs/14_个人使用到开源的渐进成长流程.md §13`
 * - `docs/10_状态提交安全隐私与错误恢复.md §12-§13`
 *
 * 和 `checkGitBoundary()` 的分工：
 *
 * | | 管什么 | 什么时候跑 |
 * | --- | --- | --- |
 * | `checkGitBoundary()` | `.local/` 有没有跑进 Git、公开目录有没有数据库 | 每次 commit |
 * | `runSanitationAudit()` | tracked 文件的**内容**里有没有个人信息 | 开源前、定期 |
 *
 * `docs/14 §13` 明说「不能只依赖一个 secret scanner」，所以这里的规则比
 * 边界检查多一层：邮箱、学校公司组合、简历文件名、申请编号也要看。
 *
 * ## 边界：`export-ignore` 标记的路径不扫
 *
 * `output/`（用户明确要求保存的本地简历）用 `.gitattributes` 标记为
 * `export-ignore`。它**不会**进 `git archive`、源码包或发布副本——那些才是
 * 要公开的东西，所以审计跳过它是用 Git 的属性事实来对齐发布边界，
 * 而不是给隐私开一条全局后门。其余 tracked 文件（源码、测试、知识库）一视同仁照扫。
 *
 * `stagedOnly` 查的是「准备发布到暂存区的内容」，语义相同，同样跳过
 * `export-ignore` 路径。
 *
 * **结果绝不回显命中的原值。** 只报文件、行号和规则名。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { exportIgnoredFiles } from "./git-attributes.js";
/**
 * 行内豁免标记。
 *
 * 扫描器自己的规则、测试样本和脱敏说明文档必须写出「像个人信息的字符串」。
 * 和 `checkGitBoundary()` 用同一个标记，保持一致。
 */
const ALLOW_MARKER = 'boundary-allow';
/**
 * 文件级豁免标记。
 *
 * 有些文件天生要塞满假手机号、假 Token、假身份证——比如扫描器自己的测试。
 * 一行一行加标记会淹没内容，所以允许在文件**前 30 行**声明一次，豁免整份文件。
 *
 * 两条限制，防止它变成万能后门：
 *
 * 1. **`src/` 下的文件不能用。** 生产代码里真出现手机号或密钥必须照拦。
 *    扫描器自己的规则表用行内 `boundary-allow`，一行一条，看得见。
 * 2. 必须写明原因，否则不生效。
 *
 * 用法（写在文件头注释里）：
 * `boundary-allow-file: 这份夹具全是合成测试值`
 */
const FILE_ALLOW_MARKER = 'boundary-allow-file:';
const FILE_ALLOW_SCAN_LINES = 30;
/** 整份文件是否被显式豁免。`src/` 下一律不认。 */
export function fileAllowReason(content, relativePath) {
    const normalized = relativePath.split(path.sep).join('/');
    if (normalized === 'src' || normalized.startsWith('src/')) {
        return undefined;
    }
    for (const line of content.split('\n').slice(0, FILE_ALLOW_SCAN_LINES)) {
        const at = line.indexOf(FILE_ALLOW_MARKER);
        if (at < 0) {
            continue;
        }
        const reason = line
            .slice(at + FILE_ALLOW_MARKER.length)
            .replace(/\*\/\s*$/, '')
            .trim();
        if (reason !== '') {
            return reason;
        }
    }
    return undefined;
}
const MAX_TEXT_SCAN_BYTES = 2 * 1024 * 1024;
/** 二进制和产物文件不扫。 */
const SKIP_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.zip', '.tar',
    '.woff', '.woff2', '.ttf', '.ico', '.mp4', '.sqlite',
]);
/**
 * 文档和测试里公认的占位值。
 *
 * 这些数字是规格包和测试自己造的假值，形状像手机号和身份证号，
 * 但不属于任何人。显式列出来，比让扫描器去猜「哪个像假的」可靠得多：
 * 名单之外的任何一个真实号码仍然会被拦下。
 */
const PLACEHOLDER_VALUES = new Set([
    '13000000000',
    '13000000001',
    '13000000002',
    '13800001111',
    '13911112222',
    '110000199001010000',
]);
/**
 * 长十六进制串里的数字不是手机号。
 *
 * SHA-256 校验和里很容易凑出 11 位连续数字。真在 manifest.json 里撞到过两次。
 */
function isInsideLongHexToken(line, match) {
    const tokens = line.split(/[^0-9a-fA-F]+/);
    return tokens.some((token) => token.length >= 32 && token.includes(match));
}
/**
 * `docs/14 §13` 点名要扫的东西，逐条落成规则。
 *
 * 正则都写成「必须后接真实取值」的形式，所以这个文件本身不会命中自己。
 */
const AUDIT_RULES = [
    {
        id: 'mobile_number',
        severity: 'blocking',
        pattern: /(?<![\d*])1[3-9]\d{9}(?![\d*])/,
        detail: '疑似手机号',
    },
    {
        id: 'id_number',
        severity: 'blocking',
        pattern: /(?<![\dXx])\d{17}[\dXx](?![\dXx])/,
        detail: '疑似身份证号',
    },
    {
        id: 'email_address',
        severity: 'warning',
        // example.com 这类保留域名是文档里正常会用的，不算问题。
        pattern: /\b[A-Za-z0-9._%+-]+@(?!example\.(?:com|org|net)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
        detail: '疑似真实邮箱地址',
    },
    {
        id: 'authorization_header',
        severity: 'blocking',
        pattern: /authorization\s*[:=]\s*(bearer|basic|token)\s+\S{8,}/i,
        detail: '疑似 Authorization 头',
    },
    {
        id: 'cookie_value',
        severity: 'blocking',
        pattern: /(^|\b)(set-)?cookie\s*[:=]\s*[^\s"']{8,}/i,
        detail: '疑似 Cookie 值',
    },
    {
        id: 'api_token',
        severity: 'blocking',
        pattern: /\b(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/,
        detail: '疑似 API Token',
    },
    {
        id: 'private_key_block',
        severity: 'blocking',
        pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
        detail: '疑似私钥',
    },
    {
        id: 'machine_home_path',
        severity: 'blocking',
        pattern: /(?:^|[\s"'(=:])\/(?:Users|home)\/[A-Za-z0-9._-]+\//,
        detail: '疑似本机用户目录绝对路径',
    },
    {
        id: 'resume_file_name',
        severity: 'blocking',
        // 姓名加「简历」的文件名会同时暴露身份和材料。 boundary-allow
        //
        // `synthetic-` 是本项目约定的**合成材料前缀**（修复清单 P2-4「固定测试哨兵值」）。
        // 测试和文档里的假材料一律用它开头，扫描器认这个前缀，不当成真人材料。
        // 前后各加一个「不是词的一部分」的断言，否则正则会从 synthetic 中间
        // 的 ynthetic- 重新起头，白名单就形同虚设。
        pattern: /(?<![\p{Script=Han}A-Za-z0-9_-])(?!synthetic[-_])[\p{Script=Han}A-Za-z0-9]{2,}[-_](?:简历|resume|cv)[-_v0-9]*\.(?:pdf|docx?|zip)/iu,
        detail: '疑似真实简历文件名',
    },
    {
        id: 'application_id',
        severity: 'warning',
        pattern: /(?:申请编号|投递编号|application[ _-]?id)\s*[:：=]\s*[A-Za-z0-9]{6,}/i,
        detail: '疑似申请编号',
    },
    {
        id: 'school_company_pair',
        severity: 'warning',
        // 学校和公司同时出现，足以定位到具体一个人。
        pattern: /[\p{Script=Han}]{2,}(?:大学|学院)[^\n]{0,20}(?:有限公司|集团|股份)/u,
        detail: '疑似真实学校与公司组合',
    },
];
function runGit(cwd, args) {
    try {
        const stdout = execFileSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
        return stdout
            .toString('utf8')
            .split('\u0000')
            .filter((entry) => entry.length > 0);
    }
    catch {
        return [];
    }
}
function shouldScan(relativePath) {
    return !SKIP_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}
/**
 * 逐行扫一段文本。命中只记行号和规则，不记原值。
 *
 * 单独拆出来是因为有的调用方要在**写文件之前**判断内容能不能公开
 * （比如 `promoteKnowledgeProposal()`）。那时候文件还不存在，
 * 而且把待检内容先落到磁盘再扫，本身就是一次泄漏。
 */
export function scanTextForPersonalData(content, label, extraSecrets = []) {
    return scanLines(content, label, extraSecrets);
}
/** 逐行扫一个文件。命中只记行号和规则，不记原值。 */
export function scanFileForPersonalData(absolutePath, relativePath, extraSecrets) {
    let content;
    try {
        if (statSync(absolutePath).size > MAX_TEXT_SCAN_BYTES) {
            return [];
        }
        content = readFileSync(absolutePath, 'utf8');
    }
    catch {
        return [];
    }
    return scanLines(content, relativePath, extraSecrets);
}
function scanLines(content, relativePath, extraSecrets) {
    // 二进制文件读出来会带 NUL，直接跳过。
    if (content.includes('\u0000')) {
        return [];
    }
    // 整份文件被显式豁免（例如扫描器自己的测试样本）。
    if (fileAllowReason(content, relativePath) !== undefined) {
        return [];
    }
    const findings = [];
    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        if (line.includes(ALLOW_MARKER)) {
            continue;
        }
        for (const rule of AUDIT_RULES) {
            const hit = rule.pattern.exec(line);
            if (hit !== null) {
                const matched = hit[0];
                if (PLACEHOLDER_VALUES.has(matched) || isInsideLongHexToken(line, matched)) {
                    continue;
                }
                findings.push({
                    file: relativePath,
                    line: index + 1,
                    rule: rule.id,
                    severity: rule.severity,
                    detail: `${rule.detail}（规则 ${rule.id}）；原值已省略`,
                });
            }
        }
        // 用户自己登记的真实值。命中一定是阻塞级。
        for (const secret of extraSecrets) {
            if (secret.length >= 2 && line.includes(secret)) {
                findings.push({
                    file: relativePath,
                    line: index + 1,
                    rule: 'user_supplied_secret',
                    severity: 'blocking',
                    detail: '命中你自己登记的真实值；原值已省略',
                });
            }
        }
    }
    return findings;
}
export function runSanitationAudit(request) {
    const checkedAt = request.now ?? new Date().toISOString();
    const root = request.paths.root;
    const extraSecrets = request.extraSecrets ?? [];
    const files = request.stagedOnly
        ? runGit(root, ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'])
        : runGit(root, ['ls-files', '-z']);
    // `.gitattributes` 的 export-ignore 文件不会进 git archive / 源码包 /
    // 发布副本，所以不算「要发布的内容」。审计和副本检查都认 Git 属性事实，
    // 不维护第二套目录清单。
    const exportIgnored = exportIgnoredFiles(root, files);
    const findings = [];
    let scannedFileCount = 0;
    for (const relativePath of files) {
        if (exportIgnored.has(relativePath)) {
            continue;
        }
        if (!shouldScan(relativePath)) {
            continue;
        }
        const absolutePath = path.join(root, relativePath);
        if (!existsSync(absolutePath)) {
            continue;
        }
        scannedFileCount += 1;
        findings.push(...scanFileForPersonalData(absolutePath, relativePath, extraSecrets));
    }
    const countsByRule = {};
    for (const finding of findings) {
        countsByRule[finding.rule] = (countsByRule[finding.rule] ?? 0) + 1;
    }
    return {
        // 只有阻塞级才算不通过。warning 要人看一眼，但不拦住开源。
        ok: findings.every((finding) => finding.severity !== 'blocking'),
        checkedAt,
        scannedFileCount,
        findings,
        countsByRule,
    };
}
//# sourceMappingURL=run-sanitation-audit.js.map