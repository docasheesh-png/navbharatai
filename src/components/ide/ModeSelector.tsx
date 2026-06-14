import React, { useState, useEffect, useRef } from 'react';
import { ClipboardList, Hammer, ChevronDown, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';

export type AgentMode = 'auto' | 'planning' | 'build' | 'chat';

interface ModeSelectorProps {
  mode: AgentMode;
  setMode: (mode: AgentMode) => void;
}

export const ModeSelector: React.FC<ModeSelectorProps> = ({ mode, setMode }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const modes: { id: AgentMode; label: string; icon: React.ReactNode; description: string }[] = [
    { id: 'auto',     label: 'Auto',     icon: <Sparkles className="w-3 h-3" />,     description: 'AI decides — chat or build' },
    { id: 'planning', label: 'Planning', icon: <ClipboardList className="w-3 h-3" />, description: 'Brainstorm & plan only' },
    { id: 'build',    label: 'Build',    icon: <Hammer className="w-3 h-3" />,        description: 'Build immediately' },
  ];

  const currentMode = modes.find(m => m.id === mode) ?? modes[0];
  const isAuto = mode === 'auto';

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all shadow-lg border",
          isAuto
            ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/30"
            : "bg-[#0d1117] border-white/10 text-gray-300 hover:text-white"
        )}
      >
        {currentMode.icon}
        {currentMode.label}
        <ChevronDown className="w-3 h-3 text-gray-500" />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-48 bg-[#0d1117] border border-white/10 rounded-xl shadow-2xl p-1 z-[200]">
          {modes.map((m) => (
            <button
              key={m.id}
              onClick={() => { setMode(m.id); setIsOpen(false); }}
              className={cn(
                "w-full flex items-start gap-2 px-3 py-2.5 rounded-lg transition-all text-left",
                mode === m.id
                  ? m.id === 'auto' ? "bg-indigo-600/20 text-indigo-300" : "bg-indigo-600/20 text-indigo-400"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              )}
            >
              <span className="mt-0.5 shrink-0">{m.icon}</span>
              <div>
                <div className="text-[10px] font-bold">{m.label}</div>
                <div className="text-[9px] opacity-60 font-normal mt-0.5">{m.description}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
