import React from 'react';
import { 
  GitBranch, RefreshCcw, Check, 
  AlertCircle, ChevronUp, Bell, Bot,
  Cpu, Activity
} from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { cn } from '../../lib/utils';

interface StatusBarProps {
  activeFile?: string;
  gitBranch?: string;
  isSaving?: boolean;
  problemsCount?: number;
  aiStatus?: 'idle' | 'thinking';
}

export const StatusBar: React.FC<StatusBarProps> = ({
  activeFile,
  gitBranch = 'main',
  isSaving = false,
  problemsCount = 0,
  aiStatus = 'idle'
}) => {
  return (
    <div className="h-6 bg-[#007acc] text-white flex items-center justify-between px-3 text-[10px] select-none shrink-0 border-t border-white/5">
      <div className="flex items-center h-full gap-3">
        <button className="flex items-center gap-1.5 hover:bg-white/10 h-full px-2 transition-all">
          <GitBranch className="w-3 h-3" />
          <span className="font-medium">{gitBranch}</span>
          <RefreshCcw className="w-2.5 h-2.5 ml-1 opacity-60" />
        </button>
        
        <div className="flex items-center gap-1.5 h-full px-2 opacity-80">
          {problemsCount > 0 ? (
            <div className="flex items-center gap-1 text-red-100">
               <AlertCircle className="w-3 h-3" />
               <span className="font-bold">{problemsCount}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-blue-100">
               <Check className="w-3 h-3" />
               <span className="font-bold">0</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 h-full px-2 opacity-80 truncate hidden md:flex">
          <Activity className="w-3 h-3" />
          <span>NavBharat Kernel Active</span>
        </div>
      </div>

      <div className="flex items-center h-full">
        <div className="flex items-center gap-3 h-full px-3 border-x border-white/10">
           <div className="flex items-center gap-1.5">
             <span className="opacity-70">Spaces: 2</span>
           </div>
           <div className="flex items-center gap-1.5">
             <span className="opacity-70">UTF-8</span>
           </div>
           <div className="flex items-center gap-1.5">
             <span className="opacity-70">JavaScript</span>
           </div>
        </div>

        <button className="flex items-center gap-2 hover:bg-white/10 h-full px-3 transition-colors group">
           {aiStatus === 'thinking' ? (
              <TirangaLoader className="w-3 h-3" />
           ) : (
              <Bot className="w-3 h-3 group-hover:scale-110 transition-transform" />
           )}
           <span className="font-black uppercase tracking-tighter">AI READY</span>
        </button>

        <button className="flex items-center gap-1 hover:bg-white/10 h-full px-2 transition-colors">
          <Bell className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
