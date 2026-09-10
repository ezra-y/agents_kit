import { redactLoginPageUrl, } from "./contracts.js";
function result(config, page, input) {
    return {
        providerId: config.id,
        pageUrlRedacted: redactLoginPageUrl(page.url()),
        ...input,
    };
}
async function visible(locator) {
    if (locator === undefined)
        return false;
    return (await locator.count()) > 0 && locator.isVisible().catch(() => false);
}
async function sent(config, page) {
    const indicator = config.sentIndicator?.(page);
    if (indicator !== undefined && (await visible(indicator)))
        return true;
    const button = config.sendButton(page);
    if (!(await visible(button)))
        return false;
    if (button === undefined)
        return false;
    const text = (await button.innerText().catch(() => '')).trim();
    return (config.sentPattern ?? /重新发送|重新获取|\d+\s*(?:s|秒)/).test(text);
}
async function inspect(config, page) {
    const loginCheck = await config.isLoggedIn(page);
    if (loginCheck.status === 'logged_in') {
        return result(config, page, {
            stage: 'logged_in',
            nextAction: 'continue_application',
            evidence: loginCheck.evidence,
        });
    }
    if (await config.hasCaptcha(page)) {
        return result(config, page, {
            stage: 'captcha_required',
            nextAction: 'confirm_captcha',
            evidence: ['页面出现安全验证控件'],
        });
    }
    if (await visible(config.phoneInput(page))) {
        const error = await config.visibleError?.(page);
        if (error !== undefined) {
            return result(config, page, {
                stage: 'failed',
                nextAction: 'retry_sms',
                evidence: ['短信登录页显示明确错误'],
                errorCode: 'login_sms_send_rejected',
                message: error,
            });
        }
        if (await sent(config, page)) {
            return result(config, page, {
                stage: 'code_sent',
                nextAction: 'read_sms',
                evidence: [
                    ...(loginCheck.status === 'logged_out' ? loginCheck.evidence : []),
                    '短信登录页已打开',
                    '验证码输入框或发送倒计时已出现',
                ],
            });
        }
        return result(config, page, {
            stage: 'sms_ready',
            nextAction: 'begin_sms',
            evidence: [
                ...(loginCheck.status === 'logged_out' ? loginCheck.evidence : []),
                '短信登录页已打开',
                '可见手机号输入框已出现',
            ],
        });
    }
    const loginEntry = page
        .getByText(/^(?:登录|登录\/注册|Sign in)$/i, { exact: true })
        .first();
    if (await visible(loginEntry)) {
        return result(config, page, {
            stage: 'login_required',
            nextAction: 'begin_sms',
            evidence: loginCheck.status === 'logged_out'
                ? loginCheck.evidence
                : ['页面显示登录入口'],
        });
    }
    if (loginCheck.status === 'logged_out') {
        return result(config, page, {
            stage: 'login_required',
            nextAction: 'recover_entry',
            evidence: loginCheck.evidence,
            message: '当前会话已失效。请检查登录入口后再继续。',
        });
    }
    return result(config, page, {
        stage: 'login_unconfirmed',
        nextAction: 'recover_entry',
        evidence: loginCheck.evidence,
        errorCode: 'login_state_unconfirmed',
        message: '登录状态暂未确认。请继续检查当前页面的登录入口，确认后再继续。',
    });
}
async function beginSms(config, page, input) {
    if (!/^1\d{10}$/.test(input.phone)) {
        return result(config, page, {
            stage: 'failed',
            nextAction: 'record_blocker',
            evidence: ['手机号格式不符合中国大陆手机号规则'],
            errorCode: 'login_phone_invalid',
        });
    }
    const current = await inspect(config, page);
    if (current.stage === 'logged_in' ||
        current.stage === 'login_unconfirmed' ||
        current.stage === 'code_sent' ||
        current.stage === 'captcha_required' ||
        current.stage === 'failed') {
        return current;
    }
    let ready = current;
    if (current.stage === 'login_required') {
        try {
            await config.prepare(page);
        }
        catch (error) {
            return result(config, page, {
                stage: 'failed',
                nextAction: 'record_blocker',
                evidence: ['没有进入可用的短信登录页'],
                errorCode: 'login_sms_page_not_reached',
                message: error instanceof Error ? error.message.split('\n')[0] : String(error),
            });
        }
        const prepared = await inspect(config, page);
        if (prepared.stage !== 'sms_ready') {
            if (prepared.stage !== 'login_required' || (await visible(config.phoneInput(page))))
                return prepared;
            return result(config, page, {
                stage: 'login_required',
                nextAction: 'recover_entry',
                evidence: [...prepared.evidence, '登录准备后仍没有可见手机号输入框'],
                message: '登录页面已打开，但短信表单尚未就绪。请继续检查当前页面后再继续。',
            });
        }
        if (!(await visible(config.phoneInput(page)))) {
            return result(config, page, {
                stage: 'login_required',
                nextAction: 'recover_entry',
                evidence: [...prepared.evidence, '登录准备后仍没有可见手机号输入框'],
                message: '登录页面已打开，但短信表单尚未就绪。请继续检查当前页面后再继续。',
            });
        }
        ready = prepared;
    }
    if (ready.stage !== 'sms_ready')
        return ready;
    const phoneInput = config.phoneInput(page);
    if (phoneInput === undefined) {
        return result(config, page, {
            stage: 'login_required',
            nextAction: 'recover_entry',
            evidence: ['短信登录表单没有手机号输入框'],
            message: '登录页面已打开，但短信表单尚未就绪。请继续检查当前页面后再继续。',
        });
    }
    await phoneInput.fill(input.phone);
    await config.beforeSend?.(page);
    const agreement = config.agreement?.(page);
    if (agreement !== undefined &&
        (await visible(agreement)) &&
        !(await agreement.isChecked().catch(() => false))) {
        await agreement.check();
    }
    const sendButton = config.sendButton(page);
    if (sendButton === undefined) {
        return result(config, page, {
            stage: 'login_required',
            nextAction: 'recover_entry',
            evidence: ['短信登录表单没有获取验证码按钮'],
            message: '登录页面已打开，但短信表单尚未就绪。请继续检查当前页面后再继续。',
        });
    }
    await sendButton.waitFor({ state: 'visible', timeout: 10_000 });
    const sendDecisionPromise = config.waitForSendDecision?.(page);
    await sendButton.click();
    if (sendDecisionPromise !== undefined) {
        const decision = await sendDecisionPromise.catch(() => undefined);
        if (decision !== undefined) {
            if (decision.accepted) {
                return result(config, page, {
                    stage: 'code_sent',
                    nextAction: 'read_sms',
                    evidence: decision.evidence ?? ['短信发送接口明确返回成功'],
                    requestedAt: input.now,
                });
            }
            if (await config.hasCaptcha(page)) {
                return result(config, page, {
                    stage: 'captcha_required',
                    nextAction: 'confirm_captcha',
                    evidence: ['手机号已填写', '短信发送接口返回后出现安全验证'],
                    requestedAt: input.now,
                });
            }
            return result(config, page, {
                stage: 'failed',
                nextAction: 'retry_sms',
                evidence: decision.evidence ?? ['短信发送接口明确返回失败'],
                errorCode: decision.errorCode ?? 'login_sms_send_rejected',
                message: decision.message,
            });
        }
    }
    const deadline = Date.now() + (config.sendTimeoutMs ?? 15_000);
    while (Date.now() < deadline) {
        if (await config.hasCaptcha(page)) {
            return result(config, page, {
                stage: 'captcha_required',
                nextAction: 'confirm_captcha',
                evidence: ['手机号已填写', '点击发送后出现安全验证'],
                requestedAt: input.now,
            });
        }
        const error = await config.visibleError?.(page);
        if (error !== undefined) {
            return result(config, page, {
                stage: 'failed',
                nextAction: 'retry_sms',
                evidence: ['短信发送后页面显示错误'],
                errorCode: 'login_sms_send_rejected',
                message: error,
            });
        }
        if (await sent(config, page)) {
            return result(config, page, {
                stage: 'code_sent',
                nextAction: 'read_sms',
                evidence: ['手机号已填写', '验证码输入框或发送倒计时已出现'],
                requestedAt: input.now,
            });
        }
        await page.waitForTimeout(250);
    }
    return result(config, page, {
        stage: 'failed',
        nextAction: 'retry_sms',
        evidence: ['点击获取验证码后没有倒计时、验证码挑战或明确错误'],
        errorCode: 'login_sms_send_unconfirmed',
    });
}
async function submitSmsCode(config, page, input) {
    if (!/^\d{4,8}$/.test(input.code)) {
        return result(config, page, {
            stage: 'code_rejected',
            nextAction: 'provide_sms_code',
            evidence: ['验证码格式不是 4 到 8 位数字'],
            errorCode: 'login_code_invalid',
        });
    }
    if (await config.hasCaptcha(page)) {
        return result(config, page, {
            stage: 'captcha_required',
            nextAction: 'confirm_captcha',
            evidence: ['提交短信验证码前仍有安全验证'],
        });
    }
    const codeInput = config.codeInput(page);
    const submitButton = config.submitButton(page);
    if (codeInput === undefined || submitButton === undefined) {
        return result(config, page, {
            stage: 'login_required',
            nextAction: 'recover_entry',
            evidence: ['短信登录表单没有完整验证码控件'],
            message: '登录页面已打开，但验证码表单尚未就绪。请继续检查当前页面后再继续。',
        });
    }
    await codeInput.fill(input.code);
    await config.beforeSubmit?.(page);
    await submitButton.waitFor({ state: 'visible', timeout: 10_000 });
    await submitButton.click();
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        const loginCheck = await config.isLoggedIn(page);
        if (loginCheck.status === 'logged_in') {
            return result(config, page, {
                stage: 'logged_in',
                nextAction: 'continue_application',
                evidence: ['验证码已提交', ...loginCheck.evidence],
            });
        }
        if (await config.hasCaptcha(page)) {
            return result(config, page, {
                stage: 'captcha_required',
                nextAction: 'confirm_captcha',
                evidence: ['提交短信验证码后出现安全验证'],
            });
        }
        const error = await config.visibleError?.(page);
        if (error !== undefined) {
            return result(config, page, {
                stage: 'code_rejected',
                nextAction: 'provide_sms_code',
                evidence: ['提交验证码后页面显示错误'],
                errorCode: 'login_code_rejected',
                message: error,
            });
        }
        await page.waitForTimeout(250);
    }
    return result(config, page, {
        stage: 'login_unconfirmed',
        nextAction: 'recover_entry',
        evidence: ['验证码已提交，但没有收到当前账号的正向登录证据'],
        errorCode: 'login_state_unconfirmed',
        message: '验证码已提交，但登录状态暂未确认。请继续检查当前页面后再继续。',
    });
}
export function createSmsLoginProvider(config) {
    return {
        id: config.id,
        hosts: config.hosts ?? [],
        hostSuffixes: config.hostSuffixes,
        pathPrefixes: config.pathPrefixes,
        matches: config.matches,
        inspect: (page) => inspect(config, page),
        beginSms: (page, input) => beginSms(config, page, input),
        submitSmsCode: (page, input) => submitSmsCode(config, page, input),
    };
}
//# sourceMappingURL=create-sms-login-provider.js.map