import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MountHandle } from '../runtime';

let runtime: typeof import('../runtime');
let reactive: typeof import('../reactive');
const handles: MountHandle[] = [];
const counter = (id: string, tail = '') => `<section id="${id}" data-forma-state='{"n":0}'>
  <button data-on:click="{n++}">increment</button><output data-text="{n}"></output>${tail}</section>`;

beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = '<main id="root"></main>';
  runtime = await import('../runtime');
  reactive = await import('../reactive');
});
afterEach(() => {
  for (const handle of handles.splice(0)) handle.unmount();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function refuseEmptyClass(beforeThrow: () => void = () => {}): DOMException {
  const error = new DOMException('The token provided must not be empty.', 'SyntaxError');
  const prototype = Object.getPrototypeOf(document.createElement('p').classList) as DOMTokenList;
  const toggle = prototype.toggle;
  vi.spyOn(prototype, 'toggle').mockImplementation(function(this: DOMTokenList, token: string, force?: boolean) {
    if (token === '') {
      beforeThrow();
      // Happy DOM accepts this token. All three native engines throw here.
      throw error;
    }
    return Reflect.apply(toggle, this, [token, force]);
  });
  return error;
}

it.each(['partial scope', 'earlier completed scope'] as const)('a failed mount disposes listeners and effects from its %s and can remount', placement => {
  const root = document.getElementById('root')!;
  let button: HTMLButtonElement | null = null;
  let output: HTMLOutputElement | null = null;
  const state: Array<ReturnType<typeof reactive.createSignal>> = [];
  const createSignal = reactive.createSignal;
  vi.spyOn(reactive, 'createSignal').mockImplementation((...args) => {
    const pair = createSignal(...args); state.push(pair); return pair;
  });
  const error = refuseEmptyClass(() => {
    button = root.querySelector('#first button'); output = root.querySelector('#first output');
  });
  const bad = '<p data-class:="{n}"></p>';
  const html = placement === 'partial scope' ? counter('first', bad) : counter('first') + counter('second', bad);
  expect(() => runtime.mountMarkup(root, runtime.trustedHtml(html), { tier: 'reviewed' })).toThrow(error);
  expect(button).not.toBeNull(); expect(output).not.toBeNull(); expect(state).toHaveLength(placement === 'partial scope' ? 1 : 2);
  button!.click();
  expect(state[0]![0](), 'retained listener must not change disposed state').toBe(0);
  state[0]![1](7);
  expect(output!.textContent, 'retained effect must not observe later writes').toBe('0');
  expect(runtime.getScopes()).toEqual([]);
  const handle = runtime.mountMarkup(root, runtime.trustedHtml(counter('replacement')), { tier: 'reviewed' }); handles.push(handle);
  root.querySelector<HTMLButtonElement>('button')!.click();
  expect(root.querySelector('output')!.textContent).toBe('1');
});

it('unsubscribes the failed initial reader without disposing its unrelated caller root', () => {
  const root = document.getElementById('root')!;
  const [other, setOther] = reactive.createSignal(0);
  const seen: number[] = [];
  let failedState: ReturnType<typeof reactive.createSignal> | undefined;
  const createSignal = reactive.createSignal;
  vi.spyOn(reactive, 'createSignal').mockImplementation((...args) => {
    failedState = createSignal(...args); return failedState;
  });
  let failedReads = 0;
  const error = refuseEmptyClass(() => { failedReads++; });
  const disposeParent = reactive.createRoot(dispose => {
    reactive.createEffect(() => { seen.push(other()); });
    expect(() => runtime.mountMarkup(root, runtime.trustedHtml(counter('bad', '<p data-class:="{n}"></p>')), { tier: 'reviewed' })).toThrow(error);
    return dispose;
  });
  try {
    expect(failedState).toBeDefined();
    failedState![1](1);
    expect(failedReads, 'a reader that threw before returning its disposer must be unsubscribed').toBe(1);
    setOther(1); expect(seen).toEqual([0, 1]);
  } finally { disposeParent(); }
});

it('aborts allowed requests and clears polling in completed and partial scopes after initial failure', () => {
  vi.useFakeTimers();
  const root = document.getElementById('root')!;
  const requests: RequestInit[] = [];
  const fetch = vi.fn((_url: string, init: RequestInit) => {
    requests.push(init); return new Promise<Response>(() => {});
  });
  vi.stubGlobal('fetch', fetch);
  const error = refuseEmptyClass();
  const poll = '<div data-fetch="GET /api/widget/items → data |poll:10"></div>';
  const scope = (bad: boolean) => `<section data-forma-state='{"data":null,"n":0}'>${poll}${bad ? '<p data-class:="{n}"></p>' : ''}</section>`;
  expect(() => runtime.mountMarkup(root, runtime.trustedHtml(scope(false) + scope(true)), {
    tier: 'reviewed', grants: { fetch: { methods: ['GET'], paths: ['/api/widget/'], cookies: false } },
  })).toThrow(error);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(requests.every(request => request.signal?.aborted === true)).toBe(true);
  vi.advanceTimersByTime(60_000);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('disposes successful and partially bound list rows when a later row refuses', () => {
  const root = document.getElementById('root')!;
  const buttons: HTMLButtonElement[] = [];
  const add = HTMLButtonElement.prototype.addEventListener;
  vi.spyOn(HTMLButtonElement.prototype, 'addEventListener').mockImplementation(function(this: HTMLButtonElement, ...args) {
    if (args[0] === 'click') buttons.push(this);
    return Reflect.apply(add, this, args);
  });
  const state: Array<ReturnType<typeof reactive.createSignal>> = [];
  const createSignal = reactive.createSignal;
  vi.spyOn(reactive, 'createSignal').mockImplementation((...args) => {
    const pair = createSignal(...args); state.push(pair); return pair;
  });
  const prototype = Object.getPrototypeOf(document.createElement('p').classList) as DOMTokenList;
  const toggle = prototype.toggle;
  const error = new DOMException('row DOM write refused', 'SyntaxError');
  vi.spyOn(prototype, 'toggle').mockImplementation(function(this: DOMTokenList, token: string, force?: boolean) {
    if (token === 'refuse' && force) throw error;
    return Reflect.apply(toggle, this, [token, force]);
  });
  const html = `<section data-forma-state='{"n":0,"items":[{"bad":false},{"bad":true}]}'>
    <div data-list="{items}"><div><button data-on:click="{n++}">increment</button>
      <output data-text="{n}"></output><p data-class:refuse="{item.bad}"></p></div></div></section>`;
  expect(() => runtime.mountMarkup(root, runtime.trustedHtml(html), { tier: 'reviewed' })).toThrow(error);
  expect(buttons).toHaveLength(2); expect(state).toHaveLength(2);
  for (const button of buttons) button.click();
  expect(state[0]![0]()).toBe(0);
  state[0]![1](8);
  for (const button of buttons) expect(button.parentElement!.querySelector('output')!.textContent).toBe('0');
});

it('the explicit mount owns successful bindings independently of an enclosing reactive root', () => {
  const root = document.getElementById('root')!;
  let handle: MountHandle | undefined;
  const disposeParent = reactive.createRoot(dispose => {
    handle = runtime.mountMarkup(root, runtime.trustedHtml(counter('live')), { tier: 'reviewed' });
    handles.push(handle); return dispose;
  });
  const button = root.querySelector<HTMLButtonElement>('button')!;
  const output = root.querySelector('output')!;
  disposeParent(); button.click(); expect(output.textContent).toBe('1');
  handle!.unmount(); button.click(); expect(output.textContent).toBe('1');
});
