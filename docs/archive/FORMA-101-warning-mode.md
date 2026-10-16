# Historical warning-only build expectation

Preserved verbatim from dependency head 6d995f0. FORMA-101 replaces this A2
publication mode with unconditional refusal; strict-only.test.ts proves default,
false and true modes all fail with complete source diagnostics and retain the
last published product.

```ts
  it('without --strict the same build succeeds, prints its lines as before, and returns the diagnostics', async () => {
    const entries = twoBrokenPages();
    const result = await build(config(entries));
    expect(existsSync(join(outDir, 'manifest.json'))).toBe(true);
    expect(result.diagnostics.map((d) => [d.page, d.code, d.severity])).toEqual([
      ['home', 'BUILD-206', 'warning'],
      ['about', 'BUILD-207', 'warning'],
    ]);
    // One line each, in the 0.3.6 shape plus the code and the position (the
    // pages compile in parallel, so the lines come in either order).
    const irLines = warnings.filter((w) => w.includes('IR: '));
    expect(irLines).toHaveLength(2);
    expect(irLines.find((line) => line.includes('home.ts'))).toMatch(
      /^ {3}IR: BUILD-206 .*home\.ts:3:\d+/s,
    );
  }, 30_000);

```
