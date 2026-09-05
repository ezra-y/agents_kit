import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, } from 'node:fs';
import path from 'node:path';
import { isInsideLocalRoot, toRepoRelative } from "../config/paths.js";
const README = `# official-apply

企业招聘官网网申执行器。官网页面字段是唯一事实源，填写和最终提交严格分开。

## 安装

\`\`\`bash
npm install --omit=dev
node bin/applyctl.js init
node bin/applyctl.js doctor
\`\`\`

## 入口

\`\`\`bash
node bin/applyctl.js --help
node bin/applyctl-mcp.js
\`\`\`

私有数据使用 \`OFFICIAL_APPLY_DATA_DIR\` 或 \`~/.config/official-apply/config.json\` 中的 dataRoot。
安装默认 \`~/.local/share/official-apply\`，开发模式默认代码根目录的 \`.local/\`。
升级插件保留同一份数据；不要把私人数据复制进插件包。
最终提交必须由用户明确确认；结果不确定时不得重复提交。
`;
const FORBIDDEN_PARTS = new Set([
    '.git',
    'node_modules',
    'tests',
    'implementation',
    'appendix',
    'fixtures',
]);
function packageError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
function copy(paths, relative, outputDir) {
    const source = path.join(paths.root, relative);
    if (!existsSync(source)) {
        throw packageError('skill_package_source_missing', relative);
    }
    const target = path.join(outputDir, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(source, target, {
        recursive: true,
        filter: (file) => path.basename(file) !== '.DS_Store' &&
            !(relative === 'skills' && path.basename(file) === 'qiuzhao-feed'),
    });
}
function listFiles(root, current = root) {
    const files = [];
    for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
            files.push(...listFiles(root, full));
        }
        else {
            files.push(path.relative(root, full));
        }
    }
    return files.sort();
}
function runtimePackageJson(paths) {
    const source = JSON.parse(readFileSync(path.join(paths.root, 'package.json'), 'utf8'));
    const lock = JSON.parse(readFileSync(path.join(paths.root, 'package-lock.json'), 'utf8'));
    const versionOf = (name) => {
        const version = lock.packages[`node_modules/${name}`]?.version;
        if (version === undefined) {
            throw packageError('skill_package_dependency_missing', name);
        }
        return version;
    };
    return {
        name: source.name,
        version: source.version,
        private: true,
        description: source.description,
        type: source.type,
        engines: source.engines,
        scripts: {
            init: 'node bin/applyctl.js init',
            cli: 'node bin/applyctl.js',
            mcp: 'node bin/applyctl-mcp.js',
            doctor: 'node bin/applyctl.js doctor',
        },
        dependencies: {
            'pdfjs-dist': versionOf('pdfjs-dist'),
            playwright: versionOf('playwright'),
            yaml: versionOf('yaml'),
        },
        bin: source.bin,
    };
}
export function packageSkill(paths) {
    const outputDir = path.join(paths.localRoot, 'packages', 'official-apply');
    if (!isInsideLocalRoot(paths, outputDir)) {
        throw packageError('skill_package_outside_local', outputDir);
    }
    if (!existsSync(path.join(paths.root, 'dist', 'bin', 'applyctl.js'))) {
        throw packageError('skill_package_dist_missing', '先运行 npm run build');
    }
    rmSync(outputDir, { recursive: true, force: true });
    mkdirSync(outputDir, { recursive: true });
    for (const entry of [
        'skills',
        '.codex-plugin',
        'examples/application-queue.example.csv',
        '.gitignore',
        '.mcp.json',
        '.codex/config.toml',
        'agents/openai.yaml',
        'bin/applyctl.js',
        'bin/applyctl-mcp.js',
        'bin/launch.js',
        'dist',
        'knowledge',
        'schemas/knowledge.sql',
        'schemas/private.sql',
        'schemas/runtime.sql',
        '.local/README.md',
    ]) {
        copy(paths, entry, outputDir);
    }
    const ignorePath = path.join(outputDir, '.gitignore');
    writeFileSync(ignorePath, readFileSync(ignorePath, 'utf8').replace(/^dist\/\r?\n/m, ''));
    const agentPath = path.join(outputDir, 'agents', 'openai.yaml');
    writeFileSync(agentPath, readFileSync(agentPath, 'utf8')
        .replaceAll('src/adapters/codex/runtime-adapter.ts', 'dist/src/adapters/codex/runtime-adapter.js')
        .replaceAll('src/adapters/codex/visual-fallback-adapter.ts', 'dist/src/adapters/codex/visual-fallback-adapter.js'));
    writeFileSync(path.join(outputDir, 'package.json'), `${JSON.stringify(runtimePackageJson(paths), null, 2)}\n`);
    writeFileSync(path.join(outputDir, 'README.md'), README);
    execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: outputDir, stdio: ['ignore', 'ignore', 'pipe'] });
    const files = listFiles(outputDir);
    const forbidden = files.filter((file) => FORBIDDEN_PARTS.has(file.split(path.sep)[0] ?? ''));
    if (forbidden.length > 0) {
        throw packageError('skill_package_contains_forbidden', forbidden.join(', '));
    }
    return {
        outputDir: toRepoRelative(paths, outputDir),
        files,
        bytes: files.reduce((total, file) => total + statSync(path.join(outputDir, file)).size, 0),
    };
}
//# sourceMappingURL=package-skill.js.map