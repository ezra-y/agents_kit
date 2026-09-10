import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOLVER = fileURLToPath(new URL('./solve-overlay-rotation-captcha.py', import.meta.url));

function backgroundUrl(value) {
  const match = value.match(/^url\(["']?(.*?)["']?\)$/);
  if (!match?.[1]) throw new Error('overlay_background_url_not_found');
  return match[1];
}

async function findChallenge(page, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if ((await frame.locator('#img-back-div #img-rotate-div img').count()) > 0) {
        return { kind: 'jcap', frame };
      }
    }
    const dingxiang = page.locator('.dx_captcha_rotate_content:visible').first();
    if ((await dingxiang.count()) > 0) return { kind: 'dingxiang', page, content: dingxiang };
    await page.waitForTimeout(50);
  }
  throw new Error('overlay_rotation_challenge_not_found');
}

async function requestImage(page, url) {
  const requestUrl = new URL(url, page.url()).href;
  const response = await page.request.get(requestUrl, { headers: { Referer: page.url() } });
  if (!response.ok()) throw new Error(`overlay_rotation_image_download_failed: ${response.status()} ${new URL(requestUrl).pathname}`);
  return Buffer.from(await response.body());
}

async function downloadJcapChallenge(frame, directory) {
  const page = frame.page();
  await frame.locator('#img-back-div').screenshot({
    path: path.join(directory, 'challenge-rendered.png'),
  });
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
  const [pieceBuffer, backgroundBuffer] = await Promise.all([
    requestImage(page, challenge.pieceSrc),
    requestImage(page, backgroundUrl(challenge.backgroundStyle)),
  ]);
  const stamp = Date.now();
  const pieceFile = path.join(directory, `overlay-rotation-${stamp}-piece.png`);
  const backgroundFile = path.join(directory, `overlay-rotation-${stamp}-background.png`);
  await Promise.all([
    writeFile(pieceFile, pieceBuffer),
    writeFile(backgroundFile, backgroundBuffer),
  ]);
  return { pieceFile, backgroundFile };
}

async function downloadDingxiangChallenge(page, content, directory) {
  await content.screenshot({ path: path.join(directory, 'challenge-rendered.png') });
  const [background, piece] = await Promise.all([
    page.locator('img[src*="/api/p1"]:visible').first().getAttribute('src'),
    page.locator('img[src*="/api/p2"]:visible').first().getAttribute('src'),
  ]);
  if (!background || !piece) throw new Error('overlay_rotation_images_not_found');
  const [backgroundBuffer, pieceBuffer] = await Promise.all([
    requestImage(page, background),
    requestImage(page, piece),
  ]);
  const stamp = Date.now();
  const pieceFile = path.join(directory, `overlay-rotation-${stamp}-piece.png`);
  const backgroundFile = path.join(directory, `overlay-rotation-${stamp}-background.png`);
  await Promise.all([
    writeFile(pieceFile, pieceBuffer),
    writeFile(backgroundFile, backgroundBuffer),
  ]);
  return { pieceFile, backgroundFile };
}

async function readRotation(locator) {
  return locator.evaluate((element) => {
    let fallback = null;
    const targets = [element, ...element.querySelectorAll('*')];
    for (const target of targets) {
      const style = target.getAttribute('style') ?? '';
      const inline = /rotate\((-?[\d.]+)deg\)/.exec(style);
      const transform = getComputedStyle(target).transform;
      if (inline) return { style, transform, angle: Number(inline[1]) };
      if (transform && transform !== 'none') {
        const matrix = new DOMMatrix(transform);
        return { style, transform, angle: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI };
      }
      fallback ??= { style, transform, angle: 0 };
    }
    return fallback ?? { style: '', transform: 'none', angle: 0 };
  });
}

function signedAngleDelta(after, before) {
  return ((after - before + 540) % 360) - 180;
}

function readDecisionBody(body) {
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
  return safe;
}

async function readDecision(response) {
  if (response === undefined) return undefined;
  const body = await response.json().catch(() => ({}));
  const url = new URL(response.url());
  return {
    httpStatus: response.status(),
    url: `${url.origin}${url.pathname}`,
    body: readDecisionBody(body),
  };
}

async function dragToAngle(page, frame, clockwiseDegrees, captchaCase) {
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
  captchaCase.record('drag_target', {
    sliderBox,
    trackBox,
    normalizedAngle,
    targetDistance,
    maxDistance,
  });
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
  captchaCase.record('drag_observed', {
    sliderBox: await slider.boundingBox(),
    pieceStyle: await frame.locator('#img-rotate-div').getAttribute('style'),
  });
  await page.mouse.up();
  return { normalizedAngle, targetDistance, maxDistance };
}

async function dragDingxiangToAngle(page, clockwiseDegrees, captchaCase) {
  const slider = page.locator('.dx_captcha_rotate_slider:visible').first();
  const track = page.locator('.dx_captcha_rotate_bar:visible').first();
  const piece = page.locator('.dx_captcha_rotate_sub-slider:visible').first();
  await slider.waitFor({ state: 'visible', timeout: 8_000 });
  const [sliderBox, trackBox, beforeRotation] = await Promise.all([
    slider.boundingBox(),
    track.boundingBox(),
    readRotation(piece),
  ]);
  if (!sliderBox || !trackBox || beforeRotation.angle === null) {
    throw new Error('overlay_rotation_css_angle_unavailable');
  }
  const maxDistance = trackBox.width - sliderBox.width;
  const probeDistance = Math.min(10, maxDistance / 4);
  if (maxDistance <= 0 || probeDistance <= 0) throw new Error('overlay_rotation_track_unusable');
  const startX = sliderBox.x + sliderBox.width / 2;
  const startY = sliderBox.y + sliderBox.height / 2;
  await page.mouse.move(startX, startY, { steps: 10 });
  await page.mouse.down();
  await page.mouse.move(startX + probeDistance, startY, { steps: 12 });
  await page.waitForTimeout(80);
  const afterProbe = await readRotation(piece);
  if (afterProbe.angle === null) {
    await page.mouse.up();
    throw new Error('overlay_rotation_css_angle_unavailable');
  }
  const probeSliderBox = await slider.boundingBox();
  const probeDisplacement = probeSliderBox ? probeSliderBox.x - sliderBox.x : 0;
  const probeAngle = signedAngleDelta(afterProbe.angle, beforeRotation.angle);
  if (probeDisplacement <= 0) {
    await page.mouse.up();
    throw new Error('overlay_rotation_slider_probe_failed');
  }
  const anglePerPixel = probeAngle / probeDisplacement;
  if (Math.abs(anglePerPixel) < 0.01) {
    await page.mouse.up();
    throw new Error('overlay_rotation_css_mapping_unavailable');
  }
  const normalizedAngle = ((clockwiseDegrees % 360) + 360) % 360;
  const normalizedBefore = ((beforeRotation.angle % 360) + 360) % 360;
  const candidates = [-1, 0, 1]
    .map((turns) => {
      const deltaAngle = normalizedAngle - normalizedBefore + turns * 360;
      return { deltaAngle, targetDistance: deltaAngle / anglePerPixel };
    })
    .filter(({ targetDistance }) => targetDistance >= 0 && targetDistance <= maxDistance);
  if (candidates.length === 0) {
    await page.mouse.up();
    throw new Error(`overlay_rotation_css_mapping_out_of_range: target=${normalizedAngle.toFixed(2)}, max=${maxDistance.toFixed(2)}`);
  }
  const target = candidates.sort((left, right) => Math.abs(left.targetDistance) - Math.abs(right.targetDistance))[0];
  const targetDistance = target.targetDistance;
  const targetCssAngle = beforeRotation.angle + target.deltaAngle;
  const remaining = targetDistance - probeDisplacement;
  captchaCase.record('rotation_probe', {
    sliderBox,
    trackBox,
    pieceBefore: beforeRotation,
    pieceAfterProbe: afterProbe,
    probeDistance,
    probeSliderBox,
    probeDisplacement,
    probeAngle,
    anglePerPixel,
    targetCssAngle,
  });
  captchaCase.record('drag_target', { sliderBox, trackBox, normalizedAngle, targetDistance, maxDistance });
  const steps = Math.max(36, Math.ceil(Math.max(Math.abs(remaining), 1) / 1.5));
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    const eased = 0.5 - Math.cos(Math.PI * progress) / 2;
    await page.mouse.move(startX + probeDistance + remaining * eased, startY + Math.sin(progress * Math.PI * 4.1) * 0.8, { steps: 1 });
    await page.waitForTimeout(8 + (step % 5));
  }
  await page.waitForTimeout(100);
  const observed = { sliderBox: await slider.boundingBox(), pieceStyle: await readRotation(piece) };
  captchaCase.record('drag_observed', observed);
  await page.mouse.up();
  return {
    normalizedAngle,
    targetDistance,
    maxDistance,
    rotationProbe: { beforeRotation, afterProbe, probeDistance, probeSliderBox, probeDisplacement, probeAngle, anglePerPixel, targetCssAngle },
    observed,
  };
}

