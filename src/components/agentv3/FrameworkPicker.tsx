import { useState } from 'react';
import { FRAMEWORK_OPTIONS as FRAMEWORKS, type FrameworkOption } from './frameworkOptions';

export type { FrameworkOption };

const CATEGORY_LABELS: Record<string, string> = {
  frontend: 'Frontend',
  fullstack: 'Full-Stack',
  backend: 'Backend / API',
  static: 'Static',
};

const CATEGORIES = ['frontend', 'fullstack', 'backend', 'static'] as const;

interface Props {
  value: string;
  onChange: (id: string) => void;
}

export function FrameworkPicker({ value, onChange }: Props) {
  const [filter, setFilter] = useState<string>('all');

  const visible = filter === 'all' ? FRAMEWORKS : FRAMEWORKS.filter(f => f.category === filter);
  const selected = FRAMEWORKS.find(f => f.id === value);

  return (
    <div className="space-y-3">
      {/* Category filter chips */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${
            filter === 'all'
              ? 'bg-indigo-600 text-on-accent'
              : 'bg-raised text-muted hover:bg-raised-hover'
          }`}
        >
          All
        </button>
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${
              filter === cat
                ? 'bg-indigo-600 text-on-accent'
                : 'bg-raised text-muted hover:bg-raised-hover'
            }`}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Framework grid */}
      <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
        {visible.map(fw => {
          const isSelected = fw.id === value;
          return (
            <button
              key={fw.id}
              onClick={() => onChange(fw.id)}
              className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all ${
                isSelected
                  ? 'border-indigo-500/60 bg-indigo-600/10'
                  : 'border-line bg-raised hover:border-line hover:bg-raised-hover'
              }`}
            >
              <span className="text-lg leading-none flex-shrink-0">{fw.iconChar}</span>
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-ink truncate">{fw.name}</div>
                <div className="text-[9px] text-faint truncate">{fw.description}</div>
              </div>
              {isSelected && (
                <div className="ml-auto flex-shrink-0 w-2 h-2 rounded-full bg-indigo-400" />
              )}
            </button>
          );
        })}
      </div>

      {/* Selected summary */}
      {selected && (
        <div className="flex items-center gap-2 px-3 py-2 bg-raised rounded-lg border border-line">
          <span className="text-base">{selected.iconChar}</span>
          <div>
            <span className="text-[11px] font-bold text-ink">{selected.name}</span>
            <span className="text-[10px] text-muted ml-2">{selected.language}</span>
          </div>
          <span className={`ml-auto text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
            selected.category === 'frontend' ? 'bg-blue-500/20 text-info' :
            selected.category === 'fullstack' ? 'bg-purple-500/20 text-accent-text' :
            selected.category === 'backend' ? 'bg-green-500/20 text-success' :
            'bg-orange-500/20 text-warn'
          }`}>
            {CATEGORY_LABELS[selected.category]}
          </span>
        </div>
      )}
    </div>
  );
}

export { FRAMEWORKS };
