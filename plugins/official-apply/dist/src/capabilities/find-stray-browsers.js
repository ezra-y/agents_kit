/**
 * 找出测试留下的孤儿浏览器。
 *
 * 规则文档：修复清单 P2-2
 *
 * ## 为什么会有孤儿
 *
 * 测试正常跑完是不漏的（`test:browser` 和 `test:e2e` 各跑一轮，前后都是 0）。
 * 漏的是**被强杀的那一次**：命令超时、Ctrl-C、或者被外面的看门狗打断时，
 * Node 收到 SIGKILL 就没机会关子进程，浏览器全部变成孤儿。
 *
 * 一次被打断的完整 verify 能留下上百个无头浏览器、一两 GB 内存。
 * 它们**没有窗口，所以完全看不见**，只会让机器越来越慢。
 *
 * ## 只认自己的
 *
 * 判据两条，都是路径级别的：
 *
 * 1. 可执行文件在 Playwright 的缓存目录里（`ms-playwright/`）。
 * 2. profile 指向本仓库的 `.local/`。
 *
 * 用户自己的 Chrome 装在 `/Applications` 下、用的是自己的 profile，
 * 两条都不满足。**绝不能误杀用户的浏览器**——那会丢掉他正在填的东西。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
/**
 * 单看一条命令行，判断它是不是测试留下的浏览器。
 *
 * 单独拆出来是因为**这是安全关键的一条**：误判会杀掉用户正在用的浏览器，
 * 丢掉他填了一半的表单。拆成纯函数才测得动各种真实命令行。
 *
 * @returns 判定理由；`undefined` 表示「不是我们的，别动」。
 */
export function classifyBrowserCommand(command, localRoot) {
    // 前后都要有分隔符：`ms-playwright/` 是目录名，不是词根。
    // 只写子串的话，`~/my-ms-playwright-notes/chrome` 也会命中——
    // 那是用户的东西，杀了就是事故。
    if (command.includes(`${path.sep}ms-playwright${path.sep}`)) {
        return 'Playwright 自带的测试浏览器';
    }
    if (command.includes(`--user-data-dir=${localRoot}`)) {
        return 'profile 在本仓库的 .local/ 里';
    }
    return undefined;
}
export function findStrayBrowsers(paths) {
    let output;
    try {
        output = execFileSync('ps', ['ax', '-o', 'pid=,command='], { encoding: 'utf8' });
    }
    catch {
        // 拿不到进程列表就如实返回空，不猜。
        return [];
    }
    const stray = [];
    const localRoot = paths.localRoot;
    for (const line of output.split('\n')) {
        const match = /^\s*(\d+)\s+(.*)$/.exec(line);
        if (match === null) {
            continue;
        }
        const pid = Number(match[1]);
        const command = match[2] ?? '';
        if (pid === process.pid) {
            continue;
        }
        const reason = classifyBrowserCommand(command, localRoot);
        if (reason !== undefined) {
            stray.push({ pid, command, reason });
        }
    }
    return stray;
}
/** 关掉它们。返回真的发出关闭信号的个数。 */
export function sweepStrayBrowsers(stray) {
    let killed = 0;
    for (const item of stray) {
        try {
            // SIGTERM 而不是 SIGKILL：给浏览器机会自己收尾。
            process.kill(item.pid, 'SIGTERM');
            killed += 1;
        }
        catch {
            // 可能已经自己退了。不重试，也不升级成硬杀。
        }
    }
    return killed;
}
//# sourceMappingURL=find-stray-browsers.js.map