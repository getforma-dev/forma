// The Grand Prix page as template strings with an escape function (vanilla-node/bun/deno).
import { rows, summary, money } from './dataset.mjs';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ESC[c]);

function row(r) {
  return `<tr data-id="${esc(r.id)}"><td>${esc(r.id)}</td><td>${esc(r.label)}</td><td>${esc(r.owner)}</td>` +
    `<td class="num">${esc(money(r.amount))}</td><td><span class="badge ${esc(r.status)}">${esc(r.status)}</span></td>` +
    `<td>${esc(r.updated)}</td></tr>`;
}

export function renderPage(n) {
  const list = rows(n);
  const s = summary(list);
  let body = '';
  for (const r of list) body += row(r);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Grand Prix</title></head><body>
<main class="dash">
<h1>Dashboard</h1>
<section class="cards">
<div class="card"><span>Rows</span><b>${esc(s.count)}</b></div>
<div class="card"><span>Open</span><b>${esc(s.open)}</b></div>
<div class="card"><span>Total</span><b>${esc(money(s.total))}</b></div>
<div class="card"><span>Average</span><b>${esc(money(s.average))}</b></div>
</section>
<table class="grid">
<thead><tr><th>ID</th><th>Label</th><th>Owner</th><th>Amount</th><th>Status</th><th>Updated</th></tr></thead>
<tbody>${body}</tbody>
</table>
</main>
</body></html>`;
}
