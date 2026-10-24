import '../../../shared/chrome.css';
import { render } from 'preact';
import { memo } from 'preact/compat';
import { useCallback, useReducer } from 'preact/hooks';
import { buildData } from '../../../shared/data.js';

const initial = { data: [], selected: 0 };

function reducer(state, action) {
  const { data, selected } = state;
  switch (action.type) {
    case 'RUN': return { data: buildData(1000), selected: 0 };
    case 'RUNLOTS': return { data: buildData(10000), selected: 0 };
    case 'ADD': return { data: data.concat(buildData(1000)), selected };
    case 'UPDATE': {
      const next = data.slice();
      for (let i = 0; i < next.length; i += 10) next[i] = { id: next[i].id, label: next[i].label + ' !!!' };
      return { data: next, selected };
    }
    case 'CLEAR': return { data: [], selected: 0 };
    case 'SWAP': {
      if (data.length <= 998) return state;
      const next = data.slice();
      const t = next[1]; next[1] = next[998]; next[998] = t;
      return { data: next, selected };
    }
    case 'REMOVE': {
      const idx = data.findIndex((d) => d.id === action.id);
      return { data: data.toSpliced(idx, 1), selected };
    }
    case 'SELECT': return { data, selected: action.id };
    default: return state;
  }
}

const Row = memo(function Row({ item, selected, onSelect, onRemove }) {
  return (
    <tr class={selected ? 'danger' : ''}>
      <td class="col-id">{item.id}</td>
      <td><a class="lbl" onClick={() => onSelect(item.id)}>{item.label}</a></td>
      <td><a class="remove" onClick={() => onRemove(item.id)}>x</a></td>
    </tr>
  );
});

function App() {
  const [{ data, selected }, dispatch] = useReducer(reducer, initial);
  const onSelect = useCallback((id) => dispatch({ type: 'SELECT', id }), []);
  const onRemove = useCallback((id) => dispatch({ type: 'REMOVE', id }), []);
  return (
    <>
      <div id="controls">
        <button id="run" onClick={() => dispatch({ type: 'RUN' })}>Create 1,000 rows</button>
        <button id="runlots" onClick={() => dispatch({ type: 'RUNLOTS' })}>Create 10,000 rows</button>
        <button id="add" onClick={() => dispatch({ type: 'ADD' })}>Append 1,000 rows</button>
        <button id="update" onClick={() => dispatch({ type: 'UPDATE' })}>Update every 10th row</button>
        <button id="clear" onClick={() => dispatch({ type: 'CLEAR' })}>Clear</button>
        <button id="swaprows" onClick={() => dispatch({ type: 'SWAP' })}>Swap Rows</button>
      </div>
      <table><tbody>
        {data.map((item) => (
          <Row key={item.id} item={item} selected={selected === item.id} onSelect={onSelect} onRemove={onRemove} />
        ))}
      </tbody></table>
    </>
  );
}

render(<App />, document.getElementById('app'));