export async function solveOverlayRotationOnPage({
  page,
  captchaCase,
  onEvent = () => {},
}) {
  const challenge = await findChallenge(page);
  const files = challenge.kind === 'jcap'
    ? await downloadJcapChallenge(challenge.frame, captchaCase.directory)
    : await downloadDingxiangChallenge(challenge.page, challenge.content, captchaCase.directory);
  const solution = captchaCase.solve([
    '--piece',
    files.pieceFile,
    '--background',
    files.backgroundFile,
  ]);
  if (!solution.ok || solution.confidence === 'low') {
    throw new Error(`overlay_rotation_solution_unusable: ${JSON.stringify(solution)}`);
  }
  onEvent('SOLUTION', solution);
  const verificationResponse = page
    .waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'POST' &&
        (url.pathname.endsWith('/cgi-bin/api/check') ||
          (challenge.kind === 'dingxiang' && url.pathname.endsWith('/api/v1')) ||
          (url.hostname.includes('captcha-sec.heytapmobi.com') && /^\/api\/(?:p2|p1|v1|check)$/.test(url.pathname)))
      );
    }, { timeout: 10_000 })
    .catch(() => undefined);
  const drag = challenge.kind === 'jcap'
    ? await dragToAngle(page, challenge.frame, Number(solution.clockwiseDegrees), captchaCase)
    : await dragDingxiangToAngle(page, Number(solution.clockwiseDegrees), captchaCase);
  const verification = await readDecision(await verificationResponse);
  captchaCase.record('verification_response', verification);
  const result = { solution, drag, verification };
  onEvent('DRAG', result);
  return result;
}
