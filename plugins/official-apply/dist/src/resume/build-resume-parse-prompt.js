const PROFILE_SCHEMA = {
    basic: {
        fullName: 'string?',
        phone: 'string?',
        email: 'string?',
        location: 'string?',
        portfolioUrl: 'string?',
    },
    education: [
        {
            label: 'string',
            school: 'string?',
            degree: 'string?',
            major: 'string?',
            startDate: 'YYYY or YYYY-MM?',
            endDate: 'YYYY or YYYY-MM?',
            current: 'boolean?',
            description: 'string?',
        },
    ],
    experience: [
        {
            label: 'string',
            company: 'string?',
            title: 'string?',
            department: 'string?',
            location: 'string?',
            startDate: 'YYYY or YYYY-MM?',
            endDate: 'YYYY or YYYY-MM?',
            current: 'boolean?',
            description: 'string?',
            bullets: ['string'],
        },
    ],
    projects: [
        {
            label: 'string',
            name: 'string?',
            role: 'string?',
            startDate: 'YYYY or YYYY-MM?',
            endDate: 'YYYY or YYYY-MM?',
            current: 'boolean?',
            description: 'string?',
            bullets: ['string'],
        },
    ],
    awards: [{ label: 'string', name: 'string?', date: 'YYYY or YYYY-MM?', level: 'string?' }],
    skills: ['string'],
    languages: ['string'],
};
export function buildResumeParsePrompt(sourceText) {
    if (sourceText.trim() === '') {
        throw new Error('resume_text_empty: 无法为零长度文字生成提示');
    }
    return [
        '你是简历结构化解析器。只抄录原文明确支持的信息。',
        '不要优化、补写或猜测。不要根据学校猜学历，不要根据年份补月份。',
        '区分教育、正式工作或实习、项目。课程项目仍属于 projects。',
        '原文写“至今”时省略 endDate，并设置 current=true。',
        '所有记录都要有简短且可识别的 label。缺失字段直接省略。',
        '',
        '输出一个 JSON 对象，不能带 Markdown 代码块：',
        '{"profile": <符合下列结构的对象>, "evidence": {"/JSON/Pointer": {"page": 1, "text": "短原文"}}, "warnings": ["仍无法确认的问题"]}',
        '',
        '目标结构：',
        JSON.stringify(PROFILE_SCHEMA, null, 2),
        '',
        '简历文字：',
        sourceText,
    ].join('\n');
}
//# sourceMappingURL=build-resume-parse-prompt.js.map