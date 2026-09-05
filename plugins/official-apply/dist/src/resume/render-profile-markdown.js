function line(label, value) {
    return value === undefined || value.trim() === '' ? undefined : `- ${label}：${value}`;
}
function dateRange(record) {
    if (record.startDate === undefined && record.endDate === undefined && record.current !== true) {
        return undefined;
    }
    return `${record.startDate ?? '未写'} 至 ${record.current === true ? '至今' : (record.endDate ?? '未写')}`;
}
function renderRecords(title, records, details) {
    if (records.length === 0) {
        return [];
    }
    const output = [`## ${title}`, ''];
    records.forEach((record) => {
        output.push(`### ${record.label}`, '');
        output.push(...details(record).filter((item) => item !== undefined));
        output.push('');
    });
    return output;
}
export function renderProfileMarkdown(profile) {
    const output = ['# 简历资料', ''];
    const basic = [
        line('姓名', profile.basic.fullName),
        line('手机', profile.basic.phone),
        line('邮箱', profile.basic.email),
        line('所在地', profile.basic.location),
        line('作品链接', profile.basic.portfolioUrl),
        line('自我介绍', profile.basic.selfEvaluation),
    ].filter((item) => item !== undefined);
    if (basic.length > 0) {
        output.push('## 基本资料', '', ...basic, '');
    }
    output.push(...renderRecords('教育经历', profile.education, (record) => [
        line('学校', record.school),
        line('学历', record.degree),
        line('专业', record.major),
        line('时间', dateRange(record)),
        record.description,
    ]), ...renderRecords('工作与实习', profile.experience, (record) => [
        line('公司', record.company),
        line('岗位', record.title),
        line('部门', record.department),
        line('地点', record.location),
        line('时间', dateRange(record)),
        record.description,
        ...(record.bullets ?? []).map((bullet) => `- ${bullet}`),
    ]), ...renderRecords('项目经历', profile.projects, (record) => [
        line('项目', record.name),
        line('网申选择', record.includeInApplications === false ? '不填写项目卡片，保留原资料' : undefined),
        line('角色', record.role),
        line('时间', dateRange(record)),
        record.description,
        ...(record.bullets ?? []).map((bullet) => `- ${bullet}`),
    ]), ...renderRecords('奖项', profile.awards, (record) => [
        line('名称', record.name),
        line('日期', record.date),
        line('级别', record.level),
    ]));
    if (profile.skills.length > 0) {
        output.push('## 技能', '', profile.skills.map((item) => `- ${item}`).join('\n'), '');
    }
    if (profile.languages.length > 0) {
        output.push('## 语言', '', profile.languages.map((item) => `- ${item}`).join('\n'), '');
    }
    return `${output.join('\n').trim()}\n`;
}
//# sourceMappingURL=render-profile-markdown.js.map