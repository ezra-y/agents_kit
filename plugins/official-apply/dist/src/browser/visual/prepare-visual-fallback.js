/**
 * 把「这个控件结构化操作不了」变成一次**有边界、可验证**的交接。
 *
 * 规则文档：`docs/07 §13`、`docs/09 §11`、`docs/13 D15`、修复清单 P1-8
 *
 * ## 共享核心不认识任何平台的 CU
 *
 * Claude Code 有自己的浏览器工具，Codex 有自己的。共用核心不该知道它们，
 * 也不该各写一套。所以这里只做三件事：
 *
 * 1. **判断该不该上 CU**：普通控件一律不许（`assertVisualFallbackAllowed()`），
 *    而且必须先有结构化定位失败的真实证据。
 * 2. **划出一小块区域并截图**，写进 `.local/runs/`。
 * 3. **写清楚做什么、能做什么、绝不能做什么、怎么算成功**。
 *
 * 宿主拿着这份交接单，用它自己的工具在那块区域里动手。
 * 动完之后必须回来调验证——**宿主说「点到了」不算数**。
 *
 * ## 为什么要截图而不是给整页
 *
 * 给一整屏，CU 就得先在里面找目标，找错的概率随面积上升。
 * 给一小块，问题从「在页面上找到那个下拉」变成「在这块里点第二项」，
 * 后者稳得多，也便宜得多。
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { isInsideLocalRoot, toRepoRelative } from "../../config/paths.js";
import { findActionTarget } from "../locators/find-action-target.js";
import { assertVisualFallbackAllowed } from "./assert-visual-fallback-allowed.js";
import { buildVisualFallbackRequest } from "./build-visual-fallback-request.js";
/** 找不到元素时退而求其次：截当前视口的一块。仍然不给整页。 */
const VIEWPORT_FALLBACK = { x: 0, y: 0, width: 900, height: 600 };
export async function prepareVisualFallback(input) {
    const emptyEvidence = {
        runtimeRef: input.field.runtimeRef,
        attempts: [],
    };
    // 1. 普通控件一律不许走 CU。这道闸在最前面，连截图都不用做。
    const notAllowed = assertVisualFallbackAllowed(input.field);
    if (notAllowed !== undefined) {
        return { refused: notAllowed, evidence: emptyEvidence };
    }
    // 2. 必须先真的试过结构化定位。没试过就上 CU 是本末倒置。
    const found = await findActionTarget(input.page.mainFrame(), input.field.locatorCandidates, { runId: input.runId, runtimeRef: input.field.runtimeRef });
    const evidence = {
        runtimeRef: input.field.runtimeRef,
        attempts: [
            ...found.attempts.map((attempt) => ({
                strategy: attempt.strategy,
                outcome: attempt.outcome,
                ...(attempt.failureReason === undefined ? {} : { reason: attempt.failureReason }),
            })),
            ...(input.priorFailures ?? []),
        ],
    };
    if (evidence.attempts.length === 0) {
        return {
            refused: 'visual_no_structured_evidence: 这个字段一条定位候选都没有，' +
                '说明扫描阶段就没认出它。该去修扫描，不是拿 CU 顶上。',
            evidence,
        };
    }
    // 定位成功、填写也没试过，就还轮不到 CU。
    // 「找不到」和「操作不了」是两回事，但两者都得有真凭实据。
    if (evidence.attempts.every((attempt) => attempt.outcome === 'success')) {
        return {
            refused: 'visual_no_structured_evidence: 结构化定位是成功的，而且没有任何填写失败记录。' +
                '先调 apply.fill_page 用结构化方式试一次；真的填不进去，那次失败才是上 CU 的理由。',
            evidence,
        };
    }
    // 3. 划区域。能定位到元素就用它的盒子，定位不到就退到视口一角。
    //
    // 注意：**定位到了不等于操作得了**。自绘下拉的容器 div 找得到，
    // 但它没有 value、没有 option，读不出当前选了什么——
    // 这恰恰是视觉兜底真正该管的情况。
    let box = VIEWPORT_FALLBACK;
    if (found.target !== undefined) {
        const measured = await found.target.locator.boundingBox().catch(() => null);
        if (measured !== null) {
            box = {
                x: Math.round(measured.x),
                y: Math.round(measured.y),
                width: Math.round(measured.width),
                height: Math.round(measured.height),
            };
        }
    }
    // 4. 截这一块，写进 .local/runs/。
    const dir = path.join(input.paths.runsDir, input.runId, 'visual');
    if (!isInsideLocalRoot(input.paths, dir)) {
        throw new Error(`visual_screenshot_outside_local: ${dir} 不在 ${input.paths.localRoot} 内`);
    }
    mkdirSync(dir, { recursive: true });
    const safeRef = input.field.runtimeRef.replace(/[^A-Za-z0-9._-]/g, '_');
    const file = path.join(dir, `${safeRef}.png`);
    const padded = padForCapture(box);
    try {
        await input.page.screenshot({ path: file, clip: padded });
    }
    catch {
        // 元素滚出视口、页面正在动画——截不到就老实说截不到，不给一张空图。
        return {
            refused: 'visual_screenshot_failed: 截不到这块区域，可能元素已经滚出视口或页面还在动',
            evidence,
        };
    }
    const relative = toRepoRelative(input.paths, file);
    // 5. 组装交接单。`buildVisualFallbackRequest()` 会再校验一遍
    //    「有失败证据、区域够小、截图在 .local/ 里」。
    try {
        const request = buildVisualFallbackRequest({
            runId: input.runId,
            field: input.field,
            goal: input.goal,
            evidence,
            regionBox: box,
            screenshotPathRedacted: relative,
            ...(input.successChecks === undefined ? {} : { successChecks: input.successChecks }),
            ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
        });
        return { request, evidence };
    }
    catch (error) {
        return {
            refused: error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error),
            evidence,
        };
    }
}
/** 截图时向外留一点，让人看得见控件周围的上下文。 */
function padForCapture(box) {
    const pad = 12;
    return {
        x: Math.max(0, box.x - pad),
        y: Math.max(0, box.y - pad),
        width: Math.max(1, box.width + pad * 2),
        height: Math.max(1, box.height + pad * 2),
    };
}
//# sourceMappingURL=prepare-visual-fallback.js.map