import { expect, it } from 'vitest';
import { h } from '../element.js';
import { __createCompiledTemplate } from '../compiled-template.js';
import { trustedHtml } from '../trusted-html.js';
import { createRoot } from '../../reactive/root.js';
import { createSignal } from '../../reactive/signal.js';

it.each(['native', 'compiled'])('probe: %s stops later effects when setup disposal is followed by an expression throw', mode => {
  const [read, write] = createSignal(0);
  const failure = new Error('later expression');
  let calls = 0;
  const later = () => { calls++; return String(read()); };
  const render = __createCompiledTemplate(() => trustedHtml('<div><span></span><span></span></div>'), [[[0], 1], [[1], 1]]);
  expect(() => createRoot(stop => {
    if (mode === 'native') {
      h('span', null, () => { stop(); return 'first'; });
      h('span', null, later);
      throw failure;
    }
    return render(bind => {
      if (!bind) return h('i');
      bind(0, () => { stop(); return 'first'; });
      bind(1, later);
      throw failure;
    });
  })).toThrow(failure);
  expect(calls).toBe(1);
  write(1);
  expect(calls).toBe(1);
});
