#!/usr/bin/env node
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replayCaptchaCase } from './captcha-case.mjs';

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help')) {
  console.log('用法：node replay-captcha-cases.mjs <案例目录或案例根目录> [--solver-dir <新版脚本目录>] [--baseline]');
  console.log('离线重新求解，不访问网站；--baseline 使用案例中保留的原版求解器。没有人工确认答案的案例只报告变化。');
  process.exit(args.includes('--help') ? 0 : 1);
}
const root = path.resolve(args[0]);
const option = args.indexOf('--solver-dir');
const solverDir = option < 0 ? path.dirname(fileURLToPath(import.meta.url)) : path.resolve(args[option + 1]);
function cases(directory) {
  if (existsSync(path.join(directory, 'case.json'))) return [directory];
  return readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory())
    .flatMap(entry => cases(path.join(directory, entry.name)));
}
const results = cases(root).map(directory => replayCaptchaCase(directory, {
  solverDir, baseline: args.includes('--baseline'),
}));
const report = { createdAt: new Date().toISOString(), cases: results,
  counts: Object.fromEntries(['passed', 'failed', 'unlabelled', 'no_solver_input']
    .map(status => [status, results.filter(result => result.status === status).length])) };
const output = path.join(root, `replay-${Date.now()}.json`);
writeFileSync(output, JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ report: output, caseCount: results.length, counts: report.counts }));
process.exitCode = results.length === 0 || report.counts.failed > 0 ? 1 : 0;
