/**
 * 飞书招聘家族共用的服务端登录证据。
 *
 * 接口返回 HTTP 200 只说明请求成功，只有约定的 body 才能确认账号状态。
 */
export async function readFeishuLoginEvidence(page) {
    return page
        .evaluate(async () => {
        async function read(path) {
            try {
                const response = await fetch(path, {
                    credentials: 'include',
                    signal: AbortSignal.timeout(5_000),
                });
                const body = (await response.json().catch(() => undefined));
                return { status: response.status, body };
            }
            catch {
                return undefined;
            }
        }
        const status = await read('/api/v1/user/mobile/login_status');
        if (status?.status === 200 && status.body?.code === 0) {
            if (status.body.data === true) {
                return {
                    status: 'logged_in',
                    evidence: ['飞书招聘登录状态接口明确返回 data=true'],
                };
            }
            if (status.body.data === false) {
                return {
                    status: 'logged_out',
                    evidence: ['飞书招聘登录状态接口明确返回 data=false'],
                };
            }
        }
        const profile = await read('/api/v1/user/profile');
        const rawData = profile?.body?.data;
        const data = rawData !== null &&
            typeof rawData === 'object' &&
            !Array.isArray(rawData)
            ? rawData
            : undefined;
        if (profile?.status === 200 &&
            profile.body?.code === 0 &&
            data !== undefined &&
            typeof data['id'] === 'string' &&
            data['id'] !== '' &&
            typeof data['user_name'] === 'string' &&
            data['user_name'] !== '' &&
            typeof data['mobile'] === 'string' &&
            data['mobile'] !== '') {
            return {
                status: 'logged_in',
                evidence: ['飞书招聘 profile 接口返回当前账号 id、user_name 和 mobile'],
            };
        }
        if (profile?.status === 401) {
            return {
                status: 'logged_out',
                evidence: ['飞书招聘 profile 接口明确返回未授权'],
            };
        }
        return {
            status: 'unconfirmed',
            evidence: ['飞书招聘登录接口没有返回可用的账号证据'],
        };
    })
        .catch(() => ({
        status: 'unconfirmed',
        evidence: ['飞书招聘登录接口请求失败，当前账号尚未确认'],
    }));
}
//# sourceMappingURL=feishu-login-evidence.js.map