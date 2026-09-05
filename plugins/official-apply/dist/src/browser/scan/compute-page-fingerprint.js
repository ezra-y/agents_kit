/**
 * 生成页面指纹。
 *
 * 规则文档：`docs/08_页面配方SaaS家族与跨公司复用.md §4`
 *
 * 用途：判断「这一页是不是之前见过的同一页」，从而复用页面配方。
 *
 * 两条硬规则：
 * 1. **不能包含用户输入值。** 否则同一页填了不同答案就变成两页。
 * 2. **不是整页死哈希。** 网站改一句文案不应该让配方全部失效。
 */
import { createHash } from 'node:crypto';
/** 把路径里的数字段和长 id 段换成占位符，避免每个岗位算成不同页面。 */
export function normalizePathShape(rawUrl) {
    try {
        const { pathname } = new URL(rawUrl);
        return pathname
            .split('/')
            .map((segment) => {
            if (segment === '')
                return segment;
            if (/^\d+$/.test(segment))
                return ':num';
            if (/^[0-9a-f]{8,}$/i.test(segment))
                return ':id';
            if (/\d{4,}/.test(segment))
                return ':id';
            return segment;
        })
            .join('/');
    }
    catch {
        return '';
    }
}
export function buildFingerprintParts(schema) {
    const host = (() => {
        try {
            return new URL(schema.url).host;
        }
        catch {
            return '';
        }
    })();
    // 只用「有哪些字段、什么类型、必填与否」，不碰任何值。
    const fieldSignature = schema.fields
        .map((field) => [field.sectionPath.join('/'), field.controlKind, field.required ? 'req' : 'opt', field.rawLabel].join(':'))
        .sort()
        .join('|');
    const actionSignature = schema.actions
        .map((action) => `${action.kind}:${action.commitAction ? 'commit' : 'normal'}`)
        .sort()
        .join('|');
    return {
        host,
        pathShape: normalizePathShape(schema.url),
        stepKey: schema.stepKey ?? schema.stepLabel ?? '',
        fieldSignature,
        actionSignature,
    };
}
export function computePageFingerprint(schema) {
    const parts = buildFingerprintParts(schema);
    const payload = [parts.host, parts.pathShape, parts.stepKey, parts.fieldSignature, parts.actionSignature].join('\n');
    const digest = createHash('sha256').update(payload).digest('hex').slice(0, 24);
    // 前缀保留可读部分，方便人直接看出这是哪一页。
    return `${parts.host}|${parts.pathShape}|${parts.stepKey}|${digest}`;
}
//# sourceMappingURL=compute-page-fingerprint.js.map