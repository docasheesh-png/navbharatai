import React, { useState, useRef, useCallback } from 'react';
import { Keyboard, X, Search, Move, ChevronDown, Maximize2, CornerDownLeft } from 'lucide-react';
import { motion, AnimatePresence, useDragControls, useMotionValue } from 'motion/react';
import { cn } from '../../lib/utils';
import { availableItems, type EditorCapability } from './editorCapabilities';
import {
  CORNERS, type Corner, type GestureStart,
  cornerGestureStart, pinchGestureStart, scaleFromGesture, readPopupScale, writePopupScale,
} from './popupResize';

interface ShortcutEntry {
  key: string;
  label: string;
  command?: string;
  category: string;
  keys: string[];
  /**
   * A capability this shortcut needs before it may be OFFERED at all.
   *
   * Most shortcuts need nothing — Monaco implements them itself. A few dispatch a real Monaco command
   * whose effect depends on something we have to provide; those must name it here, or they become a
   * button that does nothing and reports nothing. See editorCapabilities.ts for the bug that made
   * this field necessary.
   */
  requires?: EditorCapability;
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
  // Every one of these acts on an INLINE SUGGESTION, which exists only while an inline-completions
  // provider is registered. Until the AI autocomplete engine ships there is nothing to accept, hide
  // or cycle through — so they are gated rather than shown, and Monaco is never asked to commit a
  // suggestion that was never offered.
  { category: '🤖 AI CODING SHORTCUTS', key: 'tab', label: 'Accept AI Suggestion', command: 'editor.action.inlineSuggest.commit', keys: ['Tab'], requires: 'inlineAiSuggestions' },
  { category: '🤖 AI CODING SHORTCUTS', key: 'esc', label: 'Reject AI Suggestion', command: 'editor.action.inlineSuggest.hide', keys: ['Esc'], requires: 'inlineAiSuggestions' },
  { category: '🤖 AI CODING SHORTCUTS', key: 'alt+]', label: 'Next AI Suggestion', command: 'editor.action.inlineSuggest.showNext', keys: ['Alt', ']'], requires: 'inlineAiSuggestions' },
  { category: '🤖 AI CODING SHORTCUTS', key: 'alt+[', label: 'Previous AI Suggestion', command: 'editor.action.inlineSuggest.showPrevious', keys: ['Alt', '['], requires: 'inlineAiSuggestions' },

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

/** Where each corner handle sits, and the cursor a mouse shows over it. */
const CORNER_STYLE: Record<Corner, string> = {
  nw: '-top-2 -left-2 cursor-nwse-resize',
  ne: '-top-2 -right-2 cursor-nesw-resize',
  sw: '-bottom-2 -left-2 cursor-nesw-resize',
  se: '-bottom-2 -right-2 cursor-nwse-resize',
};

export const VirtualKeyboard: React.FC<VirtualKeyboardProps> = ({
  onShortcutTrigger,
  onClose,
  onToggleCursor
}) => {
  const [search, setSearch] = useState('');
  const [selectedShortcut, setSelectedShortcut] = useState<ShortcutEntry | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Size and position (admin 2026-09-24) ─────────────────────────────────────────────────────
  // ONE continuous scale replaces the 0.5× / 1× / 2× buttons. It is a MotionValue, not React state:
  // a finger dragging a corner produces a value per frame, and re-rendering the whole popup on each
  // one would make the resize stutter on exactly the phones it is for. The value is read where a
  // gesture begins and written on every move; React re-renders only for the resize-mode toggle.
  const scale = useMotionValue(readPopupScale(typeof localStorage === 'undefined' ? null : localStorage));
  const [resizing, setResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<GestureStart | null>(null);
  // The popup is MOVED from its header only (`dragListener={false}` + manual `dragControls.start`).
  // With drag on the whole panel, a corner drag and a move both claimed the same pointer.
  const dragControls = useDragControls();

  /** The panel's natural (unscaled) box and the viewport — the two numbers the geometry needs. */
  const measure = useCallback(() => {
    const rect = panelRef.current?.getBoundingClientRect();
    const s = scale.get() || 1;
    return {
      centre: { x: (rect?.left ?? 0) + (rect?.width ?? 0) / 2, y: (rect?.top ?? 0) + (rect?.height ?? 0) / 2 },
      natural: { width: (rect?.width ?? 0) / s, height: (rect?.height ?? 0) / s },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }, [scale]);

  const persistScale = () => writePopupScale(typeof localStorage === 'undefined' ? null : localStorage, scale.get());

  const onCornerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const { centre } = measure();
    gestureRef.current = cornerGestureStart(scale.get(), { x: e.clientX, y: e.clientY }, centre);
  };
  const onCornerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = gestureRef.current;
    if (!start) return;
    const { centre, natural, viewport } = measure();
    scale.set(scaleFromGesture(start, Math.hypot(e.clientX - centre.x, e.clientY - centre.y), natural, viewport));
  };
  const onCornerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!gestureRef.current) return;
    gestureRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    persistScale();
  };

  // A two-finger pinch anywhere on the panel, but ONLY in resize mode — otherwise `touchAction`
  // stays 'auto' and the shortcut list scrolls exactly as before.
  const onPinchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!resizing || e.touches.length !== 2) return;
    const [a, b] = [e.touches[0], e.touches[1]];
    gestureRef.current = pinchGestureStart(scale.get(), { x: a.clientX, y: a.clientY }, { x: b.clientX, y: b.clientY });
  };
  const onPinchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = gestureRef.current;
    if (!resizing || !start || e.touches.length !== 2) return;
    // No preventDefault here: React registers touchmove as PASSIVE, so the call would only log a
    // warning. The panel's `touchAction: 'none'` while resizing is what stops the page from scrolling.
    const [a, b] = [e.touches[0], e.touches[1]];
    const { natural, viewport } = measure();
    scale.set(scaleFromGesture(start, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), natural, viewport));
  };
  const onPinchEnd = () => {
    if (!gestureRef.current) return;
    gestureRef.current = null;
    persistScale();
  };

  // Capability gate FIRST, search second. Filtering here — at the one place the list is read — means
  // a gated shortcut cannot reach the dropdown, the keyboard-navigation index, or `handleRun`; a gate
  // applied only at render time would still let Enter fire a command with nothing behind it.
  const offered = availableItems(VS_CODE_SHORTCUTS);
  const filtered = offered.filter(s =>
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
      drag
      dragListener={false}
      dragControls={dragControls}
      dragMomentum={false}
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 40 }}
      style={{ pointerEvents: 'none', scale }}
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
    >
      <div
        ref={panelRef}
        onTouchStart={onPinchStart}
        onTouchMove={onPinchMove}
        onTouchEnd={onPinchEnd}
        onTouchCancel={onPinchEnd}
        style={{ touchAction: resizing ? 'none' : 'auto' }}
        className={cn(
          'relative w-full max-w-xl bg-surface border rounded-3xl shadow-3xl overflow-visible backdrop-blur-2xl flex flex-col pointer-events-auto cursor-default',
          resizing ? 'border-indigo-500/60 ring-2 ring-indigo-500/30' : 'border-line',
        )}
      >
        {/* Corner handles — only while resizing. Each is a 16px dot with a 32px hit area, because a
            finger is not a mouse pointer. */}
        {resizing && CORNERS.map((corner) => (
          <div
            key={corner}
            role="slider"
            aria-label={`Resize from ${corner} corner`}
            aria-valuenow={Math.round(scale.get() * 100)}
            onPointerDown={onCornerDown}
            onPointerMove={onCornerMove}
            onPointerUp={onCornerUp}
            onPointerCancel={onCornerUp}
            style={{ touchAction: 'none' }}
            className={cn('absolute z-[10006] w-8 h-8 flex items-center justify-center', CORNER_STYLE[corner])}
          >
            <div className="w-4 h-4 rounded-full bg-accent border-2 border-on-accent shadow-lg" />
          </div>
        ))}

        {/* Row 1: Context Header — the ONLY drag handle (a press on a button inside it is a click, not a move) */}
        <div
          onPointerDown={(e) => { if (!(e.target as HTMLElement).closest('button')) dragControls.start(e); }}
          className="flex items-center justify-between gap-2 p-4 bg-raised border-b border-line rounded-t-3xl touch-none cursor-grab active:cursor-grabbing"
        >
           <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 bg-indigo-500/20 rounded-xl shrink-0">
                 <Keyboard className="w-5 h-5 text-accent-text" />
              </div>
              <div className="min-w-0">
                 <h2 className="text-xs font-black text-ink uppercase tracking-[0.2em] truncate">NavBharat AI Code Studio</h2>
                 <p className="text-[9px] font-bold text-faint uppercase truncate">VS Code – Master Keyboard Shortcuts</p>
              </div>
           </div>

           <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setResizing((v) => !v)}
                aria-label="Resize"
                aria-pressed={resizing}
                title={resizing ? 'Done resizing' : 'Resize — drag a corner dot, or pinch'}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border',
                  resizing ? 'bg-accent text-on-accent border-transparent' : 'bg-well text-muted border-line hover:text-ink',
                )}
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{resizing ? 'Done' : 'Resize'}</span>
              </button>
              <button
                onClick={onClose}
                aria-label="Close"
                className="p-2 hover:bg-red-500/20 rounded-xl text-danger transition-all"
              >
                <X className="w-5 h-5" />
              </button>
           </div>
        </div>

        {/* Row 2: The Selector (Dropdown + Enter) */}
        <div className="p-4 sm:p-6 bg-well flex flex-col gap-5 relative">
           <div className="flex gap-3 h-14">
              {/* Dropdown Selector Box — `min-w-0` lets it shrink so the ENTER button beside it never
                  overflows the popup on a narrow phone (it did, at px-8 beside a flex-1 that could not give). */}
              <div className="relative flex-1 min-w-0" ref={dropdownRef}>
                 <button
                   onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                   className={cn(
                     "w-full h-full bg-raised border rounded-2xl px-4 flex items-center justify-between transition-all group",
                     isDropdownOpen ? "border-indigo-500/50 bg-raised" : "border-line hover:border-line"
                   )}
                 >
                    <div className="flex items-center gap-3 overflow-hidden">
                       <Search className="w-4 h-4 text-faint shrink-0" />
                       <span className={cn(
                         "text-sm font-bold truncate",
                         selectedShortcut ? "text-accent-text" : "text-faint"
                       )}>
                         {selectedShortcut ? `${selectedShortcut.label} (${selectedShortcut.key.toUpperCase()})` : "Select a shortcut function..."}
                       </span>
                    </div>
                    <ChevronDown className={cn("w-4 h-4 text-faint transition-transform shrink-0", isDropdownOpen && "rotate-180")} />
                 </button>

                 {/* Dropdown Options - Floating & Overflowing for better visibility */}
                 <AnimatePresence>
                   {isDropdownOpen && (
                     <motion.div
                       initial={{ opacity: 0, y: 10, scale: 0.95 }}
                       animate={{ opacity: 1, y: 0, scale: 1 }}
                       exit={{ opacity: 0, y: 10, scale: 0.95 }}
                       className="absolute left-[-12px] right-[-12px] sm:left-[-20px] sm:right-[-20px] top-[calc(100%+10px)] bg-surface border border-line rounded-3xl shadow-[0_32px_64px_-16px_rgba(0,0,0,0.8)] overflow-hidden z-[10005] flex flex-col max-h-[450px]"
                     >
                        <div className="p-4 border-b border-line bg-raised backdrop-blur-3xl">
                           <input
                              autoFocus
                              type="text"
                              placeholder="Search 100+ shortcuts..."
                              value={search}
                              onChange={(e) => { setSearch(e.target.value); setSelectedIndex(0); }}
                              onKeyDown={handleKeyDown}
                              className="w-full bg-raised border border-line rounded-2xl py-3.5 px-5 text-sm font-bold text-ink placeholder-faint outline-none focus:border-indigo-500/50 transition-all"
                           />
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar bg-well">
                           {filtered.map((s, idx) => {
                             const isSelected = selectedIndex === idx;
                             return (
                               <button
                                 key={`${s.category}-${s.key}`}
                                 onClick={() => handleSelect(s)}
                                 onMouseEnter={() => setSelectedIndex(idx)}
                                 className={cn(
                                   "w-full px-6 py-4 text-left transition-all border-b border-line last:border-0",
                                   isSelected ? "bg-indigo-600/20 text-ink" : "text-muted hover:bg-raised"
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
                                            "px-2 py-1 bg-scrim border rounded-lg text-[10px] font-black uppercase text-faint",
                                            isSelected ? "border-indigo-500/30 text-accent-text" : "border-line"
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

              {/* Enter Button — a fixed 56px square that can never push past the popup's edge */}
              <button
                onClick={handleRun}
                disabled={!selectedShortcut}
                aria-label="Run the selected shortcut"
                className={cn(
                  "shrink-0 w-14 h-full rounded-2xl flex flex-col items-center justify-center gap-0.5 font-black text-[9px] uppercase tracking-widest transition-all active:scale-95 shadow-xl",
                  selectedShortcut
                    ? "bg-indigo-500 hover:bg-indigo-400 text-on-accent shadow-indigo-500/20"
                    : "bg-raised text-faint cursor-not-allowed border border-line"
                )}
              >
                <CornerDownLeft className="w-4 h-4" />
                Enter
              </button>
           </div>

           {/* Secondary Actions */}
           <div className="flex items-center justify-between gap-3 px-1">
              <button
                onClick={onToggleCursor}
                className="flex items-center gap-2 text-faint hover:text-accent-text transition-colors font-black text-[10px] uppercase tracking-widest shrink-0"
              >
                <Move className="w-3 h-3" />
                Switch to Cursor Tool
              </button>
              {/* A hint, hidden where it would only truncate (under 640px it read "SELECT FU…"). */}
              <div className="hidden sm:block text-[9px] font-bold text-faint uppercase tracking-[0.2em] text-right truncate">
                 Select Function & Press Enter to Execute
              </div>
           </div>
        </div>

        {/* Footer Branding */}
        <div className="bg-well py-3 text-center border-t border-line rounded-b-3xl flex items-center justify-center gap-6">
           <span className="text-[8px] font-black uppercase tracking-[0.6em] text-faint italic">NavBharat AI Master Studio</span>
           <div className="h-3 w-px bg-raised" />
           <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)] animate-pulse text-on-accent" />
              <span className="text-[8px] font-black text-muted uppercase tracking-widest">Compiler Ready</span>
           </div>
        </div>
      </div>
    </motion.div>
  );
};
