/** 把任意核心函数的返回值转成可序列化的 JSON。 */
export function toJson(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}
export function ok(data, message) {
    return {
        ok: true,
        exitCode: 0,
        data: toJson(data),
        ...(message === undefined ? {} : { message }),
    };
}
/** 执行失败：退出码 1。 */
export function failed(errorCode, message, data = null) {
    return { ok: false, exitCode: 1, data: toJson(data), message, errorCode };
}
/** 用法错误：退出码 2。调用方写错了命令，不是系统出问题。 */
export function usageError(message, data = null) {
    return { ok: false, exitCode: 2, data: toJson(data), message, errorCode: 'cli_missing_option' };
}
export function readString(options, name) {
    const value = options[name];
    return typeof value === 'string' ? value : undefined;
}
export function readBoolean(options, name) {
    return options[name] === true || options[name] === 'true';
}
/** 把 `--areas db,materials` 拆成数组。 */
export function readList(options, name) {
    const raw = readString(options, name);
    if (raw === undefined) {
        return undefined;
    }
    return raw
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '');
}
export function describeError(error) {
    if (error instanceof Error) {
        return error.message.split('\n')[0] ?? error.message;
    }
    return String(error);
}
//# sourceMappingURL=shared.js.map