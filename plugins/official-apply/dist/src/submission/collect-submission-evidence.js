import { findSubmissionSuccessText } from "./submission-success-text.js";
/** 申请编号。不同网站写法不一，取常见的几种。 */
const APPLICATION_ID_PATTERNS = [
    /申请编号[：: ]\s*([A-Za-z0-9-]{4,})/,
    /投递编号[：: ]\s*([A-Za-z0-9-]{4,})/,
    /application\s*(?:id|no\.?|number)[：: ]\s*([A-Za-z0-9-]{4,})/i,
];
/** 弱证据的文字特征。看到这些**不能**算成功。 */
const WEAK_TEXT_PATTERNS = ['处理中', '提交中', '请稍候', 'processing', 'submitting'];
/** 申请编号是个人标识，只保留形状，不回显完整值。 */
export function redactApplicationId(value) {
    if (value.length <= 4) {
        return '****';
    }
    return `${value.slice(0, 2)}****${value.slice(-2)}`;
}
export function collectSubmissionEvidence(input) {
    const evidence = [];
    const text = input.bodyText.replace(/\s+/g, ' ');
    const previousText = (input.previousBodyText ?? '').replace(/\s+/g, ' ');
    const previousSemantic = new Set((input.previousSemanticTexts ?? []).map((item) => item.replace(/\s+/g, ' ').trim()));
    const newSemanticTexts = input.semanticTexts.filter((item) => !previousSemantic.has(item.replace(/\s+/g, ' ').trim()));
    // 1. 强证据：点击后新出现的语义成功文字。整页正文不参与。
    const successText = findSubmissionSuccessText(newSemanticTexts);
    if (successText !== undefined) {
        evidence.push({ kind: 'success_text', valueRedacted: successText, confidence: 0.9 });
    }
    // 2. 强证据：点击后新出现的申请编号。
    for (const pattern of APPLICATION_ID_PATTERNS) {
        const match = pattern.exec(text);
        if (match?.[1] !== undefined && !previousText.includes(match[1])) {
            evidence.push({
                kind: 'application_id',
                valueRedacted: redactApplicationId(match[1]),
                confidence: 0.95,
            });
            break;
        }
    }
    // 3. 强证据：页面类型本身就是成功页。
    if (input.pageSchema.pageType === 'submission_success' &&
        input.previousPageType !== 'submission_success') {
        evidence.push({ kind: 'status_badge', valueRedacted: '页面类型识别为成功页', confidence: 0.85 });
    }
    // 4. 中等证据：跳到了已知的成功 URL。
    for (const pattern of input.successUrlPatterns ?? []) {
        if (input.finalUrlRedacted.includes(pattern) &&
            !input.previousUrlRedacted?.includes(pattern)) {
            evidence.push({ kind: 'success_url', valueRedacted: pattern, confidence: 0.6 });
            break;
        }
    }
    // 5. 弱证据：只是「处理中」。记下来，但绝不算成功。
    const weak = WEAK_TEXT_PATTERNS.find((pattern) => text.includes(pattern));
    if (weak !== undefined) {
        evidence.push({ kind: 'other', valueRedacted: `仅出现「${weak}」`, confidence: 0.2 });
    }
    const strong = evidence.filter((item) => item.confidence >= 0.85);
    const medium = evidence.filter((item) => item.confidence >= 0.5 && item.confidence < 0.85);
    if (strong.length > 0) {
        return { evidence, strength: 'strong', confirmed: true };
    }
    if (medium.length >= 2) {
        // 两条彼此独立的中等证据可以合成确认（参考 `examples/page-recipe.example.yaml` 的判定规则）。
        return { evidence, strength: 'medium', confirmed: true };
    }
    if (medium.length === 1) {
        return { evidence, strength: 'medium', confirmed: false };
    }
    return { evidence, strength: evidence.length > 0 ? 'weak' : 'none', confirmed: false };
}
//# sourceMappingURL=collect-submission-evidence.js.map