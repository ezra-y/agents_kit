import { pickRawLabel } from "./scan-controls.js";
const PURPOSE_PATTERNS = [
    ['resume', ['简历', 'resume', 'cv']],
    ['portfolio', ['作品', 'portfolio']],
    ['transcript', ['成绩单', 'transcript']],
    ['photo', ['照片', '证件照', 'photo']],
    ['certificate', ['证书', '证明', 'certificate']],
];
/** 从说明文字里读出大小上限，例如「不超过 10MB」。 */
export function parseMaxBytes(text) {
    const match = /(\d+(?:\.\d+)?)\s*(kb|mb|gb|k|m|g)\b/i.exec(text);
    if (match === null) {
        return undefined;
    }
    const size = Number(match[1]);
    const unit = (match[2] ?? '').toLowerCase();
    const factor = unit.startsWith('g') ? 1024 ** 3 : unit.startsWith('m') ? 1024 ** 2 : 1024;
    return Math.round(size * factor);
}
function purposeOf(label) {
    const lower = label.toLowerCase();
    for (const [purpose, patterns] of PURPOSE_PATTERNS) {
        if (patterns.some((pattern) => lower.includes(pattern))) {
            return purpose;
        }
    }
    return 'other';
}
export function scanUploads(snapshot) {
    const uploads = [];
    for (const element of snapshot.elements) {
        const isFileInput = element.tag === 'input' && element.type === 'file';
        if (!isFileInput) {
            continue;
        }
        const label = pickRawLabel(element.labelEvidence);
        const accepted = (element.accept ?? '')
            .split(',')
            .map((item) => item.trim().toLowerCase())
            .filter((item) => item !== '');
        // 说明文字通常在 aria-describedby 或紧邻的段落里。
        const hint = [...element.describedByText, ...element.sectionPath].join(' ');
        const maxBytes = parseMaxBytes(`${hint} ${snapshot.bodyTextSample}`);
        uploads.push({
            fieldRuntimeRef: `${snapshot.framePath.join('>') || 'main'}#${element.index}`,
            label,
            required: element.required,
            acceptedExtensions: accepted,
            ...(maxBytes === undefined ? {} : { maxBytes }),
            ...(element.multiple ? {} : { maxCount: 1 }),
            purpose: purposeOf(label),
        });
    }
    return uploads;
}
//# sourceMappingURL=scan-uploads.js.map