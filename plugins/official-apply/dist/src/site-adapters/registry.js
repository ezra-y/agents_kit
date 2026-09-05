import { bilibiliResumePage } from "./bilibili/resume-page.js";
import { didiResumePage } from "./didi/resume-page.js";
import { neteaseResumePage } from "./netease/resume-page.js";
import { baiduResumePage } from "./baidu/resume-page.js";
import { feishuJobsResumePage } from "./feishu-jobs/resume-page.js";
import { game4399ResumePage } from "./game-4399/resume-page.js";
import { kuaishouResumePage } from "./kuaishou/resume-page.js";
import { mihoyoResumePage } from "./mihoyo/resume-page.js";
import { envisionMokaResumePage, mokaResumePage, } from "./moka/resume-page.js";
import { xiaomiResumePage } from "./xiaomi/resume-page.js";
function descriptorOf(script) {
    return {
        id: script.id,
        version: script.version,
        host: script.host,
        pageKind: script.pageKind,
        status: script.status,
        ...(script.lastVerifiedAt === undefined ? {} : { lastVerifiedAt: script.lastVerifiedAt }),
    };
}
function statusPriority(status) {
    switch (status) {
        case 'stable':
            return 3;
        case 'verified':
            return 2;
        case 'candidate':
            return 1;
        case 'deprecated':
            return 0;
    }
}
function errorMessage(error) {
    return error instanceof Error ? (error.message.split('\n')[0] ?? error.name) : String(error);
}
function hostMatches(pattern, hostname) {
    if (!pattern.startsWith('*.'))
        return pattern === hostname;
    const suffix = pattern.slice(1);
    return hostname.endsWith(suffix) && hostname.length > suffix.length;
}
export class PageScriptRegistry {
    #scripts = new Map();
    constructor(scripts = []) {
        for (const script of scripts) {
            this.register(script);
        }
    }
    register(script) {
        if (this.#scripts.has(script.id)) {
            throw new Error(`page_script_duplicate: 已注册 ${script.id}`);
        }
        this.#scripts.set(script.id, script);
    }
    list(host) {
        return [...this.#scripts.values()]
            .filter((script) => host === undefined || hostMatches(script.host, host))
            .map(descriptorOf)
            .sort((left, right) => left.id.localeCompare(right.id));
    }
    async resolve(page) {
        const hostname = new URL(page.url()).hostname;
        const candidates = [...this.#scripts.values()].filter((script) => (hostMatches(script.host, hostname) ||
            script.customDomainCompatible === true) &&
            script.status !== 'deprecated');
        const checked = candidates.map(descriptorOf);
        const errors = [];
        const matched = [];
        for (const script of candidates) {
            try {
                const match = await script.match(page);
                if (match.matched) {
                    matched.push({ script, match });
                }
            }
            catch (error) {
                errors.push({ scriptId: script.id, message: errorMessage(error) });
            }
        }
        matched.sort((left, right) => {
            const confidence = right.match.confidence - left.match.confidence;
            if (confidence !== 0) {
                return confidence;
            }
            const status = statusPriority(right.script.status) - statusPriority(left.script.status);
            if (status !== 0) {
                return status;
            }
            return right.script.version - left.script.version;
        });
        const selected = matched[0];
        return {
            ...(selected === undefined ? {} : { selected: selected.script, match: selected.match }),
            checked,
            errors,
        };
    }
}
export const pageScriptRegistry = new PageScriptRegistry([
    neteaseResumePage,
    baiduResumePage,
    bilibiliResumePage,
    didiResumePage,
    kuaishouResumePage,
    feishuJobsResumePage,
    game4399ResumePage,
    envisionMokaResumePage,
    mihoyoResumePage,
    mokaResumePage,
    xiaomiResumePage,
]);
//# sourceMappingURL=registry.js.map