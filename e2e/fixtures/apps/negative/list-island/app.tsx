// The finding behind FORMA-188's notes: an island that holds a client-side list ships core's keyed
// reconciler, which puts the route's Forma code over N2's ceiling today (BUILD-819), while the same
// island without the list is under it. Every consumer page with a list inside an island is this
// shape (the studio's chips, the service's results table). apps.spec.ts builds this entry and
// expects the refusal; when the ceiling is restated or the list code is cut, that test fails and
// the list moves back into the ksx and fauth islands. Never served.
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
