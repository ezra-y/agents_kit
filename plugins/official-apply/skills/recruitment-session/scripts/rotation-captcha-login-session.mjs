#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { launch } from '../../../bin/launch.js';
import {
  attachCaptchaNetworkObserver,
  readCaptchaDecision,
  waitForCaptchaDecision,
} from './captcha-network-observer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROTATION_SOLVER = path.join(HERE, 'solve-rotation-captcha.py');

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

if (process.argv.includes('--help')) {
  process.stdout.write(
    [
      'Usage: OFFICIAL_APPLY_PHONE=<phone> node',
      '  skills/recruitment-session/scripts/rotation-captcha-login-session.mjs',
      '  --task-id <taskId> --login-url <url>',
      '  [--profile-name captcha-<taskId>] [--channel chrome|msedge|chromium] [--headed] [--auto]',
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
const loginUrl = option('--login-url');
const profileName = option('--profile-name', `captcha-${taskId}`);
const phone = process.env['OFFICIAL_APPLY_PHONE'];
const headless = !process.argv.includes('--headed');
const auto = process.argv.includes('--auto');
if (!taskId) throw new Error('--task-id is required');
if (!loginUrl) throw new Error('--login-url is required');
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

function attachSmsNetworkObserver(page) {
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (
      response.request().method() !== 'POST' ||
      !url.pathname.endsWith('/user/mobile/token')
    ) {
      return;
    }
    void response
      .json()
      .then((body) => {
        const data =
          body?.data !== null && typeof body?.data === 'object' ? body.data : {};
        write('SMS_RESPONSE', {
          url: `${url.origin}${url.pathname}`,
          httpStatus: response.status(),
          code: body?.code,
          message:
            typeof body?.message === 'string'
              ? body.message.slice(0, 200)
              : undefined,
          verifyMethod: data?.verify_method,
        });
      })
      .catch(() => undefined);
  });
}

function rotationDegrees(styleText) {
  const match = styleText.match(/rotateZ\((-?\d+(?:\.\d+)?)deg\)/);
  if (!match) throw new Error(`rotateZ_not_found: ${styleText}`);
  return Number(match[1]);
}

async function captchaFrame(page, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = page.frames().find((candidate) =>
      candidate.url().includes('verifycenter'),
    );
    if (frame) return frame;
    await page.waitForTimeout(50);
  }
  throw new Error('captcha_frame_not_found');
}

async function relativeRotation(frame) {
  const [innerStyle, outerStyle] = await Promise.all([
    frame.locator('.whirl-img-inner-base').first().getAttribute('style'),
    frame.locator('.whirl-img-outer-base').first().getAttribute('style'),
  ]);
  if (!innerStyle || !outerStyle) throw new Error('rotation_style_not_found');
  const relative = rotationDegrees(innerStyle) - rotationDegrees(outerStyle);
  return ((relative % 360) + 360) % 360;
}

async function solveCurrentImages(frame) {
  await frame.waitForFunction(
    () => {
      const outer = document.querySelector('img.whirl-img-outer-base');
      const inner = document.querySelector('img.whirl-img-inner-base');
      return (
        outer instanceof HTMLImageElement &&
        inner instanceof HTMLImageElement &&
        outer.complete &&
        inner.complete &&
        outer.naturalWidth > 0 &&
        inner.naturalWidth > 0
      );
    },
    undefined,
    { timeout: 8_000 },
  );
  const [outerSrc, innerSrc] = await Promise.all([
    frame.locator('img.whirl-img-outer-base').first().getAttribute('src'),
    frame.locator('img.whirl-img-inner-base').first().getAttribute('src'),
  ]);
  if (!outerSrc || !innerSrc) throw new Error('captcha_image_url_not_found');

  const [outerResponse, innerResponse] = await Promise.all([
    fetch(outerSrc),
    fetch(innerSrc),
  ]);
  if (!outerResponse.ok || !innerResponse.ok) {
    throw new Error(
      `captcha_image_download_failed: outer=${outerResponse.status}, inner=${innerResponse.status}`,
    );
  }
  const stamp = Date.now();
  const outerFile = path.join(paths.tmpDir, `rotation-captcha-${stamp}-outer.png`);
  const innerFile = path.join(paths.tmpDir, `rotation-captcha-${stamp}-inner.png`);
  await Promise.all([
    writeFile(outerFile, Buffer.from(await outerResponse.arrayBuffer())),
    writeFile(innerFile, Buffer.from(await innerResponse.arrayBuffer())),
  ]);

  const solution = JSON.parse(
    execFileSync(
      'python3',
      [ROTATION_SOLVER, '--inner', innerFile, '--outer', outerFile],
      { encoding: 'utf8' },
    ),
  );
  if (!solution.ok || solution.confidence === 'low') {
    throw new Error(`rotation_solution_unusable: ${JSON.stringify(solution)}`);
  }
  return solution;
}

