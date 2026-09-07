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
const SOLVER = path.join(HERE, 'solve-jigsaw-captcha.py');
const JIGSAW_ENGINES = [
  {
    id: 'dingxiang-basic',
    background: '.dx_captcha_basic_content:visible',
    piece: '.dx_captcha_basic_sub-slider:visible',
    slider: '.dx_captcha_basic_slider:visible',
    control: '.dx_captcha_basic_bar:visible',
    solver: 'circle',
    dragProfile: 'behavioral',
    targetModel: 'direct',
  },
  {
    id: 'netease-yidun',
    background: '.yidun_bg-img:visible',
    piece: '.yidun_jigsaw:visible',
    slider: '.yidun_slider:visible',
    control: '.yidun_control:visible',
  },
  {
    id: 'unionsy-slide-puzzle',
    background: '.slide_puzzle_img_bg:visible',
    piece: '.slide_puzzle_img_move:visible',
    slider: '.slide_puzzle_slide_slider:visible',
    control: '.slide_puzzle_slide_body:visible',
    motionModel: 'piece',
  },
  {
    id: 'canvas-jigsaw',
    background: '#canvas:visible',
    piece: '#block:visible',
    slider: '.verSliderBlock:visible',
    control: '.bar:visible',
  },
];

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

async function waitForJigsawEngine(page, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const engine of JIGSAW_ENGINES) {
      const background = page.locator(engine.background).first();
      if (
        (await background.count()) > 0 &&
        (await background.isVisible().catch(() => false))
      ) {
        return engine;
      }
    }
    for (const frame of page.frames()) {
      if ((await frame.locator('img.whirl-img-inner-base').count()) > 0) {
        throw new Error('captcha_type_rotation: 当前为旋转题，请使用 rotation-captcha-login-session.mjs，不能用拼图位移算法');
      }
    }
    await page.waitForTimeout(50);
  }
  throw new Error('jigsaw_engine_not_found');
}

async function captureBackground(page, engine, attempt) {
  const background = page.locator(engine.background).first();
  await background.waitFor({ state: 'visible', timeout: 15_000 });
  const file = path.join(
    paths.tmpDir,
    `jigsaw-${engine.id}-${Date.now()}-${attempt}.png`,
  );
  await background.screenshot({ path: file });
  return { background, file };
}

async function describeEngineAssets(page, engine) {
  const result = {};
  for (const [name, selector] of Object.entries({
    background: engine.background,
    piece: engine.piece,
    slider: engine.slider,
    control: engine.control,
  })) {
    const locator = page.locator(selector).first();
    result[name] = await locator
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          tag: element.tagName,
          src: element.getAttribute('src'),
          style: element.getAttribute('style'),
          backgroundImage: style.backgroundImage,
          backgroundPosition: style.backgroundPosition,
          transform: style.transform,
        };
      })
      .catch(() => null);
  }
  write('ENGINE', { id: engine.id, elements: result });
  return result;
}

async function downloadEngineAssets(engine, assets, attempt) {
  const backgroundUrl = assets.background?.src;
  const pieceUrl = assets.piece?.src;
  if (typeof backgroundUrl !== 'string' || typeof pieceUrl !== 'string') {
    return undefined;
  }
  const [backgroundResponse, pieceResponse] = await Promise.all([
    fetch(backgroundUrl),
    fetch(pieceUrl),
  ]);
  if (!backgroundResponse.ok || !pieceResponse.ok) {
    throw new Error(
      `jigsaw_asset_download_failed: background=${backgroundResponse.status}, piece=${pieceResponse.status}`,
    );
  }
  const stamp = Date.now();
  const backgroundFile = path.join(
    paths.tmpDir,
    `jigsaw-${engine.id}-${stamp}-${attempt}-background`,
  );
  const pieceFile = path.join(
    paths.tmpDir,
    `jigsaw-${engine.id}-${stamp}-${attempt}-piece`,
  );
  await Promise.all([
    writeFile(
      backgroundFile,
      Buffer.from(await backgroundResponse.arrayBuffer()),
    ),
    writeFile(pieceFile, Buffer.from(await pieceResponse.arrayBuffer())),
  ]);
  return { backgroundFile, pieceFile };
}

function calculateGap(
  file,
  sourceXRatio,
  sourceWidthRatio,
  pieceFile,
  sourceYRatio,
  solver,
) {
  const args = [SOLVER, '--background', file];
  if (pieceFile !== undefined) {
    args.push('--piece', pieceFile);
  } else {
    args.push(
      '--source-width-ratio',
      String(sourceWidthRatio),
      '--source-x-ratio',
      String(sourceXRatio),
    );
    if (solver === 'circle') {
      args.push(
        '--circle',
        '--source-y-ratio',
        String(sourceYRatio),
      );
    }
  }
  const output = execFileSync(
    'python3',
    args,
    { encoding: 'utf8' },
  );
  return JSON.parse(output);
}

