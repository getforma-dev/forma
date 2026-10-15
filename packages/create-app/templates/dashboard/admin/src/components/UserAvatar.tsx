import { h } from '@getforma/core';

interface UserAvatarProps {
  name: string;
  size?: 'sm' | 'md';
}

export function UserAvatar({ name, size = 'sm' }: UserAvatarProps) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const sizeClass = size === 'sm' ? 'w-6 h-6 text-[10px]' : 'w-8 h-8 text-xs';
  return (
    <div class={`${sizeClass} rounded-full bg-gruvbox-blue/20 text-gruvbox-blue flex items-center justify-center font-medium shrink-0`}>
      {initials}
    </div>
  );
}
