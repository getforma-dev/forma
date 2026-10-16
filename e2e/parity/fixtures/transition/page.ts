import { h } from '@getforma/core';
import { Panel } from './island';

export function Page(p: { title: string; count: number; note?: string }) {
  return h('main', { id: 'transition' }, Panel({ title: p.title, count: p.count, note: p.note }));
}
