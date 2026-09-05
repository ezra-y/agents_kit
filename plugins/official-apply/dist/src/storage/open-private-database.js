/**
 * 打开用户答案与材料索引库。
 *
 * 规则文档：
 * - `docs/03_字段答案与保存模型.md §10.3`
 * - `docs/05_答案收集范围与复用规则.md`
 *
 * 只放用户真实答案、履历记录和材料索引。
 * 不放官网字段观察，也不放 Cookie 和 Token。
 */
import { openSkillDatabase } from "./migrate-databases.js";
export function openPrivateDatabase(input) {
    return openSkillDatabase(input.paths, 'private');
}
//# sourceMappingURL=open-private-database.js.map