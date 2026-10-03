import { readCheckboxState } from "../controls/moka-checkbox.js";
export async function setCheckbox(locator, desired, options = {}) {
    const timeout = options.timeoutMs ?? 5_000;
    const current = await readCheckboxState(locator).catch(() => undefined);
    if (current === undefined) {
        return { changed: false, ok: false, reason: '读不到复选框当前状态' };
    }
    if (current === desired) {
        return { changed: false, ok: true, finalState: current };
    }
    try {
        const wrapping = locator.locator('xpath=ancestor::label[1]');
        if (await wrapping.count() === 1) {
            await wrapping.click({ timeout });
        }
        else if (desired) {
            await locator.check({ timeout });
        }
        else {
            await locator.uncheck({ timeout });
        }
    }
    catch (error) {
        return {
            changed: false,
            ok: false,
            reason: error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error),
        };
    }
    const finalState = await readCheckboxState(locator).catch(() => !desired);
    return {
        changed: finalState !== current,
        ok: finalState === desired,
        finalState,
        ...(finalState === desired ? {} : { reason: '设置后状态没有变成目标值' }),
    };
}
//# sourceMappingURL=set-checkbox.js.map