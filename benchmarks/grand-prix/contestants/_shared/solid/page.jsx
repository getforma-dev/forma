import { renderToString } from 'solid-js/web';
import { For } from 'solid-js';
import { rows, summary, money } from './dataset.mjs';

const SHELL_HEAD = '<!doctype html><html><head><meta charset="utf-8"><title>Grand Prix</title></head><body>';
const SHELL_TAIL = '</body></html>';

function Page(props) {
  return (
    <main class="dash">
      <h1>Dashboard</h1>
      <section class="cards">
        <div class="card"><span>Rows</span><b>{props.s.count}</b></div>
        <div class="card"><span>Open</span><b>{props.s.open}</b></div>
        <div class="card"><span>Total</span><b>{money(props.s.total)}</b></div>
        <div class="card"><span>Average</span><b>{money(props.s.average)}</b></div>
      </section>
      <table class="grid">
        <thead><tr><th>ID</th><th>Label</th><th>Owner</th><th>Amount</th><th>Status</th><th>Updated</th></tr></thead>
        <tbody>
          <For each={props.list}>
            {(r) => (
              <tr data-id={r.id}>
                <td>{r.id}</td><td>{r.label}</td><td>{r.owner}</td>
                <td class="num">{money(r.amount)}</td>
                <td><span class={'badge ' + r.status}>{r.status}</span></td>
                <td>{r.updated}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </main>
  );
}

export function renderPage(n) {
  const list = rows(n);
  const s = summary(list);
  return SHELL_HEAD + renderToString(() => <Page list={list} s={s} />) + SHELL_TAIL;
}
