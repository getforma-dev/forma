import { useEffect, useState } from "react";
import type { Route } from "./+types/island";
import { rows, summary, money, ALLOWED_ROWS } from "../../dataset.mjs";

export function links() {
  return [{ rel: "icon", href: "data:," }];
}

export function loader({ request }: Route.LoaderArgs) {
  const q = Number(new URL(request.url).searchParams.get("rows"));
  const n = ALLOWED_ROWS.includes(q) ? q : 100;
  const list = rows(n);
  return { list, summary: summary(list) };
}

export default function Island({ loaderData }: Route.ComponentProps) {
  const { list, summary: s } = loaderData;
  const [count, setCount] = useState(0);
  useEffect(() => {
    const readyAt = performance.now();
    const activationStart = (window as any).__gpActivationStart ?? null;
    (window as any).__gpIsland = { ready: true, readyAt, activationStart,
      activationMs: activationStart === null ? null : readyAt - activationStart };
  }, []);
  return (
    <main className="dash">
      <h1>Dashboard</h1>
      <section id="gp-counter">
        <button id="gp-increment" onClick={() => setCount(value => value + 1)}>Increment</button>
        <output id="gp-count">{count}</output>
      </section>
      <section className="cards">
        <div className="card"><span>Rows</span><b>{s.count}</b></div>
        <div className="card"><span>Open</span><b>{s.open}</b></div>
        <div className="card"><span>Total</span><b>{money(s.total)}</b></div>
        <div className="card"><span>Average</span><b>{money(s.average)}</b></div>
      </section>
      <table className="grid">
        <thead><tr><th>ID</th><th>Label</th><th>Owner</th><th>Amount</th><th>Status</th><th>Updated</th></tr></thead>
        <tbody>
          {list.map((r: any) => (
            <tr data-id={r.id} key={r.id}>
              <td>{r.id}</td><td>{r.label}</td><td>{r.owner}</td>
              <td className="num">{money(r.amount)}</td>
              <td><span className={"badge " + r.status}>{r.status}</span></td>
              <td>{r.updated}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
