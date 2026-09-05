export function scanValidationErrors(snapshot) {
    const errors = [];
    const seen = new Set();
    const push = (error) => {
        const key = `${error.text}|${error.fieldRuntimeRef ?? ''}`;
        if (error.text === '' || seen.has(key)) {
            return;
        }
        seen.add(key);
        errors.push(error);
    };
    const framePrefix = snapshot.framePath.join('>') || 'main';
    for (const element of snapshot.elements) {
        // 字段自己说自己错了。
        if (element.ariaInvalid) {
            for (const text of element.describedByText) {
                push({
                    severity: 'error',
                    text,
                    fieldRuntimeRef: `${framePrefix}#${element.index}`,
                    source: 'aria',
                });
            }
            if (element.describedByText.length === 0) {
                push({
                    severity: 'error',
                    text: `字段 ${element.htmlName ?? element.htmlId ?? element.index} 被标记为无效`,
                    fieldRuntimeRef: `${framePrefix}#${element.index}`,
                    source: 'aria',
                });
            }
        }
        // 页面级提示。
        if (element.isErrorNode && !element.isFormControl) {
            push({ severity: 'error', text: element.text, source: 'aria' });
        }
    }
    return errors;
}
//# sourceMappingURL=scan-validation-errors.js.map