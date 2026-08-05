import React, { useState, useRef } from 'react';
import { 
  Keyboard, X, RotateCcw, Search, Move, ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';

interface ShortcutEntry {
  key: string;
  label: string;
  command?: string;
  category: string;
  keys: string[];
}

const VS_CODE_SHORTCUTS: ShortcutEntry[] = [
  // 🔥 MOST IMPORTANT
  { category: '🔥 MOST IMPORTANT', key: 'ctrl+shift+p', label: 'Command Palette', command: 'editor.action.quickCommand', keys: ['Ctrl', 'Shift', 'P'] },
  { category: '🔥 MOST IMPORTANT', key: 'ctrl+p', label: 'Quick Open File', command: 'workbench.action.quickOpen', keys: ['Ctrl', 'P'] },
  { category: '🔥 MOST IMPORTANT', key: 'ctrl+b', label: 'Toggle Sidebar', command: 'workbench.action.toggleSidebarVisibility', keys: ['Ctrl', 'B'] },
  { category: '🔥 MOST IMPORTANT', key: 'ctrl+`', label: 'Toggle Terminal', command: 'workbench.action.terminal.toggleTerminal', keys: ['Ctrl', '`'] },
  { category: '🔥 MOST IMPORTANT', key: 'ctrl+s', label: 'Save File', command: 'base.action.save', keys: ['Ctrl', 'S'] },
  { category: '🔥 MOST IMPORTANT', key: 'ctrl+k s', label: 'Save All Files', command: 'workbench.action.files.saveAll', keys: ['Ctrl', 'K', 'S'] },
  { category: '🔥 MOST IMPORTANT', key: 'ctrl+z', label: 'Undo', command: 'undo', keys: ['Ctrl', 'Z'] },
  { category: '🔥 MOST IMPORTANT', key: 'ctrl+y', label: 'Redo', command: 'redo', keys: ['Ctrl', 'Y'] },
  { category: '🔥 MOST IMPORTANT', key: 'ctrl+x', label: 'Cut Line', command: 'editor.action.clipboardCutAction', keys: ['Ctrl', 'X'] },
  { category: '🔥 MOST IMPORTANT', key: 'ctrl+c', label: 'Copy Line', command: 'editor.action.clipboardCopyAction', keys: ['Ctrl', 'C'] },
  { category: '🔥 MOST IMPORTANT', key: 'ctrl+v', label: 'Paste', command: 'editor.action.clipboardPasteAction', keys: ['Ctrl', 'V'] },
  { category: '🔥 MOST IMPORTANT', key: 'ctrl+a', label: 'Select All', command: 'editor.action.selectAll', keys: ['Ctrl', 'A'] },

  // 📂 FILE & EXPLORER
  { category: '📂 FILE & EXPLORER', key: 'ctrl+n', label: 'New File', command: 'explorer.newFile', keys: ['Ctrl', 'N'] },
  { category: '📂 FILE & EXPLORER', key: 'ctrl+o', label: 'Open File', command: 'workbench.action.files.openFile', keys: ['Ctrl', 'O'] },
  { category: '📂 FILE & EXPLORER', key: 'ctrl+shift+n', label: 'New Window', command: 'workbench.action.newWindow', keys: ['Ctrl', 'Shift', 'N'] },
  { category: '📂 FILE & EXPLORER', key: 'ctrl+w', label: 'Close Tab', command: 'workbench.action.closeActiveEditor', keys: ['Ctrl', 'W'] },
  { category: '📂 FILE & EXPLORER', key: 'ctrl+shift+t', label: 'Reopen Closed Tab', command: 'workbench.action.reopenClosedEditor', keys: ['Ctrl', 'Shift', 'T'] },
  { category: '📂 FILE & EXPLORER', key: 'ctrl+tab', label: 'Next Tab', command: 'workbench.action.nextEditor', keys: ['Ctrl', 'Tab'] },
  { category: '📂 FILE & EXPLORER', key: 'ctrl+shift+tab', label: 'Previous Tab', command: 'workbench.action.previousEditor', keys: ['Ctrl', 'Shift', 'Tab'] },
  { category: '📂 FILE & EXPLORER', key: 'ctrl+pagedown', label: 'Next Editor Group', command: 'workbench.action.nextEditorInGroup', keys: ['Ctrl', 'PgDn'] },
  { category: '📂 FILE & EXPLORER', key: 'ctrl+pageup', label: 'Previous Editor Group', command: 'workbench.action.previousEditorInGroup', keys: ['Ctrl', 'PgUp'] },
  { category: '📂 FILE & EXPLORER', key: 'ctrl+shift+e', label: 'Explorer Panel', command: 'workbench.view.explorer', keys: ['Ctrl', 'Shift', 'E'] },

  // 🔍 SEARCH & REPLACE
  { category: '🔍 SEARCH & REPLACE', key: 'ctrl+f', label: 'Find', command: 'actions.find', keys: ['Ctrl', 'F'] },
  { category: '🔍 SEARCH & REPLACE', key: 'ctrl+h', label: 'Replace', command: 'editor.action.startFindReplaceAction', keys: ['Ctrl', 'H'] },
  { category: '🔍 SEARCH & REPLACE', key: 'ctrl+shift+f', label: 'Search Entire Project', command: 'workbench.action.findInFiles', keys: ['Ctrl', 'Shift', 'F'] },
  { category: '🔍 SEARCH & REPLACE', key: 'ctrl+shift+h', label: 'Replace Project', command: 'workbench.action.replaceInFiles', keys: ['Ctrl', 'Shift', 'H'] },
  { category: '🔍 SEARCH & REPLACE', key: 'f3', label: 'Find Next', command: 'editor.action.nextMatchFindAction', keys: ['F3'] },
  { category: '🔍 SEARCH & REPLACE', key: 'shift+f3', label: 'Find Previous', command: 'editor.action.previousMatchFindAction', keys: ['Shift', 'F3'] },

  // ✍️ EDITING SHORTCUTS
  { category: '✍️ EDITING SHORTCUTS', key: 'ctrl+/', label: 'Comment Line', command: 'editor.action.commentLine', keys: ['Ctrl', '/'] },
  { category: '✍️ EDITING SHORTCUTS', key: 'shift+alt+a', label: 'Block Comment', command: 'editor.action.blockComment', keys: ['Shift', 'Alt', 'A'] },
  { category: '✍️ EDITING SHORTCUTS', key: 'alt+up', label: 'Move Line Up', command: 'editor.action.moveLinesUpAction', keys: ['Alt', '↑'] },
  { category: '✍️ EDITING SHORTCUTS', key: 'alt+down', label: 'Move Line Down', command: 'editor.action.moveLinesDownAction', keys: ['Alt', '↓'] },
  { category: '✍️ EDITING SHORTCUTS', key: 'shift+alt+up', label: 'Copy Line Up', command: 'editor.action.copyLinesUpAction', keys: ['Shift', 'Alt', '↑'] },
  { category: '✍️ EDITING SHORTCUTS', key: 'shift+alt+down', label: 'Copy Line Down', command: 'editor.action.copyLinesDownAction', keys: ['Shift', 'Alt', '↓'] },
  { category: '✍️ EDITING SHORTCUTS', key: 'ctrl+shift+k', label: 'Delete Line', command: 'editor.action.deleteLines', keys: ['Ctrl', 'Shift', 'K'] },
  { category: '✍️ EDITING SHORTCUTS', key: 'ctrl+enter', label: 'Insert Line Below', command: 'editor.action.insertLineAfter', keys: ['Ctrl', 'Enter'] },
  { category: '✍️ EDITING SHORTCUTS', key: 'ctrl+shift+enter', label: 'Insert Line Above', command: 'editor.action.insertLineBefore', keys: ['Ctrl', 'Shift', 'Enter'] },
  { category: '✍️ EDITING SHORTCUTS', key: 'ctrl+d', label: 'Select Next Word', command: 'editor.action.addSelectionToNextFindMatch', keys: ['Ctrl', 'D'] },
  { category: '✍️ EDITING SHORTCUTS', key: 'ctrl+shift+l', label: 'Select All Match', command: 'editor.action.selectHighlights', keys: ['Ctrl', 'Shift', 'L'] },
  { category: '✍️ EDITING SHORTCUTS', key: 'ctrl+l', label: 'Select Current Line', command: 'expandLineSelection', keys: ['Ctrl', 'L'] },
  { category: '✍️ EDITING SHORTCUTS', key: 'ctrl+u', label: 'Undo Cursor', command: 'cursorUndo', keys: ['Ctrl', 'U'] },
  { category: '✍️ EDITING SHORTCUTS', key: 'ctrl+alt+up', label: 'Cursor Above', command: 'editor.action.insertCursorAbove', keys: ['Ctrl', 'Alt', '↑'] },
  { category: '✍️ EDITING SHORTCUTS', key: 'ctrl+alt+down', label: 'Cursor Below', command: 'editor.action.insertCursorBelow', keys: ['Ctrl', 'Alt', '↓'] },

  // 🧠 CODE NAVIGATION
  { category: '🧠 CODE NAVIGATION', key: 'f12', label: 'Go to Definition', command: 'editor.action.revealDefinition', keys: ['F12'] },
  { category: '🧠 CODE NAVIGATION', key: 'alt+f12', label: 'Peek Definition', command: 'editor.action.peekDefinition', keys: ['Alt', 'F12'] },
  { category: '🧠 CODE NAVIGATION', key: 'shift+f12', label: 'Find References', command: 'editor.action.referenceSearch.trigger', keys: ['Shift', 'F12'] },
  { category: '🧠 CODE NAVIGATION', key: 'ctrl+shift+o', label: 'Go to Symbol', command: 'editor.action.quickOutline', keys: ['Ctrl', 'Shift', 'O'] },
  { category: '🧠 CODE NAVIGATION', key: 'ctrl+g', label: 'Go to Line', command: 'editor.action.gotoLine', keys: ['Ctrl', 'G'] },
  { category: '🧠 CODE NAVIGATION', key: 'ctrl+t', label: 'Search Symbols in File', command: 'workbench.action.showAllSymbols', keys: ['Ctrl', 'T'] },
  { category: '🧠 CODE NAVIGATION', key: 'alt+left', label: 'Go Back', command: 'workbench.action.navigateBack', keys: ['Alt', '←'] },
  { category: '🧠 CODE NAVIGATION', key: 'alt+right', label: 'Go Forward', command: 'workbench.action.navigateForward', keys: ['Alt', '→'] },

  // ⚡ CODE FORMATTING
  { category: '⚡ CODE FORMATTING', key: 'shift+alt+f', label: 'Format Document', command: 'editor.action.formatDocument', keys: ['Shift', 'Alt', 'F'] },
  { category: '⚡ CODE FORMATTING', key: 'ctrl+k ctrl+f', label: 'Format Selection', command: 'editor.action.formatSelection', keys: ['Ctrl', 'K', 'F'] },
  { category: '⚡ CODE FORMATTING', key: 'ctrl+space', label: 'IntelliSense Suggestions', command: 'editor.action.triggerSuggest', keys: ['Ctrl', 'Space'] },
  { category: '⚡ CODE FORMATTING', key: 'ctrl+shift+space', label: 'Parameter Hints', command: 'editor.action.triggerParameterHints', keys: ['Ctrl', 'Shift', 'Space'] },
  { category: '⚡ CODE FORMATTING', key: 'tab', label: 'Accept Suggestion', command: 'acceptSelectedSuggestion', keys: ['Tab'] },

  // 🧩 TERMINAL SHORTCUTS
  { category: '🧩 TERMINAL SHORTCUTS', key: 'ctrl+shift+`', label: 'New Terminal', command: 'workbench.action.terminal.new', keys: ['Ctrl', 'Shift', '`'] },

  // 🐞 DEBUGGING
  { category: '🐞 DEBUGGING', key: 'f5', label: 'Start Debugging', command: 'workbench.action.debug.start', keys: ['F5'] },
  { category: '🐞 DEBUGGING', key: 'shift+f5', label: 'Stop Debugging', command: 'workbench.action.debug.stop', keys: ['Shift', 'F5'] },
  { category: '🐞 DEBUGGING', key: 'f9', label: 'Toggle Breakpoint', command: 'editor.debug.action.toggleBreakpoint', keys: ['F9'] },
  { category: '🐞 DEBUGGING', key: 'ctrl+shift+d', label: 'Debug Panel', command: 'workbench.view.debug', keys: ['Ctrl', 'Shift', 'D'] },

  // 🌐 GIT SHORTCUTS
  { category: '🌐 GIT SHORTCUTS', key: 'ctrl+shift+g', label: 'Source Control', command: 'workbench.view.scm', keys: ['Ctrl', 'Shift', 'G'] },

  // 📦 EXTENSIONS & SETTINGS
  { category: '📦 EXTENSIONS & SETTINGS', key: 'ctrl+shift+x', label: 'Extensions', command: 'workbench.view.extensions', keys: ['Ctrl', 'Shift', 'X'] },
  { category: '📦 EXTENSIONS & SETTINGS', key: 'ctrl+,', label: 'Settings', command: 'workbench.action.openSettings', keys: ['Ctrl', ','] },
  { category: '📦 EXTENSIONS & SETTINGS', key: 'ctrl+k ctrl+s', label: 'Keyboard Shortcuts', command: 'workbench.action.openGlobalKeybindings', keys: ['Ctrl', 'K', 'S'] },

  // 🪄 ADVANCED POWER USER
  { category: '🪄 ADVANCED POWER USER', key: 'ctrl+shift+m', label: 'Problems Panel', command: 'workbench.actions.view.problems', keys: ['Ctrl', 'Shift', 'M'] },
  { category: '🪄 ADVANCED POWER USER', key: 'ctrl+shift+u', label: 'Output Panel', command: 'workbench.action.output.toggleOutput', keys: ['Ctrl', 'Shift', 'U'] },
  { category: '🪄 ADVANCED POWER USER', key: 'ctrl+j', label: 'Toggle Bottom Panel', command: 'workbench.action.toggleMaximizedPanel', keys: ['Ctrl', 'J'] },
  { category: '🪄 ADVANCED POWER USER', key: 'ctrl+k z', label: 'Zen Mode', command: 'workbench.action.toggleZenMode', keys: ['Ctrl', 'K', 'Z'] },
  { category: '🪄 ADVANCED POWER USER', key: 'ctrl+\\', label: 'Split Editor', command: 'workbench.action.splitEditor', keys: ['Ctrl', '\\'] },
  { category: '🪄 ADVANCED POWER USER', key: 'ctrl+1', label: 'Focus First Group', command: 'workbench.action.focusFirstEditorGroup', keys: ['Ctrl', '1'] },
  { category: '🪄 ADVANCED POWER USER', key: 'ctrl+shift+[', label: 'Fold Code', command: 'editor.fold', keys: ['Ctrl', 'Shift', '['] },
  { category: '🪄 ADVANCED POWER USER', key: 'ctrl+shift+]', label: 'Unfold Code', command: 'editor.unfold', keys: ['Ctrl', 'Shift', ']'] },
  { category: '🪄 ADVANCED POWER USER', key: 'ctrl+k ctrl+0', label: 'Fold All', command: 'editor.foldAll', keys: ['Ctrl', 'K', '0'] },
  { category: '🪄 ADVANCED POWER USER', key: 'ctrl+k ctrl+j', label: 'Unfold All', command: 'editor.unfoldAll', keys: ['Ctrl', 'K', 'J'] },

  // 🤖 AI CODING SHORTCUTS
  { category: '🤖 AI CODING SHORTCUTS', key: 'tab', label: 'Accept AI Suggestion', command: 'editor.action.inlineSuggest.commit', keys: ['Tab'] },
  { category: '🤖 AI CODING SHORTCUTS', key: 'esc', label: 'Reject AI Suggestion', command: 'editor.action.inlineSuggest.hide', keys: ['Esc'] },
  { category: '🤖 AI CODING SHORTCUTS', key: 'alt+]', label: 'Next AI Suggestion', command: 'editor.action.inlineSuggest.showNext', keys: ['Alt', ']'] },
  { category: '🤖 AI CODING SHORTCUTS', key: 'alt+[', label: 'Previous AI Suggestion', command: 'editor.action.inlineSuggest.showPrevious', keys: ['Alt', '['] },

  // 🚀 SUPER USEFUL HIDDEN
  { category: '🚀 SUPER USEFUL HIDDEN', key: 'ctrl+shift+v', label: 'Markdown Preview', command: 'markdown.showPreview', keys: ['Ctrl', 'Shift', 'V'] },
  { category: '🚀 SUPER USEFUL HIDDEN', key: 'f2', label: 'Rename Variable', command: 'editor.action.rename', keys: ['F2'] },
  { category: '🚀 SUPER USEFUL HIDDEN', key: 'ctrl+.', label: 'Quick Fix', command: 'editor.action.quickFix', keys: ['Ctrl', '.'] },
  { category: '🚀 SUPER USEFUL HIDDEN', key: 'home', label: 'Line Start', command: 'cursorHome', keys: ['Home'] },
  { category: '🚀 SUPER USEFUL HIDDEN', key: 'end', label: 'Line End', command: 'cursorEnd', keys: ['End'] },
  { category: '🚀 SUPER USEFUL HIDDEN', key: 'ctrl+home', label: 'File Start', command: 'cursorTop', keys: ['Ctrl', 'Home'] },
  { category: '🚀 SUPER USEFUL HIDDEN', key: 'ctrl+end', label: 'File End', command: 'cursorBottom', keys: ['Ctrl', 'End'] },
];

interface VirtualKeyboardProps {
  onShortcutTrigger: (keys: string[], key?: string) => void;
  onClose: () => void;
  onToggleCursor?: () => void;
}

export const VirtualKeyboard: React.FC<VirtualKeyboardProps> = ({ 
  onShortcutTrigger, 
  onClose,
  onToggleCursor 
}) => {
  const [search, setSearch] = useState('');
  const [scale, setScale] = useState(1);
  const [selectedShortcut, setSelectedShortcut] = useState<ShortcutEntry | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filtered = VS_CODE_SHORTCUTS.filter(s => 
     s.label.toLowerCase().includes(search.toLowerCase()) || 
     s.category.toLowerCase().includes(search.toLowerCase())
  );

  const handleRun = () => {
    if (selectedShortcut) {
      onShortcutTrigger(selectedShortcut.keys, selectedShortcut.command);
      // Optional: keep open or close? The user wanted it to stay open after selecting (pressing enter reviews it), usually implying it stays for review.
    }
  };

  const handleSelect = (shortcut: ShortcutEntry) => {
    setSelectedShortcut(shortcut);
    setIsDropdownOpen(false);
    setSearch('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isDropdownOpen) {
       if (e.key === 'Enter') handleRun();
       return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      if (filtered[selectedIndex]) {
        handleSelect(filtered[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsDropdownOpen(false);
    }
  };

  return (
    <motion.div
      ref={containerRef}
      drag
      dragMomentum={false}
      initial={{ opacity: 0, y: 40, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: scale }}
      exit={{ opacity: 0, y: 40, scale: 0.95 }}
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ pointerEvents: 'none' }}
    >
      <div className="w-full max-w-xl bg-[#0d1117]/98 border border-white/10 rounded-3xl shadow-3xl overflow-visible backdrop-blur-2xl flex flex-col pointer-events-auto cursor-default active:cursor-grabbing">
        
        {/* Row 1: Context Header - Acts as Drag Handle */}
        <div className="flex items-center justify-between p-4 bg-white/5 border-b border-white/5 rounded-t-3xl">
           <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500/20 rounded-xl">
                 <Keyboard className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                 <h2 className="text-xs font-black text-white uppercase tracking-[0.2em]">NavBharat AI Code Studio</h2>
                 <p className="text-[9px] font-bold text-[#484f58] uppercase">VS Code – Master Keyboard Shortcuts</p>
              </div>
           </div>
           
           <div className="flex items-center gap-3">
              <div className="flex items-center bg-black/40 rounded-xl border border-white/5 p-1">
                {[0.5, 1, 2].map(s => (
                  <button
                    key={s}
                    onClick={() => setScale(s)}
                    className={cn(
                      "px-3 py-1 text-[10px] font-black rounded-lg transition-all",
                      scale === s ? "bg-white text-black" : "text-[#484f58] hover:text-[#8b949e]"
                    )}
                  >
                    {s}x
                  </button>
                ))}
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-red-500/20 rounded-xl text-red-500/60 transition-all"
              >
                <X className="w-5 h-5" />
              </button>
           </div>
        </div>

        {/* Row 2: The Selector (Dropdown + Enter) */}
        <div className="p-6 bg-black/20 flex flex-col gap-6 relative">
           <div className="flex gap-3 h-14">
              {/* Dropdown Selector Box */}
              <div className="relative flex-1" ref={dropdownRef}>
                 <button 
                   onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                   className={cn(
                     "w-full h-full bg-white/5 border rounded-2xl px-5 flex items-center justify-between transition-all group",
                     isDropdownOpen ? "border-indigo-500/50 bg-white/[0.08]" : "border-white/10 hover:border-white/20"
                   )}
                 >
                    <div className="flex items-center gap-3 overflow-hidden">
                       <Search className="w-4 h-4 text-[#484f58]" />
                       <span className={cn(
                         "text-sm font-bold truncate",
                         selectedShortcut ? "text-indigo-400" : "text-[#484f58]"
                       )}>
                         {selectedShortcut ? `${selectedShortcut.label} (${selectedShortcut.key.toUpperCase()})` : "Select a shortcut function..."}
                       </span>
                    </div>
                    <ChevronDown className={cn("w-4 h-4 text-[#484f58] transition-transform", isDropdownOpen && "rotate-180")} />
                 </button>

                 {/* Dropdown Options - Floating & Overflowing for better visibility */}
                 <AnimatePresence>
                   {isDropdownOpen && (
                     <motion.div
                       initial={{ opacity: 0, y: 10, scale: 0.95 }}
                       animate={{ opacity: 1, y: 0, scale: 1 }}
                       exit={{ opacity: 0, y: 10, scale: 0.95 }}
                       className="absolute left-[-20px] right-[-20px] top-[calc(100%+10px)] bg-[#0d1117] border border-white/10 rounded-3xl shadow-[0_32px_64px_-16px_rgba(0,0,0,0.8)] overflow-hidden z-[10005] flex flex-col max-h-[450px]"
                     >
                        <div className="p-4 border-b border-white/5 bg-white/5 backdrop-blur-3xl">
                           <input 
                              autoFocus
                              type="text"
                              placeholder="Search 100+ shortcuts..."
                              value={search}
                              onChange={(e) => { setSearch(e.target.value); setSelectedIndex(0); }}
                              onKeyDown={handleKeyDown}
                              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3.5 px-5 text-sm font-bold text-white placeholder-[#21262d] outline-none focus:border-indigo-500/50 transition-all"
                           />
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar bg-black/40">
                           {filtered.map((s, idx) => {
                             const isSelected = selectedIndex === idx;
                             return (
                               <button
                                 key={`${s.category}-${s.key}`}
                                 onClick={() => handleSelect(s)}
                                 onMouseEnter={() => setSelectedIndex(idx)}
                                 className={cn(
                                   "w-full px-6 py-4 text-left transition-all border-b border-white/5 last:border-0",
                                   isSelected ? "bg-indigo-600/20 text-white" : "text-[#8b949e] hover:bg-white/5"
                                 )}
                               >
                                  <div className="flex items-center justify-between">
                                     <div className="flex flex-col">
                                        <span className="text-sm font-black tracking-tight">{s.label}</span>
                                        <span className="text-[9px] font-bold opacity-30 uppercase tracking-widest mt-0.5">{s.category}</span>
                                     </div>
                                     <div className="flex gap-1.5">
                                        {s.keys.map((k, kIdx) => (
                                          <kbd key={kIdx} className={cn(
                                            "px-2 py-1 bg-black/60 border rounded-lg text-[10px] font-black uppercase text-[#484f58]",
                                            isSelected ? "border-indigo-500/30 text-indigo-400" : "border-white/5"
                                          )}>
                                            {k}
                                          </kbd>
                                        ))}
                                     </div>
                                  </div>
                               </button>
                             );
                           })}
                        </div>
                     </motion.div>
                   )}
                 </AnimatePresence>
              </div>

              {/* Enter Button */}
              <button 
                onClick={handleRun}
                disabled={!selectedShortcut}
                className={cn(
                  "px-8 h-full rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-95 shadow-xl",
                  selectedShortcut 
                    ? "bg-indigo-500 hover:bg-indigo-400 text-white shadow-indigo-500/20" 
                    : "bg-white/5 text-[#21262d] cursor-not-allowed border border-white/5"
                )}
              >
                ENTER
              </button>
           </div>

           {/* Secondary Actions */}
           <div className="flex items-center justify-between px-2">
              <button 
                onClick={onToggleCursor}
                className="flex items-center gap-2 text-[#484f58] hover:text-indigo-400 transition-colors font-black text-[10px] uppercase tracking-widest"
              >
                <Move className="w-3 h-3" />
                Switch to Cursor Tool
              </button>
              <div className="text-[9px] font-bold text-[#21262d] uppercase tracking-[0.2em]">
                 Select Function & Press Enter to Execute
              </div>
           </div>
        </div>

        {/* Footer Branding */}
        <div className="bg-black/40 py-3 text-center border-t border-white/5 flex items-center justify-center gap-6">
           <span className="text-[8px] font-black uppercase tracking-[0.6em] text-[#21262d] italic">NavBharat AI Master Studio</span>
           <div className="h-3 w-px bg-white/5" />
           <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)] animate-pulse" />
              <span className="text-[8px] font-black text-[#8b949e] uppercase tracking-widest">Compiler Ready</span>
           </div>
        </div>
      </div>
    </motion.div>
  );
};
