import '../../../shared/chrome.css';
import { createSignal, batch, For } from 'solid-js';
import { render } from 'solid-js/web';
import { buildData } from '../../../shared/data.js';

function makeRows(count) {
  return buildData(count).map((d) => {
    const [label, setLabel] = createSignal(d.label);
    return { id: d.id, label, setLabel };
  });
}

function App() {
  const [data, setData] = createSignal([]);
  const [selected, setSelected] = createSignal(null);

  const run = () => batch(() => { setData(makeRows(1000)); setSelected(null); });
  const runLots = () => batch(() => { setData(makeRows(10000)); setSelected(null); });
  const add = () => setData((d) => d.concat(makeRows(1000)));
  const update = () => batch(() => {
    const d = data();
    for (let i = 0; i < d.length; i += 10) d[i].setLabel((l) => l + ' !!!');
  });
  const clear = () => batch(() => { setData([]); setSelected(null); });
  const swap = () => {
    const d = data();
    if (d.length > 998) {
      const next = d.slice();
      const t = next[1]; next[1] = next[998]; next[998] = t;
      setData(next);
    }
  };
  const remove = (id) => setData((d) => d.toSpliced(d.findIndex((r) => r.id === id), 1));

  return (
    <>
      <div id="controls">
        <button id="run" onClick={run}>Create 1,000 rows</button>
        <button id="runlots" onClick={runLots}>Create 10,000 rows</button>
        <button id="add" onClick={add}>Append 1,000 rows</button>
        <button id="update" onClick={update}>Update every 10th row</button>
        <button id="clear" onClick={clear}>Clear</button>
        <button id="swaprows" onClick={swap}>Swap Rows</button>
      </div>
      <table><tbody>
        <For each={data()}>{(row) => (
          <tr classList={{ danger: selected() === row.id }}>
            <td class="col-id">{row.id}</td>
            <td><a class="lbl" onClick={() => setSelected(row.id)}>{row.label()}</a></td>
            <td><a class="remove" onClick={() => remove(row.id)}>x</a></td>
          </tr>
        )}</For>
      </tbody></table>
    </>
  );
}

render(() => <App />, document.getElementById('app'));
