// FORMA-181 N3: both measured owners come from real typed native rows. The
// fixture exposes only the public handle, after explicit activation by the test.
import { h, createKeyedRows, createList, createSignal } from '@getforma/core';
export type Row = { id: string; label: string };
type Props = { rows: Row[]; name: string };
export function IndexedRows(props: Props) {
  const rows = createKeyedRows(props.rows, row => row.id);
  const [clicked, setClicked] = createSignal('none');
  const [edited, setEdited] = createSignal('none');
  return <section id={props.name}>
    <button data-arm="" onClick={() => {
      const registry = ((window as any).__indexed ??= {});
      registry[props.name] = rows;
    }}>Expose fixture handle</button>
    <ul>{createList(rows, item => <li title={() => item().label}>
      <input value="edit me" onInput={(event: Event) => setEdited(`${item().id}:${(event.currentTarget as HTMLInputElement).value}`)} />
      <b>{() => item().label}</b>
      <button onClick={() => setClicked(item().label)}>Read current row</button>
    </li>)}</ul>
    <output data-clicked="">{() => clicked()}</output>
    <output data-edited="">{() => edited()}</output>
  </section>;
}
export function Page(props: { small: Row[]; large: Row[] }) {
  return <main><IndexedRows name="small" rows={props.small} /><IndexedRows name="large" rows={props.large} /></main>;
}
