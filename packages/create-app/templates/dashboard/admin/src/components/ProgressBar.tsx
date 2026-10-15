import { h } from '@getforma/core';

interface ProgressBarProps {
  label: string;
  value: number;
  max?: number;
}

export function ProgressBar({ label, value, max = 100 }: ProgressBarProps) {
  const pct = Math.min((value / max) * 100, 100);
  const color = pct > 90 ? 'bg-gruvbox-red' : pct > 70 ? 'bg-gruvbox-yellow' : 'bg-gruvbox-green';
  return (
    <div class="space-y-1">
      <div class="flex items-center justify-between text-xs">
        <span class="text-gruvbox-gray font-medium">{label}</span>
        <span class="text-gruvbox-fg font-mono">{value.toFixed(0)}%</span>
      </div>
      <div class="h-1.5 rounded-full bg-gruvbox-bg overflow-hidden">
        <div class={`h-full rounded-full ${color} transition-all duration-300`} style={`width: ${pct}%`} />
      </div>
    </div>
  );
}
