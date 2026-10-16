// FORMA-181 D: actual typed native props, emitted keys and browser registration.
// The F2 key rotates the rows without moving focus to an action button first.
import { h, createList, createSignal } from '@getforma/core';

type Row = { id: string; label: string };
type Props = { rows: Row[] };
export function KeyedRows(props: Props) {
  const [rows, setRows] = createSignal(props.rows);
  const [last, setLast] = createSignal('none');
  const [clicked, setClicked] = createSignal('none');
  return (
    <section id="keyed-rows">
      <ul onKeyDown={(event: KeyboardEvent) => {
        if (event.key === 'F2' && rows().length > 0) {
          event.preventDefault();
          setRows([...rows().slice(1), rows()[0]!]);
        }
      }}>
        {createList(rows, (row) => row.id, (row) => (
          <li>
            <input value={row.label} onInput={(event: Event) => setLast(`${row.id}:${(event.target as HTMLInputElement).value}`)} />
            <button onClick={() => setClicked(row.id)}>Count</button>
          </li>
        ))}
      </ul>
      <p id="keyed-edit">{() => last()}</p>
      <p id="keyed-click">{() => clicked()}</p>
    </section>
  );
}
export function Page(props: Props) {
  return <main><KeyedRows rows={props.rows} /></main>;
}
