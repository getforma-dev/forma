import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

let moduleText = '';
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `export { createEffect } from './reactive/effect';
        export { createSignal } from './reactive/signal';
        export { createRoot, registerDisposer, getOwner } from './reactive/root';
        export { onCleanup } from './reactive/cleanup';
        export { onError } from './reactive/dev';
        export { withAdoptionCallbacks } from './reactive/adoption-hooks';`,
      resolveDir: fileURLToPath(new URL('../src', import.meta.url)),
    },
    bundle: true, write: false, format: 'esm', platform: 'browser',
    define: { __FORMA_DEV_BUILD__: 'false' }, logLevel: 'silent',
  });
  moduleText = result.outputFiles[0]!.text;
});

for (const captured of [false, true]) {
  test(`self-disposal drains the active generation in ${captured ? 'captured' : 'ordinary'} context`, async ({ page }) => {
    await page.route('**/effect-self-disposal.mjs', route => route.fulfill({ contentType: 'text/javascript', body: moduleText }));
    await page.route('**/effect-self-disposal.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
    await page.goto('/effect-self-disposal.html');
    const result = await page.evaluate(async captured => {
      const { createEffect, createSignal, createRoot, registerDisposer, onCleanup, onError, getOwner, withAdoptionCallbacks } = await import('/effect-self-disposal.mjs' as string);
      const [value, setValue] = createSignal(0), cleaned: string[] = [], errors: string[] = [];
      let dispose: () => void, calls = 0;
      const off = onError((error: Error) => errors.push(error.message));
      const body = () => {
        calls++;
        if (!value()) return;
        createRoot(() => registerDisposer(() => cleaned.push('child-before')));
        onCleanup(() => { cleaned.push('before'); dispose(); });
        dispose();
        createRoot(() => registerDisposer(() => cleaned.push('child-after')));
        onCleanup(() => cleaned.push('after'));
        throw new Error('after disposal');
      };
      dispose = captured ? withAdoptionCallbacks((fn: () => unknown) => fn(), () => createEffect(body)) : createEffect(body);
      setValue(1); setValue(2); dispose(); off();
      return { calls, cleaned, errors, ownerRestored: getOwner() === null };
    }, captured);
    expect(result).toEqual({ calls: 2, cleaned: ['child-before', 'child-after', 'before', 'after'], errors: ['after disposal'], ownerRestored: true });
  });
  test(`error reporters retain their first cleanup in ${captured ? 'captured' : 'ordinary'} context`, async ({ page }) => {
    await page.route('**/effect-self-disposal.mjs', route => route.fulfill({ contentType: 'text/javascript', body: moduleText }));
    await page.route('**/effect-self-disposal.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
    await page.goto('/effect-self-disposal.html');
    const result = await page.evaluate(async captured => {
      const { createEffect, createSignal, onCleanup, onError, getOwner, withAdoptionCallbacks } = await import('/effect-self-disposal.mjs' as string);
      return ['body', 'reporter', 'later'].map(disposal => {
        const [value, setValue] = createSignal(0), cleaned: string[] = [];
        let dispose: () => void;
        const off = onError(() => {
          onCleanup(() => cleaned.push('reporter'));
          if (disposal === 'reporter') dispose();
        });
        const body = () => {
          if (value() !== 1) return;
          if (disposal === 'body') dispose();
          throw new Error('expected');
        };
        dispose = captured ? withAdoptionCallbacks((fn: () => unknown) => fn(), () => createEffect(body)) : createEffect(body);
        setValue(1);
        const immediate = [...cleaned];
        setValue(2); dispose(); dispose(); off();
        return { disposal, immediate, cleaned, ownerRestored: getOwner() === null };
      });
    }, captured);
    expect(result).toEqual(['body', 'reporter', 'later'].map(disposal => ({
      disposal, immediate: disposal === 'later' ? [] : ['reporter'], cleaned: ['reporter'], ownerRestored: true,
    })));
  });

}
