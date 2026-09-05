export function buildResumeReviewPrompt(input) {
    if (input.sourceText.trim() === '') {
        throw new Error('resume_text_empty: 无法复核零长度文字');
    }
    return [
        '你是独立简历复核器。不要信任第一轮结果，要重新对照原始文字。',
        '只检查证据、经历分类、日期、学校、公司、岗位、遗漏和串位。',
        '删除没有原文证据的内容。不要优化措辞，不要增加数字，不要根据常识补全。',
        '输出一个 JSON 对象，不能带 Markdown 代码块：',
        '{"profile": <完整修正后的 profile>, "warnings": ["原文仍无法确定的问题"]}',
        'profile 必须是完整对象，不能只返回修改建议。',
        '',
        '确定性校验发现的问题：',
        JSON.stringify(input.validationIssues, null, 2),
        '',
        '第一轮结果：',
        JSON.stringify(input.firstPassResult, null, 2),
        '',
        '原始简历文字：',
        input.sourceText,
    ].join('\n');
}
//# sourceMappingURL=build-resume-review-prompt.js.map