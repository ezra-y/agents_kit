/**
 * 把「这次任务绑定的材料」配到「这一页真实出现的上传控件」上。
 *
 * 规则文档：`docs/03`、`docs/07 §8`、修复清单 P1-2
 *
 * 两条边界：
 *
 * 1. **只用任务绑定的材料。** 不扫描用户的全部材料库（P0-2 同一条规则）。
 * 2. **官网出现什么上传控件，才配什么。** 官网只要简历，就不会因为你登记了
 *    作品集而硬塞一份上去（`docs/13 D02`）。
 *
 * 配对靠两层证据：控件自己声明的用途，和控件标签上的文字。
 * 两层都对不上就不配——宁可留空让人处理，也不要把成绩单当简历传上去。
 */
import { existsSync } from 'node:fs';
import { openPrivateDatabase } from "../../storage/open-private-database.js";
import { resolveStoredMaterialPath } from "../../materials/list-materials.js";
/** 上传控件标签里出现这些词，就认为它要这一类材料。 */
const LABEL_HINTS = {
    resume: /简历|履历|resume|cv\b/i,
    portfolio: /作品集|作品|portfolio|demo/i,
    transcript: /成绩单|成绩|transcript|grade/i,
    photo: /照片|证件照|头像|photo|avatar/i,
    certificate: /证书|证明|获奖|certificate|award/i,
    other: /其他|附件|other|attachment/i,
};
/** 读出任务绑定的那几份材料。绑几份读几份。 */
function readBoundMaterials(paths, materialRefs) {
    if (materialRefs.length === 0) {
        return [];
    }
    const priv = openPrivateDatabase({ paths });
    try {
        return priv.db
            .prepare(`SELECT id, purpose, local_path, display_name
           FROM material_files
          WHERE active = 1 AND id IN (${materialRefs.map(() => '?').join(', ')})`)
            .all(...materialRefs);
    }
    finally {
        priv.close();
    }
}
/** 这个上传控件想要哪一类材料。判断不出来就返回 undefined，不猜。 */
export function guessRequiredPurpose(upload) {
    // 扫描器已经判断出用途时，直接信它——那是页面自己声明的。
    if (upload.purpose !== undefined && upload.purpose !== 'other') {
        return upload.purpose;
    }
    for (const [purpose, pattern] of Object.entries(LABEL_HINTS)) {
        if (purpose !== 'other' && pattern.test(upload.label)) {
            return purpose;
        }
    }
    return undefined;
}
export function planUploads(input) {
    const assignments = [];
    const unmatched = [];
    const materials = readBoundMaterials(input.paths, input.materialRefs);
    const used = new Set();
    for (const upload of input.pageSchema.uploads) {
        const wanted = guessRequiredPurpose(upload);
        if (wanted === undefined) {
            unmatched.push({
                runtimeRef: upload.fieldRuntimeRef,
                label: upload.label,
                required: upload.required,
                reason: `看不出「${upload.label}」要哪一类材料，需要你指定`,
            });
            continue;
        }
        // 同一份材料不重复配给两个控件。
        const candidate = materials.find((material) => material.purpose === wanted && !used.has(material.id));
        if (candidate === undefined) {
            unmatched.push({
                runtimeRef: upload.fieldRuntimeRef,
                label: upload.label,
                required: upload.required,
                reason: `这次任务没有绑定「${wanted}」类型的材料`,
            });
            continue;
        }
        const localPath = resolveStoredMaterialPath(input.paths, candidate.local_path);
        if (localPath === undefined || !existsSync(localPath)) {
            unmatched.push({
                runtimeRef: upload.fieldRuntimeRef,
                label: upload.label,
                required: upload.required,
                reason: `材料「${candidate.display_name}」的文件已经找不到了`,
            });
            continue;
        }
        used.add(candidate.id);
        assignments.push({
            runtimeRef: upload.fieldRuntimeRef,
            localPath,
            materialId: candidate.id,
            purpose: wanted,
            reason: `「${upload.label}」要 ${wanted}，配上任务绑定的「${candidate.display_name}」`,
        });
    }
    return { assignments, unmatched };
}
//# sourceMappingURL=plan-uploads.js.map