import React from 'react';
import { Files, Search, GitBranch, Settings, Move, ShieldAlert, Keyboard } from 'lucide-react';
import { cn } from '../../lib/utils';
import { IDEScreen } from '../../types/ide';

interface ActivityBarProps {
  activeScreen: IDEScreen;
  onScreenChange: (screen: IDEScreen) => void;
  isMobile?: boolean;
  isShortcutsOpen?: boolean;
  isCursorPopupOpen?: boolean;
}

export const ActivityBar: React.FC<ActivityBarProps> = ({
  activeScreen,
  onScreenChange,
  isMobile = false,
  isShortcutsOpen = false,
  isCursorPopupOpen = false
}) => {
  const items = [
    { id: 'files' as const, icon: Files, label: 'Explorer' },
    { id: 'search' as const, icon: Search, label: 'Search' },
    { id: 'git' as const, icon: GitBranch, label: 'Source Control' },
    { id: 'shortcuts' as const, icon: Keyboard, label: 'Shortcuts' },
    { id: 'cursor' as const, icon: Move, label: 'Cursor' },
    { id: 'security' as const, icon: ShieldAlert, label: 'Security' },
  ];

  const isItemActive = (id: string) => {
    if (id === 'cursor') return isCursorPopupOpen;
    if (id === 'shortcuts') return isShortcutsOpen;
    return activeScreen === id;
  };

  if (isMobile) {
    return (
      <div className="flex border-t border-[var(--theme-border)] bg-[var(--theme-card)] h-16 shrink-0 relative z-50 select-none transition-colors duration-500">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onScreenChange(item.id)}
            className={cn(
              "flex-1 flex flex-col items-center justify-center gap-1 transition-all relative",
              isItemActive(item.id) ? "text-indigo-400" : "text-[#484f58] hover:text-[#8b949e]"
            )}
          >
            <item.icon className={cn("w-5 h-5", isItemActive(item.id) && "animate-pulse")} />
            <span className="text-[8px] font-black uppercase tracking-tighter">{item.label.split(' ')[0]}</span>
            {isItemActive(item.id) && (
              <div className="absolute top-0 left-1/4 right-1/4 h-0.5 bg-indigo-500 rounded-full" />
            )}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="w-12 bg-[var(--theme-card)] flex flex-col items-center py-4 gap-4 border-r border-[var(--theme-border)] shrink-0 select-none transition-colors duration-500">
      {/* The hamburger was REMOVED here (admin 2026-08-21): no onClick, and nothing for it to open.
          This is the DESKTOP rail (the mobile variant returns earlier), where the icons below ARE
          the navigation — there is no drawer, and ActivityBarProps carries no menu-toggle to wire it
          to. Adding one would be inventing a menu to justify a button, which is backwards. */}
      
      {items.map((item) => (
        <div 
          key={item.id}
          className={cn(
            "flex border-l-2 w-full justify-center group relative",
            isItemActive(item.id) ? "border-white" : "border-transparent"
          )}
        >
          <button
            onClick={() => onScreenChange(item.id)}
            aria-label={item.label}
            className={cn(
              "p-2.5 transition-colors",
              isItemActive(item.id) ? "text-white" : "text-[#858585] group-hover:text-white"
            )}
            title={item.label}
          >
            <item.icon className="w-6 h-6" />
          </button>
          
          {/* Tooltip emulation */}
          <div className="absolute left-full ml-2 px-2 py-1 bg-[#252526] text-white text-[10px] rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-[100] border border-white/10 shadow-xl ml-4">
            {item.label}
          </div>
        </div>
      ))}

      <div className="mt-auto pb-4 flex flex-col items-center gap-4">
        <button
           onClick={() => onScreenChange('settings')}
           aria-label="Settings"
           title="Settings"
           className={cn(
             "p-2.5 transition-colors",
             activeScreen === 'settings' ? "text-white" : "text-[#858585] hover:text-white"
           )}
        >
          <Settings className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
};
