<script>
  import { buildData } from '../../../shared/data.js';
  import { Item } from './Item.svelte.js';

  let data = $state.raw([]);
  let selected = $state(null);

  const make = (n) => buildData(n).map((d) => new Item(d));

  function run() { data = make(1000); selected = null; }
  function runLots() { data = make(10000); selected = null; }
  function add() { data = data.concat(make(1000)); }
  function update() { for (let i = 0; i < data.length; i += 10) data[i].label += ' !!!'; }
  function clear() { data = []; selected = null; }
  function swap() {
    if (data.length > 998) {
      const next = data.slice();
      const t = next[1]; next[1] = next[998]; next[998] = t;
      data = next;
    }
  }
  function remove(id) { data = data.toSpliced(data.findIndex((r) => r.id === id), 1); }
</script>

<div id="controls">
  <button id="run" onclick={run}>Create 1,000 rows</button>
  <button id="runlots" onclick={runLots}>Create 10,000 rows</button>
  <button id="add" onclick={add}>Append 1,000 rows</button>
  <button id="update" onclick={update}>Update every 10th row</button>
  <button id="clear" onclick={clear}>Clear</button>
  <button id="swaprows" onclick={swap}>Swap Rows</button>
</div>
<table>
  <tbody>
    {#each data as row (row.id)}
      <tr class:danger={selected === row.id}>
        <td class="col-id">{row.id}</td>
        <td><a class="lbl" onclick={() => (selected = row.id)}>{row.label}</a></td>
        <td><a class="remove" onclick={() => remove(row.id)}>x</a></td>
      </tr>
    {/each}
  </tbody>
</table>
