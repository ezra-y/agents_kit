import { redactLoginPageUrl, } from "./contracts.js";
const PROVIDER_ID = 'bilibili.passport.sms';
function result(page, input) {
    return {
        providerId: PROVIDER_ID,
        pageUrlRedacted: redactLoginPageUrl(page.url()),
        ...input,
    };
}
async function visible(locator) {
    return (await locator.count()) > 0 && locator.isVisible().catch(() => false);
}
function phoneInput(page) {
    return page.locator('input[placeholder="请输入手机号"]:visible').first();
}
function codeInput(page) {
    return page.locator('input[placeholder="请输入验证码"]:visible').first();
}
async function hasCaptcha(page) {
    const locator = page.locator([
        '.geetest_panel:visible',
        '.geetest_holder:visible',
        '.captcha-container:visible',
        '.captcha-img:visible',
        'iframe[src*="captcha"]:visible',
    ].join(', '));
    if ((await locator.count()) > 0)
        return true;
    const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    return /请完成验证|拖动滑块|安全验证/.test(body);
}
async function loggedIn() {
    return {
        status: 'unconfirmed',
        evidence: ['页面没有当前账号身份的正向证据'],
    };
}
async function prepareSms(page) {
    if (await hasCaptcha(page)) {
        return result(page, {
            stage: 'captcha_required',
            nextAction: 'confirm_captcha',
            evidence: ['页面出现安全验证控件'],
        });
    }
    if (await visible(phoneInput(page))) {
        return result(page, {
            stage: 'sms_ready',
            nextAction: 'begin_sms',
            evidence: ['短信登录页已打开', '可见手机号输入框已出现'],
        });
    }
    const smsTab = page.getByText('短信登录', { exact: true }).first();
    if (!(await visible(smsTab))) {
        return result(page, {
            stage: 'failed',
            nextAction: 'record_blocker',
            evidence: ['没有找到 B站短信登录标签'],
            errorCode: 'login_sms_tab_not_found',
        });
    }
    await smsTab.click();
    await phoneInput(page).waitFor({ state: 'visible', timeout: 10_000 });
    return result(page, {
        stage: 'sms_ready',
        nextAction: 'begin_sms',
        evidence: ['“短信登录”标签已选中', '可见手机号输入框已出现'],
    });
}
async function inspect(page) {
    const loginCheck = await loggedIn();
    if (loginCheck.status === 'logged_in') {
        return result(page, {
            stage: 'logged_in',
            nextAction: 'continue_application',
            evidence: loginCheck.evidence,
        });
    }
    if (await hasCaptcha(page)) {
        return result(page, {
            stage: 'captcha_required',
            nextAction: 'confirm_captcha',
            evidence: ['页面出现安全验证控件'],
        });
    }
    if (await visible(phoneInput(page))) {
        const send = page.getByText(/获取验证码|重新获取|\d+\s*秒/, { exact: false }).first();
        const text = (await send.innerText().catch(() => '')).trim();
        if (/重新获取|\d+\s*秒/.test(text)) {
            return result(page, {
                stage: 'code_sent',
                nextAction: 'read_sms',
                evidence: ['短信登录页已打开', '验证码按钮进入倒计时'],
            });
        }
        return result(page, {
            stage: 'sms_ready',
            nextAction: 'begin_sms',
            evidence: ['短信登录页已打开', '可见手机号输入框已出现'],
        });
    }
    const loginEntry = page
        .getByText(/^(?:登录|短信登录|登录\/注册)$/)
        .first();
    if (await visible(loginEntry)) {
        return result(page, {
            stage: 'login_required',
            nextAction: 'begin_sms',
            evidence: ['B站页面显示登录入口'],
        });
    }
    if (loginCheck.status === 'unconfirmed') {
        return result(page, {
            stage: 'login_unconfirmed',
            nextAction: 'recover_entry',
            evidence: loginCheck.evidence,
            errorCode: 'login_state_unconfirmed',
            message: '登录状态暂未确认。请继续检查当前页面后再继续。',
        });
    }
    return result(page, {
        stage: 'login_required',
        nextAction: 'begin_sms',
        evidence: ['B站账号登录页已打开'],
    });
}
async function beginSms(page, input) {
    if (!/^1\d{10}$/.test(input.phone)) {
        return result(page, {
            stage: 'failed',
            nextAction: 'record_blocker',
            evidence: ['手机号格式不符合中国大陆手机号规则'],
            errorCode: 'login_phone_invalid',
        });
    }
    const current = await inspect(page);
    if (current.stage === 'logged_in' ||
        current.stage === 'login_unconfirmed' ||
        current.stage === 'code_sent' ||
        current.stage === 'captcha_required' ||
        current.stage === 'failed') {
        return current;
    }
    if (current.stage === 'login_required') {
        const prepared = await prepareSms(page);
        if (prepared.stage !== 'sms_ready')
            return prepared;
    }
    if (current.stage !== 'sms_ready')
        return current;
    await phoneInput(page).fill(input.phone);
    const send = page.getByText('获取验证码', { exact: true }).first();
    await page.waitForFunction((element) => element?.getAttribute('disabled') !== 'disabled', await send.elementHandle(), { timeout: 10_000 });
    await send.click();
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
        if (await hasCaptcha(page)) {
            return result(page, {
                stage: 'captcha_required',
                nextAction: 'confirm_captcha',
                evidence: ['手机号已填写', '点击发送后出现安全验证'],
                requestedAt: input.now,
            });
        }
        const text = (await send.innerText().catch(() => '')).trim();
        if (/重新获取|\d+\s*秒/.test(text)) {
            return result(page, {
                stage: 'code_sent',
                nextAction: 'read_sms',
                evidence: ['手机号已填写', '验证码按钮进入倒计时'],
                requestedAt: input.now,
            });
        }
        await page.waitForTimeout(250);
    }
    return result(page, {
        stage: 'failed',
        nextAction: 'retry_sms',
        evidence: ['点击获取验证码后没有倒计时、验证码挑战或明确错误'],
        errorCode: 'login_sms_send_unconfirmed',
    });
}
async function submitSmsCode(page, input) {
    if (!/^\d{4,8}$/.test(input.code)) {
        return result(page, {
            stage: 'code_rejected',
            nextAction: 'provide_sms_code',
            evidence: ['验证码格式不是 4 到 8 位数字'],
            errorCode: 'login_code_invalid',
        });
    }
    if (await hasCaptcha(page)) {
        return result(page, {
            stage: 'captcha_required',
            nextAction: 'confirm_captcha',
            evidence: ['提交短信验证码前仍有安全验证'],
        });
    }
    await codeInput(page).fill(input.code);
    const submit = page.locator('.btn_primary').filter({ hasText: '登录/注册' }).first();
    await submit.waitFor({ state: 'visible', timeout: 10_000 });
    await submit.click();
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        const loginCheck = await loggedIn();
        if (loginCheck.status === 'logged_in') {
            return result(page, {
                stage: 'logged_in',
                nextAction: 'continue_application',
                evidence: ['验证码已提交', ...loginCheck.evidence],
            });
        }
        if (await hasCaptcha(page)) {
            return result(page, {
                stage: 'captcha_required',
                nextAction: 'confirm_captcha',
                evidence: ['提交短信验证码后出现安全验证'],
            });
        }
        await page.waitForTimeout(250);
    }
    return result(page, {
        stage: 'login_unconfirmed',
        nextAction: 'recover_entry',
        evidence: ['验证码已提交，但没有收到当前账号的正向登录证据'],
        errorCode: 'login_state_unconfirmed',
        message: '验证码已提交，但登录状态暂未确认。请继续检查当前页面后再继续。',
    });
}
export const bilibiliLogin = {
    id: PROVIDER_ID,
    hosts: ['passport.bilibili.com', 'jobs.bilibili.com'],
    inspect,
    beginSms,
    submitSmsCode,
};
//# sourceMappingURL=bilibili-login.js.map