// L-58 admits the client-list island under the current N2 policy. apps.spec.ts builds this
// entry and checks the emitted route bytes, ceilings and verdict. Never served.
import { h, mount, activateIslands, createSignal, createList } from '@getforma/core';

type Row = { id: number; name: string };

function Results(props: { rows: Row[] }) {
  const [rows, setRows] = createSignal(props.rows);
  return (
    <section>
      <button onClick={() => setRows([...rows(), { id: rows().length + 1, name: 'added' }])}>Add</button>
      <ul>{createList(() => rows(), (row) => row.id, (row) => <li>{row.name}</li>)}</ul>
    </section>
  );
}

function Page(props: { rows: Row[] }) {
  return <main><Results rows={props.rows} /></main>;
}

await activateIslands({ Results });
mount(() => Page({ rows: [] }), '#app');
