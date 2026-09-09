#!/usr/bin/env node

import { createInterface } from 'node:readline';
import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launch } from '../../../bin/launch.js';
import { solveJigsawOnPage } from '../../../skills/recruitment-session/scripts/jigsaw-captcha-engine.mjs';

const { getSkillPaths, isInsideLocalRoot } = await launch('src/config/paths.ts');
const { createMcpServer } = await launch('src/mcp/create-mcp-server.ts');

const paths = getSkillPaths();
const evidenceDir = resolveEvidenceDir(paths, process.argv.slice(2));
mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });

const server = createMcpServer({ paths });
const stdin = process.stdin;
const stdinIsTTY = stdin.isTTY === true && typeof stdin.setRawMode === 'function';
const previousRawMode = stdinIsTTY ? stdin.isRaw : undefined;
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let sequence = nextSequence(evidenceDir);
let shutdownPromise;

if (stdinIsTTY) stdin.setRawMode(true);
if (stdinIsTTY) stdin.on('data', onRawInput);

process.stderr.write(`official-apply browser session ready; evidenceDir=${evidenceDir}\n`);

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(signal, () => {
    void shutdown(signal).then(
      () => {
        restoreStdin();
        process.exit(0);
      },
      (error) => {
        restoreStdin();
        process.stderr.write(`official-apply browser session shutdown failed: ${describeError(error)}\n`);
        process.exit(1);
      },
    );
  });
}

try {
  for await (const line of lines) {
    const text = line.trim();
    if (text === '') continue;

    const startedAt = new Date().toISOString();
    const started = performance.now();
    const number = ++sequence;
    let command;
    let result;

    try {
      command = JSON.parse(text);
      result = await execute(command, number);
    } catch (error) {
      result = {
        ok: false,
        error: describeError(error),
        ...(typeof error?.caseDirectory === 'string'
          ? { caseDirectory: error.caseDirectory }
          : {}),
      };
    }

    const finishedAt = new Date().toISOString();
    const elapsedMs = Math.round(performance.now() - started);
    const name = `${String(number).padStart(3, '0')}-${slug(command?.tool ?? command?.operation ?? 'invalid')}.json`;
    const record = {
      command: redactCommand(command),
      startedAt,
      finishedAt,
      elapsedMs,
      result,
    };
    writeFileSync(path.join(evidenceDir, name), `${JSON.stringify(record, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    appendFileSync(
      path.join(evidenceDir, 'timings.jsonl'),
      `${JSON.stringify({
        tool: command?.tool ?? command?.operation ?? 'invalid',
        runId: command?.runId ?? command?.args?.runId,
        elapsedMs,
        startedAt,
        evidence: name,
        ok: result?.ok,
      })}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );

    const output = command?.brief === true
      ? { ok: result?.ok, message: result?.message, errorCode: result?.errorCode, error: result?.error }
      : result;
    process.stdout.write(`${JSON.stringify({ evidence: name, elapsedMs, result: output })}\n`);
  }
} finally {
  restoreStdin();
  await shutdown('stdin closed');
}

async function execute(command, number) {
  if (command === null || typeof command !== 'object' || Array.isArray(command)) {
    throw new Error('每行必须是 JSON 对象');
  }

  if (typeof command.tool === 'string' && command.tool !== '') {
    const args = isRecord(command.args) ? command.args : {};
    let finalPage;
    if (command.tool === 'apply.close_run' && typeof args.runId === 'string') {
      const page = server.pageOf(args.runId);
      if (page && !page.isClosed()) {
        const screenshotPath = path.join(evidenceDir, `${String(number).padStart(3, '0')}-final-page.png`);
        try {
          await page.screenshot({ path: screenshotPath, fullPage: false, timeout: 5_000 });
          finalPage = { screenshotPath };
        } catch (error) {
          finalPage = { error: describeError(error) };
        }
      }
    }
    const result = await server.callTool(command.tool, args);
    return finalPage === undefined ? result : { ...result, finalPage };
  }

  const page = pageOf(command.runId);

  if (command.operation === 'solve_jigsaw') {
    return solveJigsawOnPage({
      page,
      evidenceDir,
      runId: command.runId,
      taskId: typeof command.taskId === 'string' ? command.taskId : undefined,
      maxAttempts: command.maxAttempts ?? 1,
      sessionScript: fileURLToPath(import.meta.url),
    });
  }

  if (command.operation === 'goto') {
    const response = await page.goto(command.url);
    return { url: page.url(), status: response?.status() };
  }

  if (command.operation === 'evaluate') {
    return page.evaluate(command.expression, command.argument);
  }

  if (command.operation === 'screenshot') {
    const { options, screenshotPath } = screenshotOptions(command, number);
    await page.screenshot(options);
    return { screenshotPath };
  }

  if (command.operation === 'locator') {
    const locator = page.locator(command.selector);
    const method = command.method;
    if (method === 'screenshot') {
      const { options, screenshotPath } = screenshotOptions(command, number);
      await locator.screenshot(options);
      return { screenshotPath };
    }
    if (typeof locator[method] !== 'function') {
      throw new Error(`locator 不支持方法：${String(method)}`);
    }
    return locator[method](...(Array.isArray(command.arguments) ? command.arguments : []));
  }

  if (command.operation === 'mouse') {
    const method = command.method;
    if (typeof page.mouse[method] !== 'function') {
      throw new Error(`mouse 不支持方法：${String(method)}`);
    }
    return page.mouse[method](...(Array.isArray(command.arguments) ? command.arguments : []));
  }

  throw new Error(`未知操作：${String(command.operation)}`);
}

