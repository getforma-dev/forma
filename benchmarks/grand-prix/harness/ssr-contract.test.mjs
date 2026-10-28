import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../contestants/vanilla-node/src/page.vanilla.mjs';
import { assertSSRPage } from './ssr-contract.mjs';
import { captureResponse, validateResponse, requestHeaders } from './transport.mjs';

function middle(html, change) { return html.replace(/<tr data-id="50">[\s\S]*?<\/tr>/, change); }
function validate(html) {
  const body = Buffer.from(html), response = captureResponse(100, { status: 200, body, headers: {}, rawHeaders: [] }, requestHeaders());
  assert.equal(response.semanticValidation, 'laboratory-1-rows-v1');
  validateResponse(response);
  assert.equal(response.bodyBase64, body.toString('base64'), 'semantic checks never rewrite retained bytes');
}
for (const n of [10,100,1000]) test(`canonical ${n}-row table validates`, () => {
  assert.deepEqual(assertSSRPage(n, renderPage(n)), { rowCount: n, contract: 'laboratory-1-rows-v1' });
});
test('framework marker comments, extra attributes, span text, whitespace and equivalent entities are accepted', () => {
  const html = renderPage(100).replace('data-id="1"', 'data-forma-key="1" data-id="&#49;"')
    .replace('<td>1</td>', '<td>\n<!--text-->&#x31;<!---->\n</td>')
    .replace(/\$/g, '&#36;').replace('handsome red table', '<!--start-->handsome red table<!--end-->');
  validate(html);
});
for (const [label, change] of [
  ['wrong middle label with totals preserved', html => middle(html, row => row.replace(/<td>([^<]+)<\/td><td>([^<]+)<\/td>/, '<td>$1</td><td>invented label</td>'))],
  ['wrong middle amount', html => middle(html, row => row.replace(/\$[0-9,.]+/, '$0.00'))],
  ['wrong middle owner', html => middle(html, row => row.replace('<td>maya</td>', '<td>ops</td>'))],
  ['duplicate middle ID with unchanged row count', html => middle(html, row => row.replace('data-id="50"', 'data-id="49"'))],
  ['ID concealed by a duplicate HTML attribute', html => middle(html, row => row.replace('data-id="50"', 'data-id="50" data-id="49"'))],
  ['wrong middle ID cell', html => middle(html, row => row.replace('<td>50</td>', '<td>49</td>'))],
  ['missing middle data attribute', html => middle(html, row => row.replace(' data-id="50"', ''))],
  ['hidden middle row', html => middle(html, row => row.replace('<tr ', '<tr hidden '))],
  ['hidden middle cell', html => middle(html, row => row.replace('<td>', '<td style="display: none">'))],
  ['comment masquerading as a middle row', html => middle(html, row => `<!--${row}-->`)],
  ['script masquerading as a middle row', html => middle(html, row => `<script>${row}</script>`)],
  ['textarea masquerading as a middle row', html => middle(html, row => `<textarea>${row}</textarea>`)],
  ['inert template masquerading as a middle row', html => middle(html, row => `<template>${row}</template>`)],
  ['hidden ancestor around an otherwise complete table', html => html.replace('<table ', '<div hidden><table ').replace('</table>', '</table></div>')],
  ['all duplicate ID rows retain the old substring/count check', html => html.replace(/data-id="\d+"/g, 'data-id="1"')],
]) test(`${label} fails before timing`, () => assert.throws(() => validate(change(renderPage(100))), /SSR|duplicate/));
