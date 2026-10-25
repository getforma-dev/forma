import { createRoot, createSignal, createList } from '@getforma/core';
import { makeDelegatedRows } from '../forma-delegated/src/delegated-row.js';

// Untimed supplemental fixture. Candidate helper and real list/root/effects are unchanged.
// Getter counters observe effect execution, not just whether DOM values changed.
const report = { kind: 'actual createList ownership supplement', scenarios: [], passed: false };
window.__ownershipSupplement = report;
function check(result, name, ok, evidence = {}) {
  result.checks.push({ name, ok: !!ok, evidence });
  if (!ok) throw new Error(`${result.name}: ${name}`);
}
function setup(name, ids) {
  const result = { name, checks: [] };
  report.scenarios.push(result);
  const table = document.createElement('table');
  const tbody = document.createElement('tbody');
  table.append(tbody); document.body.append(table);
  const records = ids.map(value => {
    const [label, setLabel] = createSignal(`row-${value}`);
    const counts = { idReads: 0, labelReads: 0 };
    return { value, counts, setLabel,
      get id() { counts.idReads++; return value; },
      label() { counts.labelReads++; return label(); },
    };
  });
  let dispose, selected, setSelected, data, setData, listenerSignal, dispatcher;
  const calls = { selected: 0, remove: 0 };
  const add = tbody.addEventListener;
  tbody.addEventListener = function(type, handler, options) {
    if (type === 'click') { listenerSignal = options.signal; dispatcher = handler; }
    return add.call(this, type, handler, options);
  };
  createRoot(stop => {
    dispose = stop;
    [selected, setSelected] = createSignal(null);
    [data, setData] = createSignal(records);
    const rows = makeDelegatedRows(selected,
      id => { calls.selected++; setSelected(id); },
      id => { calls.remove++; setData(items => items.filter(row => row.id !== id)); });
    rows.attach(tbody);
    tbody.append(createList(data, row => row.id, rows.render));
  });
  records.forEach((r, i) => { r.node = tbody.querySelectorAll('tr')[i]; });
  check(result, 'actual list rendered all rows', tbody.querySelectorAll('tr').length === records.length);
  check(result, 'root listener active', listenerSignal && !listenerSignal.aborted);
  // Positive controls distinguish a disconnected fixture from successful cleanup.
  for (const r of records) {
    const previous = { ...r.counts };
    r.setLabel(`live-${r.value}`);
    setSelected(r.value);
    check(result, `row ${r.value} live effects execute`, r.counts.labelReads > previous.labelReads && r.counts.idReads > previous.idReads && r.node.querySelector('.lbl').textContent === `live-${r.value}` && r.node.className === 'danger');
  }
  setSelected(null);
  const snapshot = r => ({ ...r.counts, text: r.node.querySelector('.lbl').textContent, className: r.node.className });
  const proveStopped = (r, reason) => {
    const before = snapshot(r);
    r.setLabel(`disposed-${r.value}`); setSelected(r.value);
    const after = snapshot(r);
    check(result, `${reason}: row ${r.value} label effect stopped`, after.labelReads === before.labelReads && after.text === before.text, { before, after });
    check(result, `${reason}: row ${r.value} class effect stopped`, after.idReads === before.idReads && after.className === before.className, { before, after });
  };
  const clickStale = (rs, reason, replay = false) => {
    setSelected(null);
    const before = { ...calls };
    for (const r of rs) {
      for (const selector of ['.lbl', '.remove']) {
        const target = r.node.querySelector(selector);
        if (replay) {
          // Deliberately bypass native listener abortion to check slot revocation separately.
          // This is a controlled dispatcher replay, not a browser propagation claim.
          dispatcher({ composedPath: () => [target, target.parentElement, r.node, tbody, table, document.body, document, window] });
        } else target.click();
      }
    }
    check(result, `${reason}: stale select/remove callbacks revoked`, selected() === null && calls.selected === before.selected && calls.remove === before.remove, { before, after: { ...calls }, mode: replay ? 'captured dispatcher + composedPath surrogate' : 'native click on connected rows' });
  };
  return { result, table, tbody, records, dispose, selected, setSelected, data, setData, listenerSignal, calls, snapshot, proveStopped, clickStale };
}
try {
  {
    const f = setup('actual delegated remove through createList', [11, 12]);
    const [removed, live] = f.records;
    removed.node.querySelector('.remove').click();
    check(f.result, 'delegated remove invoked actual list update', f.calls.remove === 1 && f.data().length === 1 && f.data()[0] === live && !removed.node.isConnected && f.tbody.querySelectorAll('tr').length === 1);
    f.proveStopped(removed, 'list removal');
    live.setLabel('survivor-updated'); f.setSelected(live.value);
    check(f.result, 'remaining row effects stay live', live.node.querySelector('.lbl').textContent === 'survivor-updated' && live.node.className === 'danger');
    // Reconnect removed row under the still-active dispatcher: detached clicks would be vacuous.
    f.tbody.append(removed.node);
    check(f.result, 'removed row reconnected with active root listener', removed.node.isConnected && !f.listenerSignal.aborted);
    f.clickStale([removed], 'list removal');
    removed.node.remove(); f.dispose(); f.table.remove();
  }
  {
    const f = setup('actual createList clear', [21, 22]);
    f.setData([]);
    check(f.result, 'clear removed every actual list row', f.data().length === 0 && f.tbody.querySelectorAll('tr').length === 0 && f.records.every(r => !r.node.isConnected));
    for (const r of f.records) f.proveStopped(r, 'list clear');
    for (const r of f.records) f.tbody.append(r.node);
    check(f.result, 'cleared rows reconnected with active root listener', f.records.every(r => r.node.isConnected) && !f.listenerSignal.aborted);
    f.clickStale(f.records, 'list clear');
    for (const r of f.records) r.node.remove();
    f.dispose(); f.table.remove();
  }
  {
    const f = setup('parent disposal with live createList rows', [31, 32]);
    check(f.result, 'both rows live and connected immediately before parent disposal', f.data().length === 2 && f.tbody.querySelectorAll('tr').length === 2 && f.records.every(r => r.node.isConnected));
    f.dispose();
    check(f.result, 'parent disposal aborted root listener', f.listenerSignal.aborted);
    check(f.result, 'retained row nodes remain connected for non-vacuous click controls', f.records.every(r => r.node.isConnected));
    for (const r of f.records) f.proveStopped(r, 'parent disposal');
    f.clickStale(f.records, 'aborted parent native listener');
    f.clickStale(f.records, 'parent row slots independently revoked', true);
    f.table.remove();
  }
  report.passed = true;
} catch (error) {
  report.error = String(error);
} finally {
  report.done = true;
}
