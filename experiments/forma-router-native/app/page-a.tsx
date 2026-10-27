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
  return <main id="native-route" data-native-page="a">
      <h1 id="route-title" data-forma-route-heading>Native route A</h1>
      <CounterA count={props.count}/>
      <p id="server-name">{props.name}</p>
      <form id="update-form" action="/native/update" method="post">
        <label>Name<input id="name-input" name="name" value={props.name}/></label>
        <input type="hidden" name="csrf" value={props.csrf}/>
        <p id="form-error" data-forma-form-error role="alert">{props.error}</p>
        <button id="submit-update" type="submit">Update</button>
      </form>
    <div class="native-spacer" aria-hidden="true"></div>
  </main>;
}
