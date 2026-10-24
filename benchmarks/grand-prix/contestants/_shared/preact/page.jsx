import { render } from 'preact-render-to-string';
import { rows, summary, money } from './dataset.mjs';

function Page({ list, s }) {
  return (
    <html>
      <head><meta charset="utf-8" /><title>Grand Prix</title></head>
      <body>
        <main class="dash">
          <h1>Dashboard</h1>
          <section class="cards">
            <div class="card"><span>Rows</span><b>{s.count}</b></div>
            <div class="card"><span>Open</span><b>{s.open}</b></div>
            <div class="card"><span>Total</span><b>{money(s.total)}</b></div>
            <div class="card"><span>Average</span><b>{money(s.average)}</b></div>
          </section>
          <table class="grid">
            <thead><tr><th>ID</th><th>Label</th><th>Owner</th><th>Amount</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} data-id={r.id}>
                  <td>{r.id}</td><td>{r.label}</td><td>{r.owner}</td>
                  <td class="num">{money(r.amount)}</td>
                  <td><span class={'badge ' + r.status}>{r.status}</span></td>
                  <td>{r.updated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </main>
      </body>
    </html>
  );
}

export function renderPage(n) {
  const list = rows(n);
  const s = summary(list);
  return '<!doctype html>' + render(<Page list={list} s={s} />);
}
