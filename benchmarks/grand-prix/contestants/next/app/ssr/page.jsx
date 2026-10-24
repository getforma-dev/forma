import { rows, summary, money, ALLOWED_ROWS } from '../../dataset.mjs';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }) {
  const sp = await searchParams;
  const q = Number(sp.rows);
  const n = ALLOWED_ROWS.includes(q) ? q : 100;
  const list = rows(n);
  const s = summary(list);
  return (
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
            <tr data-id={r.id} key={r.id}>
              <td>{r.id}</td><td>{r.label}</td><td>{r.owner}</td>
              <td className="num">{money(r.amount)}</td>
              <td><span className={'badge ' + r.status}>{r.status}</span></td>
              <td>{r.updated}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
