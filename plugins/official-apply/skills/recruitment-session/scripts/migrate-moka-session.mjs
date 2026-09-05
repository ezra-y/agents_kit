#!/usr/bin/env node

import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

const COOKIE_NAMES = new Set([
  'connect.sid',
  'moka-token',
  'moka-apply',
  'csrfCk',
  'locale',
]);

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv.includes('--help')) {
  process.stdout.write(
    [
      'Usage: node skills/recruitment-session/scripts/migrate-moka-session.mjs',
      '  --from-profile <logged-in-profile>',
      '  --to-profile <target-profile>',
      '  --target-host <company-moka-host>',
      '  [--dry-run]',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

const fromProfile = option('--from-profile');
const toProfile = option('--to-profile');
const targetHost = option('--target-host');
const dryRun = process.argv.includes('--dry-run');

for (const [name, value] of [
  ['--from-profile', fromProfile],
  ['--to-profile', toProfile],
]) {
  if (value === undefined || !/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`${name} 只能包含字母、数字、点、下划线和短横线`);
  }
}
if (
  targetHost === undefined ||
  targetHost.includes('/') ||
  !/^[A-Za-z0-9.-]+$/.test(targetHost)
) {
  throw new Error('--target-host 必须是完整域名，不带协议和路径');
}

const root = path.resolve('.local/browser-profile');
const sourcePath = path.join(
  root,
  fromProfile,
  '.official-apply-web-state.json',
);
const targetDir = path.join(root, toProfile);
const targetPath = path.join(targetDir, '.official-apply-web-state.json');
const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const target = await readFile(targetPath, 'utf8')
  .then((value) => JSON.parse(value))
  .catch(() => ({ version: 2, origins: {}, cookies: [] }));

if (source.version !== 2 || !Array.isArray(source.cookies)) {
  throw new Error('源 profile 不是可迁移的 version 2 登录态');
}
if (target.version !== 2 || !Array.isArray(target.cookies)) {
  throw new Error('目标 profile 不是可迁移的 version 2 登录态');
}

const migrated = source.cookies
  .filter((cookie) => COOKIE_NAMES.has(cookie.name))
  .map((cookie) => ({
    ...cookie,
    domain: targetHost,
    path: '/',
  }));
if (migrated.length !== COOKIE_NAMES.size) {
  const found = new Set(migrated.map((cookie) => cookie.name));
  const missing = [...COOKIE_NAMES].filter((name) => !found.has(name));
  throw new Error(`源 profile 缺少 Moka Cookie：${missing.join('、')}`);
}

const next = {
  ...target,
  cookies: [
    ...target.cookies.filter(
      (cookie) =>
        !(
          cookie.domain.replace(/^\./, '') === targetHost &&
          COOKIE_NAMES.has(cookie.name)
        ),
    ),
    ...migrated,
  ],
};

let backupPath;
if (!dryRun) {
  await mkdir(targetDir, { recursive: true, mode: 0o700 });
  const targetExists = await readFile(targetPath)
    .then(() => true)
    .catch(() => false);
  if (targetExists) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = `${targetPath}.bak-${stamp}`;
    await copyFile(targetPath, backupPath);
  }
  await writeFile(targetPath, `${JSON.stringify(next, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(targetPath, 0o600);
}

process.stdout.write(
  `${JSON.stringify(
    {
      dryRun,
      fromProfile,
      toProfile,
      targetHost,
      migratedCookieNames: migrated.map((cookie) => cookie.name),
      migratedCount: migrated.length,
      copiedLocalStorage: false,
      backupPath,
    },
    null,
    2,
  )}\n`,
);
