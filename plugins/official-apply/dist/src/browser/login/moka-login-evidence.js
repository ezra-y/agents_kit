async function visible(locator) {
    return (await locator.count()) > 0 && locator.isVisible().catch(() => false);
}
export function readMokaAccountFromDom() {
    const data = window.TurboApply?.data;
    if (typeof data?.csrfToken !== 'string' || data.csrfToken === '')
        return undefined;
    const account = data.candidateAccount;
    const id = account?.['id'] ?? account?.['candidateAccountId'];
    if ((typeof id !== 'string' && typeof id !== 'number') || String(id) === '')
        return undefined;
    return {
        accountId: String(id),
        ...(typeof account?.['phone'] === 'string' ? { phone: account['phone'] } : {}),
        ...(typeof account?.['email'] === 'string' ? { email: account['email'] } : {}),
    };
}
/** Moka/Didi 共用的当前账号读取证据。页面无账号数据时保持未确认。 */
export async function readMokaLoginEvidence(page) {
    let account = await page.evaluate(readMokaAccountFromDom).catch(() => undefined);
    if (account !== undefined) {
        return {
            status: 'logged_in',
            evidence: ['Moka 页面返回当前 candidateAccount 与 csrfToken'],
        };
    }
    if (await visible(page.getByText(/^(?:登录|Sign in)$/i, { exact: true }).first())) {
        return {
            status: 'unconfirmed',
            evidence: ['页面显示登录控件，当前账号尚未通过正向证据确认'],
        };
    }
    await page
        .waitForFunction(readMokaAccountFromDom, undefined, { timeout: 10_000 })
        .catch(() => undefined);
    account = await page.evaluate(readMokaAccountFromDom).catch(() => undefined);
    if (account !== undefined) {
        return {
            status: 'logged_in',
            evidence: ['Moka 页面返回当前 candidateAccount 与 csrfToken'],
        };
    }
    if (await visible(page.getByText(/^(?:登录|Sign in)$/i, { exact: true }).first())) {
        return {
            status: 'unconfirmed',
            evidence: ['页面显示登录控件，当前账号尚未通过正向证据确认'],
        };
    }
    return {
        status: 'unconfirmed',
        evidence: ['Moka 页面尚未返回当前 candidateAccount 与 csrfToken'],
    };
}
//# sourceMappingURL=moka-login-evidence.js.map