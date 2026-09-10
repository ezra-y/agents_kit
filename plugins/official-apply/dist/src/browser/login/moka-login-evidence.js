async function visible(locator) {
    return (await locator.count()) > 0 && locator.isVisible().catch(() => false);
}
function hasMokaAccountInPage() {
    const data = window.TurboApply?.data;
    const account = data?.candidateAccount;
    const candidateId = account?.['id'] ?? account?.['candidateAccountId'];
    return (typeof data?.csrfToken === 'string' &&
        data.csrfToken !== '' &&
        account !== undefined &&
        ((typeof candidateId === 'string' && candidateId !== '') ||
            (typeof candidateId === 'number' && Number.isFinite(candidateId))));
}
/** Moka/Didi 共用的当前账号读取证据。页面无账号数据时保持未确认。 */
export async function readMokaLoginEvidence(page) {
    let confirmed = await page.evaluate(hasMokaAccountInPage).catch(() => false);
    if (confirmed) {
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
        .waitForFunction(hasMokaAccountInPage, undefined, { timeout: 10_000 })
        .catch(() => undefined);
    confirmed = await page.evaluate(hasMokaAccountInPage).catch(() => false);
    if (confirmed) {
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