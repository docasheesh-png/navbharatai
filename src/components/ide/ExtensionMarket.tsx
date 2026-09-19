import React, { useState } from 'react';
import { 
  Puzzle, Download, Star, CheckCircle2, 
  Search, ShieldCheck, Zap, Globe
} from 'lucide-react';
import { cn } from '../../lib/utils';

interface Extension {
  id: string;
  name: string;
  description: string;
  author: string;
  installs: string;
  rating: number;
  icon: any;
  category: string;
  isInstalled?: boolean;
}

export const ExtensionMarket: React.FC = () => {
  const [search, setSearch] = useState('');
  const [installedIds, setInstalledIds] = useState<string[]>(['eslint', 'prettier']);

  const extensions: Extension[] = [
    { 
      id: 'eslint', 
      name: 'ESLint', 
      description: 'Integrates ESLint into NAVBHARAT IDE', 
      author: 'Microsoft', 
      installs: '2.5M', 
      rating: 4.5, 
      icon: ShieldCheck, 
      category: 'Linters' 
    },
    { 
      id: 'prettier', 
      name: 'Prettier', 
      description: 'Code formatter for your project', 
      author: 'Prettier', 
      installs: '3.1M', 
      rating: 4.8, 
      icon: CheckCircle2, 
      category: 'Formatters' 
    },
    { 
      id: 'tailwind', 
      name: 'Tailwind CSS IntelliSense', 
      description: 'Intelligent Tailwind CSS tooling', 
      author: 'Tailwind Labs', 
      installs: '1.2M', 
      rating: 4.9, 
      icon: Zap, 
      category: 'Styling' 
    },
    { 
      id: 'python-nb', 
      name: 'Python for NavBharat', 
      description: 'Full Python runtime & autocomplete', 
      author: 'Bharat Dynamics', 
      installs: '800K', 
      rating: 4.4, 
      icon: Globe, 
      category: 'Languages' 
    },
  ];

  const filtered = extensions.filter(ex => 
    ex.name.toLowerCase().includes(search.toLowerCase()) ||
    ex.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="p-4 border-b border-line space-y-4">
        <h3 className="text-xs font-black uppercase tracking-widest text-ink flex items-center gap-2">
          <Puzzle className="w-4 h-4 text-accent-text" />
          Marketplace
        </h3>
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-faint" />
          <input 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search extensions..."
            className="w-full bg-well border border-line rounded-xl py-2 pl-9 pr-4 text-[11px] font-bold outline-none focus:border-indigo-500/50 transition-all"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar p-2 space-y-1">
        {filtered.map((ext) => {
          const isInstalled = installedIds.includes(ext.id);
          return (
            <div 
              key={ext.id}
              className="p-3 rounded-xl hover:bg-raised border border-transparent hover:border-line transition-all group flex items-start gap-3"
            >
              <div className="relative">
                <div className="w-10 h-10 bg-surface rounded-xl flex items-center justify-center border border-line group-hover:border-indigo-500/30 transition-colors">
                  <ext.icon className="w-5 h-5 text-accent-text" />
                </div>
                {isInstalled && (
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 text-on-accent rounded-full flex items-center justify-center border-2 border-line">
                    <CheckCircle2 className="w-2.5 h-2.5" />
                  </div>
                )}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                   <h4 className="text-[11px] font-bold text-ink truncate">{ext.name}</h4>
                   <span className="text-[8px] font-black text-faint uppercase px-1.5 py-0.5 bg-well rounded border border-line">{ext.category}</span>
                </div>
                <p className="text-[10px] text-muted line-clamp-1 mb-2">{ext.description}</p>
                <div className="flex items-center gap-3">
                   <div className="flex items-center gap-1 text-[9px] font-bold text-faint">
                     <Download className="w-2.5 h-2.5" />
                     {ext.installs}
                   </div>
                   <div className="flex items-center gap-1 text-[9px] font-bold text-warn">
                     <Star className="w-2.5 h-2.5 fill-current" />
                     {ext.rating}
                   </div>
                </div>
              </div>

              <button 
                onClick={() => {
                   if (isInstalled) {
                     setInstalledIds(prev => prev.filter(id => id !== ext.id));
                   } else {
                     setInstalledIds(prev => [...prev, ext.id]);
                   }
                }}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all",
                  isInstalled ? "bg-raised text-muted hover:bg-red-500/10 hover:text-danger" : "bg-indigo-600 text-on-accent hover:bg-indigo-700"
                )}
              >
                {isInstalled ? 'Uninstall' : 'Install'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