function pageOf(runId) {
  if (typeof runId !== 'string' || runId === '') {
    throw new Error('页面操作缺少 runId');
  }
  const page = server.pageOf(runId);
  if (page === undefined || page === null) {
    throw new Error(`运行 ${runId} 没有活页面`);
  }
  return page;
}

function screenshotOptions(command, number) {
  const raw = Array.isArray(command.arguments) ? command.arguments[0] : undefined;
  if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw))) {
    throw new Error('截图 arguments 必须是一个选项对象');
  }
  const requested = typeof raw?.path === 'string' ? raw.path : undefined;
  const screenshotPath = requested === undefined
    ? path.join(evidenceDir, `${String(number).padStart(3, '0')}-screenshot.png`)
    : path.resolve(paths.localRoot, requested);
  if (!isInsideLocalRoot(paths, screenshotPath)) {
    throw new Error(`截图路径必须在数据目录内：${screenshotPath}`);
  }
  mkdirSync(path.dirname(screenshotPath), { recursive: true, mode: 0o700 });
  return { options: { ...(raw ?? {}), path: screenshotPath }, screenshotPath };
}

function resolveEvidenceDir(skillPaths, argv) {
  let requested;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--evidence-dir') {
      requested = argv[++index];
      if (requested === undefined || requested === '') {
        throw new Error('--evidence-dir 需要路径');
      }
    } else {
      throw new Error(`未知参数：${argv[index]}`);
    }
  }
  const fallback = `browser-session-${new Date().toISOString().replaceAll(':', '-')}`;
  const evidenceDir = path.resolve(skillPaths.localRoot, requested ?? path.join(skillPaths.runsDir, fallback));
  if (!isInsideLocalRoot(skillPaths, evidenceDir)) {
    throw new Error(`证据目录必须在数据目录内：${evidenceDir}`);
  }
  return evidenceDir;
}

function redactCommand(command) {
  if (!isSensitiveCommand(command)) return command;
  const redacted = { ...command };
  for (const key of ['args', 'arguments', 'argument', 'expression']) {
    if (key in redacted) redacted[key] = '[redacted]';
  }
  return redacted;
}

function isSensitiveCommand(command) {
  if (command === null || typeof command !== 'object') return false;
  if (command.sensitive === true) return true;
  if (command.operation !== 'locator' || command.method !== 'fill') return false;
  const marker = [command.selector, command.type]
    .filter((value) => value !== undefined && value !== null)
    .join(' ')
    .toLowerCase();
  return /password|passwd|captcha|verification|verify|sms|otp|code|密码|验证码|校验码/.test(marker);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function slug(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'command';
}

function describeError(error) {
  return error instanceof Error ? error.message.split('\n')[0] ?? error.name : String(error);
}

function nextSequence(dir) {
  let max = 0;
  for (const name of readdirSync(dir)) {
    const match = /^(\d+)-/.exec(name);
    if (match !== null) max = Math.max(max, Number(match[1]));
  }
  return max;
}

function onRawInput(chunk) {
  if (String(chunk).includes('\u0003')) {
    process.exitCode = 130;
    lines.close();
    stdin.pause();
  }
}

function restoreStdin() {
  if (!stdinIsTTY) return;
  stdin.removeListener('data', onRawInput);
  try {
    stdin.setRawMode(previousRawMode ?? false);
  } catch {
    // 终端已断开时无法恢复，进程仍要继续退出清理。
  }
}

async function shutdown(reason) {
  shutdownPromise ??= server.close().then(() => {
    process.stderr.write(`official-apply browser session closed; reason=${reason}\n`);
  });
  return shutdownPromise;
}
