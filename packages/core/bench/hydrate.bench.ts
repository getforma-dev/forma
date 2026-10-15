/**
 * Hydration: adopting a server-rendered tree instead of re-creating it.
 *
 * Adoption is the claim that costs the most if it is wrong — the whole reason
 * to ship SSR markup plus a runtime is that taking ownership of existing DOM is
 * cheaper than building it. Every benchmark here is therefore paired with the
 * client-side-render cost of the same tree.
 *
 * Strict preparation validates exact paired native markers and matching values
 * on connected original DOM. A refusal never repairs the fixture. The guards
 * below prove identity, zero initial writes and later liveness before timing.
 * Connected setup/removal is part of each measured parse/adopt cycle; archived
 * detached, repairing-hydrator timings are not directly comparable.
 */

import { bench, describe } from 'vitest';
import { createSignal, createRoot, onError } from 'forma/reactive';
import { h, hydrateIsland } from 'forma/dom';
import { createList } from 'forma/dom';
import {
  HEAVY,
  MACRO,
  detachedContainer,
  makeRows,
  type Row,
} from './_support';

// ---------------------------------------------------------------------------
// Fixture: a realistic page, and the component that adopts it
// ---------------------------------------------------------------------------

/**
 * Markup shaped like what the walker emits: nested sections, static attributes,
 * URL attributes, and `f:tN` text markers interleaved with static content.
 */
function pageMarkup(sections: number, slotsPerSection: number): string {
  const parts: string[] = ['<div class="page" data-page="1">'];
  let slot = 0;
  for (let s = 0; s < sections; s++) {
    parts.push(`<section class="card" data-index="${s}">`);
    parts.push(`<h2 class="card-title">Section ${s}</h2>`);
    for (let i = 0; i < slotsPerSection; i++) {
      parts.push(
        `<p class="row"><span class="label">Field ${i}</span>` +
        `<!--f:t${slot}-->value ${slot}<!--/f:t${slot}--></p>`,
      );
      slot++;
    }
    parts.push('<footer class="card-foot"><a class="more" href="/more">More</a></footer>');
    parts.push('</section>');
  }
  parts.push('</div>');
  return parts.join('');
}

/** The component whose descriptor tree matches `pageMarkup` node for node. */
function pageComponent(sections: number, slotsPerSection: number, value: () => number) {
  return (): unknown => {
    const kids: unknown[] = [];
    for (let s = 0; s < sections; s++) {
      const rows: unknown[] = [
        h('h2', { class: 'card-title' }, `Section ${s}`),
      ];
      for (let i = 0; i < slotsPerSection; i++) {
        const slot = s * slotsPerSection + i;
        rows.push(
          h('p', { class: 'row' },
            h('span', { class: 'label' }, `Field ${i}`),
            () => `value ${slot + value()}`,
          ),
        );
      }
      rows.push(
        h('footer', { class: 'card-foot' }, h('a', { class: 'more', href: '/more' }, 'More')),
      );
      kids.push(h('section', { class: 'card', 'data-index': String(s) }, ...rows));
    }
    return h('div', { class: 'page', 'data-page': '1' }, ...kids);
  };
}

function ssrHost(markup: string): HTMLElement {
  const host = detachedContainer(markup);
  host.setAttribute('data-forma-ssr', '');
  document.body.appendChild(host);
  return host;
}

function guardAdoption(build: () => unknown, host: HTMLElement): void {
  const errors: unknown[] = [], stop = onError(error => errors.push(error));
  const before = host.outerHTML, observer = new MutationObserver(() => {});
  observer.observe(host, { subtree: true, attributes: true, childList: true, characterData: true });
  try {
    hydrateIsland(build, host);
    if (errors.length || host.outerHTML !== before || observer.takeRecords().length) {
      throw new Error('Benchmark fixture failed strict zero-write adoption', { cause: errors[0] });
    }
  } finally { stop(); observer.disconnect(); }
}

// ---------------------------------------------------------------------------
// Adoption over a realistic SSR tree
// ---------------------------------------------------------------------------

