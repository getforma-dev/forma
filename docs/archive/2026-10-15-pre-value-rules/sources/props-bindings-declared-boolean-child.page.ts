import { h, createShow } from '@getforma/core'; export function Page(p: { ok: boolean; title: string }) {
      return h('main', null, createShow(() => p.ok, () => p.title), p.ok ? p.title : 'hidden', () => p.ok ? p.title : 'hidden', p.ok);
    }