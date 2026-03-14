import { h, Fragment, createSignal, createList } from '@getforma/core';

interface Row {
  id: number;
  name: string;
  value: number;
}

const initialData: Row[] = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  name: `Item ${i + 1}`,
  value: Math.round(Math.random() * 1000) / 10,
}));

const [rows, setRows] = createSignal(initialData);
const [sortAsc, setSortAsc] = createSignal(true);

function toggleSort() {
  const asc = !sortAsc();
  setSortAsc(asc);
  setRows(
    [...rows()].sort((a, b) => (asc ? a.value - b.value : b.value - a.value)),
  );
}

export function HomeIsland() {
  return (
    <div>
      <h1>Dashboard</h1>
      <button onClick={toggleSort}>
        {() => `Sort by value (${sortAsc() ? '\u2191' : '\u2193'})`}
      </button>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {createList(
            rows,
            (r) => r.id,
            (r) => (
              <tr>
                <td>{String(r.id)}</td>
                <td>{r.name}</td>
                <td>{r.value.toFixed(1)}</td>
              </tr>
            ),
            { updateOnItemChange: 'rerender' },
          )}
        </tbody>
      </table>
    </div>
  );
}
