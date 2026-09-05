/** 每种 nextAction 对应的「做完哪件事才能继续」。写给人看，要能照着做。 */
const RESUME_BY_ACTION = {
    continue_application: '登录已完成，继续申请流程。',
    begin_sms: '发送短信验证码前先确认接收手机号。',
    read_sms: '读取最新短信验证码。',
    confirm_captcha: '完成页面上的验证码确认。',
    provide_sms_code: '提供短信验证码。',
    retry_sms: '重发短信并重试登录。',
    record_blocker: '人工处理并解除阻断后再继续。',
};
/** 每种卡点的默认说明。只有 flow.message 缺失时才用。 */
const FALLBACK_MESSAGE = {
    login: '当前需要登录。',
    captcha: '页面出现验证码，需要人工确认。',
    sms_code: '需要短信验证码。',
    unknown_required_answer: '页面要追问缺失答案。',
    sensitive_confirmation: '需要确认敏感信息。',
    submission_confirmation: '需要确认最终提交。',
    site_blocked: '页面跳到了未登记的域名，已暂停自动操作。',
    tool_failure: '登录工具没有适配这个页面，需要人工处理。',
    submission_uncertain: '提交结果不确定，需要去官网人工确认。',
};
export function loginHumanTakeover(runId, flow) {
    switch (flow.stage) {
        case 'logged_in':
        case 'sms_ready':
            // 已经过去的一关：不产生卡点（调用方以 active 缺省解除旧 pending）。
            return undefined;
        case 'login_required':
            return takeover(runId, flow, 'login');
        case 'captcha_required':
            return takeover(runId, flow, 'captcha');
        case 'code_sent':
        case 'code_rejected':
            return takeover(runId, flow, 'sms_code');
        case 'unsupported':
            return takeover(runId, flow, 'tool_failure');
        case 'failed':
            if (flow.nextAction === 'retry_sms') {
                return takeover(runId, flow, 'site_blocked');
            }
            if (flow.nextAction === 'provide_sms_code') {
                return takeover(runId, flow, 'sms_code');
            }
            return takeover(runId, flow, 'tool_failure');
    }
}
function takeover(runId, flow, reason) {
    return {
        runId,
        reason,
        message: flow.message ?? FALLBACK_MESSAGE[reason],
        resumeCondition: RESUME_BY_ACTION[flow.nextAction],
        currentUrl: flow.pageUrlRedacted,
    };
}
//# sourceMappingURL=login-human-takeover.js.map