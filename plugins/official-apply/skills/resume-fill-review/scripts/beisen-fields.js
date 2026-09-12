// Beisen resume form helpers. Runs inside the page via addScriptTag.
// Uses the form's own field props and onChange; Save still runs site validation.
window.batchBeisenFields = function () {
  const found = [], seen = new Set();
  for (const item of document.querySelectorAll('.form-item')) {
    const nodes = [...item.querySelectorAll('input,textarea'), item.querySelector('.form-item__control')].filter(Boolean);
    for (const node of nodes) {
      const key = Object.keys(node).find(k => k.startsWith('__reactInternalInstance') || k.startsWith('__reactFiber$'));
      if (!key) continue;
      let fiber = node[key];
      for (let depth = 0; fiber && depth < 45; depth++, fiber = fiber.return) {
        const props = fiber.memoizedProps;
        if (!props?.cmp_name || !props.cmp_type?.startsWith('BC_') || typeof props.onChange !== 'function') continue;
        const id = props.cmp_id + ':' + String(props.bizData?._id?.value ?? props.parId ?? 'single');
        if (!seen.has(id)) { seen.add(id); found.push({ props, item, key: id }); }
        break;
      }
    }
  }
  return found;
};
window.batchBeisenSnapshot = function () {
  return window.batchBeisenFields().map(({ props: p, key }) => ({ key, name: p.cmp_name, label: p.cmp_label,
    section: p.metaObjectName, field: p.cmp_data?.field_name, type: p.cmp_type, required: p.cmp_data?.required,
    format: p.cmp_data?.data_format, parId: p.parId, recordId: p.bizData?._id?.value, value: p.value, text: p.text,
    maxLength: p.validators?.length?.maximum }));
};
// Serialize a field's data props (no DOM/functions) for offline diagnosis.
window.batchBeisenProps = function (key) {
  const field = window.batchBeisenFields().find(f => f.key === key);
  if (!field) return null;
  const clean = (v, depth) => {
    if (v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'function') return '[fn]';
    if (depth > 4) return Array.isArray(v) ? '[…]' : '{…}';
    if (Array.isArray(v)) return v.slice(0, 40).map(x => clean(x, depth + 1));
    if (v instanceof Element) return '[dom]';
    const out = {};
    for (const k of Object.keys(v).slice(0, 60)) out[k] = clean(v[k], depth + 1);
    return out;
  };
  const p = field.props;
  return { key, label: p.cmp_label, type: p.cmp_type, cmp_data: clean(p.cmp_data, 0), value: p.value, text: p.text,
    bizData: clean(p.bizData, 0), dataSourceResults: clean(p.dataSourceResults ?? p.cmp_data?.dataSourceResults, 0) };
};
window.batchBeisenSet = function (key, text, value, untilNow = false) {
  const field = window.batchBeisenFields().find(f => f.key === key);
  if (!field) throw Error('Field disappeared: ' + key);
  if (untilNow) {
    if (/9999|至今/.test(String(field.props.value??'')+String(field.props.text??''))) return true;
    const endItem = field.item;
    let host = endItem;
    for (let up = 0; up < 4 && host; up++, host = host.parentElement) {
      const target = [...host.querySelectorAll('label,span,a,button')].find(e =>
        e.textContent.trim() === '至今' && e.children.length === 0 && e.offsetParent !== null);
      if (target) { target.click(); return true; }
    }
    return false;
  }
  field.props.onChange({ text, value });
  return true;
};
// Options currently available to a dropdown/radio/popconstant field.
window.batchBeisenOptions = function (key) {
  const field = window.batchBeisenFields().find(f => f.key === key);
  if (!field) return null;
  const p = field.props;
  const opts = p.cmp_data?.datasource ?? p.dataSourceResults ?? [];
  return (Array.isArray(opts) ? opts : []).map(o => ({ text: String(o.text ?? ''), value: String(o.value ?? '') }));
};
// Delete the DOM card that holds ONLY this record's fields. Driver decides when (fully blank cards only).
window.batchBeisenDeleteRecord = function (recordId) {
  const mine = window.batchBeisenFields().filter(f => f.props.bizData?._id?.value === recordId);
  if (!mine.length) return 'no-fields';
  const items = mine.map(f => f.item);
  let host = items[0];
  for (let up = 0; up < 10 && host; up++, host = host.parentElement) {
    if (!items.every(it => host.contains(it))) continue;
    // host must not contain any .form-item that is not one of this record's own items
    const formItems = [...host.querySelectorAll('.form-item')];
    const known = new Set(items);
    if (formItems.some(fi => !known.has(fi))) continue;
    const del = [...host.querySelectorAll('a,span,button')]
      .find(e => e.textContent.trim() === '删除' && e.children.length === 0 && e.offsetParent !== null);
    if (!del) continue;
    del.click();
    return true;
  }
  return 'card-or-delete-button-not-found';
};
window.batchBeisenValidation = function () {
  const errors = [];
  for (const el of document.querySelectorAll('.form-item')) {
    if (!el.querySelector('[class*="error" i], .form-item__explain--error, .has-error')) continue;
    const label = el.querySelector('.form-item__text')?.textContent?.trim();
    if (label) errors.push(label);
  }
  return [...new Set(errors)];
};
