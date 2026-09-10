#!/usr/bin/env node

import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { launch } from '../../../bin/launch.js';
import { createCaptchaCase } from './captcha-case.mjs';
import { SOLVER, solveOverlayRotationOnPage } from './overlay-rotation-engine.mjs';


function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

if (process.argv.includes('--help')) {
  process.stdout.write(
    [
      'Usage: OFFICIAL_APPLY_PHONE=<phone> node',
      '  skills/recruitment-session/scripts/overlay-rotation-login-session.mjs',
      '  --task-id <taskId> [--profile-name captcha-<taskId>] [--channel chrome|msedge|chromium] [--headed] [--auto]',
      '',
      'Interactive commands:',
      '  fast',
      '  code <sms-code>',
      '  status',
      '  quit',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

const taskId = option('--task-id');
const profileName = option('--profile-name', `captcha-${taskId}`);
const phone = process.env['OFFICIAL_APPLY_PHONE'];
const headless = !process.argv.includes('--headed');
const auto = process.argv.includes('--auto');
if (!taskId) throw new Error('--task-id is required');
if (!/^1\d{10}$/.test(phone ?? '')) {
  throw new Error('OFFICIAL_APPLY_PHONE must be an 11-digit mainland China number');
}

const { getSkillPaths } = await launch('src/config/paths.ts');
const { createMcpServer } = await launch('src/mcp/create-mcp-server.ts');
const paths = getSkillPaths();
const server = createMcpServer({ paths });
let runId;
let closing = false;
let captchaCase;

function write(event, data) {
  captchaCase?.recordEvent(event, data);
  process.stdout.write(`${event} ${JSON.stringify(data)}\n`);
}

async function fast(page) {
  let status = await server.callTool('apply.login', {
    runId,
    action: 'inspect',
  });
  if (status.ok && status.data?.stage === 'logged_in') {
    write('FAST_RESULT', { status, solved: true });
    return;
  }
  if (!status.ok || status.data?.stage === 'sms_ready') {
    status = await server.callTool('apply.login', {
      runId,
      action: 'begin_sms',
      phone,
    });
  }
  if (status.data?.stage === 'code_sent') {
    write('FAST_RESULT', { status, solved: true });
    return;
  }
  captchaCase = createCaptchaCase({ evidenceDir: paths.evidenceDir, pageUrl: page.url(),
    runId, taskId, type: 'overlay_rotation', solver: SOLVER,
    sessionScript: fileURLToPath(import.meta.url) });
  write('CASE', { directory: captchaCase.directory });
  try {
    const { solution, drag, verification } = await solveOverlayRotationOnPage({
      page,
      captchaCase,
      onEvent: write,
    });
    await page.waitForTimeout(1_500);
    status = await server.callTool('apply.login', {
      runId,
      action: 'inspect',
    });
    if (status.ok && status.data?.stage === 'sms_ready') {
      status = await server.callTool('apply.login', {
        runId,
        action: 'begin_sms',
        phone,
      });
    }
    write('FAST_RESULT', {
      solution,
      drag,
      verification,
      status,
      solved:
        status.ok &&
        (status.data?.stage === 'code_sent' || status.data?.stage === 'logged_in'),
    });
    captchaCase.finish(status.ok && (status.data?.stage === 'code_sent' || status.data?.stage === 'logged_in')
      ? 'passed' : 'not_confirmed', { verification, loginStage: status.data?.stage });
  } catch (error) {
    captchaCase.fail(error);
    throw error;
  } finally {
    captchaCase = undefined;
  }
}

async function close() {
  if (closing) return;
  closing = true;
  if (runId) {
    await server.callTool('apply.close_run', { runId }).catch(() => undefined);
  }
  await server.close().catch(() => undefined);
  process.exit(0);
}

process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());

const opened = await server.callTool('apply.open_task', {
  taskId,
  browserMode: 'persistent',
  ...(option('--channel') ? { channel: option('--channel') } : {}),
  profileName,
  headless,
});
if (!opened.ok) throw new Error(opened.message ?? 'open_task_failed');
runId = String(opened.data.runId);
const page = server.pageOf(runId);
write('READY', { runId, taskId, profileName, headless });
if (auto) {
  await fast(page).catch((error) => {
    write('ERROR', {
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

const rl = readline.createInterface({ input: process.stdin });
let pendingCommand = Promise.resolve();
rl.on('close', () => void pendingCommand.then(close));
rl.on('line', (line) => {
  pendingCommand = pendingCommand.then(async () => {
    const [command, value] = line.trim().split(/\s+/, 2);
    if (command === 'fast') await fast(page);
    if (command === 'status') {
      write(
        'STATUS',
        await server.callTool('apply.login', { runId, action: 'inspect' }),
      );
    }
    if (command === 'code' && value) {
      write(
        'CODE',
        await server.callTool('apply.login', {
          runId,
          action: 'submit_sms_code',
          code: value,
        }),
      );
    }
    if (command === 'quit') await close();
  }).catch((error) => {
    write('ERROR', {
      message: error instanceof Error ? error.message : String(error),
    });
  });
});
