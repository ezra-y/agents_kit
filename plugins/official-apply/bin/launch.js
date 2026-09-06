/**
 * 入口启动器。**故意写成普通 JavaScript**，因为它要在「Node 还不认识
 * TypeScript」的机器上先跑起来，然后才有资格谈怎么加载 `.ts`。
 *
 * 规则文档：修复清单 P2-1
 *
 * ## 要解决的问题
 *
 * `.mcp.json` 原来直接写 `node bin/applyctl-mcp.ts`。
 * 这在 Node 23.6 以上没问题（原生类型擦除），但在 Node 22.6～23.5 上
 * 需要 `--experimental-strip-types`，在更老的版本上根本跑不了。
 * 用户 clone 下来一跑，看到的是一句看不懂的语法错误。
 *
 * ## 三条路，按可靠程度排
 *
 * 1. **有 `dist/`**：直接跑编译好的 JS。发布形态就是这个，最稳。
 * 2. **Node 认识 TypeScript**：直接跑源码，开发时不用先编译。
 * 3. **都不行**：**明确报错并告诉用户跑什么命令**。
 *
 * 第三条是关键。静默失败或者半跑起来，比直接报错难查得多。
 */
import { existsSync, readdirSync, statSync, readFileSync, mkdirSync, copyFileSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/**
 * 这个 Node 能不能直接跑 `.ts`。
 *
 * @param {string} version 例如 `'22.14.0'`
 * @param {string} flags 命令行参数和 NODE_OPTIONS 拼起来的字符串
 */
export function nodeStripsTypes(version, flags = '') {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  // 23.6 起默认开启；22.6～23.5 需要显式参数，这里只认默认开启的情况。
  if (major > 23) {
    return true;
  }
  if (major === 23 && minor >= 6) {
    return true;
  }
  // 用户自己加了参数也算。
  return flags.includes('strip-types');
}

/**
 * 决定该加载哪个文件。**纯函数**，不碰磁盘也不加载任何东西——
 * 这样「在老 Node 上会怎样」才测得了，不用真去装一个老 Node。
 *
 * 顺序有一条不显然但很重要：**源码比产物新时优先跑源码**。
 *
 * 只警告不改行为是不够的。改完 `src/` 直接跑 CLI 会跑到上一次编译的产物上，
 * 连测试也一样——起子进程验入口的那几条测试拿到的是旧代码，
 * 于是「我明明改了怎么还红」。
 *
 * 发布形态里没有 `src/*.ts`，「更新」永远不成立，所以照旧跑 dist。
 *
 * @param {{ distExists: boolean, sourceExists: boolean, stripsTypes: boolean, sourceIsNewer?: boolean }} state
 * @returns {{ kind: 'dist' | 'source' | 'unsupported' }}
 */
export function chooseEntry(state) {
  const canRunSource = state.stripsTypes && state.sourceExists;

  if (state.distExists) {
    return canRunSource && state.sourceIsNewer === true ? { kind: 'source' } : { kind: 'dist' };
  }
  if (canRunSource) {
    return { kind: 'source' };
  }
  return { kind: 'unsupported' };
}

/**
 * 跑不了时给用户看的话。
 *
 * 分成一个函数是因为**这是用户唯一看得到的东西**：
 * 静默失败或者一句看不懂的语法错误，比什么都难查。
 *
 * @param {string} version
 * @param {string} missingCompiled
 */
export function unsupportedMessage(version, missingCompiled) {
  return [
    `official-apply：这个 Node（v${version}）不能直接运行 TypeScript 源码，`,
    '而且还没有编译产物。二选一：',
    '',
    '  1. 编译一次（推荐，发布形态就是这个）：',
    '       npm install && npm run build',
    '',
    '  2. 换到 Node 23.6 或更高版本，它能直接跑 .ts。',
    '',
    `找不到的编译产物：${missingCompiled}`,
    '',
  ].join('\n');
}

/**
 * 源码比编译产物新吗。
 *
 * 这个检查是踩出来才加的：改完 `src/` 直接跑 CLI，跑的却是上一次编译的产物，
 * 于是「我明明改了怎么没生效」查了半天。产物默默盖住源码，
 * 正是这个项目一直在铲除的那类静默失败。
 *
 * 只警告不阻断：编译产物本身没错，只是旧了。
 *
 * @param {string} compiled 编译产物的绝对路径
 * @returns {boolean}
 */
function distIsStale(compiled) {
  let builtAt;
  try {
    builtAt = statSync(compiled).mtimeMs;
  } catch {
    return false;
  }

  /** @param {string} dir @returns {number} */
  const newestUnder = (dir) => {
    let newest = 0;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return 0;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        newest = Math.max(newest, newestUnder(full));
      } else if (entry.name.endsWith('.ts')) {
        try {
          newest = Math.max(newest, statSync(full).mtimeMs);
        } catch {
          // 读不到就跳过，这只是个提醒。
        }
      }
    }
    return newest;
  };

  return Math.max(newestUnder(path.join(ROOT, 'src')), newestUnder(path.join(ROOT, 'bin'))) > builtAt;
}

