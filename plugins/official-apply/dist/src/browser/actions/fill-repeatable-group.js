import { scanChangedRegion } from "../scan/scan-changed-region.js";
import { collectFrameNodes, scanControls } from "../scan/scan-controls.js";
import { scanActions } from "../scan/scan-actions.js";
import { scanRepeatableGroups } from "../scan/scan-repeatable-groups.js";
import { findActionTarget } from "../locators/find-action-target.js";
import { actionKindFor } from "./build-action-plan.js";
import { executeFieldAction } from "./fill-page.js";
const DEFAULT_TIMEOUT_MS = 8_000;
function failure(runtimeRef, errorCode, errorMessage) {
    return {
        actionPlanItemId: `repeat_${runtimeRef}`,
        runtimeRef,
        kind: 'fill_text',
        outcome: 'failed',
        locatorAttemptIds: [],
        pageChanged: false,
        errorCode,
        errorMessage,
    };
}
export async function fillRepeatableGroup(page, request) {
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const frame = page.mainFrame();
    const results = [];
    const rescannedRegionSelectors = [];
    let addedInstances = 0;
    let workingGroup = request.group;
    let workingSchema = request.pageSchema;
    const fieldsByInstance = new Map();
    for (const field of request.pageSchema.fields) {
        if (field.repeatGroupKey === request.group.groupKey &&
            field.repeatInstanceIndex !== undefined) {
            const fields = fieldsByInstance.get(field.repeatInstanceIndex) ?? [];
            fields.push(field);
            fieldsByInstance.set(field.repeatInstanceIndex, fields);
        }
    }
    const neededInstances = Math.max(0, ...request.assignments.map((assignment) => assignment.instanceIndex + 1));
    // 1. 卡片不够就点「新增」补齐。
    let currentCount = workingGroup.currentCount;
    while (currentCount < neededInstances) {
        const addAction = workingGroup.addAction;
        if (addAction === undefined) {
            results.push(failure(request.group.groupKey, 'repeat_add_action_missing', `需要 ${neededInstances} 段经历，页面只有 ${currentCount} 段，且找不到新增按钮`));
            break;
        }
        const found = await findActionTarget(frame, addAction.locatorCandidates, {
            runId: request.runId,
            actionKind: 'click',
            timeoutMs,
        });
        if (found.target === undefined) {
            results.push(failure(request.group.groupKey, 'repeat_add_action_missing', '页面上找不到新增按钮'));
            break;
        }
        await found.target.locator.click({ timeout: timeoutMs });
        addedInstances += 1;
        let newCandidates = nextInstanceCandidates(workingGroup);
        if (newCandidates.length === 0) {
            const refreshed = await refreshRepeatableState(page, workingGroup);
            if (refreshed === undefined) {
                results.push(failure(workingGroup.groupKey, 'repeat_instance_not_found', '新增后仍未识别出经历卡片'));
                break;
            }
            workingGroup = refreshed.group;
            workingSchema = { ...workingSchema, fields: refreshed.fields };
            newCandidates =
                workingGroup.instanceLocatorCandidates[workingGroup.currentCount - 1] ?? [];
            for (const field of refreshed.fields) {
                if (field.repeatGroupKey === workingGroup.groupKey &&
                    field.repeatInstanceIndex !== undefined) {
                    const fields = fieldsByInstance.get(field.repeatInstanceIndex) ?? [];
                    fields.push(field);
                    fieldsByInstance.set(field.repeatInstanceIndex, fields);
                }
            }
        }
        else {
            const css = cssRegionOf(newCandidates);
            if (css !== undefined) {
                try {
                    const region = await scanChangedRegion(frame, {
                        rootSelector: css.selector,
                        rootIndex: css.index,
                    });
                    for (const field of region.fields) {
                        field.repeatGroupKey = workingGroup.groupKey;
                        field.repeatInstanceIndex = currentCount;
                    }
                    fieldsByInstance.set(currentCount, region.fields);
                    workingSchema = {
                        ...workingSchema,
                        fields: [...workingSchema.fields, ...region.fields],
                    };
                    rescannedRegionSelectors.push(`${css.selector}[${css.index}]`);
                }
                catch {
                    newCandidates = [];
                }
            }
        }
        if (newCandidates.length === 0) {
            results.push(failure(workingGroup.groupKey, 'repeat_instance_not_found', '新增后找不到新经历卡片'));
            break;
        }
        const located = await findActionTarget(frame, newCandidates, {
            runId: request.runId,
            actionKind: 'click',
            timeoutMs,
        });
        if (located.target === undefined) {
            results.push(failure(workingGroup.groupKey, 'repeat_instance_not_found', '新增后找不到新经历卡片'));
            break;
        }
        workingGroup = {
            ...workingGroup,
            currentCount: currentCount + 1,
            instanceLocatorCandidates: [
                ...workingGroup.instanceLocatorCandidates.slice(0, currentCount),
                newCandidates,
            ],
        };
        currentCount += 1;
    }
    // 2. 逐张卡片填写。字段只在这张卡片内部找，不跨卡片。
    for (const assignment of request.assignments) {
        const cardCandidates = workingGroup.instanceLocatorCandidates[assignment.instanceIndex] ?? [];
        const locatedCard = await findActionTarget(frame, cardCandidates, {
            runId: request.runId,
            actionKind: 'click',
            timeoutMs,
        });
        if (locatedCard.target === undefined) {
            results.push(failure(`${workingGroup.groupKey}#${assignment.instanceIndex}`, 'repeat_instance_not_found', `第 ${assignment.instanceIndex + 1} 张卡片不存在`));
            continue;
        }
        const card = locatedCard.target.locator;
        for (const [canonicalKey, value] of Object.entries(assignment.values)) {
            const field = findFieldInCard(workingSchema, workingGroup, fieldsByInstance, assignment.instanceIndex, canonicalKey);
            const label = resolveFieldLabel(request, canonicalKey, field);
            const runtimeRef = field?.runtimeRef ?? `${workingGroup.groupKey}#${assignment.instanceIndex}`;
            if (field === undefined || label === undefined) {
                results.push(failure(runtimeRef, 'repeat_instance_not_found', `不知道公共字段 ${canonicalKey} 在这个网站上叫什么，无法定位`));
                continue;
            }
            const control = field.htmlName === null || field.htmlName === undefined || field.htmlName === ''
                ? card.getByLabel(label, { exact: false })
                : card.locator(`[name="${cssAttributeValue(field.htmlName)}"]`);
            const count = await control.count().catch(() => 0);
            if (count === 0 || (count > 1 && field.controlKind !== 'radio_group')) {
                results.push(failure(runtimeRef, 'repeat_instance_not_found', count === 0 ? `卡片里找不到「${label}」` : `卡片里「${label}」命中 ${count} 个`));
                continue;
            }
            const item = actionItemFor(field, canonicalKey, value);
            const outcome = await executeFieldAction(item, field, control.first(), timeoutMs, {
                page,
                pageSchema: workingSchema,
                runId: request.runId,
            });
            results.push({
                actionPlanItemId: `repeat_${runtimeRef}`,
                runtimeRef,
                kind: item.actionKind,
                outcome: outcome.ok ? 'success' : 'failed',
                ...(outcome.beforeValue === undefined ? {} : { beforeValue: outcome.beforeValue }),
                ...(outcome.afterValue === undefined ? {} : { afterValue: outcome.afterValue }),
                locatorAttemptIds: [],
                pageChanged: outcome.changed,
                ...(outcome.ok ? {} : { errorCode: 'repeat_fill_failed', errorMessage: outcome.reason ?? '' }),
            });
        }
    }
    return {
        results,
        addedInstances,
        rescannedRegionSelectors,
        failed: results.filter((result) => result.outcome !== 'success'),
    };
}
/** 在快照里找这张卡片上的对应字段，用来拿准确的 label。 */
function findFieldInCard(pageSchema, group, fieldsByInstance, instanceIndex, canonicalKey) {
    const token = keyToken(canonicalKey);
    return (fieldsByInstance.get(instanceIndex)?.find((field) => (field.htmlName ?? '').includes(token)) ??
        pageSchema.fields.find((field) => field.repeatGroupKey === group.groupKey &&
            field.repeatInstanceIndex === instanceIndex &&
            (field.htmlName ?? '').includes(token)));
}
/** `profile.education[].school` → `school`。用来和网页的 `education[0].school` 对上。 */
function keyToken(canonicalKey) {
    return (canonicalKey.split('.').pop() ?? '').replace(/\[\]/g, '');
}
/**
 * 找出这个公共字段在网页上叫什么。
 *
 * 优先用编排层给的映射；没有就从快照里按技术属性词根推断；
 * 都拿不到就明确失败，不拿 canonicalKey 当 label 去碰运气。
 */
