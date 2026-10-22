import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, firefox, webkit, type Browser } from '@playwright/test';
import { renderBothReports } from '../src/render-both.mts';

// Force load activation to span more timer turns than one idle callback and two
// frames. The real runtime still chooses its batches and performs every adoption.
function delayedTimers(browser: Browser, seedLateWrite: boolean): Browser {
  return new Proxy(browser, {
    get(target, key, receiver) {
      if (key !== 'newPage') return Reflect.get(target, key, receiver);
      return async () => {
        const page = await target.newPage();
        await page.addInitScript((seed: boolean) => {
          const schedule = window.setTimeout.bind(window);
          let injected = false;
          window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
            if (typeof callback !== 'function') return schedule(callback, delay, ...args);
            return schedule(() => {
              callback(...args);
              const hosts = [...document.querySelectorAll('[data-forma-island]')];
              if (seed && !injected && hosts.length === 32 && hosts.every(host =>
                typeof (host as Element & { __formaDispose?: unknown }).__formaDispose === 'function')) {
                injected = true;
                hosts[31]!.setAttribute('data-seeded-late-write', 'caught');
              }
            }, Math.max(delay ?? 0, 50));
          }) as typeof window.setTimeout;
        }, seedLateWrite);
        return page;
      };
    },
  });
}

const engine = process.env.FORMA_PARITY_BROWSER ?? 'chromium';
assert.ok(engine === 'chromium' || engine === 'firefox' || engine === 'webkit', `unknown engine ${engine}`);
const type = { chromium, firefox, webkit }[engine];

test(`${engine}: P2 awaits all 32 yielded load islands and observes the final batch`, async () => {
  const browser = await type.launch({ headless: true });
  try {
    for (const seedLateWrite of [false, true]) {
      const reports = await renderBothReports({
        module: 'rows', index: 9, seed: 'forma-183', engine,
        browser: delayedTimers(browser, seedLateWrite),
      });
      const p2 = reports.find(report => report.check === 'P2')!;
      assert.deepEqual(p2.activation, { hosts: 32, activated: 32 }, p2.error);
      if (seedLateWrite) {
        assert.equal(p2.verdict, 'different');
        assert.ok(p2.differences.some(d => d.kind === 'mutation' &&
          d.path.endsWith('[data-seeded-late-write]')), JSON.stringify(p2.differences));
      } else {
        assert.equal(p2.verdict, 'equal', JSON.stringify(p2.differences));
        assert.equal(reports.find(report => report.check === 'P1')!.verdict, 'equal');
      }
    }
  } finally {
    await browser.close();
  }
});
