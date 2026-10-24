<script>
  import { money } from './dataset.mjs';
  let { list, s } = $props();
</script>

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
      {#each list as r (r.id)}
        <tr data-id={r.id}>
          <td>{r.id}</td><td>{r.label}</td><td>{r.owner}</td>
          <td class="num">{money(r.amount)}</td>
          <td><span class="badge {r.status}">{r.status}</span></td>
          <td>{r.updated}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</main>
