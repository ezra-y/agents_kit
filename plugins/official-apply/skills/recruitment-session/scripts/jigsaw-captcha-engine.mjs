import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCaptchaCase } from './captcha-case.mjs';
import {
  readCaptchaDecision,
  waitForCaptchaDecision,
} from './captcha-network-observer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SOLVER = path.join(HERE, 'solve-jigsaw-captcha.py');

export const JIGSAW_ENGINES = [
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

function emit(onEvent, event, value) {
  if (typeof onEvent === 'function') onEvent(event, value);
}

export async function waitForJigsawEngine(page, timeoutMs = 10_000, onReveal) {
  const deadline = Date.now() + timeoutMs;
  const hovered = new Set();
  while (Date.now() < deadline) {
    for (const engine of JIGSAW_ENGINES) {
      const background = page.locator(engine.background).first();
      if (
        (await background.count()) > 0 &&
        (await background.isVisible().catch(() => false))
      ) {
        return engine;
      }

      // 易盾在真实登录页中会把题图父面板保持 display:none，移动到滑块上才展开题图。
      // 只调用真实 hover，不修改页面样式；已展开的页面不会重复触发。
      if (!hovered.has(engine.id)) {
        const slider = page.locator(engine.slider).first();
        if (
          (await slider.count()) > 0 &&
          (await slider.isVisible().catch(() => false))
        ) {
          await page.mouse.move(0, 0);
          const revealed = await slider.hover().then(() => true).catch(() => false);
          if (revealed) {
            hovered.add(engine.id);
            onReveal?.({ engine: engine.id, action: 'hover_slider' });
            await page.waitForTimeout(120);
          }
        }
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

async function captureBackground(page, engine, captchaCase, attempt) {
  const background = page.locator(engine.background).first();
  await background.waitFor({ state: 'visible', timeout: 15_000 });
  const file = path.join(
    captchaCase.directory,
    `jigsaw-${engine.id}-${Date.now()}-${attempt}.png`,
  );
  await background.screenshot({ path: file });
  return { background, file };
}

async function describeEngineAssets(page, engine, onEvent) {
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
          src: element instanceof HTMLImageElement ? element.src : element.getAttribute('src'),
          style: element.getAttribute('style'),
          backgroundImage: style.backgroundImage,
          backgroundPosition: style.backgroundPosition,
          transform: style.transform,
        };
      })
      .catch(() => null);
  }
  emit(onEvent, 'ENGINE', { id: engine.id, elements: result });
  return result;
}

async function downloadEngineAssets(engine, assets, captchaCase, attempt) {
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
    captchaCase.directory,
    `jigsaw-${engine.id}-${stamp}-${attempt}-background`,
  );
  const pieceFile = path.join(
    captchaCase.directory,
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
  captchaCase,
  file,
  sourceXRatio,
  sourceWidthRatio,
  pieceFile,
  sourceYRatio,
  solver,
) {
  const args = ['--background', file];
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
  return captchaCase.solve(args);
}

export async function solveJigsawChallenge(page, {
  engine,
  captchaCase,
  attempt,
  onEvent,
}) {
  const assets = await describeEngineAssets(page, engine, onEvent);
  const { background, file } = await captureBackground(page, engine, captchaCase, attempt);
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
  captchaCase.record('geometry', { backgroundBox, pieceBox, sliderBox, controlBox });
  const sourceXRatio =
    (pieceBox.x - backgroundBox.x) / backgroundBox.width;
  const sourceWidthRatio = pieceBox.width / backgroundBox.width;
  const sourceYRatio =
    (pieceBox.y - backgroundBox.y) / backgroundBox.height;
  const screenshotSolution = calculateGap(
    captchaCase,
    file,
    sourceXRatio,
    sourceWidthRatio,
    undefined,
    sourceYRatio,
    engine.solver,
  );
  const downloaded = await downloadEngineAssets(engine, assets, captchaCase, attempt);
  let solution = screenshotSolution;
  if (downloaded !== undefined) {
    const rawSolution = calculateGap(
      captchaCase,
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
    emit(onEvent, 'CANDIDATES', {
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
  captchaCase.record('motion_probe', { probeDistance, piecePerMouse, sliderPerMouse });
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
  captchaCase.record('drag_target', { targetSliderDistance, totalMouseDistance });
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
  captchaCase.record('drag_observed', {
    pieceBox: await piece.boundingBox(),
    sliderBox: await slider.boundingBox(),
  });
  await page.mouse.up();
  const response = await verificationResponse;
  let verification = {};
  if (response !== undefined) {
    try {
      const decision = await readCaptchaDecision(response);
      captchaCase.record('verification_response', decision);
      verification = decision.body;
    } catch {
      verification = {};
    }
  }
  await page.waitForTimeout(response === undefined ? 1_200 : 300);

  if (response !== undefined) {
    await page.waitForTimeout(1_500);
    emit(onEvent, 'POST_VERIFY_STATE', {
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

  emit(onEvent, 'DRAG', {
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

export function verificationPassed(verification) {
  return (
    verification.success === true ||
    verification.result === true ||
    verification.data?.result === true ||
    verification.code === 0 ||
    (verification.code === 200 &&
      /通过|success|ok/i.test(verification.message ?? ''))
  );
}

export async function solveJigsawOnPage({
  page,
  evidenceDir,
  pageUrl,
  runId,
  taskId,
  maxAttempts = 1,
  sessionScript = fileURLToPath(import.meta.url),
  onCase,
  onEvent,
  afterAttempt,
}) {
  if (!page) throw new Error('jigsaw_page_required');
  if (typeof evidenceDir !== 'string' || evidenceDir === '') {
    throw new Error('jigsaw_evidence_dir_required');
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 2) {
    throw new Error('jigsaw_max_attempts_must_be_1_or_2');
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const captchaCase = createCaptchaCase({
      evidenceDir,
      pageUrl: pageUrl ?? page.url(),
      runId,
      taskId,
      type: 'jigsaw',
      solver: SOLVER,
      sessionScript,
    });
    onCase?.({ attempt, directory: captchaCase.directory });
    const caseEvent = (event, value) => {
      captchaCase.recordEvent(event, value);
      emit(onEvent, event, value);
    };
    caseEvent('CASE', { directory: captchaCase.directory, attempt });
    try {
      const engine = await waitForJigsawEngine(
        page,
        10_000,
        (reveal) => captchaCase.record('engine_reveal', reveal),
      );
      captchaCase.record('engine', { id: engine.id, attempt });
      const drag = await solveJigsawChallenge(page, {
        engine,
        captchaCase,
        attempt,
        onEvent: caseEvent,
      });
      if (verificationPassed(drag.verification)) {
        captchaCase.finish('passed', { verification: drag.verification });
        caseEvent('CAPTCHA_SOLVED', { attempt, runId });
        return {
          attempt,
          captchaSolved: true,
          verification: drag.verification,
          caseDirectory: captchaCase.directory,
        };
      }
      const status = afterAttempt === undefined
        ? undefined
        : await afterAttempt({ attempt, drag, page });
      if (status?.ok && status.data?.stage === 'code_sent') {
        captchaCase.finish('passed', { loginStage: 'code_sent' });
        caseEvent('SOLVED', { attempt, runId });
        return {
          attempt,
          captchaSolved: true,
          codeSent: true,
          verification: drag.verification,
          caseDirectory: captchaCase.directory,
        };
      }
      if (afterAttempt !== undefined &&
          (!status?.ok || status.data?.stage !== 'captcha_required')) {
        throw new Error(`jigsaw_unexpected_status: ${JSON.stringify(status)}`);
      }
      captchaCase.finish('not_passed', {
        verification: drag.verification,
        loginStage: status?.data?.stage,
      });
      if (attempt === maxAttempts) {
        throw new Error(`jigsaw_failed_after_${maxAttempts}_fresh_challenge`);
      }
    } catch (error) {
      if (error !== null && typeof error === 'object') {
        error.caseDirectory = captchaCase.directory;
      }
      captchaCase.fail(error);
      throw error;
    }
  }
  throw new Error(`jigsaw_failed_after_${maxAttempts}_fresh_challenge`);
}
