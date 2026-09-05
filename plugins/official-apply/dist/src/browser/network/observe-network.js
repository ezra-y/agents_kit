import { normalizePathShape } from "../scan/compute-page-fingerprint.js";
const DEFAULT_MAX_BODY_BYTES = 512 * 1024;
const DEFAULT_MAX_RECORDS = 200;
const MAX_KEYS = 200;
const MAX_DEPTH = 6;
/** 把 URL 归一成模式：去掉 query，数字段和长 id 段换占位符。 */
export function toUrlPattern(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        return `${parsed.origin}${normalizePathShape(rawUrl)}`;
    }
    catch {
        return '<无法解析的 URL>';
    }
}
/** 收集结构里出现过的键名。 */
export function collectKeys(value, depth = 0, out = new Set()) {
    if (depth > MAX_DEPTH || out.size > MAX_KEYS) {
        return [...out];
    }
    if (Array.isArray(value)) {
        for (const item of value.slice(0, 20)) {
            collectKeys(item, depth + 1, out);
        }
    }
    else if (typeof value === 'object' && value !== null) {
        for (const [key, child] of Object.entries(value)) {
            out.add(key);
            collectKeys(child, depth + 1, out);
        }
    }
    return [...out].sort();
}
/**
 * 把叶子值换成类型占位符。
 *
 * 这是隐私的关键一步：结构留下来，内容全部丢掉。
 * 所以就算响应里有用户手机号，落盘的也只是 `"<string>"`。
 */
export function redactStructure(value, depth = 0) {
    if (depth > MAX_DEPTH) {
        return '<深度截断>';
    }
    if (Array.isArray(value)) {
        // 数组只留前两项作为形状样本。
        return value.slice(0, 2).map((item) => redactStructure(item, depth + 1));
    }
    if (typeof value === 'object' && value !== null) {
        const result = {};
        for (const [key, child] of Object.entries(value).slice(0, 50)) {
            result[key] = redactStructure(child, depth + 1);
        }
        return result;
    }
    if (value === null)
        return null;
    if (typeof value === 'string')
        return '<string>';
    if (typeof value === 'number')
        return '<number>';
    if (typeof value === 'boolean')
        return '<boolean>';
    return '<unknown>';
}
export function responseIndicatesSuccess(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const record = value;
    return (record['success'] === true ||
        record['ok'] === true ||
        record['code'] === 0 ||
        record['status'] === 0);
}
export function observeNetwork(page, options = {}) {
    const jsonOnly = options.jsonOnly ?? true;
    const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    const records = [];
    const pending = [];
    let stopped = false;
    const onResponse = (response) => {
        if (stopped || records.length >= maxRecords) {
            return;
        }
        // 只看 content-type 这一个响应头，且不保存它以外的任何头。
        const contentType = response.headers()['content-type'] ?? '';
        if (jsonOnly && !contentType.includes('json')) {
            return;
        }
        const task = (async () => {
            let body;
            try {
                body = await response.body();
            }
            catch {
                return;
            }
            if (stopped || records.length >= maxRecords) {
                return;
            }
            const observation = {
                requestUrlPattern: toUrlPattern(response.url()),
                method: response.request().method(),
                status: response.status(),
                ...(contentType === '' ? {} : { responseContentType: contentType }),
                byteSize: body.byteLength,
                detectedKeys: [],
                observedAt: new Date().toISOString(),
            };
            const requestBody = response.request().postDataBuffer();
            if (requestBody !== null && requestBody.byteLength <= maxBodyBytes) {
                try {
                    const parsedRequest = response.request().postDataJSON();
                    observation.requestDetectedKeys = collectKeys(parsedRequest);
                    observation.requestRedactedSample = redactStructure(parsedRequest);
                }
                catch {
                    // 非 JSON 请求只保留方法和 URL 形状。文件内容不读取。
                }
            }
            if (body.byteLength <= maxBodyBytes) {
                try {
                    const parsed = JSON.parse(body.toString('utf8'));
                    observation.detectedKeys = collectKeys(parsed);
                    observation.redactedSample = redactStructure(parsed);
                    observation.responseIndicatesSuccess = responseIndicatesSuccess(parsed);
                }
                catch {
                    // 不是合法 JSON 就只留元数据。
                }
            }
            records.push(observation);
        })();
        pending.push(task);
    };
    page.on('response', onResponse);
    return {
        observations() {
            return [...records];
        },
        async settle() {
            // 快照一份再等：等待期间可能又来新响应，那些留给下一次。
            await Promise.allSettled([...pending]);
        },
        stop() {
            if (stopped) {
                return;
            }
            stopped = true;
            page.off('response', onResponse);
        },
    };
}
/**
 * 等待还在解析中的响应处理完。扫描前调用。
 *
 * 原来这里只是 `setTimeout(50)` 然后 `void handle`——名字叫 drain，
 * 实际什么都没等。机器一忙就漏掉首屏那条表单接口，
 * 而那恰恰是最有价值的一条。
 */
export async function drainNetworkObserver(handle) {
    await handle.settle();
}
//# sourceMappingURL=observe-network.js.map