async function calibratedSinglePress(page, frame, targetAngle) {
  const button = frame.locator('.captcha-slider-btn').first();
  const box = await button.boundingBox();
  if (!box) throw new Error('captcha_slider_not_visible');

  const startX = box.x + box.width * 0.46;
  const startY = box.y + box.height * 0.53;
  const probeDistance = 20;
  await page.mouse.move(startX, startY, { steps: 12 });
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.move(startX + probeDistance, startY, { steps: 16 });
  await page.waitForTimeout(80);

  const probeAngle = await relativeRotation(frame);
  if (!Number.isFinite(probeAngle) || probeAngle <= 0.5) {
    await page.mouse.up();
    throw new Error(`rotation_probe_failed: ${probeAngle}`);
  }
  const anglePerPixel = probeAngle / probeDistance;
  const totalDistance = targetAngle / anglePerPixel;
  const remaining = totalDistance - probeDistance;
  const steps = Math.max(48, Math.ceil(Math.abs(remaining) / 1.25));
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    const eased = 0.5 - Math.cos(Math.PI * progress) / 2;
    const jitterY =
      Math.sin(progress * Math.PI * 3.2) * 1.1 +
      Math.sin(progress * Math.PI * 10.7) * 0.3;
    await page.mouse.move(
      startX + probeDistance + remaining * eased,
      startY + jitterY,
      { steps: 1 },
    );
    await page.waitForTimeout(9 + (step % 4));
  }
  await page.waitForTimeout(120);
  const actualAngle = await relativeRotation(frame);
  write('ANGLE', {
    targetAngle,
    probeAngle,
    anglePerPixel,
    totalDistance,
    actualAngle,
  });
  await page.mouse.up();
}

