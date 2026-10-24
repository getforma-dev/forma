import { h, createList, mount, createSignal, activateIslands } from '@getforma/core';

// Rows, summary and money formatting are computed per request in Rust (dataset.mjs port) and
// arrive as typed presentation props.
type Row = { id: string; label: string; owner: string; amount: string; status: string; badge: string; updated: string };
type PageProps = { count: string; open: string; total: string; average: string; rows: Row[] };

function IslandPage(props: PageProps) {
  return (
    <main class="dash">
      <h1>Dashboard</h1>
      <Counter initial={0} />
      <section class="cards">
        <div class="card"><span>Rows</span><b>{props.count}</b></div>
        <div class="card"><span>Open</span><b>{props.open}</b></div>
        <div class="card"><span>Total</span><b>{props.total}</b></div>
        <div class="card"><span>Average</span><b>{props.average}</b></div>
      </section>
      <table class="grid">
        <thead><tr><th>ID</th><th>Label</th><th>Owner</th><th>Amount</th><th>Status</th><th>Updated</th></tr></thead>
        <tbody>
          {createList(() => props.rows, r => r.id, r => (
            <tr data-id={r.id}><td>{r.id}</td><td>{r.label}</td><td>{r.owner}</td><td class="num">{r.amount}</td>
              <td><span class={r.badge}>{r.status}</span></td><td>{r.updated}</td></tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
function Counter(props: { initial: number }) {
  const [count, setCount] = createSignal(props.initial);
  return <section id="gp-counter"><button id="gp-increment" type="button" onClick={() => setCount(count() + 1)}>Increment</button><output id="gp-count">{() => count()}</output></section>;
}

(window as any).__gpActivationStart = performance.now();
await activateIslands({ Counter });
const readyAt = performance.now();
(window as any).__gpIsland = { ready: true, readyAt,
  activationStart: (window as any).__gpActivationStart,
  activationMs: readyAt - (window as any).__gpActivationStart };
mount(() => IslandPage({ count: '', open: '', total: '', average: '', rows: [] }), '#app');
