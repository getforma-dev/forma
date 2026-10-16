# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: fixtures/apps/apps.spec.ts >> fixture application fauth >> /t/:slug/login: adoption writes nothing, every island keeps its server values, and then the islands work
- Location: e2e/fixtures/apps/apps.spec.ts:140:13

# Error details

```
AssertionError: /t/:slug/login: browser error
+ actual - expected

+ [
+   "The Content Security Policy 'require-trusted-types-for 'script'; trusted-types forma forma-runtime' was delivered in report-only mode, but does not specify a 'report-to'; the policy will have no effect. Please either add a 'report-to' directive, or deliver the policy via the 'Content-Security-Policy' header."
+ ]
- []

```

# Test source

```ts
  139 |       };
  140 |     });
  141 |     assert.deepEqual(adoption.mutations, [], `${route}: successful adoption wrote to the DOM`);
  142 |     assert.equal(adoption.sameNodes, true, `${route}: activation replaced original nodes`);
  143 |     for (const { selector, text } of expected.serverValues ?? []) assert.equal(await textOf(page, selector), text, `${route}: ${selector} after activation`);
  144 | 
  145 |     // The positive control: the same observer sees a deliberate write, so an empty record
  146 |     // list above means no write happened, not that the observer was never watching.
  147 |     const control = await page.evaluate(() => {
  148 |       const check = globalThis.__fixtureAdoption;
  149 |       document.body.setAttribute('data-fixture-control', '1');
  150 |       const seen = check.observer.takeRecords().length;
  151 |       document.body.removeAttribute('data-fixture-control');
  152 |       check.observer.takeRecords();
  153 |       return seen;
  154 |     });
  155 |     assert.equal(control, 1, `${route}: the mutation observer did not see a deliberate write`);
  156 | 
  157 |     // Now the activation-time requests may complete, and the page's own writes begin.
  158 |     await page.evaluate(() => globalThis.__fixtureAdoption.observer.disconnect());
  159 |     openRequests();
  160 |     const interacted = interact ? await interact(page) : undefined;
  161 |     assert.equal(await page.locator('[data-forma-status="error"]').count(), 0, `${route}: an island ended in error`);
  162 |     const violations = await page.evaluate(() => globalThis.__fixtureViolations);
  163 |     assert.deepEqual(violations, [], `${route}: CSP violation`);
  164 |     assert.deepEqual(observed.errors, [], `${route}: browser error`);
  165 |     return { route, served, hosts: before.hosts, nodes: before.nodes, mutations: adoption.mutations.length, interacted };
  166 |   } finally { open(); openRequests(); await context.close(); }
  167 | }
  168 | 
      |            ^ AssertionError: /t/:slug/login: browser error
```