import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
function resumeTextError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
function assertReadableFile(filePath) {
    const absolute = path.resolve(filePath);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
        throw resumeTextError('resume_file_not_found', absolute);
    }
    return absolute;
}
function pageBlock(pageNumber, text) {
    return `--- PAGE ${pageNumber} ---\n${text.trim()}`;
}
export function extractPlainText(filePath) {
    const absolute = assertReadableFile(filePath);
    const extension = path.extname(absolute).toLowerCase();
    if (extension !== '.txt' && extension !== '.md') {
        throw resumeTextError('resume_format_unsupported', `只支持 TXT 或 MD：${absolute}`);
    }
    const content = readFileSync(absolute, 'utf8').trim();
    if (content === '') {
        throw resumeTextError('resume_text_empty', `${absolute} 没有可解析文字`);
    }
    return {
        text: `${pageBlock(1, content)}\n`,
        format: extension === '.md' ? 'md' : 'txt',
        pageCount: 1,
    };
}
export async function extractPdfText(filePath) {
    const absolute = assertReadableFile(filePath);
    if (path.extname(absolute).toLowerCase() !== '.pdf') {
        throw resumeTextError('resume_format_unsupported', `不是 PDF：${absolute}`);
    }
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const require = createRequire(import.meta.url);
    const pdfPackageDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const standardFontDataUrl = `${path.join(pdfPackageDir, 'standard_fonts')}${path.sep}`;
    const loadingTask = getDocument({
        data: new Uint8Array(readFileSync(absolute)),
        standardFontDataUrl,
    });
    try {
        const document = await loadingTask.promise;
        const pages = [];
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
            const page = await document.getPage(pageNumber);
            const content = await page.getTextContent();
            const text = content.items
                .map((item) => ('str' in item ? item.str.trim() : ''))
                .filter((item) => item !== '')
                .join(' ');
            pages.push(pageBlock(pageNumber, text));
            page.cleanup();
        }
        const hasText = pages.some((page) => page.replace(/^--- PAGE \d+ ---\s*/, '').trim() !== '');
        if (!hasText) {
            throw resumeTextError('resume_text_empty', `${absolute} 没有文本层；当前版本不做 OCR`);
        }
        return {
            text: `${pages.join('\n\n')}\n`,
            format: 'pdf',
            pageCount: document.numPages,
        };
    }
    finally {
        await loadingTask.destroy();
    }
}
export async function extractResumeText(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.pdf') {
        return extractPdfText(filePath);
    }
    if (extension === '.txt' || extension === '.md') {
        return extractPlainText(filePath);
    }
    throw resumeTextError('resume_format_unsupported', `只支持 PDF、TXT 或 MD：${filePath}`);
}
//# sourceMappingURL=extract-resume-text.js.map