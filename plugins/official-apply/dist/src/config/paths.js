/**
 * Skill 根目录与全部绝对路径的唯一事实源。
 *
 * 规则文档：
 * - `ARCHITECTURE.md §6`
 * - `docs/02_系统架构与代码落点.md §4`
 * - `docs/10_状态提交安全隐私与错误恢复.md §12`
 *
 * 三条硬规则：
 * 1. 不用 `process.cwd()` 当项目根目录。
 * 2. 不用用户主目录当默认数据根。
 * 3. 业务函数不自己拼 `.local/...`，只能用这里返回的 `SkillPaths`。
 */
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const SKILL_ROOT_ENV_VAR = 'OFFICIAL_APPLY_ROOT';
export const DATA_ROOT_ENV_VAR = 'OFFICIAL_APPLY_DATA_DIR';
/**
 * 根目录标记。
 *
 * 项目包含可见业务 Skill，根目录标记使用 `skills/recruitment-link/SKILL.md`。
 * 根目录仍取「必须有 package.json，且至少有一个项目结构标记」。
 * 详见 `implementation/IMPLEMENTATION-LOG.md` 的阶段 0 冲突记录。
 */
const REQUIRED_MARKER = 'package.json';
const STRUCTURE_MARKERS = [
    path.join('skills', 'recruitment-link', 'SKILL.md'),
    'ARCHITECTURE.md',
    path.join('implementation', 'stage-map.yaml'),
];
function bootstrapError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
function findMarkers(dir) {
    const found = [];
    if (existsSync(path.join(dir, REQUIRED_MARKER))) {
        found.push(REQUIRED_MARKER);
    }
    for (const marker of STRUCTURE_MARKERS) {
        if (existsSync(path.join(dir, marker))) {
            found.push(marker);
        }
    }
    return found;
}
function isSkillRoot(markers) {
    return markers.includes(REQUIRED_MARKER) && markers.length >= 2;
}
function normalizeDirectory(candidate) {
    const absolute = path.resolve(candidate);
    if (!existsSync(absolute)) {
        throw bootstrapError('skill_root_invalid', `目录不存在：${absolute}`);
    }
    const real = realpathSync(absolute);
    return statSync(real).isDirectory() ? real : path.dirname(real);
}
/**
 * 找到 Skill 根目录。
 *
 * 优先级：显式参数 → `OFFICIAL_APPLY_ROOT` → 从本模块文件位置向上找标记。
 * 显式来源排在最前面，否则测试和 CLI 无法把根目录指向别处。
 * 三种来源都失败时直接报错，不回退到用户主目录。
 */
export function resolveSkillRoot(options = {}) {
    const env = options.env ?? process.env;
    const explicit = options.explicitRoot ?? env[SKILL_ROOT_ENV_VAR];
    if (explicit !== undefined && explicit !== '') {
        const root = normalizeDirectory(explicit);
        const markers = findMarkers(root);
        if (!isSkillRoot(markers)) {
            throw bootstrapError('skill_root_invalid', `${root} 缺少 Skill 根目录标记（需要 ${REQUIRED_MARKER} 和 ${STRUCTURE_MARKERS.join(' / ')} 之一）`);
        }
        return {
            root,
            source: options.explicitRoot !== undefined && options.explicitRoot !== ''
                ? 'explicit_option'
                : 'environment_variable',
            markersFound: markers,
        };
    }
    const startFrom = options.startFrom ?? fileURLToPath(import.meta.url);
    let current = normalizeDirectory(startFrom);
    while (true) {
        const markers = findMarkers(current);
        if (isSkillRoot(markers)) {
            return { root: current, source: 'module_location', markersFound: markers };
        }
        const parent = path.dirname(current);
        if (parent === current) {
            throw bootstrapError('skill_root_not_found', `从 ${startFrom} 向上找不到 Skill 根目录；请设置 ${SKILL_ROOT_ENV_VAR}`);
        }
        current = parent;
    }
}
/**
 * 一次性生成所有绝对路径。
 *
 * 私有内容使用配置的数据目录；开发时默认 `<skill-root>/.local/`。公开内容留在代码根目录。
 */
export function getSkillPaths(options = {}) {
    const root = resolveSkillRoot(options).root;
    const configuredData = (options.env ?? process.env)[DATA_ROOT_ENV_VAR];
    const localRoot = configuredData ? path.resolve(configuredData) : path.join(root, '.local');
    const dbDir = path.join(localRoot, 'db');
    return {
        root,
        localRoot,
        knowledgeDb: path.join(dbDir, 'knowledge.sqlite'),
        privateDb: path.join(dbDir, 'private.sqlite'),
        runtimeDb: path.join(dbDir, 'runtime.sqlite'),
        materialsDir: path.join(localRoot, 'materials'),
        profilesDir: path.join(localRoot, 'profiles'),
        browserProfileDir: path.join(localRoot, 'browser-profile'),
        runsDir: path.join(localRoot, 'runs'),
        learningDir: path.join(localRoot, 'learning'),
        evidenceDir: path.join(localRoot, 'evidence'),
        rawFixturesDir: path.join(localRoot, 'fixtures-raw'),
        backupsDir: path.join(localRoot, 'backups'),
        publicKnowledgeDir: path.join(root, 'knowledge'),
        publicFixturesDir: path.join(root, 'fixtures'),
        dbDir,
        secretsDir: path.join(localRoot, 'secrets'),
        tmpDir: path.join(localRoot, 'tmp'),
    };
}
/** 判断某个路径是否位于 `.local/` 内。所有写私有数据的函数都必须先过这一关。 */
export function isInsideLocalRoot(paths, candidate) {
    const absolute = path.resolve(candidate);
    return absolute === paths.localRoot || absolute.startsWith(paths.localRoot + path.sep);
}
/** 判断某个路径是否位于 Skill 根目录内。 */
export function isInsideSkillRoot(paths, candidate) {
    const absolute = path.resolve(candidate);
    return absolute === paths.root || absolute.startsWith(paths.root + path.sep);
}
/** 把绝对路径转成相对 Skill 根目录、使用 `/` 分隔的展示路径。 */
export function toRepoRelative(paths, candidate) {
    return path.relative(paths.root, path.resolve(candidate)).split(path.sep).join('/');
}
//# sourceMappingURL=paths.js.map