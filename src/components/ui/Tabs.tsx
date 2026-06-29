// P-DESIGN.1 — Tabs primitive: a controlled pill-style tab row. Accessible (role=tablist/tab,
// aria-selected). Keeps state in the parent (value + onChange) so it composes anywhere.

import React from 'react';
import { cn } from '../../lib/utils';

export interface TabItem {
  value: string;
  label: React.ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function Tabs({ items, value, onChange, className }: TabsProps) {
  return (
    <div role="tablist" className={cn('inline-flex items-center gap-1', className)}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'px-3 py-1 rounded-lg text-xs font-semibold border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60',
              active
                ? 'bg-zinc-800 text-white border-zinc-600'
                : 'bg-transparent text-[#8b949e] border-transparent hover:text-white hover:bg-white/5',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export default Tabs;
