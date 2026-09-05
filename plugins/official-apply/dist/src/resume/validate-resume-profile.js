const DATE_PATTERN = /^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/;
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function normalize(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
function dateOrderValue(value) {
    const [year = '0', month = '01'] = value.split('-');
    return Number(year) * 12 + Number(month);
}
function validateStringFields(entry, pointer, issues) {
    for (const [key, value] of Object.entries(entry)) {
        if (key === 'current' || key === 'includeInApplications') {
            if (typeof value !== 'boolean') {
                issues.push({
                    pointer: `${pointer}/${key}`,
                    code: 'shape_invalid',
                    message: `${key} 必须是布尔值。`,
                });
            }
            continue;
        }
        if (key === 'bullets') {
            if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
                issues.push({
                    pointer: `${pointer}/${key}`,
                    code: 'shape_invalid',
                    message: 'bullets 必须是字符串数组。',
                });
            }
            continue;
        }
        if (typeof value !== 'string') {
            issues.push({
                pointer: `${pointer}/${key}`,
                code: 'shape_invalid',
                message: `${key} 必须是字符串。`,
            });
        }
    }
}
export function validateResumeDates(profile) {
    const issues = [];
    const sections = ['education', 'experience', 'projects'];
    for (const section of sections) {
        profile[section].forEach((entry, index) => {
            const pointer = `/${section}/${index}`;
            for (const key of ['startDate', 'endDate']) {
                const value = entry[key];
                if (value !== undefined && !DATE_PATTERN.test(value)) {
                    issues.push({
                        pointer: `${pointer}/${key}`,
                        code: 'date_invalid',
                        message: `${key} 必须是 YYYY 或 YYYY-MM。`,
                    });
                }
            }
            if (entry.startDate !== undefined &&
                entry.endDate !== undefined &&
                DATE_PATTERN.test(entry.startDate) &&
                DATE_PATTERN.test(entry.endDate) &&
                dateOrderValue(entry.startDate) > dateOrderValue(entry.endDate)) {
                issues.push({
                    pointer,
                    code: 'date_order_invalid',
                    message: '开始时间晚于结束时间。',
                });
            }
        });
    }
    profile.awards.forEach((entry, index) => {
        if (entry.date !== undefined && !DATE_PATTERN.test(entry.date)) {
            issues.push({
                pointer: `/awards/${index}/date`,
                code: 'date_invalid',
                message: 'date 必须是 YYYY 或 YYYY-MM。',
            });
        }
    });
    return issues;
}
export function detectDuplicateRecords(profile) {
    const issues = [];
    const sections = ['education', 'experience', 'projects', 'awards'];
    for (const section of sections) {
        const seen = new Map();
        profile[section].forEach((entry, index) => {
            const signature = JSON.stringify(Object.entries(entry)
                .filter(([key]) => key !== 'description' && key !== 'bullets')
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, value]) => [key, normalize(value)]));
            const first = seen.get(signature);
            if (first !== undefined) {
                issues.push({
                    pointer: `/${section}/${index}`,
                    code: 'duplicate_record',
                    message: `与 /${section}/${first} 重复。`,
                });
            }
            else {
                seen.set(signature, index);
            }
        });
    }
    return issues;
}
export function validateResumeProfile(input) {
    const issues = [];
    if (!isRecord(input)) {
        return {
            valid: false,
            issues: [{ pointer: '/', code: 'shape_invalid', message: '顶层必须是对象。' }],
        };
    }
    const basic = input['basic'];
    if (!isRecord(basic)) {
        issues.push({ pointer: '/basic', code: 'shape_invalid', message: 'basic 必须是对象。' });
    }
    for (const section of ['education', 'experience', 'projects', 'awards', 'skills', 'languages']) {
        if (!Array.isArray(input[section])) {
            issues.push({
                pointer: `/${section}`,
                code: 'shape_invalid',
                message: `${section} 必须是数组。`,
            });
        }
    }
    if (issues.length > 0) {
        return { valid: false, issues };
    }
    const profile = input;
    for (const section of ['education', 'experience', 'projects', 'awards']) {
        profile[section].forEach((value, index) => {
            const pointer = `/${section}/${index}`;
            if (!isRecord(value)) {
                issues.push({ pointer, code: 'shape_invalid', message: '记录必须是对象。' });
                return;
            }
            if (typeof value.label !== 'string' || value.label.trim() === '') {
                issues.push({
                    pointer: `${pointer}/label`,
                    code: 'label_missing',
                    message: '每条记录都必须有非空 label。',
                });
            }
            validateStringFields(value, pointer, issues);
        });
    }
    for (const section of ['skills', 'languages']) {
        if (profile[section].some((value) => typeof value !== 'string')) {
            issues.push({
                pointer: `/${section}`,
                code: 'shape_invalid',
                message: `${section} 只能包含字符串。`,
            });
        }
    }
    if (isRecord(basic)) {
        validateStringFields(basic, '/basic', issues);
        const email = basic['email'];
        if (typeof email === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            issues.push({
                pointer: '/basic/email',
                code: 'basic_value_invalid',
                message: '邮箱格式明显不正确。',
            });
        }
        const phone = basic['phone'];
        if (typeof phone === 'string' && !/^\+?[\d\s().-]{7,20}$/.test(phone)) {
            issues.push({
                pointer: '/basic/phone',
                code: 'basic_value_invalid',
                message: '手机号格式明显不正确。',
            });
        }
        const fullName = basic['fullName'];
        if (typeof fullName === 'string' && fullName.trim() === '') {
            issues.push({
                pointer: '/basic/fullName',
                code: 'basic_value_invalid',
                message: '姓名不能是空字符串。没有姓名时请省略字段。',
            });
        }
    }
    issues.push(...validateResumeDates(profile), ...detectDuplicateRecords(profile));
    return { valid: issues.length === 0, issues, ...(issues.length === 0 ? { profile } : {}) };
}
//# sourceMappingURL=validate-resume-profile.js.map