/** Single narrative fields include both the overview and every detailed paragraph. */
export function fullRecordDescription(values, descriptionKey = 'description') {
    const raw = values[descriptionKey] ?? values['description'];
    const overview = typeof raw === 'string' ? raw.trim() : '';
    const paragraphs = Array.isArray(values['bullets'])
        ? values['bullets'].filter((value) => typeof value === 'string')
            .map(value => value.trim()).filter(Boolean)
        : [];
    return [...new Set([overview, ...paragraphs.filter(value => !overview.includes(value))])]
        .filter(Boolean).join('\n\n');
}
/** Project narratives default to one description, including any explicitly recorded duties. */
export function fullProjectDescription(values) {
    const duties = values['responsibilities'];
    return fullRecordDescription({
        ...values,
        bullets: [
            ...(Array.isArray(values['bullets']) ? values['bullets'] : []),
            ...(Array.isArray(duties) ? duties : typeof duties === 'string' ? [duties] : []),
        ],
    });
}
//# sourceMappingURL=record-description.js.map