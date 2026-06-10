import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, ClipboardList, Code2, Hammer, Bug, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export type AgentMode = 'planning' | 'build' | 'chat';

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
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [dropdownRef]);

  const modes: { id: AgentMode; label: string; icon: React.ReactNode }[] = [
    { id: 'planning', label: 'Planning', icon: <ClipboardList className="w-3 h-3" /> },
    { id: 'build', label: 'Building', icon: <Hammer className="w-3 h-3" /> },
  ];

  const currentMode = modes.find(m => m.id === mode);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0d1117] border border-white/10 rounded-lg text-[10px] font-bold text-gray-300 hover:text-white transition-all shadow-lg"
      >
        {currentMode?.icon}
        {currentMode?.label}
        <ChevronDown className="w-3 h-3 text-gray-500" />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-32 bg-[#0d1117] border border-white/10 rounded-xl shadow-2xl p-1 z-[200]">
          {modes.map((m) => (
            <button
              key={m.id}
              onClick={() => { setMode(m.id); setIsOpen(false); }}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-bold transition-all",
                mode === m.id ? "bg-indigo-600/20 text-indigo-400" : "text-gray-400 hover:text-white hover:bg-white/5"
              )}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
