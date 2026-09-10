import { readMihoyoResumeResponse } from "../../site-adapters/mihoyo/read-resume-response.js";
export async function readMihoyoLoginEvidence(page) {
    const tokenState = await page
        .evaluate(() => {
        const token = window.localStorage.getItem('Jobs-Token') ?? '';
        if (token === '')
            return { state: 'missing' };
        const payload = token.split('.')[1];
        if (payload === undefined)
            return { state: 'present' };
        try {
            const decoded = atob(payload.replaceAll('-', '+').replaceAll('_', '/'));
            const value = JSON.parse(decoded);
            return typeof value.exp === 'number' && Number.isFinite(value.exp)
                ? { state: 'present', exp: value.exp }
                : { state: 'present' };
        }
        catch {
            return { state: 'present' };
        }
    })
        .catch(() => ({ state: 'page_unconfirmed' }));
    if (tokenState.state === 'missing') {
        return {
            status: 'logged_out',
            evidence: ['米哈游页面没有 Jobs-Token，当前会话没有可用凭据'],
        };
    }
    if (tokenState.state === 'present' &&
        tokenState.exp !== undefined &&
        tokenState.exp * 1_000 <= Date.now()) {
        return {
            status: 'logged_out',
            evidence: ['米哈游 Jobs-Token 已过期，当前会话不可用'],
        };
    }
    if (tokenState.state === 'page_unconfirmed') {
        return {
            status: 'unconfirmed',
            evidence: ['米哈游页面无法读取 Jobs-Token，当前账号尚未确认'],
        };
    }
    const response = await readMihoyoResumeResponse(page).catch(() => undefined);
    if (response === undefined) {
        return {
            status: 'unconfirmed',
            evidence: ['米哈游受保护简历接口请求失败，当前账号尚未确认'],
        };
    }
    if (response.status >= 200 &&
        response.status < 300 &&
        response.code === 0 &&
        response.success === true) {
        return {
            status: 'logged_in',
            evidence: ['米哈游受保护简历接口返回已认证的简历数据'],
        };
    }
    if (response.status === 401) {
        return {
            status: 'logged_out',
            evidence: ['米哈游受保护简历接口明确返回未授权'],
        };
    }
    if (response.code === -3 || response.code === '-3') {
        return {
            status: 'logged_out',
            evidence: ['米哈游受保护简历接口返回 code=-3，明确拒绝当前会话'],
        };
    }
    return {
        status: 'unconfirmed',
        evidence: ['米哈游受保护简历接口返回非预期结果，当前账号尚未确认'],
    };
}
//# sourceMappingURL=mihoyo-login-evidence.js.map