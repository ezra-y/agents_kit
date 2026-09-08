#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../../../bin/launch.js';
import { createCaptchaCase } from './captcha-case.mjs';

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
const separator = args.indexOf('--');
const solvers = { jigsaw: 'solve-jigsaw-captcha.py', rotation: 'solve-rotation-captcha.py',
  overlay_rotation: 'solve-overlay-rotation-captcha.py' };
const type = args.includes('--type') ? option('--type') : undefined;
if (args.includes('--help') || !solvers[type] || separator < 0) {
  console.log('用法：node import-captcha-case.mjs --type jigsaw|rotation|overlay_rotation [--page-url <来源页>] -- <求解器图片参数>');
  console.log('例：--type jigsaw -- --background /path/background.png --piece /path/piece.png');
  console.log('复制已有图片形成长期案例并离线求解；不访问网站，不改动原图片。');
  process.exit(args.includes('--help') ? 0 : 1);
}
const { getSkillPaths } = await launch('src/config/paths.ts');
const record = createCaptchaCase({ evidenceDir: getSkillPaths().evidenceDir, type,
  pageUrl: args.includes('--page-url') ? option('--page-url') : undefined,
  solver: path.join(path.dirname(fileURLToPath(import.meta.url)), solvers[type]),
  sessionScript: fileURLToPath(import.meta.url) });
try {
  record.record('import', { sourceFiles: args.slice(separator + 1).filter(value => !value.startsWith('--')) });
  const solution = record.solve(args.slice(separator + 1));
  record.finish('offline_import', { note: '离线导入，未执行网站验证；求解输出不是正确答案标签。' });
  console.log(JSON.stringify({ caseDirectory: record.directory, solution }));
} catch (error) {
  record.fail(error);
  console.log(JSON.stringify({ caseDirectory: record.directory, error: error.message }));
  process.exitCode = 1;
}
