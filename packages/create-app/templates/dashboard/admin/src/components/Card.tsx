import { h } from '@getforma/core';

export function Card(props: { title: string; children: unknown }) {
  return (
    <div class="card">
      <div class="card-label">{props.title}</div>
      <div class="card-value">{...(Array.isArray(props.children) ? props.children : [props.children])}</div>
    </div>
  );
}