/**
 * 找到入口文件并加载它。
 *
 * @param {string} relativeEntry 相对仓库根目录的入口，例如 `bin/applyctl.ts`
 */
export async function launch(relativeEntry) {
  if (existsSync(path.join(ROOT, '.codex-plugin', 'plugin.json'))) {
    if (!process.env.OFFICIAL_APPLY_DATA_DIR) {
      const configFile = path.join(homedir(), '.config', 'official-apply', 'config.json');
      const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : {};
      process.env.OFFICIAL_APPLY_DATA_DIR = config.dataRoot ?? path.join(homedir(), '.local', 'share', 'official-apply');
    }
    const configFile = path.join(homedir(), '.config', 'official-apply', 'config.json');
    if (!process.env.OFFICIAL_APPLY_BROWSER_CHANNEL && existsSync(configFile)) {
      const config = JSON.parse(readFileSync(configFile, 'utf8'));
      if (config.browserChannel) process.env.OFFICIAL_APPLY_BROWSER_CHANNEL = config.browserChannel;
    }
    const require = createRequire(path.join(ROOT, 'package.json'));
    try {
      for (const name of ['yaml', 'playwright', 'pdfjs-dist/package.json']) require.resolve(name);
    } catch {
      const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
      const dependenciesRoot = path.join(homedir(), '.cache', 'official-apply', 'dependencies', pkg.version);
      const lock = readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8');
      const sharedLock = path.join(dependenciesRoot, 'package-lock.json');
      let ready = existsSync(sharedLock) && readFileSync(sharedLock, 'utf8') === lock;
      try {
        const sharedRequire = createRequire(path.join(dependenciesRoot, 'package.json'));
        for (const name of ['yaml', 'playwright', 'pdfjs-dist/package.json']) sharedRequire.resolve(name);
      } catch { ready = false; }
      if (!ready) {
        process.stderr.write('网申助手：正在准备运行依赖。\n');
        mkdirSync(dependenciesRoot, { recursive: true });
        for (const file of ['package.json', 'package-lock.json']) copyFileSync(path.join(ROOT, file), path.join(dependenciesRoot, file));
        execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
          ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
          { cwd: dependenciesRoot, stdio: ['ignore', 'ignore', 'pipe'] });
      }
      if (!existsSync(path.join(ROOT, 'node_modules'))) {
        symlinkSync(path.join(dependenciesRoot, 'node_modules'), path.join(ROOT, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
      }
    }
  }
  const compiled = path.join(ROOT, 'dist', relativeEntry.replace(/\.ts$/, '.js'));
  const source = path.join(ROOT, relativeEntry);
  const flags = process.execArgv.join(' ') + (process.env['NODE_OPTIONS'] ?? '');

  const distExists = existsSync(compiled);
  const sourceIsNewer = distExists && distIsStale(compiled);
  const choice = chooseEntry({
    distExists,
    sourceExists: existsSync(source),
    stripsTypes: nodeStripsTypes(process.versions.node, flags),
    sourceIsNewer,
  });

  if (choice.kind === 'source' && sourceIsNewer) {
    process.stderr.write(
      '[official-apply] dist/ 比源码旧，这次跑的是源码。要用编译产物请先 npm run build。\n',
    );
  }

  if (choice.kind === 'dist') {
    return import(pathToFileURL(compiled).href);
  }
  if (choice.kind === 'source') {
    return import(pathToFileURL(source).href);
  }

  process.stderr.write(unsupportedMessage(process.versions.node, path.relative(ROOT, compiled)));
  process.exit(1);
}
