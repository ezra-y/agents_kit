const SENSITIVE_KEY = /password|passwd|captcha|verification.?code|one.?time.?code|token|cookie|authorization|csrf|secret|session/i;
export function isEmptyWriteValue(value) {
    return value === undefined || value === null ||
        (typeof value === 'string' && value.trim() === '');
}
export function redactResumeValue(value) {
    if (value === undefined)
        return undefined;
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    if (Array.isArray(value)) {
        return value
            .map((item) => redactResumeValue(item))
            .filter((item) => item !== undefined);
    }
    if (typeof value !== 'object')
        return undefined;
    const output = {};
    for (const [key, item] of Object.entries(value)) {
        if (SENSITIVE_KEY.test(key))
            continue;
        const redacted = redactResumeValue(item);
        if (redacted !== undefined)
            output[key] = redacted;
    }
    return output;
}
function decodeSelector(value) {
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}
export function parseWritePath(path) {
    const match = /^([^.[{]+)(?:\[([^\]]*)\]|\{([^}]*)\})?\.([^]+)$/.exec(path);
    if (match === null)
        return undefined;
    const selectors = {};
    for (const part of (match[2] ?? match[3] ?? '').split(/[;,]/)) {
        const separator = part.indexOf('=');
        if (separator < 1)
            continue;
        selectors[decodeSelector(part.slice(0, separator).trim())] = decodeSelector(part.slice(separator + 1).trim());
    }
    return { section: match[1], selectors, field: match[4] };
}
export function makeWritePath(section, selectors, field) {
    const entries = Object.entries(selectors)
        .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    return `${section}${entries.length === 0 ? '' : `[${entries.join(';')}]`}.${field}`;
}
export function selectorsMatch(row, selectors) {
    return Object.entries(selectors).every(([key, expected]) => String(row[key] ?? '') === expected);
}
export function scopeSelects(scope, path) {
    return scope.mode === 'fill_missing' || scope.fields.includes(path);
}
export function normaliseWriteScope(scope) {
    if (scope?.mode === 'repair') {
        return { mode: 'repair', fields: [...new Set(scope.fields)] };
    }
    return { mode: 'fill_missing' };
}
export function mergeScopedRecord(current, candidate, requestedScope, adapter) {
    const scope = normaliseWriteScope(requestedScope);
    const targetPaths = [];
    const conflicts = [];
    const seenRequested = new Set();
    const addTarget = (path) => {
        targetPaths.push(path);
        seenRequested.add(path);
    };
    const rowIdentity = (section, row) => {
        const key = adapter.identityKey(section);
        const value = key === undefined ? undefined : row[key];
        return value === undefined || value === null || value === '' ? undefined : String(value);
    };
    const rowSelectors = (section, row, rows) => {
        const key = adapter.identityKey(section);
        const identity = rowIdentity(section, row);
        if (key === undefined || identity === undefined)
            return {};
        const selectors = { [key]: identity };
        if (rows.filter((item) => rowIdentity(section, item) === identity).length > 1) {
            for (const signal of adapter.signalKeys(section)) {
                if (!isEmptyWriteValue(row[signal]))
                    selectors[signal] = String(row[signal]);
            }
        }
        return selectors;
    };
    const availableFields = (() => {
        const fields = [];
        const visit = (value, prefix) => {
            for (const [key, item] of Object.entries(value)) {
                const path = prefix === '' ? key : `${prefix}.${key}`;
                if (Array.isArray(item)) {
                    const rows = item.filter((row) => row !== null && typeof row === 'object' && !Array.isArray(row));
                    for (const row of rows) {
                        const selectors = rowSelectors(key, row, rows);
                        for (const [field, fieldValue] of Object.entries(row)) {
                            const nestedId = adapter.nestedRowIdentity?.(field);
                            if (nestedId !== undefined && Array.isArray(fieldValue)) {
                                const innerRows = fieldValue.filter((item) => item !== null && typeof item === 'object' && !Array.isArray(item));
                                for (const innerRow of innerRows) {
                                    const innerId = innerRow[nestedId];
                                    if (isEmptyWriteValue(innerId))
                                        continue;
                                    fields.push(makeWritePath(key, selectors, `${field}[${encodeURIComponent(nestedId)}=${encodeURIComponent(String(innerId))}].value`));
                                }
                                continue;
                            }
                            if (fieldValue !== null && typeof fieldValue === 'object')
                                continue;
                            fields.push(makeWritePath(key, selectors, field));
                        }
                    }
                }
                else if (item !== null && typeof item === 'object') {
                    visit(item, path);
                }
                else {
                    fields.push(path);
                }
            }
        };
        visit(current, '');
        return [...new Set(fields)];
    })();
    const mergeRows = (section, currentRows, candidateRows) => {
        const used = new Set();
        const output = currentRows.map((row) => ({ ...row }));
        const requestedRows = scope.mode === 'repair'
            ? scope.fields
                .map(parseWritePath)
                .filter((parsed) => parsed?.section === section && Object.keys(parsed.selectors).length > 0)
            : [];
        const identityKey = adapter.identityKey(section);
        for (const candidateRow of candidateRows) {
            const identity = rowIdentity(section, candidateRow);
            if (scope.mode === 'repair' && !requestedRows.some((parsed) => identityKey !== undefined && parsed.selectors[identityKey] === identity))
                continue;
            const candidates = currentRows.flatMap((row, index) => !used.has(index) && identity !== undefined && rowIdentity(section, row) === identity
                ? [{ row, index }]
                : []);
            let selected;
            let repairFailure = false;
            if (scope.mode === 'repair') {
                const selectedPaths = requestedRows.filter((parsed) => identityKey !== undefined && parsed.selectors[identityKey] === identity);
                const selectedCurrent = currentRows.flatMap((row, index) => selectedPaths.some((parsed) => selectorsMatch(row, parsed.selectors))
                    ? [{ row, index }]
                    : []);
                const candidateMatches = candidateRows.filter((row) => rowIdentity(section, row) === identity);
                const targetFields = new Set(selectedPaths.map((parsed) => parsed.field));
                const candidateExact = candidateMatches.filter((row) => selectedPaths.every((parsed) => Object.entries(parsed.selectors)
                    .filter(([key]) => !targetFields.has(key))
                    .every(([key, value]) => String(row[key] ?? '') === value)));
                const candidateSelected = candidateExact.length === 1
                    ? candidateExact
                    : candidateMatches.length === 1
                        ? candidateMatches
                        : [];
                if (selectedCurrent.length === 1 && candidateSelected.length === 1) {
                    if (candidateRow !== candidateSelected[0])
                        continue;
                    selected = selectedCurrent[0];
                }
                else {
                    repairFailure = true;
                    if (selectedCurrent.length > 1 || candidateMatches.length > 1) {
                        conflicts.push({ key: section, reason: `无法唯一配对 ${identity ?? '未命名'} 返修记录，未按网站数组顺序猜测` });
                    }
                }
            }
            else if (candidates.length === 1) {
                selected = candidates[0];
            }
            else if (candidates.length > 1) {
                const exact = candidates.filter(({ row }) => adapter.signalKeys(section).every((key) => isEmptyWriteValue(candidateRow[key]) || String(row[key] ?? '') === String(candidateRow[key])));
                if (exact.length === 1)
                    selected = exact[0];
            }
            if (selected === undefined) {
                if (repairFailure)
                    continue;
                if (candidates.length > 1) {
                    conflicts.push({ key: section, reason: `无法唯一配对 ${identity ?? '未命名'} 记录，未按网站数组顺序猜测` });
                }
                else if (scope.mode === 'repair') {
                    conflicts.push({ key: section, reason: `服务器没有可唯一配对的 ${identity ?? '未命名'} 记录` });
                }
                else {
                    const selectors = rowSelectors(section, candidateRow, candidateRows);
                    const appended = {};
                    for (const [key, value] of Object.entries(candidateRow)) {
                        if (isEmptyWriteValue(value))
                            continue;
                        appended[key] = value;
                        addTarget(makeWritePath(section, selectors, key));
                    }
                    output.push(appended);
                }
                continue;
            }
            used.add(selected.index);
            const selectors = rowSelectors(section, selected.row, currentRows);
            const merged = output[selected.index] ?? { ...selected.row };
            for (const [key, value] of Object.entries(candidateRow)) {
                if (isEmptyWriteValue(value))
                    continue;
                const nestedId = adapter.nestedRowIdentity?.(key);
                if (nestedId !== undefined && Array.isArray(value)) {
                    const existingRows = Array.isArray(selected.row[key])
                        ? selected.row[key].filter((row) => row !== null && typeof row === 'object' && !Array.isArray(row))
                        : [];
                    const candidateRows = value.filter((row) => row !== null && typeof row === 'object' && !Array.isArray(row));
                    if (candidateRows.length > 0) {
                        const existingById = new Map(existingRows.map((row) => [String(row[nestedId]), row]));
                        const out = existingRows.map((row) => ({ ...row }));
                        const writtenPushed = [];
                        for (const cand of candidateRows) {
                            const id = String(cand[nestedId] ?? '');
                            if (id === '' || isEmptyWriteValue(cand['value']))
                                continue;
                            const nestedPath = makeWritePath(section, selectors, `${key}[${encodeURIComponent(nestedId)}=${encodeURIComponent(id)}].value`);
                            if (!scopeSelects(scope, nestedPath))
                                continue;
                            const existing = existingById.get(id);
                            const keep = scope.mode !== 'repair' &&
                                existing !== undefined && !isEmptyWriteValue(existing['value']);
                            if (keep)
                                continue;
                            if (existing === undefined) {
                                out.push({ ...cand });
                                existingById.set(id, cand);
                            }
                            else {
                                const idx = out.findIndex((row) => String(row[nestedId]) === id);
                                if (idx < 0)
                                    continue;
                                out[idx] = { ...out[idx], value: cand['value'] };
                            }
                            if (writtenPushed.includes(id))
                                continue;
                            writtenPushed.push(id);
                            addTarget(nestedPath);
                        }
                        if (out.length > 0)
                            merged[key] = out;
                        continue;
                    }
                }
                if (value !== null && typeof value === 'object' && adapter.mergeRowObjects !== true)
                    continue;
                const path = makeWritePath(section, selectors, key);
                if (!scopeSelects(scope, path) || (scope.mode === 'fill_missing' && !isEmptyWriteValue(selected.row[key])))
                    continue;
                merged[key] = value;
                addTarget(path);
            }
            output[selected.index] = merged;
        }
        return output;
    };
    const mergeObject = (currentValue, candidateValue, prefix) => {
        const output = { ...currentValue };
        for (const [key, value] of Object.entries(candidateValue)) {
            if (value === undefined || (scope.mode === 'fill_missing' && isEmptyWriteValue(value)))
                continue;
            const path = prefix === '' ? key : `${prefix}.${key}`;
            const existing = currentValue[key];
            if (Array.isArray(value)) {
                const rows = value.filter((row) => row !== null && typeof row === 'object' && !Array.isArray(row));
                const currentRows = Array.isArray(existing)
                    ? existing.filter((row) => row !== null && typeof row === 'object' && !Array.isArray(row))
                    : [];
                if (adapter.identityKey(key) !== undefined) {
                    output[key] = mergeRows(key, currentRows, rows);
                }
                else if (value.length > 0 && scopeSelects(scope, path) &&
                    (scope.mode === 'repair' || isEmptyWriteValue(existing))) {
                    output[key] = value;
                    addTarget(path);
                }
                else if (existing !== undefined) {
                    output[key] = existing;
                }
                continue;
            }
            if (value !== null && typeof value === 'object') {
                output[key] = mergeObject(existing !== null && typeof existing === 'object' && !Array.isArray(existing)
                    ? existing
                    : {}, value, path);
                continue;
            }
            if (!scopeSelects(scope, path) || (scope.mode === 'fill_missing' && !isEmptyWriteValue(existing)))
                continue;
            output[key] = value;
            addTarget(path);
        }
        return output;
    };
    const resume = mergeObject(current, candidate, '');
    if (scope.mode === 'repair') {
        for (const field of scope.fields) {
            if (!availableFields.includes(field) && !seenRequested.has(field)) {
                conflicts.push({ key: field, reason: `字段路径不在当前服务器简历中：${field}` });
            }
            else if (!seenRequested.has(field)) {
                conflicts.push({ key: field, reason: `字段路径无法从原始资料定位可写值：${field}` });
            }
        }
    }
    return { resume, targetPaths: [...new Set(targetPaths)], conflicts, availableFields };
}
//# sourceMappingURL=write-scope.js.map