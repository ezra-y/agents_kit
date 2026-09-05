/**
 * 结构化工具能稳稳搞定的控件。
 *
 * `file_upload` 尤其重要：CU 去点「上传」会打开操作系统文件对话框，
 * 那已经不在浏览器里了，CU 既控制不好也验证不了。
 * 唯一正确的做法是 `setInputFiles()`。
 */
const STRUCTURED_ONLY_CONTROLS = new Set([
    'text',
    'textarea',
    'email',
    'phone',
    'number',
    'date',
    'month',
    'year',
    'native_select',
    'radio_group',
    'checkbox',
    'checkbox_group',
    'file_upload',
    'contenteditable',
    'repeater_add',
    'action_button',
]);
/**
 * 检查这个字段能不能走视觉兜底。
 *
 * @returns 拒绝原因；`undefined` 表示允许。
 */
export function assertVisualFallbackAllowed(field) {
    if (STRUCTURED_ONLY_CONTROLS.has(field.controlKind)) {
        return (`visual_fallback_not_allowed: ${field.controlKind} 是普通控件，一律不走视觉兜底。` +
            `「${field.rawLabel || field.runtimeRef}」定位不到说明扫描或定位有问题，` +
            '要去修那里，不能用 CU 盖住——盖住之后真正的毛病就再也发现不了了。');
    }
    if (field.disabled) {
        return `visual_fallback_not_allowed: 「${field.rawLabel || field.runtimeRef}」是禁用状态，点它没有意义`;
    }
    if (!field.visible) {
        return `visual_fallback_not_allowed: 「${field.rawLabel || field.runtimeRef}」不可见，看不见的东西没法用视觉操作`;
    }
    return undefined;
}
/** 允许走视觉兜底的控件类型。文档和测试都读这一份。 */
export function visualFallbackEligibleKinds() {
    const all = [
        'text', 'textarea', 'email', 'phone', 'number', 'date', 'month', 'year',
        'native_select', 'combobox', 'radio_group', 'checkbox', 'checkbox_group',
        'file_upload', 'contenteditable', 'cascading_select', 'date_picker',
        'repeater_add', 'action_button', 'visual_only', 'unknown',
    ];
    return all.filter((kind) => !STRUCTURED_ONLY_CONTROLS.has(kind));
}
//# sourceMappingURL=assert-visual-fallback-allowed.js.map