# Historical placeholder helper tests

Archived by FORMA-101 from dependency head 6d995f0 on 2026-10-15.
These tests documented the obsolete exported placeholder generator. Strict-only
3.0 removes that generator; current BUILD-601 through BUILD-606 conformance
cases prove failed pages cannot publish a placeholder instead. This is historical
evidence, not an admitted 3.0 contract.

```ts
  // -------------------------------------------------------------------------
  // Explicit placeholder helper — declared native refusal never uses it
  // -------------------------------------------------------------------------

  it('placeholder IR from the SSR plugin has valid structure', () => {
    // Calls the SHIPPED generatePlaceholderIr. A copy of its body inlined here
    // would keep passing even if the real fallback were gutted.
    const binary = generatePlaceholderIr('test-page');

    // Valid FMIR magic + version
    expect(Array.from(binary.slice(0, 8))).toEqual(Array.from(SIGNATURE));
    expect(readFmirContainer(binary).writer).toEqual(COMPILER_WRITER_VERSION);

    expect(getStrings(binary)).toEqual(['div', 'id', 'app', 'data-forma-page', 'test-page']);
    expect(parseOpcodeList(binary)).toEqual([
      'OPEN_TAG div id="app" data-forma-page="test-page"',
      'CLOSE_TAG div',
    ]);
    expect(getSlots(binary)).toEqual([]);
    expect(getIslands(binary)).toEqual([]);
    assertBinaryInvariants(binary);

    // OPEN_TAG: 1 + 4 + 2 + 2*(4+4) = 23 bytes; CLOSE_TAG: 1 + 4 = 5 bytes.
    expect(readSections(binary).opcodeSize).toBe(23 + 5);
  });

  it('placeholder IR names the page it was generated for', () => {
    // The page name is the only thing that varies between placeholders — it is
    // what the client-side mount keys off.
    const strings = readStringTable(
      generatePlaceholderIr('tenant-dashboard'),
      readSections(generatePlaceholderIr('tenant-dashboard')).stringTableOffset,
    );
    expect(strings).toEqual(['div', 'id', 'app', 'data-forma-page', 'tenant-dashboard']);
  });
```
