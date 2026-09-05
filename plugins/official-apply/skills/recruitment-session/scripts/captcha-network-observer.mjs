export function safeCaptchaResponseSummary(value) {
  if (!value || typeof value !== 'object') return {};
  const summary = {};
  for (const key of [
    'code',
    'message',
    'msg',
    'success',
    'status',
    'result',
    'verify_result',
    'reason',
    'decision',
  ]) {
    const item = value[key];
    if (
      typeof item === 'boolean' ||
      typeof item === 'number' ||
      (typeof item === 'string' && item.length <= 200)
    ) {
      summary[key] = item;
    }
  }
  if (value.data && typeof value.data === 'object') {
    summary.dataKeys = Object.keys(value.data).slice(0, 40);
    summary.data = safeCaptchaResponseSummary(value.data);
  }
  summary.keys = Object.keys(value).slice(0, 40);
  return summary;
}

export function isCaptchaDecisionResponse(response) {
  const method = response.request().method();
  if (method !== 'POST' && method !== 'GET') return false;
  const url = response.url();
  if (/(?:report|monitor|collect)/i.test(url)) return false;
  return (
    /(?:\/captcha\/verify|\/check|\/validate|\/verify)(?:[/?]|$)/i.test(url) ||
    (/(?:dun\.163|yidun)/i.test(url) && /(?:check|verify)/i.test(url))
  );
}

export async function readCaptchaDecision(response) {
  let body = {};
  try {
    body = await response.json();
  } catch {
    try {
      const text = await response.text();
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      body =
        start >= 0 && end > start
          ? JSON.parse(text.slice(start, end + 1))
          : {};
    } catch {
      body = {};
    }
  }
  const url = new URL(response.url());
  return {
    method: response.request().method(),
    url: `${url.origin}${url.pathname}`,
    httpStatus: response.status(),
    body: safeCaptchaResponseSummary(body),
  };
}

export function attachCaptchaNetworkObserver(page, write) {
  const listener = (response) => {
    if (!isCaptchaDecisionResponse(response)) return;
    void readCaptchaDecision(response)
      .then((decision) => write('VERIFY_RESPONSE', decision))
      .catch(() => undefined);
  };
  page.on('response', listener);
  return () => page.off('response', listener);
}

export function waitForCaptchaDecision(page, timeout = 8_000) {
  return page
    .waitForResponse(isCaptchaDecisionResponse, { timeout })
    .catch(() => undefined);
}
