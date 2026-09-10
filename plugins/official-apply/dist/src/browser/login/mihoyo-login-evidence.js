import { readMihoyoResumeResponse } from "../../site-adapters/mihoyo/read-resume-response.js";
export async function readMihoyoLoginEvidence(page) {
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
    return {
        status: 'unconfirmed',
        evidence: ['米哈游受保护简历接口没有返回可用的账号证据'],
    };
}
//# sourceMappingURL=mihoyo-login-evidence.js.map