async function dragCurrentChallenge(page, engine, attempt) {
  const assets = await describeEngineAssets(page, engine);
  const { background, file } = await captureBackground(page, engine, attempt);
  const piece = page.locator(engine.piece).first();
  const slider = page.locator(engine.slider).first();
  const control = page.locator(engine.control).first();
  const [backgroundBox, pieceBox, sliderBox, controlBox] = await Promise.all([
    background.boundingBox(),
    piece.boundingBox(),
    slider.boundingBox(),
    control.boundingBox(),
  ]);
  if (!backgroundBox || !pieceBox || !sliderBox || !controlBox) {
    throw new Error('jigsaw_geometry_unavailable');
  }
  const sourceXRatio =
    (pieceBox.x - backgroundBox.x) / backgroundBox.width;
  const sourceWidthRatio = pieceBox.width / backgroundBox.width;
  const sourceYRatio =
    (pieceBox.y - backgroundBox.y) / backgroundBox.height;
  const screenshotSolution = calculateGap(
    file,
    sourceXRatio,
    sourceWidthRatio,
    undefined,
    sourceYRatio,
    engine.solver,
  );
  const downloaded = await downloadEngineAssets(engine, assets, attempt);
  let solution = screenshotSolution;
  if (downloaded !== undefined) {
    const rawSolution = calculateGap(
          downloaded.backgroundFile,
          sourceXRatio,
          sourceWidthRatio,
          downloaded.pieceFile,
          sourceYRatio,
          engine.solver,
        );
    const rawTargetOnScreenshot =
      Number(rawSolution.targetX) *
      (Number(screenshotSolution.imageWidth) / Number(rawSolution.imageWidth));
    const agreementPx = Math.abs(
      rawTargetOnScreenshot - Number(screenshotSolution.targetX),
    );
    write('CANDIDATES', {
      raw: rawSolution,
      screenshot: screenshotSolution,
      agreementPx: Number(agreementPx.toFixed(2)),
    });
    if (rawSolution.confidence === 'high') {
      solution = rawSolution;
    } else if (
      rawSolution.confidence === 'medium' &&
      Number(rawSolution.scoreGap) >= 0.06
    ) {
      solution = rawSolution;
    } else if (
      rawSolution.confidence === 'low' &&
      screenshotSolution.confidence !== 'low'
    ) {
      solution = screenshotSolution;
    } else if (
      agreementPx <= 6 &&
      screenshotSolution.confidence !== 'low'
    ) {
      solution = {
        ...screenshotSolution,
        confidence: 'medium',
        ensembleAgreementPx: Number(agreementPx.toFixed(2)),
      };
    } else if (
      agreementPx <= 12 &&
      rawSolution.confidence !== 'low' &&
      screenshotSolution.confidence !== 'low'
    ) {
      solution = {
        ...rawSolution,
        confidence: 'medium',
        ensembleAgreementPx: Number(agreementPx.toFixed(2)),
      };
    } else {
      throw new Error(
        `jigsaw_candidates_disagree: ${JSON.stringify({
          raw: rawSolution,
          screenshot: screenshotSolution,
          agreementPx,
        })}`,
      );
    }
  }
  if (solution.confidence === 'low') {
    throw new Error(`jigsaw_low_confidence: ${JSON.stringify(solution)}`);
  }

  const startX = sliderBox.x + sliderBox.width / 2;
  const startY = sliderBox.y + sliderBox.height / 2;
  const probeDistance = 20;

  await page.mouse.move(startX, startY);
  if (engine.dragProfile === 'behavioral') {
    await page.waitForTimeout(180);
  }
  await page.mouse.down();
  if (engine.dragProfile === 'behavioral') {
    await page.waitForTimeout(120);
  }
  await page.mouse.move(startX + probeDistance, startY, { steps: 20 });
  await page.waitForTimeout(
    engine.dragProfile === 'behavioral' ? 320 : 180,
  );

  const [probedPieceBox, probedSliderBox] = await Promise.all([
    piece.boundingBox(),
    slider.boundingBox(),
  ]);
  const piecePerMouse =
    probedPieceBox === null ? 0 : (probedPieceBox.x - pieceBox.x) / probeDistance;
  const sliderPerMouse =
    probedSliderBox === null ? 0 : (probedSliderBox.x - sliderBox.x) / probeDistance;
  const calibration =
    engine.motionModel === 'piece' ? piecePerMouse : sliderPerMouse;
  if (!Number.isFinite(calibration) || calibration <= 0.05) {
    await page.mouse.up();
    throw new Error('jigsaw_motion_calibration_failed');
  }

  const targetPieceDistance =
    Number(solution.distanceX) *
    (backgroundBox.width / Number(solution.imageWidth));
  const pieceTravel = backgroundBox.width - pieceBox.width;
  const sliderTravel = controlBox.width - sliderBox.width;
  const targetSliderDistance =
    engine.targetModel === 'direct'
      ? targetPieceDistance
      : (targetPieceDistance / pieceTravel) * sliderTravel;
  const totalMouseDistance =
    engine.motionModel === 'piece'
      ? targetPieceDistance / piecePerMouse
      : targetSliderDistance / sliderPerMouse;
  const remaining = totalMouseDistance - probeDistance;
  const steps =
    engine.dragProfile === 'behavioral'
      ? Math.max(105, Math.ceil(Math.abs(remaining) / 1.25))
      : Math.max(55, Math.ceil(Math.abs(remaining) / 3));
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    const eased = 0.5 - Math.cos(Math.PI * progress) / 2;
    const jitterY =
      Math.sin(progress * Math.PI * 4) *
      (engine.dragProfile === 'behavioral' ? 1.1 : 0.8);
    await page.mouse.move(
      startX + probeDistance + remaining * eased,
      startY + jitterY,
      { steps: 1 },
    );
    await page.waitForTimeout(
      engine.dragProfile === 'behavioral'
        ? 22 + (step % 5) * 3
        : 16 + (step % 4) * 2,
    );
    if (
      engine.dragProfile === 'behavioral' &&
      (step === Math.floor(steps * 0.28) ||
        step === Math.floor(steps * 0.72))
    ) {
      await page.waitForTimeout(90 + (step % 2) * 40);
    }
  }
  await page.waitForTimeout(
    engine.dragProfile === 'behavioral' ? 420 : 220,
  );
  const verificationResponse = waitForCaptchaDecision(page, 6_000);
  await page.mouse.up();
  const response = await verificationResponse;
  let verification = {};
  if (response !== undefined) {
    try {
      verification = (await readCaptchaDecision(response)).body;
    } catch {
      verification = {};
    }
  }
  await page.waitForTimeout(response === undefined ? 1_200 : 300);
  if (response !== undefined) {
    await page.waitForTimeout(1_500);
    write('POST_VERIFY_STATE', {
      captchaVisible:
        (await page
          .locator(
            [
              '.slide_puzzle_img_bg:visible',
              '.yidun_bg-img:visible',
              '.dx_captcha_basic_content:visible',
            ].join(', '),
          )
          .count()) > 0,
      sendControls: (
        await page
          .locator('button:visible, a:visible, span:visible')
          .filter({
            hasText:
              /获取验证码|重新获取|重新发送|^\s*\d{1,3}\s*(?:s|秒)\s*$/,
          })
          .allTextContents()
      )
        .map((text) => text.trim())
        .filter((text) => text !== '')
        .slice(0, 10),
    });
  }

  write('DRAG', {
    attempt,
    engine: engine.id,
    solution,
    verification,
    piecePerMouse: Number(piecePerMouse.toFixed(4)),
    sliderPerMouse: Number(sliderPerMouse.toFixed(4)),
    targetSliderDistance: Number(targetSliderDistance.toFixed(2)),
    totalMouseDistance: Number(totalMouseDistance.toFixed(2)),
  });
  return { verification };
}

function verificationPassed(verification) {
  return (
    verification.success === true ||
    verification.result === true ||
    verification.data?.result === true ||
    verification.code === 0 ||
    (verification.code === 200 &&
      /通过|success|ok/i.test(verification.message ?? ''))
  );
}

async function autoSolve() {
  const page = server.pageOf(runId);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const engine = await waitForJigsawEngine(page);
    const drag = await dragCurrentChallenge(page, engine, attempt);
    if (verificationPassed(drag.verification)) {
      write('CAPTCHA_SOLVED', { attempt, runId });
      return { attempt, captchaSolved: true };
    }
    const status = await inspect();
    if (status.ok && status.data?.stage === 'code_sent') {
      write('SOLVED', { attempt, runId });
      return { attempt, captchaSolved: true, codeSent: true };
    }
    if (!status.ok || status.data?.stage !== 'captcha_required') {
      throw new Error(`jigsaw_unexpected_status: ${JSON.stringify(status)}`);
    }
  }
  throw new Error(`jigsaw_failed_after_${maxAttempts}_fresh_challenge`);
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
