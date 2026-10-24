# The page every server renders (the SSR events)

`GET /ssr?rows=N`, N in {10, 100, 1000} (default 100); `GET /health` returns 200 `ok`. Port 3000.
Each request builds the rows and the summary from `dataset.mjs` (or its exact port) and renders
HTML; nothing may cache the rendered HTML or the row list between requests. Text is escaped by
the framework's normal path. Production mode, the framework's own production server or its
documented minimal production setup. No client JavaScript is required on this page; a framework
that adds its own scripts or payload by default keeps them (that is its real cost) and the report
says so.

Markup, element for element (attribute quoting and whitespace may differ):

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Grand Prix</title></head><body>
<main class="dash">
  <h1>Dashboard</h1>
  <section class="cards">
    <div class="card"><span>Rows</span><b>{count}</b></div>
    <div class="card"><span>Open</span><b>{open}</b></div>
    <div class="card"><span>Total</span><b>{money(total)}</b></div>
    <div class="card"><span>Average</span><b>{money(average)}</b></div>
  </section>
  <table class="grid">
    <thead><tr><th>ID</th><th>Label</th><th>Owner</th><th>Amount</th><th>Status</th><th>Updated</th></tr></thead>
    <tbody>
      <!-- one per row -->
      <tr data-id="{id}"><td>{id}</td><td>{label}</td><td>{owner}</td><td class="num">{money(amount)}</td>
        <td><span class="badge {status}">{status}</span></td><td>{updated}</td></tr>
    </tbody>
  </table>
</main>
</body></html>
```

The harness rejects a contestant whose `/ssr?rows=N` body lacks any of `expected(N).mustContain`
or holds other than N occurrences of `<tr data-id=`.
