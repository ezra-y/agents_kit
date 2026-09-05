/**
 * 区域直接从字段的 `sectionPath` 归纳出来。
 *
 * 这样区域和字段用的是同一套判定规则，不会出现「区域里没有这个字段」的矛盾。
 */
export function scanRegions(snapshot) {
    const seen = new Map();
    for (const element of snapshot.elements) {
        if (element.sectionPath.length === 0) {
            continue;
        }
        // 看不见的区域不算「房间」。条件字段展开后它才会出现在 diff 里。
        if (!element.visible) {
            continue;
        }
        // 每一层前缀都是一个区域：教育经历 / 教育经历>硕士 都要能被定位。
        for (let depth = 1; depth <= element.sectionPath.length; depth += 1) {
            const sectionPath = element.sectionPath.slice(0, depth);
            const key = sectionPath.join('>');
            if (seen.has(key)) {
                continue;
            }
            seen.set(key, {
                ref: `region:${snapshot.framePath.join('>') || 'main'}:${key}`,
                framePath: snapshot.framePath,
                sectionPath,
                textAnchor: sectionPath[sectionPath.length - 1] ?? '',
            });
        }
    }
    return [...seen.values()];
}
//# sourceMappingURL=scan-regions.js.map