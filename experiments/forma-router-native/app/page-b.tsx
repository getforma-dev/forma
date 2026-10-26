import { h, createSignal } from '@getforma/core';
export interface PageProps { count: number; name: string; csrf: string; error: string }
export function CounterB(props: { count: number }) {
  const [count, setCount] = createSignal(props.count);
  return <section aria-label="Counter B">
    <button id="counter-b" type="button" onClick={() => setCount(count() + 1)}>Increment B</button>
    <output id="value-b">{() => count()}</output>
    <label>Editable B<input id="island-input-b" type="number" value={() => count()} onInput={(event: Event) => setCount(Number((event.currentTarget as HTMLInputElement).value))}/></label>
  </section>;
}
export function PageB(props: PageProps) {
  return <main id="native-route" data-native-page="b">
      <h1 id="route-title" data-forma-route-heading>Native route B</h1>
      <CounterB count={props.count}/>
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
