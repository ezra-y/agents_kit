import { baiduTalentLogin } from "./baidu-login.js";
import { bilibiliLogin } from "./bilibili-login.js";
import { bytedanceLogin, didiLogin, feishuJobsLogin, jdCampusLogin, lenovoTalentLogin, meituanLogin, mihoyoCampusLogin, mokaSharedLogin, neteaseGamesLogin, oppoCampusLogin, pddCampusLogin, unionsyRecruitmentLogin, xiaomiMiofficeLogin, } from "./recruitment-sms-providers.js";
import { redactLoginPageUrl, } from "./contracts.js";
const providers = [
    baiduTalentLogin,
    bilibiliLogin,
    meituanLogin,
    didiLogin,
    neteaseGamesLogin,
    mokaSharedLogin,
    oppoCampusLogin,
    bytedanceLogin,
    feishuJobsLogin,
    pddCampusLogin,
    unionsyRecruitmentLogin,
    lenovoTalentLogin,
    jdCampusLogin,
    xiaomiMiofficeLogin,
    mihoyoCampusLogin,
];
function providerForUrl(rawUrl) {
    try {
        const url = new URL(rawUrl);
        const hostname = url.hostname;
        return providers.find((provider) => provider.hosts.includes(hostname) ||
            provider.hostSuffixes?.some((suffix) => hostname.endsWith(suffix)) === true ||
            provider.pathPrefixes?.some((prefix) => url.pathname.startsWith(prefix)) === true);
    }
    catch {
        return undefined;
    }
}
async function providerFor(page) {
    const immediate = providerForUrl(page.url());
    if (immediate !== undefined)
        return immediate;
    const initial = new URL(page.url());
    await page
        .waitForURL((url) => url.hostname !== initial.hostname ||
        url.pathname !== initial.pathname, { timeout: 5_000 })
        .catch(() => undefined);
    const redirected = providerForUrl(page.url());
    if (redirected !== undefined)
        return redirected;
    for (const provider of providers) {
        if (await provider.matches?.(page).catch(() => false))
            return provider;
    }
    return undefined;
}
export async function manageLogin(input) {
    const provider = await providerFor(input.page);
    if (provider === undefined) {
        return {
            providerId: 'unsupported',
            stage: 'unsupported',
            pageUrlRedacted: redactLoginPageUrl(input.page.url()),
            nextAction: 'record_blocker',
            evidence: ['当前网址没有已安装的登录适配器'],
            errorCode: 'login_provider_not_found',
        };
    }
    switch (input.action) {
        case 'inspect':
            return provider.inspect(input.page);
        case 'begin_sms':
            if (input.phone === undefined) {
                return {
                    providerId: provider.id,
                    stage: 'failed',
                    pageUrlRedacted: redactLoginPageUrl(input.page.url()),
                    nextAction: 'record_blocker',
                    evidence: ['开始短信登录时没有收到手机号'],
                    errorCode: 'login_phone_missing',
                };
            }
            return provider.beginSms(input.page, { phone: input.phone, now: input.now });
        case 'submit_sms_code':
            if (input.code === undefined) {
                return {
                    providerId: provider.id,
                    stage: 'failed',
                    pageUrlRedacted: redactLoginPageUrl(input.page.url()),
                    nextAction: 'provide_sms_code',
                    evidence: ['提交短信验证码时没有收到验证码'],
                    errorCode: 'login_code_missing',
                };
            }
            return provider.submitSmsCode(input.page, { code: input.code, now: input.now });
    }
}
//# sourceMappingURL=manage-login.js.map