import { expect, it } from 'vitest';
import { effect, getActiveSub, signal } from 'alien-signals';

it('the pinned engine clears Pending at callback entry and marks self-writes', () => {
  const source = signal(0), entries: number[] = [], selfWrites: number[] = [];
  const dispose = effect(() => {
    const node = getActiveSub()!;
    entries.push(node.flags & 32);
    if (source() === 1) {
      source(2);
      selfWrites.push(node.flags & 32);
    }
  });
  source(1);
  dispose();
  expect(entries).toEqual([0, 0]);
  expect(selfWrites).toEqual([32]);
});
