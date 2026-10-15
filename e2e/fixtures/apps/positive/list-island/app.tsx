// The smallest island that brings a keyed list into the browser. L-58 admits its
// reconciler under N2; both source and packed lanes record its actual size report.
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

activateIslands({ Results });
mount(() => Page({ rows: [] }), '#app');
