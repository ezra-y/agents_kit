#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { launch } from '../../../bin/launch.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOLVER = path.join(HERE, 'solve-overlay-rotation-captcha.py');

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

function write(event, data) {
  process.stdout.write(`${event} ${JSON.stringify(data)}\n`);
}

function backgroundUrl(value) {
  const match = value.match(/^url\(["']?(.*?)["']?\)$/);
  if (!match?.[1]) throw new Error('overlay_background_url_not_found');
  return match[1];
}

async function challengeFrame(page, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if ((await frame.locator('#img-back-div #img-rotate-div img').count()) > 0) {
        return frame;
      }
    }
    await page.waitForTimeout(50);
  }
  throw new Error('overlay_rotation_challenge_not_found');
}

async function downloadCurrentChallenge(frame) {
  const challenge = await frame.evaluate(() => {
    const background = document.querySelector('#img-back-div');
    const piece = document.querySelector('#img-rotate-div img');
    if (!(background instanceof HTMLElement) || !(piece instanceof HTMLImageElement)) {
      throw new Error('overlay_rotation_images_not_found');
    }
    return {
      backgroundStyle: getComputedStyle(background).backgroundImage,
      pieceSrc: piece.src,
    };
  });
  const [pieceResponse, backgroundResponse] = await Promise.all([
    fetch(challenge.pieceSrc),
    fetch(backgroundUrl(challenge.backgroundStyle)),
  ]);
  if (!pieceResponse.ok || !backgroundResponse.ok) {
    throw new Error(
      `overlay_rotation_download_failed: piece=${pieceResponse.status}, background=${backgroundResponse.status}`,
    );
  }
  const stamp = Date.now();
  const pieceFile = path.join(paths.tmpDir, `overlay-rotation-${stamp}-piece.png`);
  const backgroundFile = path.join(
    paths.tmpDir,
    `overlay-rotation-${stamp}-background.png`,
  );
  await Promise.all([
    writeFile(pieceFile, Buffer.from(await pieceResponse.arrayBuffer())),
    writeFile(backgroundFile, Buffer.from(await backgroundResponse.arrayBuffer())),
  ]);
  return { pieceFile, backgroundFile };
}

function solveCurrentChallenge(files) {
  const solution = JSON.parse(
    execFileSync(
      'python3',
      [
        SOLVER,
        '--piece',
        files.pieceFile,
        '--background',
        files.backgroundFile,
      ],
      { encoding: 'utf8' },
    ),
  );
  if (!solution.ok || solution.confidence === 'low') {
    throw new Error(`overlay_rotation_solution_unusable: ${JSON.stringify(solution)}`);
  }
  return solution;
}

async function dragToAngle(page, frame, clockwiseDegrees) {
  const slider = frame.locator('#slider-div').first();
  const track = frame.locator('.drag-box').first();
  await slider.waitFor({ state: 'visible', timeout: 8_000 });
  const [sliderBox, trackBox] = await Promise.all([
    slider.boundingBox(),
    track.boundingBox(),
  ]);
  if (!sliderBox || !trackBox) throw new Error('overlay_rotation_slider_not_visible');

  const maxDistance = trackBox.width - sliderBox.width;
  if (maxDistance <= 0) throw new Error('overlay_rotation_track_unusable');
  const normalizedAngle = ((clockwiseDegrees % 360) + 360) % 360;
  const targetDistance = (normalizedAngle / 360) * maxDistance;
  const startX = sliderBox.x + sliderBox.width / 2;
  const startY = sliderBox.y + sliderBox.height / 2;

  await page.mouse.move(startX, startY, { steps: 10 });
  await page.mouse.down();
  await page.waitForTimeout(70);

  if (targetDistance < 1) {
    await page.mouse.move(startX + 8, startY + 0.8, { steps: 10 });
    await page.waitForTimeout(80);
  }
  const steps = Math.max(36, Math.ceil(Math.max(targetDistance, 1) / 1.5));
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    const eased = 0.5 - Math.cos(Math.PI * progress) / 2;
    const jitterY = Math.sin(progress * Math.PI * 4.1) * 0.8;
    await page.mouse.move(
      startX + Math.max(targetDistance, 0.5) * eased,
      startY + jitterY,
      { steps: 1 },
    );
    await page.waitForTimeout(8 + (step % 5));
  }
  await page.waitForTimeout(100);
  await page.mouse.up();
  return { normalizedAngle, targetDistance, maxDistance };
}

async function readDecision(response) {
  if (response === undefined) return undefined;
  const body = await response.json().catch(() => ({}));
  const safe = {};
  for (const key of ['code', 'msg', 'message', 'success', 'status', 's_code']) {
    const value = body?.[key];
    if (
      typeof value === 'boolean' ||
      typeof value === 'number' ||
      (typeof value === 'string' && value.length <= 200)
    ) {
      safe[key] = value;
    }
  }
  safe.hasReplacementImage = body?.img !== undefined;
  return {
    httpStatus: response.status(),
    url: `${new URL(response.url()).origin}${new URL(response.url()).pathname}`,
    body: safe,
  };
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
  const frame =
    status.data?.stage === 'captcha_required'
      ? await challengeFrame(page)
      : await challengeFrame(page, 4_000).catch(() => undefined);
  if (frame === undefined) {
    throw new Error(`overlay_rotation_not_ready: ${JSON.stringify(status)}`);
  }
  const files = await downloadCurrentChallenge(frame);
  const solution = solveCurrentChallenge(files);
  write('SOLUTION', solution);
  const verificationResponse = page
    .waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'POST' &&
        url.pathname.endsWith('/cgi-bin/api/check')
      );
    }, { timeout: 10_000 })
    .catch(() => undefined);
  const drag = await dragToAngle(
    page,
    frame,
    Number(solution.clockwiseDegrees),
  );
  const verification = await readDecision(await verificationResponse);
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
