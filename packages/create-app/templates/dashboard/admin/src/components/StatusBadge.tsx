import { h } from '@getforma/core';

const STATUS_CLASSES: Record<string, string> = {
  success:    'bg-gruvbox-green/20 text-gruvbox-green',
  healthy:    'bg-gruvbox-green/20 text-gruvbox-green',
  online:     'bg-gruvbox-green/20 text-gruvbox-green',
  active:     'bg-gruvbox-green/20 text-gruvbox-green',
  failed:     'bg-gruvbox-red/20 text-gruvbox-red',
  down:       'bg-gruvbox-red/20 text-gruvbox-red',
  offline:    'bg-gruvbox-red/20 text-gruvbox-red',
  critical:   'bg-gruvbox-red/20 text-gruvbox-red',
  rolling:    'bg-gruvbox-yellow/20 text-gruvbox-yellow',
  degraded:   'bg-gruvbox-yellow/20 text-gruvbox-yellow',
  warning:    'bg-gruvbox-yellow/20 text-gruvbox-yellow',
  investigating: 'bg-gruvbox-yellow/20 text-gruvbox-yellow',
  cancelled:  'bg-gruvbox-gray/20 text-gruvbox-gray',
  pending:    'bg-gruvbox-gray/20 text-gruvbox-gray',
  monitoring: 'bg-gruvbox-blue/20 text-gruvbox-blue',
  resolved:   'bg-gruvbox-blue/20 text-gruvbox-blue',
  info:       'bg-gruvbox-blue/20 text-gruvbox-blue',
  high:       'bg-gruvbox-orange/20 text-gruvbox-orange',
  medium:     'bg-gruvbox-purple/20 text-gruvbox-purple',
  low:        'bg-gruvbox-gray/20 text-gruvbox-gray',
};

interface StatusBadgeProps {
  status: string;
  dot?: boolean;
}

export function StatusBadge({ status, dot = false }: StatusBadgeProps) {
  const key = status.toLowerCase();
  const cls = STATUS_CLASSES[key] || 'bg-gruvbox-gray/20 text-gruvbox-gray';
  return (
    <span class={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium tracking-wide ${cls}`}>
      {dot && <span class={`inline-block w-1.5 h-1.5 rounded-full bg-current`} />}
      {status}
    </span>
  );
}
