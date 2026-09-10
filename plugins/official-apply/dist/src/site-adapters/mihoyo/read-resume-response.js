export const MIHOYO_READ_URL = 'https://ats.openout.mihoyo.com/ats-portal/v2/resume/info';
/** 复用米哈游现有的受保护简历读取请求，供保存和登录判断共同使用。 */
export async function readMihoyoResumeResponse(page) {
    return page.evaluate(async ({ url }) => {
        const token = window.localStorage.getItem('Jobs-Token') ?? '';
        const result = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            signal: AbortSignal.timeout(5_000),
            headers: {
                'content-type': 'application/json',
                ...(token === '' ? {} : { authorization: token }),
            },
            body: JSON.stringify({ channelDetailIds: [1], hireType: 1 }),
        });
        const body = await result.json();
        return {
            status: result.status,
            code: body?.code,
            success: body?.success,
            message: body?.message,
            data: body?.data,
        };
    }, { url: MIHOYO_READ_URL });
}
//# sourceMappingURL=read-resume-response.js.map