describe('hydration: adopt an SSR page', () => {
  // 20 sections × 5 slots = 100 reactive text bindings, ~380 elements,
  // 200 comment markers — a page, not a widget.
  const SHAPES = [
    { sections: 5, slots: 4, label: '5 sections × 4 slots (20 bindings)' },
    { sections: 20, slots: 5, label: '20 sections × 5 slots (100 bindings)' },
    { sections: 60, slots: 8, label: '60 sections × 8 slots (480 bindings)' },
  ] as const;

  for (const { sections, slots, label } of SHAPES) {
    const markup = pageMarkup(sections, slots);
    const preset = sections >= 60 ? HEAVY : MACRO;

    // Prove the fixture hydrates rather than rebuilds, once, outside the
    // measured region: the SSR <h2> must survive by identity, and the reactive
    // slot must be live afterwards.
    createRoot((dispose) => {
      const host = ssrHost(markup);
      const before = host.querySelector('h2')!;
      const [n, setN] = createSignal(0);
      guardAdoption(pageComponent(sections, slots, n), host);
      if (host.querySelector('h2') !== before) {
        throw new Error(`${label}: adoption replaced the SSR node instead of adopting it`);
      }
      setN(2);
      if (!host.querySelector('p.row')!.textContent!.includes('value 2')) {
        throw new Error(`${label}: adopted binding is not live`);
      }
      dispose();
      host.remove();
    });

    bench(`${label}: parse markup only (control)`, () => {
      ssrHost(markup).remove();
    }, preset);

    bench(`${label}: parse + hydrateIsland (adopt)`, () => {
      createRoot((dispose) => {
        const host = ssrHost(markup);
        const [n] = createSignal(0);
        hydrateIsland(pageComponent(sections, slots, n), host);
        dispose();
        host.remove();
      });
    }, preset);

    bench(`${label}: client-side render, no SSR markup (comparison)`, () => {
      createRoot((dispose) => {
        const host = detachedContainer();
        const [n] = createSignal(0);
        host.appendChild(pageComponent(sections, slots, n)() as Node);
        dispose();
        host.remove();
      });
    }, preset);
  }
});

// ---------------------------------------------------------------------------
// List adoption — data-forma-key matching
// ---------------------------------------------------------------------------

/**
 * A server-rendered keyed list region: `<!--f:l0-->` … `<!--/f:l0-->` with one
 * `data-forma-key` row per item. Strict preparation requires the initial key
 * order to match and retains those exact rows for later reconciliation.
 */
function listMarkup(rows: Row[]): string {
  const parts: string[] = ['<ul class="todos"><!--f:l0-->'];
  for (const row of rows) {
    parts.push(`<li data-forma-key="${row.id}" class="todo">${row.label}</li>`);
  }
  parts.push('<!--/f:l0--></ul>');
  return parts.join('');
}

const key = (r: Row): number => r.id;
const renderRow = (r: Row): HTMLElement =>
  h('li', { class: 'todo', 'data-forma-key': String(r.id) }, r.label);

describe('hydration: adopt an SSR keyed list', () => {
  for (const [n, preset] of [[100, MACRO], [1000, HEAVY]] as const) {
    const rows = makeRows(n);
    const markup = listMarkup(rows);

    // Same guard as above: the first SSR <li> must be the same node afterwards.
    createRoot((dispose) => {
      const host = ssrHost(markup);
      const before = host.querySelector('li')!;
      const [items, setItems] = createSignal(rows);
      guardAdoption(
        () => h('ul', { class: 'todos' }, createList(items, key, renderRow)),
        host,
      );
      if (host.querySelector('li') !== before) {
        throw new Error(`${n}-row list: adoption replaced the SSR rows instead of adopting them`);
      }
      setItems(rows.slice(1));
      if (host.contains(before) || host.querySelectorAll('li').length !== n - 1) {
        throw new Error(`${n}-row list: adopted reconciliation is not live`);
      }
      dispose();
      host.remove();
    });

    bench(`${n} rows: parse markup only (control)`, () => {
      ssrHost(markup).remove();
    }, preset);

    bench(`${n} rows: parse + adopt by data-forma-key`, () => {
      createRoot((dispose) => {
        const host = ssrHost(markup);
        const [items] = createSignal(rows);
        hydrateIsland(
          () => h('ul', { class: 'todos' }, createList(items, key, renderRow)),
          host,
        );
        dispose();
        host.remove();
      });
    }, preset);

    bench(`${n} rows: client-side createList, no SSR markup (comparison)`, () => {
      createRoot((dispose) => {
        const parent = detachedContainer();
        const [items] = createSignal(rows);
        parent.appendChild(createList(items, key, renderRow));
        dispose();
      });
    }, preset);
  }
});
