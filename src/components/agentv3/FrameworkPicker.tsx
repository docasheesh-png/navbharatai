import React, { useState } from 'react';

export interface FrameworkOption {
  id: string;
  name: string;
  description: string;
  category: 'frontend' | 'fullstack' | 'backend' | 'static';
  language: string;
  color: string;
  iconChar: string;
}

const FRAMEWORKS: FrameworkOption[] = [
  // React ecosystem
  { id: 'vite-react', name: 'React + Vite', description: 'Fast SPA, React 18', category: 'frontend', language: 'TypeScript', color: '#61DAFB', iconChar: '⚛' },
  { id: 'nextjs', name: 'Next.js', description: 'SSR + App Router', category: 'fullstack', language: 'TypeScript', color: '#ffffff', iconChar: '▲' },
  { id: 'remix', name: 'Remix', description: 'Full-stack, Web standards', category: 'fullstack', language: 'TypeScript', color: '#5B9CF6', iconChar: '💿' },
  // Vue
  { id: 'vue', name: 'Vue 3 + Vite', description: 'Composition API', category: 'frontend', language: 'TypeScript', color: '#42B883', iconChar: '🟢' },
  { id: 'nuxt', name: 'Nuxt 3', description: 'Vue + SSR + auto-imports', category: 'fullstack', language: 'TypeScript', color: '#00DC82', iconChar: '🟩' },
  // Svelte
  { id: 'svelte', name: 'Svelte + Vite', description: 'Compile-time, no vdom', category: 'frontend', language: 'TypeScript', color: '#FF3E00', iconChar: '🔥' },
  { id: 'sveltekit', name: 'SvelteKit', description: 'Full-stack Svelte', category: 'fullstack', language: 'TypeScript', color: '#FF3E00', iconChar: '⚡' },
  // Other frontend
  { id: 'angular', name: 'Angular', description: 'Enterprise, Google', category: 'frontend', language: 'TypeScript', color: '#DD0031', iconChar: '🔴' },
  { id: 'astro', name: 'Astro', description: 'Content-first, 0 JS', category: 'frontend', language: 'TypeScript', color: '#FF5D01', iconChar: '🚀' },
  { id: 'vanilla', name: 'Vanilla TS', description: 'No framework, pure control', category: 'frontend', language: 'TypeScript', color: '#3178C6', iconChar: '📄' },
  // Node backends
  { id: 'node-express', name: 'Express.js', description: 'Minimal Node HTTP', category: 'backend', language: 'TypeScript', color: '#68A063', iconChar: '🚂' },
  { id: 'nestjs', name: 'NestJS', description: 'Enterprise Node + DI', category: 'backend', language: 'TypeScript', color: '#E0234E', iconChar: '🐈' },
  { id: 'fastify', name: 'Fastify', description: 'High-performance Node', category: 'backend', language: 'TypeScript', color: '#ffffff', iconChar: '⚡' },
  // Python
  { id: 'python-fastapi', name: 'FastAPI', description: 'Async Python + OpenAPI', category: 'backend', language: 'Python', color: '#009688', iconChar: '🐍' },
  { id: 'django', name: 'Django', description: 'Batteries-included ORM', category: 'fullstack', language: 'Python', color: '#44B78B', iconChar: '🎸' },
  { id: 'flask', name: 'Flask', description: 'Lightweight micro-framework', category: 'backend', language: 'Python', color: '#ffffff', iconChar: '🌶' },
  // Static
  { id: 'static', name: 'Static HTML', description: 'Plain HTML/CSS/JS, no build', category: 'static', language: 'JavaScript', color: '#E34F26', iconChar: '🌐' },
];

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
              ? 'bg-indigo-600 text-white'
              : 'bg-white/5 text-[#8b949e] hover:bg-white/10'
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
                ? 'bg-indigo-600 text-white'
                : 'bg-white/5 text-[#8b949e] hover:bg-white/10'
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
                  : 'border-white/5 bg-white/[0.03] hover:border-white/10 hover:bg-white/[0.06]'
              }`}
            >
              <span className="text-lg leading-none flex-shrink-0">{fw.iconChar}</span>
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-white truncate">{fw.name}</div>
                <div className="text-[9px] text-[#484f58] truncate">{fw.description}</div>
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
        <div className="flex items-center gap-2 px-3 py-2 bg-white/[0.03] rounded-lg border border-white/5">
          <span className="text-base">{selected.iconChar}</span>
          <div>
            <span className="text-[11px] font-bold text-white">{selected.name}</span>
            <span className="text-[10px] text-[#8b949e] ml-2">{selected.language}</span>
          </div>
          <span className={`ml-auto text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
            selected.category === 'frontend' ? 'bg-blue-500/20 text-blue-400' :
            selected.category === 'fullstack' ? 'bg-purple-500/20 text-purple-400' :
            selected.category === 'backend' ? 'bg-green-500/20 text-green-400' :
            'bg-orange-500/20 text-orange-400'
          }`}>
            {CATEGORY_LABELS[selected.category]}
          </span>
        </div>
      )}
    </div>
  );
}

export { FRAMEWORKS };
