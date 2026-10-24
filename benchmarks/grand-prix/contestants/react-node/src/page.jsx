// The Grand Prix page as a React component (shared by react-node, react-bun, react-deno).
import { renderToString } from 'react-dom/server';
import { rows, summary, money } from './dataset.mjs';

function Page({ list, s }) {
  return (
    <html>
      <head><meta charSet="utf-8" /><title>Grand Prix</title></head>
      <body>
        <main className="dash">
          <h1>Dashboard</h1>
          <section className="cards">
            <div className="card"><span>Rows</span><b>{s.count}</b></div>
            <div className="card"><span>Open</span><b>{s.open}</b></div>
            <div className="card"><span>Total</span><b>{money(s.total)}</b></div>
            <div className="card"><span>Average</span><b>{money(s.average)}</b></div>
          </section>
          <table className="grid">
            <thead><tr><th>ID</th><th>Label</th><th>Owner</th><th>Amount</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} data-id={r.id}>
                  <td>{r.id}</td><td>{r.label}</td><td>{r.owner}</td>
                  <td className="num">{money(r.amount)}</td>
                  <td><span className={'badge ' + r.status}>{r.status}</span></td>
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
  return '<!doctype html>' + renderToString(<Page list={list} s={s} />);
}
