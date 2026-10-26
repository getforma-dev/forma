import { h, createSignal } from '@getforma/core';
export interface PageProps { count: number; name: string; csrf: string; error: string }
export function CounterA(props: { count: number }) {
  const [count, setCount] = createSignal(props.count);
  return <section aria-label="Counter A">
    <button id="counter-a" type="button" onClick={() => setCount(count() + 1)}>Increment A</button>
    <output id="value-a">{() => count()}</output>
    <label>Editable A<input id="island-input-a" type="number" value={() => count()} onInput={(event: Event) => setCount(Number((event.currentTarget as HTMLInputElement).value))}/></label>
  </section>;
}
export function PageA(props: PageProps) {
  return <div data-proof-layout="shared">
    <header id="proof-layout"><label>Persistent layout<input id="layout-note" value="persistent"/></label></header>
    <main id="proof-route" data-proof-page="a">
      <h1 id="route-title">Native route A</h1>
      <nav><a id="to-a" href="/proof/a">Route A</a> <a id="to-b" href="/proof/b">Route B</a></nav>
      <CounterA count={props.count}/>
      <p id="server-name">{props.name}</p>
      <form id="update-form" action="/proof/update" method="post">
        <label>Name<input id="name-input" name="name" value={props.name}/></label>
        <input type="hidden" name="csrf" value={props.csrf}/>
        <p id="form-error" role="alert">{props.error}</p>
        <button id="submit-update" type="submit">Update</button>
      </form>
    </main>
  </div>;
}
