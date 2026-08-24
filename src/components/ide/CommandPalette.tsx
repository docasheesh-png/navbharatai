import React, { useState, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onAction: (id: string) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ 
  isOpen, 
  onClose,
  onAction 
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const commands = [
    { id: 'git-commit', label: 'Git: Commit All Changes', category: 'Source Control' },
    { id: 'npm-install', label: 'NPM: Install Dependencies', category: 'Package Manager' },
    { id: 'ai-refactor', label: 'AI: Refactor Selected Code', category: 'AI Assistant' },
    { id: 'ai-debug', label: 'AI: Find Bugs & Fix', category: 'AI Assistant' },
    { id: 'files-new', label: 'File: Create New File', category: 'Files' },
    { id: 'settings-open', label: 'Preferences: Open User Settings', category: 'Settings' },
    { id: 'theme-dark', label: 'Theme: Switch to Dark+ (Default)', category: 'Appearance' },
    { id: 'deploy-vercel', label: 'Deploy: Push to Vercel', category: 'Deployment' },
  ];

  const filteredItems = commands.filter(cmd => 
    cmd.label.toLowerCase().includes(query.toLowerCase()) ||
    cmd.category.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      const input = document.getElementById('command-palette-input');
      input?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % Math.max(1, filteredItems.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
      } else if (e.key === 'Enter') {
        if (filteredItems[selectedIndex]) {
           onAction(filteredItems[selectedIndex].id);
           onClose();
        }
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedIndex, filteredItems]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 z-[1000] backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 w-full max-w-xl bg-[#252526] border border-white/10 rounded-xl shadow-2xl z-[1001] overflow-hidden"
          >
            <div className="flex items-center px-4 py-3 border-b border-white/5 bg-[#1e1e1e]">
               <ChevronRight className="w-4 h-4 text-white mr-3" />
               <input 
                 id="command-palette-input"
                 autoFocus
                 value={query}
                 onChange={(e) => {
                    setQuery(e.target.value);
                    setSelectedIndex(0);
                 }}
                 placeholder="Search commands..."
                 className="flex-1 bg-transparent border-none outline-none text-white text-sm"
               />
            </div>
            
            <div className="max-h-[40vh] supports-[height:100dvh]:max-h-[40dvh] overflow-y-auto py-2 no-scrollbar">
               {filteredItems.length === 0 ? (
                  <div className="px-4 py-8 text-center text-[#858585] text-xs">
                     No commands found for "{query}"
                  </div>
               ) : (
                  filteredItems.map((item, index) => (
                    <div
                      key={item.id}
                      onClick={() => {
                        onAction(item.id);
                        onClose();
                      }}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={cn(
                        "px-4 py-2 flex items-center justify-between cursor-pointer transition-colors",
                        index === selectedIndex ? "bg-[#04395e] text-white" : "text-[#cccccc] hover:bg-white/5"
                      )}
                    >
                      <div className="flex flex-col">
                        <span className="text-[13px]">{item.label}</span>
                        <span className="text-[10px] opacity-40 uppercase tracking-widest font-black leading-none mt-1">{item.category}</span>
                      </div>
                      {index === selectedIndex && (
                         <div className="flex items-center gap-1 opacity-40">
                             <span className="px-1.5 py-0.5 bg-black/40 rounded border border-white/10 text-[9px]">Enter</span>
                         </div>
                      )}
                    </div>
                  ))
               )}
            </div>
            
            <div className="px-4 py-2 bg-[#1e1e1e] border-t border-white/5 text-[9px] text-[#858585] flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1"><span className="px-1 py-0.5 bg-white/5 rounded">↑↓</span> to navigate</span>
                  <span className="flex items-center gap-1"><span className="px-1 py-0.5 bg-white/5 rounded">↵</span> to select</span>
                </div>
                <div>{filteredItems.length} commands found</div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
