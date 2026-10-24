import '../../../shared/chrome.css';
import { buildData } from '../../../shared/data.js';

const tbody = document.getElementById('tbody');
const rowTemplate = document.createElement('tr');
rowTemplate.innerHTML = '<td class="col-id"></td><td><a class="lbl"></a></td><td><a class="remove">x</a></td>';

let rows = []; // { id, label, tr, lbl }
const byId = new Map();
let selected = null;

function createRow(d) {
  const tr = rowTemplate.cloneNode(true);
  tr.firstChild.textContent = d.id;
  const lbl = tr.childNodes[1].firstChild;
  lbl.textContent = d.label;
  const row = { id: d.id, label: d.label, tr, lbl };
  byId.set(d.id, row);
  tr._row = row;
  return row;
}

function setRows(data) {
  selected = null;
  byId.clear();
  rows = data.map(createRow);
  tbody.textContent = '';
  const frag = document.createDocumentFragment();
  for (const r of rows) frag.appendChild(r.tr);
  tbody.appendChild(frag);
}

function append(data) {
  const frag = document.createDocumentFragment();
  for (const d of data) { const r = createRow(d); rows.push(r); frag.appendChild(r.tr); }
  tbody.appendChild(frag);
}

const actions = {
  run: () => setRows(buildData(1000)),
  runlots: () => setRows(buildData(10000)),
  add: () => append(buildData(1000)),
  update: () => {
    for (let i = 0; i < rows.length; i += 10) {
      const r = rows[i];
      r.label += ' !!!';
      r.lbl.textContent = r.label;
    }
  },
  clear: () => { rows = []; byId.clear(); selected = null; tbody.textContent = ''; },
  swaprows: () => {
    if (rows.length > 998) {
      const a = rows[1], b = rows[998];
      rows[1] = b; rows[998] = a;
      const bNext = b.tr.nextSibling;
      tbody.insertBefore(b.tr, a.tr);        // b to index 1
      tbody.insertBefore(a.tr, bNext);       // a to index 998
    }
  },
};

document.getElementById('controls').addEventListener('click', (e) => {
  const fn = actions[e.target.id];
  if (fn) fn();
});

tbody.addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  const row = tr._row;
  if (e.target.classList.contains('remove')) {
    rows.splice(rows.indexOf(row), 1);
    byId.delete(row.id);
    if (selected === row) selected = null;
    tr.remove();
  } else if (e.target.classList.contains('lbl')) {
    if (selected) selected.tr.className = '';
    selected = row;
    tr.className = 'danger';
  }
});
