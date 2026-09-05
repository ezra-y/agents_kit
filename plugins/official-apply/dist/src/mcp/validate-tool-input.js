function typeNameOf(value) {
    if (value === null) {
        return 'null';
    }
    if (Array.isArray(value)) {
        return 'array';
    }
    return typeof value;
}
function matchesType(value, expected) {
    switch (expected) {
        case 'string':
            return typeof value === 'string';
        case 'number':
        case 'integer':
            return typeof value === 'number' && Number.isFinite(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'array':
            return Array.isArray(value);
        case 'object':
            return value !== null && typeof value === 'object' && !Array.isArray(value);
        case 'null':
            return value === null;
        default:
            // schema 里写了我们不认识的类型，就不拦——宁可放过，也不误杀。
            return true;
    }
}
export function validateToolInput(tool, args) {
    const problems = [];
    const schema = tool.inputSchema;
    const properties = (schema.properties ?? {});
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const name of required) {
        if (args[name] === undefined) {
            problems.push({ field: name, reason: '必填，但没给' });
        }
    }
    for (const [name, value] of Object.entries(args)) {
        if (value === undefined) {
            continue;
        }
        const property = properties[name];
        if (property === undefined) {
            // 多给的参数不报错：客户端可能带了它自己的元数据。
            continue;
        }
        const expected = property['type'];
        if (typeof expected === 'string' && !matchesType(value, expected)) {
            problems.push({
                field: name,
                reason: `应该是 ${expected}，实际给的是 ${typeNameOf(value)}`,
            });
            continue;
        }
        const allowed = property['enum'];
        if (Array.isArray(allowed) && !allowed.includes(value)) {
            problems.push({
                field: name,
                reason: `只能是 ${allowed.map((item) => JSON.stringify(item)).join(' / ')}，实际给的是 ${JSON.stringify(value)}`,
            });
        }
    }
    return problems;
}
/** 拼一句人能直接照着改的话。 */
export function describeToolInputProblems(toolName, problems) {
    return (`${toolName} 的参数不对：` +
        problems.map((problem) => `${problem.field}（${problem.reason}）`).join('；'));
}
//# sourceMappingURL=validate-tool-input.js.map