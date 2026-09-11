/** 在页面内读取账号状态，供源浏览器与恢复后的会话共用。 */
export async function readCurrentLoginEvidenceFromDom() {
    const deadline = Date.now() + 8_000;
    if (location.hostname.endsWith('.jobs.feishu.cn')) {
        try {
            const response = await fetch('/api/v1/user/mobile/login_status', {
                credentials: 'include',
                signal: AbortSignal.timeout(5_000),
            });
            const body = await response.json();
            if (response.ok && body !== null && typeof body === 'object' &&
                'code' in body && body.code === 0 && 'data' in body) {
                if (body.data === true) {
                    return { status: 'logged_in', evidence: ['招聘站账号接口确认当前已登录'] };
                }
                if (body.data === false) {
                    return { status: 'logged_out', evidence: ['招聘站账号接口确认当前未登录'] };
                }
            }
        }
        catch {
            // 接口暂不可用时继续检查页面账号控件。
        }
    }
    do {
        const turbo = Reflect.get(window, 'TurboApply');
        const data = turbo !== null && typeof turbo === 'object' && 'data' in turbo
            ? turbo.data : undefined;
        if (data !== null && typeof data === 'object' && 'candidateAccount' in data &&
            'csrfToken' in data && typeof data.csrfToken === 'string' && data.csrfToken !== '') {
            const account = data.candidateAccount;
            if (account !== null && typeof account === 'object') {
                const id = 'id' in account ? account.id
                    : 'candidateAccountId' in account ? account.candidateAccountId : undefined;
                if ((typeof id === 'string' && id !== '') || typeof id === 'number') {
                    return { status: 'logged_in', evidence: ['招聘页面返回当前候选人账号标识'] };
                }
            }
        }
        const visible = (element) => element instanceof HTMLElement && element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== 'hidden';
        const logout = Array.from(document.querySelectorAll('a,button,[role="button"],span'))
            .some((element) => visible(element) &&
            /^(退出登录|退出账号|退出|登出|Log out|Logout)$/i.test(element.innerText.trim()));
        if (logout) {
            return { status: 'logged_in', evidence: ['页面显示可见的退出账号入口'] };
        }
        const accountAreas = Array.from(document.querySelectorAll('header,nav,[role="navigation"],[class*="header"],[class*="Header"],' +
            '[class*="account"],[class*="Account"],[class*="user"],[class*="User"]'));
        for (const area of accountAreas) {
            for (const element of [area, ...Array.from(area.querySelectorAll('a,button,span'))]) {
                if (visible(element) && /^(?:\+?86\s*)?1[3-9]\d{1,2}\*{3,4}\d{3,4}$/.test(element.innerText.trim())) {
                    return { status: 'logged_in', evidence: ['页面账号区域显示已登录用户的遮挡手机号'] };
                }
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    return { status: 'unconfirmed', evidence: ['页面未返回可确认的当前账号信息'] };
}
export async function readCurrentLoginEvidence(page) {
    return page.evaluate(readCurrentLoginEvidenceFromDom).catch(() => ({
        status: 'unconfirmed',
        evidence: ['当前页面账号信息读取未完成'],
    }));
}
//# sourceMappingURL=current-login-evidence.js.map