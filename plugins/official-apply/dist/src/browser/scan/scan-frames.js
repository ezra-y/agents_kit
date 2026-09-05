function describeError(error) {
    if (error instanceof Error) {
        return error.message.split('\n')[0] ?? error.name;
    }
    return String(error);
}
function sameOrigin(pageUrl, frameUrl) {
    try {
        return new URL(pageUrl).origin === new URL(frameUrl).origin;
    }
    catch {
        return false;
    }
}
/**
 * 返回可读 frame 列表和不可读记录。
 *
 * `about:blank` 和空 frame 会被跳过：它们没有内容，也不算失败。
 */
export async function scanFrames(page) {
    const pageUrl = page.url();
    const result = {
        frames: [],
        unreadableFrames: [],
        readable: [],
    };
    for (const frame of page.frames()) {
        const isMain = frame === page.mainFrame();
        const path = isMain ? [] : framePathOf(frame, page);
        const frameUrl = frame.url();
        if (!isMain && (frameUrl === '' || frameUrl === 'about:blank')) {
            continue;
        }
        const origin = isMain ? true : sameOrigin(pageUrl, frameUrl);
        try {
            // 真正试一次读取。跨域时这里会抛错，这正是我们要如实记录的信号。
            await frame.evaluate(() => document.readyState);
            result.frames.push({
                path,
                url: frameUrl,
                ...(frame.name() === '' ? {} : { name: frame.name() }),
                sameOrigin: origin,
            });
            result.readable.push({ frame, path, sameOrigin: origin });
        }
        catch (error) {
            result.unreadableFrames.push({
                path,
                url: frameUrl,
                reason: origin ? 'evaluate_failed' : 'cross_origin',
                message: describeError(error),
            });
        }
    }
    return result;
}
/** frame 路径只用 name 或 url 的 pathname，不保存临时句柄。 */
function framePathOf(frame, page) {
    const path = [];
    let current = frame;
    while (current !== null && current !== page.mainFrame()) {
        const name = current.name();
        if (name !== '') {
            path.unshift(name);
        }
        else {
            try {
                path.unshift(new URL(current.url()).pathname);
            }
            catch {
                path.unshift('<unnamed>');
            }
        }
        current = current.parentFrame();
    }
    return path;
}
//# sourceMappingURL=scan-frames.js.map