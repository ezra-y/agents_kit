#!/usr/bin/env node

import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { launch } from '../../../bin/launch.js';
import { attachCaptchaNetworkObserver } from './captcha-network-observer.mjs';
import { solveJigsawOnPage } from './jigsaw-captcha-engine.mjs';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

if (process.argv.includes('--help')) {
  process.stdout.write(
    [
      'Usage: OFFICIAL_APPLY_PHONE=<phone> node',
      '  skills/recruitment-session/scripts/jigsaw-captcha-session.mjs',
      '  --task-id <taskId>',
      '  [--profile-name captcha-<taskId>] [--channel chrome|msedge|chromium] [--headed] [--auto]',
      '  [--max-attempts 1|2]',
      '',
      'Interactive commands:',
      '  inspect',
      '  sms <phone>',
      '  auto',
      '  code <sms-code>',
      '  resume',
      '  quit',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

const taskId = option('--task-id');
if (!taskId) throw new Error('--task-id is required');
const profileName = option('--profile-name', `captcha-${taskId}`);
const headless = !process.argv.includes('--headed');
const auto = process.argv.includes('--auto');
const maxAttempts = Number(option('--max-attempts', '2'));
const phone = process.env['OFFICIAL_APPLY_PHONE'];
if (auto && !/^1\d{10}$/.test(phone ?? '')) {
  throw new Error('OFFICIAL_APPLY_PHONE must be an 11-digit mainland China number');
}
if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 2) {
  throw new Error('--max-attempts must be 1 or 2');
}
const { getSkillPaths } = await launch('src/config/paths.ts');
const { createMcpServer } = await launch('src/mcp/create-mcp-server.ts');
const paths = getSkillPaths();
const server = createMcpServer({ paths });
let runId;
let closing = false;

function write(event, data) {
  process.stdout.write(`${event} ${JSON.stringify(data)}\n`);
}

function attachLoginResponseObserver(page) {
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (
      !(
        url.pathname.endsWith('/personal-center/candidate/loginAuthCode/') ||
        /verification\/getPhoneCode|sms.*send|send.*code/i.test(
          `${url.pathname}${url.search}`,
        )
      )
    ) {
      return;
    }
    void response
      .json()
      .then((body) => {
        write('SMS_RESPONSE', {
          url: `${url.origin}${url.pathname}`,
          httpStatus: response.status(),
          errorCode: body?.errorCode,
          message:
            typeof (body?.message ?? body?.msg) === 'string'
              ? String(body.message ?? body.msg).slice(0, 200)
              : undefined,
          code: body?.code,
          success: body?.success,
          ttl: body?.ttl,
        });
      })
      .catch(() => undefined);
  });
}

async function inspect() {
  const result = await server.callTool('apply.login', {
    runId,
    action: 'inspect',
  });
  write('LOGIN', result);
  return result;
}

async function autoSolve() {
  return solveJigsawOnPage({
    page: server.pageOf(runId),
    evidenceDir: paths.evidenceDir,
    pageUrl: server.pageOf(runId).url(),
    runId,
    taskId,
    maxAttempts,
    sessionScript: fileURLToPath(import.meta.url),
    onCase: ({ directory }) => write('CASE', { directory }),
    onEvent: write,
    afterAttempt: () => inspect(),
  });
}

async function fast() {
  const sms = await server.callTool('apply.login', {
    runId,
    action: 'begin_sms',
    phone,
  });
  write('SMS', sms);
  if (sms.ok && sms.data?.stage === 'code_sent') {
    write('SOLVED', { attempt: 0, runId });
    return;
  }
  if (!sms.ok || sms.data?.stage !== 'captcha_required') {
    throw new Error(`jigsaw_sms_unexpected_status: ${JSON.stringify(sms)}`);
  }
  const captcha = await autoSolve();
  if (captcha.codeSent === true) return;
  let status;
  const deadline = Date.now() + 8_000;
  do {
    status = await server.callTool('apply.login', {
      runId,
      action: 'inspect',
    });
    if (
      status.ok &&
      (status.data?.stage === 'code_sent' ||
        status.data?.stage === 'logged_in')
    ) {
      break;
    }
    await server.pageOf(runId).waitForTimeout(250);
  } while (Date.now() < deadline);
  write('LOGIN', status);
  const solved =
    status.ok &&
    (status.data?.stage === 'code_sent' ||
      status.data?.stage === 'logged_in');
  write('FAST_RESULT', { status, solved });
  if (!solved) {
    throw new Error(`jigsaw_sms_send_unconfirmed: ${JSON.stringify(status)}`);
  }
  write('SOLVED', { attempt: captcha.attempt, runId });
}

async function fillAndSaveResume() {
  const resume = await server.callTool('apply.open_resume', { runId });
  write('RESUME', resume);
  if (!resume.ok) return;

  const resolved = await server.callTool('apply.resolve_page', { runId });
  const preparation = resolved.data?.preparation;
  write('RESOLVED', {
    ok: resolved.ok,
    missingCount: preparation?.missing?.length ?? 0,
    conflictCount: preparation?.conflicts?.length ?? 0,
  });
  if (
    !resolved.ok ||
    preparation === undefined ||
    preparation.missing.length > 0 ||
    preparation.conflicts.length > 0
  ) {
    return;
  }

  const filled = await server.callTool('apply.fill_page', { runId });
  write('FILLED', filled);
  if (!filled.ok) return;

  const saved = await server.callTool('apply.advance', {
    runId,
    actionKind: 'save',
  });
  write('SAVED', saved);
  if (!saved.ok) return;

  write('VALIDATED', await server.callTool('apply.validate_page', { runId }));
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
attachCaptchaNetworkObserver(page, write);
attachLoginResponseObserver(page);
write('READY', { runId, taskId, profileName, headless });
await inspect();
if (auto) {
  await fast().catch((error) => {
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
    if (command === 'inspect') await inspect();
    if (command === 'sms' && value) {
      write(
        'SMS',
        await server.callTool('apply.login', {
          runId,
          action: 'begin_sms',
          phone: value,
        }),
      );
    }
    if (command === 'auto') await autoSolve();
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
    if (command === 'resume') await fillAndSaveResume();
    if (command === 'quit') await close();
  }).catch((error) => {
    write('ERROR', {
      message: error instanceof Error ? error.message.split('\n')[0] : String(error),
    });
  });
});