async function fast(page) {
  let currentFrame = page.frames().find((candidate) =>
    candidate.url().includes('verifycenter'),
  );
  if (currentFrame === undefined) {
    const phoneInput = page.getByPlaceholder('手机号码').first();
    await page
      .getByText('+86', { exact: true })
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 })
      .catch(() => undefined);
    await phoneInput.fill('');
    await phoneInput.pressSequentially(phone, { delay: 25 });
    await page.waitForTimeout(250);
    const agreement = page.locator('input[type=checkbox]:visible').first();
    if (!(await agreement.isChecked().catch(() => false))) {
      await agreement.check({ force: true });
    }
    await page.waitForTimeout(500);
    const sendButton = page.getByRole('button', { name: '获取验证码' }).first();
    await page
      .waitForFunction(
        (button) =>
          button instanceof HTMLButtonElement &&
          !button.disabled &&
          button.getAttribute('aria-disabled') !== 'true',
        await sendButton.elementHandle(),
        { timeout: 5_000 },
      )
      .catch(() => undefined);
    const preflight = {
      phoneLength: (await phoneInput.inputValue()).length,
      agreementChecked: await agreement.isChecked().catch(() => false),
      sendDisabled: await sendButton.isDisabled().catch(() => true),
    };
    write('PREFLIGHT', preflight);
    if (
      preflight.phoneLength !== 11 ||
      !preflight.agreementChecked ||
      preflight.sendDisabled
    ) {
      throw new Error(`sms_form_not_ready: ${JSON.stringify(preflight)}`);
    }
    await sendButton.click();
    currentFrame = await captchaFrame(page);
  } else {
    write('REUSE_CURRENT_CHALLENGE', { url: currentFrame.url() });
  }
  await currentFrame
    .locator('.captcha-slider-btn')
    .first()
    .waitFor({ state: 'visible', timeout: 8_000 });

  const solution = await solveCurrentImages(currentFrame);
  write('SOLUTION', solution);
  const verificationResponse = waitForCaptchaDecision(page);
  await calibratedSinglePress(
    page,
    currentFrame,
    Number(solution.clockwiseDegrees),
  );
  const response = await verificationResponse;
  let verification = {};
  if (response !== undefined) {
    try {
      verification = (await readCaptchaDecision(response)).body;
    } catch {
      verification = {};
    }
  }
  await page
    .waitForFunction(
      () => !document.querySelector('iframe[src*="verifycenter"]'),
      undefined,
      { timeout: 2_500 },
    )
    .catch(() => undefined);
  if (verification.code === 200) {
    await page
      .waitForFunction(
        () => {
          const buttons = [...document.querySelectorAll('button')];
          return buttons.some((button) =>
            /重新获取|\d+\s*秒|\d+\s*s/i.test(button.innerText),
          );
        },
        undefined,
        { timeout: 5_000 },
      )
      .catch(() => undefined);
  }

  const loginStatus = await server.callTool('apply.login', {
    runId,
    action: 'inspect',
  });

  const verificationStillOpen = page.frames().some((candidate) =>
    candidate.url().includes('verifycenter'),
  );
  const sendText = await page
    .getByText(/重新获取|获取验证码/)
    .first()
    .innerText()
    .catch(() => '');
  write('FAST_RESULT', {
    verification,
    loginStatus,
    verificationStillOpen,
    sendText,
    captchaSolved: verification.code === 200,
    solved:
      (loginStatus.ok && loginStatus.data?.stage === 'code_sent') ||
      (!verificationStillOpen && /重新获取|\d+\s*秒|\d+s/.test(sendText)),
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
attachCaptchaNetworkObserver(page, write);
attachSmsNetworkObserver(page);

await page.goto(loginUrl, {
  waitUntil: 'domcontentloaded',
  timeout: 120_000,
});
await page.getByPlaceholder('手机号码').waitFor({
  state: 'visible',
  timeout: 15_000,
});
write('READY', { runId, taskId, profileName, headless });
if (auto) {
  await fast(page);
}

const rl = readline.createInterface({ input: process.stdin });
let pendingCommand = Promise.resolve();
rl.on('close', () => void pendingCommand.then(close));
rl.on('line', (line) => {
  pendingCommand = pendingCommand.then(async () => {
    const [command, value] = line.trim().split(/\s+/, 2);
    if (command === 'fast') await fast(page);
    if (command === 'code' && value) {
      const phoneInput = page.getByPlaceholder('手机号码').first();
      if ((await phoneInput.inputValue()).trim() === '') {
        await phoneInput.fill(phone);
      }
      const agreement = page.locator('input[type=checkbox]').first();
      if (!(await agreement.isChecked().catch(() => false))) {
        await agreement.check({ force: true });
      }
      write(
        'CODE',
        await server.callTool('apply.login', {
          runId,
          action: 'submit_sms_code',
          code: value,
        }),
      );
    }
    if (command === 'status') {
      write(
        'STATUS',
        await server.callTool('apply.login', {
          runId,
          action: 'inspect',
        }),
      );
    }
    if (command === 'quit') await close();
  }).catch((error) => {
    write('ERROR', {
      message: error instanceof Error ? error.message.split('\n')[0] : String(error),
    });
  });
});
