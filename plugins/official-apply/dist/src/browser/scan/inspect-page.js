/**
 * 把当前页面一次转换成统一 `PageSchema`。
 *
 * 规则文档：
 * - `docs/04_官网扫描与字段识别算法.md`
 * - `docs/06_函数接口与执行循环.md §3.2`
 *
 * 这是整个系统的眼睛。
 * Agent 不需要看到完整 HTML，只需要这份结构化结果。
 *
 * 一页一次扫描：每个可读 frame 一次 `evaluate`，然后在 Node 侧归一化。
 * 不允许「每填一个字段就完整重扫一次」。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { collectFrameNodes, scanControls } from "./scan-controls.js";
import { scanFrames } from "./scan-frames.js";
import { scanRegions } from "./scan-regions.js";
import { scanActions } from "./scan-actions.js";
import { isAntiBotField } from "./scan-controls.js";
import { scanUploads } from "./scan-uploads.js";
import { scanValidationErrors } from "./scan-validation-errors.js";
import { scanRepeatableGroups } from "./scan-repeatable-groups.js";
import { classifyPage } from "./classify-page.js";
import { computePageFingerprint } from "./compute-page-fingerprint.js";
import { extractSchemaCandidates } from "../network/extract-schema-candidates.js";
import { detectRecruitmentFamily } from "../../recipes/detect-recruitment-family.js";
import { redactUrl } from "../session/open-application-page.js";
import { isInsideLocalRoot } from "../../config/paths.js";
import { openRuntimeDatabase } from "../../storage/open-runtime-database.js";
function scanError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
/** 扫描前默认等多久，等单页应用把表单渲染出来。 */
const DEFAULT_CONTENT_WAIT_MS = 8_000;
/**
 * 等到页面上真的出现可交互内容再扫。
 *
 * 真实招聘网站基本都是单页应用：`load` 事件早就触发了，DOM 里却只有一个
 * 空壳。这时候扫描会得到零个字段，主流程就以为「这一页没什么好填的」。
 *
 * 2026-08-20 在真实站点上实测：小米和百度的招聘页都扫出 0 个字段，
 * 就是这个原因。本地静态夹具永远复现不了——它们一加载完就是完整的。
 *
 * 等不到也照样往下走：有些页面本来就没有表单（成功页、错误页）。
 * 这里只负责「别扫得太早」，不负责判断页面该不该有字段。
 */
async function waitForInteractiveContent(page, timeoutMs) {
    if (timeoutMs <= 0) {
        return;
    }
    try {
        await page.waitForFunction(() => document.querySelector('input, select, textarea, button, [role="textbox"], [role="combobox"], [contenteditable="true"]') !== null, undefined, { timeout: timeoutMs, polling: 250 });
    }
    catch {
        // 等不到就算了。空页面也是一种如实的扫描结果。
    }
}
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
export async function inspectPage(session, page, options) {
    if (page.isClosed()) {
        throw scanError('scan_page_unavailable', '页面已经关闭');
    }
    const now = options.now ?? new Date().toISOString();
    const newId = options.idFactory ?? defaultIdFactory;
    const snapshotId = newId('snapshot');
    await waitForInteractiveContent(page, options.waitForContentMs ?? DEFAULT_CONTENT_WAIT_MS);
    const frameScan = await scanFrames(page);
    const fields = [];
    const regions = [];
    const actions = [];
    const uploads = [];
    const errors = [];
    const repeatableGroups = [];
    let title = '';
    let headings = [];
    let bodyTextSample = '';
    let stepKey;
    let stepLabel;
    let stepsSeen = [];
    for (const readable of frameScan.readable) {
        let snapshot;
        try {
            snapshot = await collectFrameNodes(readable.frame, readable.path);
        }
        catch (error) {
            frameScan.unreadableFrames.push({
                path: readable.path,
                url: readable.frame.url(),
                reason: 'evaluate_failed',
                message: error instanceof Error ? error.message.split('\n')[0] ?? '' : String(error),
            });
            continue;
        }
        const isMainFrame = readable.path.length === 0;
        if (isMainFrame) {
            title = snapshot.title;
            headings = snapshot.headings;
            bodyTextSample = snapshot.bodyTextSample;
            const current = snapshot.steps.find((step) => step.current);
            stepKey = current?.key;
            stepLabel = current?.label;
            stepsSeen = snapshot.steps.map((step) => ({
                key: step.key,
                label: step.label,
                current: step.current,
            }));
        }
        const frameFields = scanControls(snapshot, {
            ...(stepKey === undefined ? {} : { stepKey }),
            ...(stepLabel === undefined ? {} : { stepLabel }),
        });
        const frameActions = scanActions(snapshot);
        // 反爬令牌容器不进字段表：不填它、也不拿它去问用户。
        // 往里写值等于绕过风控，是明令禁止的。
        fields.push(...frameFields.filter((field) => !isAntiBotField(field)));
        regions.push(...scanRegions(snapshot));
        actions.push(...frameActions);
        uploads.push(...scanUploads(snapshot));
        errors.push(...scanValidationErrors(snapshot));
        repeatableGroups.push(...scanRepeatableGroups(snapshot, frameFields, frameActions));
    }
    // 阶段 5：网络信号只做辅助。没有它 DOM 扫描照常工作。
    const observations = options.networkObservations ?? [];
    const networkSchemaCandidates = extractSchemaCandidates({
        observations,
        pageFieldLabels: fields.map((field) => field.rawLabel).filter((label) => label !== ''),
    });
    const saasFamily = detectRecruitmentFamily({
        pageUrl: page.url(),
        scriptUrls: await collectScriptUrls(page),
        apiUrlPatterns: observations.map((observation) => observation.requestUrlPattern),
        domMarkers: await collectDomMarkers(page),
    });
    const classification = classifyPage({
        url: page.url(),
        title,
        headings,
        bodyTextSample,
        controlKinds: fields.map((field) => field.controlKind),
        actionLabels: actions.map((action) => action.label),
        hasPasswordField: fields.some((field) => field.inputType === 'password'),
        // 只有**看得见的**验证码控件才算「这一页要人过验证码」。
        // 隐藏的 g-recaptcha-response 只是反爬令牌容器，整页照样是申请表。
        hasCaptchaSignal: fields.some((field) => field.visible && /captcha|验证码|人机验证/i.test(field.rawLabel)),
        fieldCount: fields.length,
    });
    const schema = {
        schemaVersion: 1,
        snapshotId,
        pageType: classification.pageType,
        url: page.url(),
        ...(title === '' ? {} : { title }),
        ...(saasFamily.familyKey === 'unknown' ? {} : { saasFamily }),
        ...(stepKey === undefined ? {} : { stepKey }),
        ...(stepLabel === undefined ? {} : { stepLabel }),
        stepsSeen,
        regions,
        fields,
        repeatableGroups,
        uploads,
        actions,
        errors,
        networkSchemaCandidates,
        capturedAt: now,
    };
    const fingerprint = computePageFingerprint(schema);
    if (options.persist !== false) {
        persistSnapshot(session, options.runId, schema, fingerprint, classification.matchedSignals, now);
    }
    return {
        schema,
        unreadableFrames: frameScan.unreadableFrames,
        fingerprint,
        snapshotId,
    };
}
/**
 * 保存快照。
 *
 * 完整扫描结果写 `.local/runs/<run-id>/snapshots/`，索引写 runtime.sqlite。
 * URL 和标题都先脱敏；页面里的字段值不写进索引表。
 */
