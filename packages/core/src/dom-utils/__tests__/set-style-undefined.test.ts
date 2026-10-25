import { describe, expect, it } from 'vitest';
import { setStyle } from '../mutate';

describe('setStyle undefined cssText', () => {
  it('preserves every existing declaration when cssText is undefined', () => {
    const el = document.createElement('div');
    el.style.setProperty('color', 'red', 'important');
    el.style.opacity = '0.5';
    const before = el.getAttribute('style');

    setStyle(el, { cssText: undefined });

    expect(el.getAttribute('style')).toBe(before);
    expect(el.style.color).toBe('red');
    expect(el.style.getPropertyPriority('color')).toBe('important');
    expect(el.style.opacity).toBe('0.5');
  });
});
