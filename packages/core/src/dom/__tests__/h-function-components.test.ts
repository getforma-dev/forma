import { describe, it, expect } from 'vitest';
import { h } from '../element';
import { mount } from '../mount';
import { createList } from '../list';
import { withAdoptionDescription, type ComponentDescription } from '../adoption-description';
import { prepareAdoption } from '../adoption';
import { createSignal, createRoot } from 'forma/reactive';

// ---------------------------------------------------------------------------
// S3: Function component support in h()
// ---------------------------------------------------------------------------

describe('h() — function components', () => {
  it('calls the function with merged props including children', () => {
    const Greeting = (props: Record<string, unknown>) => {
      return h('span', null, `Hello ${props.name}`);
    };

    const el = h(Greeting, { name: 'World' }, 'child1', 'child2') as HTMLElement;
    expect(el).toBeInstanceOf(HTMLSpanElement);
    expect(el.textContent).toBe('Hello World');
  });

  it('passes children array in props when called with null props', () => {
    let receivedProps: Record<string, unknown> | null = null;
    const Spy = (props: Record<string, unknown>) => {
      receivedProps = props;
      return h('div', null, 'spy');
    };

    h(Spy, null, 'child1', 'child2');

    expect(receivedProps).not.toBeNull();
    expect(receivedProps!.children).toEqual(['child1', 'child2']);
  });

  it('function receives {count: 5, children: []} when no children passed', () => {
    let receivedProps: Record<string, unknown> | null = null;
    const Counter = (props: Record<string, unknown>) => {
      receivedProps = props;
      return h('span', null, String(props.count));
    };

    const el = h(Counter, { count: 5 }) as HTMLElement;

    expect(receivedProps).not.toBeNull();
    expect(receivedProps!.count).toBe(5);
    expect(receivedProps!.children).toEqual([]);
    expect(el.textContent).toBe('5');
  });

  it('function component returning h("div") works inside mount()', () => {
    const container = document.createElement('div');

    const App = (props: Record<string, unknown>) => {
      return h('div', { class: 'app' }, 'mounted');
    };

    const unmount = mount(() => h(App, null) as HTMLElement, container);

    expect(container.children.length).toBe(1);
    expect(container.children[0]!.tagName).toBe('DIV');
    expect(container.children[0]!.getAttribute('class')).toBe('app');
    expect(container.children[0]!.textContent).toBe('mounted');

    unmount();
  });

  it('function component works inside createList render callback', () => {
    const Item = (props: Record<string, unknown>) => {
      return h('li', null, String(props.label));
    };

    const container = document.createElement('div');
    let frag: DocumentFragment | undefined;

    createRoot(() => {
      const [items] = createSignal([
        { id: 1, label: 'A' },
        { id: 2, label: 'B' },
        { id: 3, label: 'C' },
      ]);

      frag = createList(
        items,
        (item: { id: number; label: string }) => item.id,
        (item: { id: number; label: string }) => h(Item, { label: item.label }) as HTMLElement,
      );
    });

    container.appendChild(frag!);

    // The fragment should have comment markers + 3 list items
    const lis = container.querySelectorAll('li');
    expect(lis.length).toBe(3);
    expect(lis[0]!.textContent).toBe('A');
    expect(lis[1]!.textContent).toBe('B');
    expect(lis[2]!.textContent).toBe('C');
  });

  it('describes a function component lazily, then prepares it once with merged props', () => {
    let calls = 0;
    let receivedProps: Record<string, unknown> | null = null;
    const MyComponent = (props: Record<string, unknown>) => {
      calls++; receivedProps = props;
      return h('div', { class: 'real' }, 'real content');
    };
    const result = withAdoptionDescription(() => h(MyComponent, { value: 42 }, 'child')) as unknown as ComponentDescription;
    expect(calls).toBe(0);
    expect(result.type).toBe('component');
    expect(result.component).toBe(MyComponent);
    expect(result.args).toEqual([{ value: 42, children: ['child'] }]);
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<div class="real">real content</div>';
    const host = doc.body.firstElementChild!, original = host.firstChild;
    const plan = prepareAdoption(host, () => result);
    expect(calls).toBe(1);
    expect(receivedProps).toEqual({ value: 42, children: ['child'] });
    plan.commit(); expect(calls).toBe(1); expect(host.firstChild).toBe(original); plan.dispose();
    const normalResult = h(MyComponent, null) as HTMLElement;
    expect(calls).toBe(2); expect(normalResult).toBeInstanceOf(HTMLDivElement);
    expect(normalResult.textContent).toBe('real content');
  });

  it('nested function components work: h(Outer) where Outer returns h(Inner)', () => {
    const Inner = (props: Record<string, unknown>) => {
      return h('span', { class: 'inner' }, String(props.text ?? 'default'));
    };

    const Outer = (props: Record<string, unknown>) => {
      return h('div', { class: 'outer' },
        h(Inner, { text: 'nested' }),
      );
    };

    const el = h(Outer, null) as HTMLElement;

    expect(el).toBeInstanceOf(HTMLDivElement);
    expect(el.getAttribute('class')).toBe('outer');
    expect(el.children.length).toBe(1);

    const innerEl = el.children[0] as HTMLElement;
    expect(innerEl.tagName).toBe('SPAN');
    expect(innerEl.getAttribute('class')).toBe('inner');
    expect(innerEl.textContent).toBe('nested');
  });
});
