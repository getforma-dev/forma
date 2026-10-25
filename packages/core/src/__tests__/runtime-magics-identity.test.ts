import { mountFixture, unmountFixture } from './runtime-fixture';
/**
 * `$el` and `$dispatch` are made on their first read (FORMA-273 follow-up):
 * each element still has exactly one of each, kept for every later read.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as runtime from '../runtime';

describe('per-element magics keep one identity per element', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    runtime.clearDiagnostics();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    unmountFixture(container);
    container.remove();
    runtime.clearDiagnostics();
  });

  it('every read of $el and of $dispatch on one element is the same host', () => {
    container.innerHTML = `<div data-forma-state='{}'>
      <p id="el" data-text="{$el === $el}"></p>
      <p id="dispatch" data-text="{$dispatch === $dispatch}"></p>
    </div>`;
    mountFixture(container);
    expect(container.querySelector('#el')!.textContent).toBe('true');
    expect(container.querySelector('#dispatch')!.textContent).toBe('true');
    expect(runtime.getDiagnostics()).toEqual([]);
  });

  it('two elements do not share a host', () => {
    container.innerHTML = `<div data-forma-state='{"first": null}'>
      <p id="a" data-on:go="{first = $el}"></p>
      <p id="b" data-on:go="{first = first === $el ? 'same' : 'different'}" data-text="{first}"></p>
    </div>`;
    mountFixture(container);
    container.querySelector('#a')!.dispatchEvent(new Event('go'));
    container.querySelector('#b')!.dispatchEvent(new Event('go'));
    expect(container.querySelector('#b')!.textContent).toBe('different');
  });
});