function persistSnapshot(session, runId, schema, fingerprint, matchedSignals, now) {
    const snapshotDir = path.join(session.paths.runsDir, runId, 'snapshots');
    if (!isInsideLocalRoot(session.paths, snapshotDir)) {
        throw scanError('scan_persist_outside_local', `${snapshotDir} 不在 ${session.paths.localRoot} 内`);
    }
    mkdirSync(snapshotDir, { recursive: true });
    const schemaPath = path.join(snapshotDir, `${schema.snapshotId}.json`);
    writeFileSync(schemaPath, `${JSON.stringify({ schema, fingerprint, matchedSignals }, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
    });
    // 数据库还没迁移时（离线扫描、单元测试）只留文件，不写索引。
    // 正式流程里 `openApplicationTask()` 已经保证迁移过了。
    let runtime;
    try {
        runtime = openRuntimeDatabase({ paths: session.paths });
    }
    catch (error) {
        if (error instanceof Error && error.message.startsWith('database_not_migrated')) {
            return;
        }
        throw error;
    }
    try {
        const runExists = runtime.db.prepare('SELECT 1 FROM application_runs WHERE id = ?').get(runId);
        if (runExists === undefined) {
            // 没有 run 时只留文件，不写索引。测试和离线扫描都属于这种情况。
            return;
        }
        runtime.db
            .prepare(`INSERT OR REPLACE INTO page_snapshots
           (id, run_id, page_type, url_redacted, title_redacted, step_key, capture_mode,
            page_schema_path, content_hash, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, 'full', ?, ?, ?)`)
            .run(schema.snapshotId, runId, schema.pageType, redactUrl(schema.url), schema.title ?? null, schema.stepKey ?? null, path.relative(session.paths.root, schemaPath).split(path.sep).join('/'), createHash('sha256').update(fingerprint).digest('hex').slice(0, 32), now);
    }
    finally {
        runtime.close();
    }
}
/** 脚本域名是识别招聘 SaaS 家族的主要信号之一（`docs/08 §3.1`）。 */
async function collectScriptUrls(page) {
    try {
        return await page.evaluate(() => Array.from(document.querySelectorAll('script[src]'))
            .map((element) => element.getAttribute('src') ?? '')
            .filter((src) => src !== '')
            .slice(0, 50));
    }
    catch {
        return [];
    }
}
/**
 * DOM 上的稳定标记。
 *
 * 两类：
 *
 * 1. `data-*` **属性名**。只取名字不取值——值里可能是用户数据。
 * 2. 形如 `moka-version`、`beisen-root` 的 **id / name**。
 *
 * 第二类是真实站点上量出来的：`app.mokahr.com` 的页面里有一个隐藏字段
 * `moka-version`。它比域名更有价值——用自己域名部署这套 SaaS 的公司
 * 拿不到域名信号，但这个标记还在。
 *
 * 形状卡得很死（`厂商名-用途`，两段、无数字、都是已知用途词），
 * 是为了**绝不把用户数据当成标记**。`user-<手机号>` 那种形状进不来。
 */
async function collectDomMarkers(page) {
    try {
        return await page.evaluate(() => {
            const markers = new Set();
            const VENDOR_MARKER = /^[a-z][a-z]{1,15}[-_](version|app|root|sdk|build|widget|container|main)$/;
            for (const element of Array.from(document.querySelectorAll('*')).slice(0, 2000)) {
                for (const attribute of Array.from(element.attributes)) {
                    if (attribute.name.startsWith('data-')) {
                        markers.add(attribute.name);
                    }
                }
                for (const candidate of [element.id, element.getAttribute('name') ?? '']) {
                    const lowered = candidate.toLowerCase();
                    if (VENDOR_MARKER.test(lowered)) {
                        markers.add(lowered);
                    }
                }
                if (markers.size > 100)
                    break;
            }
            return [...markers];
        });
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=inspect-page.js.map