/**
 * 打开本机知识观察库。
 *
 * 规则文档：`docs/03_字段答案与保存模型.md §10.2`
 *
 * 只处理官网字段实例、映射证据、locator 统计和候选。
 * 不放用户真实答案，也不放运行状态。
 */
import { openSkillDatabase } from "./migrate-databases.js";
export function openKnowledgeDatabase(input) {
    return openSkillDatabase(input.paths, 'knowledge');
}
//# sourceMappingURL=open-knowledge-database.js.map