function resolveFieldLabel(request, canonicalKey, field) {
    const explicit = request.fieldLabelByCanonicalKey?.[canonicalKey];
    if (explicit !== undefined && explicit !== '') {
        return explicit;
    }
    if (field !== undefined && field.rawLabel !== '') {
        return field.rawLabel;
    }
    // 卡片只有一张时扫描器不会标 repeatInstanceIndex，这里放宽到整页找同名字段。
    const token = keyToken(canonicalKey);
    const anywhere = request.pageSchema.fields.find((item) => (item.htmlName ?? '').includes(token) && item.rawLabel !== '');
    return anywhere?.rawLabel;
}
function nextInstanceCandidates(group) {
    const cssCandidates = group.instanceLocatorCandidates
        .flat()
        .filter((candidate) => candidate.strategy === 'css_fallback' &&
        candidate.target?.css !== undefined &&
        candidate.target.nth !== undefined);
    const last = cssCandidates.sort((a, b) => (b.target?.nth ?? -1) - (a.target?.nth ?? -1))[0];
    if (last?.target?.css === undefined || last.target.nth === undefined) {
        return [];
    }
    const nextIndex = last.target.nth + 1;
    return [
        {
            ...last,
            description: `在「${group.label}」卡片集合中定位第 ${nextIndex + 1} 张`,
            target: { ...last.target, nth: nextIndex },
        },
    ];
}
function cssRegionOf(candidates) {
    const candidate = candidates.find((item) => item.strategy === 'css_fallback' &&
        item.target?.css !== undefined &&
        item.target.nth !== undefined);
    if (candidate?.target?.css === undefined || candidate.target.nth === undefined) {
        return undefined;
    }
    return { selector: candidate.target.css, index: candidate.target.nth };
}
async function refreshRepeatableState(page, previous) {
    const snapshot = await collectFrameNodes(page.mainFrame(), []);
    const fields = scanControls(snapshot);
    const actions = scanActions(snapshot);
    const groups = scanRepeatableGroups(snapshot, fields, actions);
    const group = groups.find((candidate) => candidate.canonicalRecordType === previous.canonicalRecordType &&
        candidate.label === previous.label);
    return group === undefined ? undefined : { group, fields };
}
function actionItemFor(field, canonicalKey, value) {
    const actionKind = actionKindFor(field.controlKind, value);
    return {
        id: `repeat_${field.runtimeRef}`,
        runtimeRef: field.runtimeRef,
        canonicalKey,
        actionKind,
        value,
        locatorCandidates: field.locatorCandidates,
        expectedChanges: [{ kind: 'field_value_changed', target: field.runtimeRef }],
        sensitive: false,
    };
}
function cssAttributeValue(value) {
    return value.replace(/["\\]/g, '\\$&');
}
//# sourceMappingURL=fill-repeatable-group.js.map