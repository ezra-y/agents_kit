/**
 * 把用户确认过的字段映射标成 verified。
 *
 * 规则文档：`docs/04 §7`、`docs/05 §3`、修复清单 P0/P1 主链
 *
 * ## 为什么需要这个
 *
 * 映射置信度不够时，`resolveAnswers()` 会把字段报成「要问用户」，
 * 而且**不会自动填**——这是对的，猜错了填进去很难发现。
 *
 * 但缺了一环：用户回答之后，映射仍然是低置信度。下一轮解析又报一次，
 * 又问一次，永远填不进去。完整 E2E 就是卡在这里。
 *
 * 这个函数补上那一环：用户对着某个字段给了答案，就说明他认可了
 * 「这个输入框 = 这个公共字段」。把它标成 verified，下次直接用。
 *
 * ## 边界
 *
 * - **只有人能确认。** `confirmedBy` 必填，会写进 `verified_by`。
 * - 已经 verified 的映射不会被低置信度结果覆盖（`mapSiteFields()` 保证）。
 * - 确认的是「含义」，不是「答案」。答案照旧存在 `answer_values` 里，
 *   受 scope 和 policy 约束。
 */
import { openKnowledgeDatabase } from "../storage/open-knowledge-database.js";
export function confirmFieldMapping(request) {
    const now = request.now ?? new Date().toISOString();
    if (request.confirmedBy.trim() === '') {
        return {
            siteFieldId: request.siteFieldId,
            canonicalKey: request.canonicalKey,
            confirmed: false,
            reason: '必须写明是谁确认的',
        };
    }
    const knowledge = openKnowledgeDatabase({ paths: request.paths });
    try {
        // 公共字段目录里没有这个 key 就不认。外键也会拦，但先给个能看懂的理由。
        const known = knowledge.db
            .prepare('SELECT 1 FROM catalog_fields_cache WHERE canonical_key = ?')
            .get(request.canonicalKey);
        if (known === undefined) {
            return {
                siteFieldId: request.siteFieldId,
                canonicalKey: request.canonicalKey,
                confirmed: false,
                reason: `公共字段目录里没有 ${request.canonicalKey}`,
            };
        }
        const existing = knowledge.db
            .prepare('SELECT id, status FROM field_mappings WHERE site_field_id = ?')
            .get(request.siteFieldId);
        if (existing === undefined) {
            return {
                siteFieldId: request.siteFieldId,
                canonicalKey: request.canonicalKey,
                confirmed: false,
                reason: `找不到字段 ${request.siteFieldId} 的映射记录`,
            };
        }
        knowledge.db
            .prepare(`UPDATE field_mappings
            SET canonical_key = ?, status = 'verified', confidence = 1,
                verified_by = ?, verified_at = ?, updated_at = ?
          WHERE id = ?`)
            .run(request.canonicalKey, request.confirmedBy, now, now, existing.id);
        return {
            siteFieldId: request.siteFieldId,
            canonicalKey: request.canonicalKey,
            previousStatus: existing.status,
            confirmed: true,
        };
    }
    finally {
        knowledge.close();
    }
}
//# sourceMappingURL=confirm-field-mapping.js.map