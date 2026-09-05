import { didiResumePage } from "../didi/resume-page.js";
import { isMokaRecruitmentPath } from "./routes.js";
export function createMokaResumePage(options) {
    return {
        ...didiResumePage,
        id: options.id,
        version: 1,
        host: options.host,
        customDomainCompatible: options.customDomainCompatible,
        status: options.status,
        ...(options.lastVerifiedAt === undefined
            ? {}
            : { lastVerifiedAt: options.lastVerifiedAt }),
        async match(page) {
            const initialUrl = new URL(page.url());
            if (initialUrl.hostname === options.host) {
                await page
                    .waitForFunction(() => /^\/(?:(?:campus|social)-recruitment|campus_apply|apply)\/[^/]+\/\d+\/?$/.test(window.location.pathname) &&
                    window.location.hash.startsWith('#/candidateHome/resume'), undefined, { timeout: 10_000 })
                    .catch(() => undefined);
            }
            const url = new URL(page.url());
            const hostMatched = url.hostname === options.host ||
                (options.customDomainCompatible === true &&
                    isMokaRecruitmentPath(url.pathname));
            const pathMatched = isMokaRecruitmentPath(url.pathname) &&
                url.hash.startsWith('#/candidateHome/resume');
            const anchors = ['基础信息', '教育背景', '项目经验', '保存'];
            const checks = await Promise.all(anchors.map(async (anchor) => ({
                anchor,
                found: (await page.getByText(anchor, { exact: true }).count()) > 0,
            })));
            const matchedAnchors = checks
                .filter((item) => item.found)
                .map((item) => item.anchor);
            const missingAnchors = checks
                .filter((item) => !item.found)
                .map((item) => item.anchor);
            const matched = hostMatched && pathMatched;
            return {
                matched,
                confidence: matched && missingAnchors.length === 0 ? 1 : matched ? 0.8 : 0,
                allowRun: matched,
                reasons: [
                    hostMatched ? 'Moka 招聘域名匹配' : '域名不匹配',
                    pathMatched ? 'Moka 简历路由匹配' : '简历路由不匹配',
                ],
                matchedAnchors,
                missingAnchors,
                pageVersionChanged: hostMatched && pathMatched && missingAnchors.length > 0,
            };
        },
    };
}
export const mokaResumePage = createMokaResumePage({
    id: 'moka.shared.campus-resume',
    host: 'app.mokahr.com',
    status: 'verified',
    lastVerifiedAt: '2026-08-28T18:21:00.000+08:00',
    customDomainCompatible: true,
});
export const envisionMokaResumePage = createMokaResumePage({
    id: 'moka.envision.campus-resume',
    host: 'envision-career.com',
    status: 'candidate',
});
//# sourceMappingURL=resume-page.js.map