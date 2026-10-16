import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { SSR_ORIGIN } from './origin';

test('actual native policies enforce and deliver a blocked local image report', async ({ page }) => {
  let imageRequests = 0;
  const imageServer = createServer((_req, res) => { imageRequests++; res.writeHead(204); res.end(); });
  await new Promise<void>((resolve) => imageServer.listen(0, '127.0.0.1', resolve));
  const address = imageServer.address();
  if (!address || typeof address === 'string') throw new Error('missing local image receiver');
  const blocked = `http://127.0.0.1:${address.port}/blocked-image`;
  const path = `/__csp-control/${randomUUID()}`;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    // Prove the second origin is reachable, then require CSP to prevent the
    // browser from sending it a request. No external host is contacted.
    expect((await fetch(blocked)).status).toBe(204);
    expect(imageRequests).toBe(1);
    imageRequests = 0;
    const before = await fetch(`${SSR_ORIGIN}/__csp-reports`).then(r => r.json());
    await page.addInitScript(() => {
      (window as any).__cspViolations = [];
      document.addEventListener('securitypolicyviolation', event => {
        (window as any).__cspViolations.push({ directive: event.effectiveDirective, disposition: event.disposition, blocked: event.blockedURI });
      });
    });
    const response = await page.goto(`${SSR_ORIGIN}${path}`);
    const headers = await response!.allHeaders();
    for (const name of ['content-security-policy', 'content-security-policy-report-only']) {
      expect(headers[name]).toContain("require-trusted-types-for 'script'");
      expect(headers[name]).toContain('trusted-types forma forma-runtime');
      expect(headers[name]).toContain('report-uri /__csp-reports');
      expect(headers[name]).not.toMatch(/(?:^|;)\s*report-to\s/);
    }
    expect(await page.evaluate(() => (window as any).__cspViolations)).toEqual([]);
    await page.evaluate(url => new Promise<void>(resolve => {
      const image = new Image();
      image.onerror = () => resolve();
      image.onload = () => resolve();
      image.src = url;
      document.body.append(image);
    }), blocked);
    await expect.poll(() => page.evaluate(() => (window as any).__cspViolations)).toEqual([
      { directive: 'img-src', disposition: 'enforce', blocked },
    ]);
    await expect.poll(async () => {
      const result = await fetch(`${SSR_ORIGIN}/__csp-reports?after=${before.cursor}`).then(r => r.json());
      return result.reports.filter((report: { document: string }) => report.document === path);
    }, { timeout: 5_000, message: 'actual HTTP report delivered by this browser' }).toEqual([
      { document: path, directive: 'img-src', disposition: 'enforce' },
    ]);
    expect(imageRequests, 'enforced policy prevented all outbound image requests').toBe(0);
    expect(errors).toEqual([]);
  } finally { imageServer.closeAllConnections(); await new Promise<void>(resolve => imageServer.close(() => resolve())); }
});
