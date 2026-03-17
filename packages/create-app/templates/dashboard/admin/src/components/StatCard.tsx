import { h } from '@getforma/core';
import { Icon } from './Icon';
import { ICON_ARROW_UP, ICON_ARROW_DOWN } from './icons';

interface StatCardProps {
  label: string;
  value: string;
  change?: number;
  trend?: string;
  index?: number;
}

export function StatCard({ label, value, change, trend, index = 0 }: StatCardProps) {
  const trendColor = trend === 'up' || (change && change > 0)
    ? 'text-gruvbox-green'
    : trend === 'down' || (change && change < 0)
      ? 'text-gruvbox-red'
      : 'text-gruvbox-gray';
  return (
    <div
      class="bg-gruvbox-bg-soft border border-gruvbox-border rounded-lg p-5 animate-fade-in transition-all duration-150 hover:border-gruvbox-gray/50"
      style={`animation-delay: ${index * 80}ms`}
    >
      <div class="text-xs font-medium text-gruvbox-gray tracking-wide uppercase mb-2">{label}</div>
      <div class="font-mono text-3xl font-semibold text-gruvbox-blue mb-1">{value}</div>
      {change !== undefined && (
        <div class={`flex items-center gap-1 text-xs font-medium ${trendColor}`}>
          <Icon d={change >= 0 ? ICON_ARROW_UP : ICON_ARROW_DOWN} size={14} />
          <span>{Math.abs(change).toFixed(1)}%</span>
        </div>
      )}
    </div>
  );
}
