import { h } from '@getforma/core';

interface IconProps {
  d: string;
  size?: number;
  class?: string;
}

export function Icon({ d, size = 18, class: cls = '' }: IconProps) {
  const paths = d.split(/(?= M)/);
  return (
    <svg
      class={`shrink-0 ${cls}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {paths.map(p => <path d={p.trim()} />)}
    </svg>
  );
}
