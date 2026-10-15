import { h, createSignal, createList, createShow } from '@getforma/core';

export interface Props {
  title: string;
  user: { displayName: string; active: boolean };
  rows: { id: number; detail: { label: string }; enabled: boolean }[];
  mode: 'ready' | 'offline';
  flash?: string;
  nullable: string | null;
  at: Date;
  safeCount: number;
  optionalRows: (string | null)[];
}

export function Page(props: Props) {
  const [first] = createSignal(props.title);
  const [second] = createSignal(props.title);
  const [local] = createSignal('local-only');
  return h('main', { 'data-mode': props.mode },
    h('h1', null, first()), h('h2', null, second()),
    h('span', null, local()), h('p', null, props.user.displayName),
    h('p', null, props.flash), h('p', null, props.nullable),
    h('p', null, props.safeCount),
    createShow(() => props.user.active, () => props.title),
    props.user.active ? props.title : 'hidden',
    createList(() => props.rows, row => row.id, row => h('label', { 'data-enabled': row.enabled }, row.detail.label)),
    createList(() => props.rows, row => row.id, row => h('b', null, row.id)));
}
