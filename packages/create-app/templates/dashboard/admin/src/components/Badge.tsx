import { h } from '@getforma/core';

export function Badge(props: { status: string }) {
  return <span class={`badge badge-${props.status.toLowerCase()}`}>{props.status}</span>;
}
