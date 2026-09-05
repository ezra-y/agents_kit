/**
 * 真实站点已经验证过的导航修正。
 *
 * 百度招聘的公开 Page bundle 会在缺少 `dev=0` 时启动调试检测器；
 * 检测命中后主动跳到 `about:blank`。`dev=0` 是站点自身提供的关闭开关。
 */
export function prepareNavigationUrl(rawUrl) {
    const url = new URL(rawUrl);
    if (url.hostname === 'talent.baidu.com' && url.pathname.startsWith('/jobs/')) {
        url.searchParams.set('dev', '0');
        return { url: url.toString(), rule: 'baidu_disable_debug_detector' };
    }
    return { url: rawUrl };
}
//# sourceMappingURL=prepare-navigation-url.js.map