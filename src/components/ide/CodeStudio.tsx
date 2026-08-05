import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Editor } from './Editor';
import { FileExplorer } from './FileExplorer';
import { ActivityBar } from './ActivityBar';
import { DebugPanel } from './DebugPanel';
import { TerminalPanel } from './TerminalPanel';
import { ProblemsPanel } from './ProblemsPanel';
import type { PreviewProblem } from '../../lib/previewProblems';
import { loadBreakpoints, serializeBreakpoints, toggleBreakpoint as toggleBpInMap, BREAKPOINTS_STORAGE_KEY, type BreakpointMap } from '../../lib/breakpoints';
import { CommandPalette } from './CommandPalette';
import { ExtensionMarket } from './ExtensionMarket';
import { GitPanel } from './GitPanel';
import { PreviewPanel } from './PreviewPanel';
import { AgentV3MiniChat } from './AgentV3MiniChat';
import { SecurityScan } from './SecurityScan';
import { VirtualKeyboard } from './VirtualKeyboard';
import { CursorPopup } from './CursorPopup';
import { IDEScreen, TerminalLine, Tab } from '../../types/ide';
import { AgentMode } from './ModeSelector';
import { ThemeMode, getThemeClasses, THEME_MODES } from '../../lib/theme';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';
import {
  Menu as MenuIcon, X, Maximize2, Minimize2,
  ChevronUp, ChevronDown, Rocket, Command, Search, Keyboard,
  Bot, Palette, Monitor, FileCode, Plus, AlignJustify, Map, Code2,
  MessageSquare, Sparkles, TestTube, FileText, Bug, ShieldCheck,
  BookOpen, Key, Layers, Moon, Smartphone, Database, Accessibility, Braces,
  RefreshCw, Shield, Package, Lock, Users, Cpu, Type, BarChart2, Activity, AlertTriangle, AlertCircle,
  Files as FilesIcon, GitBranch, Terminal as TerminalIcon
} from 'lucide-react';

interface CodeStudioProps {
  files: Record<string, string>;
  onFilesChange: (files: Record<string, string>) => void;
  /** Force pending edits to the durable store and resolve once they are really stored (Save). */
  onFlushEdits?: () => Promise<void>;
  /** Side-effect when files are deleted (clear durable storage; sync deletion to v5.0). */
  onFilesRemoved?: (paths: string[]) => void;
  onRun: (files: Record<string, string>) => void;
  /** The built preview HTML (same best-engine output the Pro preview uses). */
  generatedCode?: string;
  messages: any[];
  chatInput: string;
  onChatInputChange: (val: string) => void;
  onChatSend: () => void;
  isChatLoading: boolean;
  activeIntent?: string;
  /** Real compile-error problems from the live esbuild preview bundle (empty = compiled clean). */
  problems?: PreviewProblem[];
  /** v5.0 identity for the REAL terminal (runs commands in this user's warm sandbox). */
  v3WorkspaceId?: string;
  v3UserId?: string;
  v3Email?: string;
  pendingGHEdit?: any;
  onConfirmPush?: () => void;
  isGHPushing?: boolean;
  // GitHub Props
  githubToken: string | null;
  githubUser: any;
  githubRepoContext: any;
  isGHSyncing: boolean;
  onGHConnect: () => void;
  onGHDisconnect: () => void;
  onGHPush: (msg: string) => void;
  // Firebase Props
  firebaseToken?: string | null;
  firebaseUser?: any;
  onFirebaseConnect?: () => void;
  onFirebaseDisconnect?: () => void;
  isPinned: boolean;
  onTogglePin: () => void;
  isLoggedIn?: boolean;
  onShowLogin?: () => void;
  mode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
  onSocialChatTrigger?: () => void;
  activeAgent?: string;
  isAppBuilt?: boolean;
  onPreviewClick?: () => void;
  theme?: ThemeMode;
  onThemeChange?: (theme: ThemeMode) => void;
  onAgentChange?: (agent: string) => void;
  onGoToMain?: () => void;
  wallet?: any;
  onUnlockVishwakarma: () => void;
  /** N1-N9: Send a message directly to AI (bypasses controlled input state). */
  onSendDirect?: (text: string) => void;
}

export const CodeStudio: React.FC<CodeStudioProps> = React.memo(({
  files,
  onFilesChange,
  onFlushEdits,
  onFilesRemoved,
  onRun,
  generatedCode,
  messages,
  chatInput,
  onChatInputChange,
  onChatSend,
  isChatLoading,
  activeIntent = 'social',
  problems = [],
  v3WorkspaceId,
  v3UserId,
  v3Email,
  pendingGHEdit,
  onConfirmPush,
  isGHPushing,
  githubToken,
  githubUser,
  githubRepoContext,
  isGHSyncing,
  onGHConnect,
  onGHDisconnect,
  onGHPush,
  firebaseToken = null,
  firebaseUser = null,
  onFirebaseConnect = () => {},
  onFirebaseDisconnect = () => {},
  isPinned,
  onTogglePin,
  isLoggedIn = false,
  onShowLogin,
  mode,
  onModeChange,
  onSocialChatTrigger,
  activeAgent = 'navbharatai',
  isAppBuilt = false,
  onPreviewClick,
  theme = 'dark',
  onThemeChange,
  onAgentChange,
  onGoToMain,
  wallet,
  onUnlockVishwakarma,
  onSendDirect,
}) => {
  const themeClasses = getThemeClasses(theme);
  const [activeScreen, setActiveScreen] = useState<IDEScreen>(() => {
    const saved = localStorage.getItem('github_oauth_return_active_screen');
    return (saved as IDEScreen) || 'files';
  });
  const [activeFile, setActiveFile] = useState<string>(Object.keys(files)[0] || 'index.html');
  const [openTabs, setOpenTabs] = useState<Tab[]>(
    Object.keys(files).slice(0, 3).map(path => ({ path }))
  );

  /**
   * SPLIT EDITOR (admin 2026-08-04: "Code Studio ko sach me VS Code ke barabar chahiye").
   * Ctrl+\ used to be an honest no-op — the command existed, did nothing, and said so in a comment.
   *
   * This is a SECOND, fully independent editor group with its own tabs and its own active file, so
   * you can read a component beside the hook it calls, or a test beside the code under test. That is
   * the entire reason split view exists; a split that shows the same file twice is a toy.
   *
   * DELIBERATELY ADDITIVE: while `splitTabs` is empty every code path below behaves exactly as it did
   * before — same layout, same save, same focus. Nothing about the existing single-editor experience
   * is re-plumbed to make the split possible, so the feature cannot regress the common case.
   */
  const [splitTabs, setSplitTabs] = useState<Tab[]>([]);
  const [splitActive, setSplitActive] = useState<string>('');
  const splitOpen = splitTabs.length > 0;   // desktop-only; see handleSplitEditor

  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isPanelMaximized, setIsPanelMaximized] = useState(false);
  // Real "Problems" panel (esbuild compile errors from the live preview bundle).
  const [isProblemsPanelOpen, setIsProblemsPanelOpen] = useState(false);
  // P-DEV.3 — breakpoints (file → lines), persisted to localStorage; + the Debugger panel toggle.
  const [isDebugPanelOpen, setIsDebugPanelOpen] = useState(false);
  const [breakpoints, setBreakpoints] = useState<BreakpointMap>(() => {
    try { return loadBreakpoints(localStorage.getItem(BREAKPOINTS_STORAGE_KEY)); } catch { return {}; }
  });
  const persistBreakpoints = (next: BreakpointMap) => {
    setBreakpoints(next);
    try { localStorage.setItem(BREAKPOINTS_STORAGE_KEY, serializeBreakpoints(next)); } catch { /* ignore */ }
  };
  const handleToggleBreakpoint = (file: string, line: number) => persistBreakpoints(toggleBpInMap(breakpoints, file, line));
  const handleClearBreakpoint = (file: string, line: number) => persistBreakpoints(toggleBpInMap(breakpoints, file, line)); // toggle off an existing one
  const handleClearAllBreakpoints = () => persistBreakpoints({});
  const handleJumpToBreakpoint = (file: string, line: number) => {
    if (files[file] !== undefined) setActiveFile(file);
    setTimeout(() => {
      try {
        editorInstance?.revealLineInCenter?.(line);
        editorInstance?.setPosition?.({ lineNumber: line, column: 1 });
        editorInstance?.focus?.();
      } catch { /* best-effort jump */ }
    }, 80);
  };
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    return !!localStorage.getItem('github_oauth_return_active_screen') || true;
  });
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  // REAL MENU BAR (admin 2026-08-04: "mark kiye huye buttons kaam nahi kar rahe"). The six labels —
  // File / Edit / Selection / Run / Terminal / Help — were bare <span>s with hover styles and NO
  // onClick: they looked like VS Code menus and did nothing. That is exactly the "looks done but does
  // nothing" state the second absolute rule forbids. They are now real dropdown menus, VS Code-style:
  // click opens, hovering a sibling while one is open switches to it, Escape/click-away closes, and
  // every item routes through the SAME handleShortcut dispatcher the palette + keyboard already use —
  // one command path, no parallel fake wiring. Items that have no real implementation are simply not
  // listed (honesty rule: no dead entries).
  // The dropdown is rendered through a PORTAL onto document.body, not inline (admin 2026-08-04: the
  // menus did not visibly open on desktop). Inline, a dropdown is at the mercy of every ancestor: one
  // `overflow-hidden` or one stacking context anywhere up the tree — and this component has several,
  // including the root — silently clips or hides it, with no error and nothing to debug. A portal has
  // no ancestors but <body>, so that entire class of failure cannot happen. The anchor rect is captured
  // on open and the menu is positioned `fixed` from it.
  const [openMenu, setOpenMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  const menuBarRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openMenu) return;
    // Both the bar and the portalled dropdown carry data-ide-menu, so a click on a MENU ITEM is not
    // treated as "outside". Without that the mousedown would unmount the dropdown before the item's
    // click fired, and every entry would silently do nothing — the exact bug this menu is fixing.
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest?.('[data-ide-menu]')) setOpenMenu(null);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenMenu(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onEsc);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', onEsc); };
  }, [openMenu]);
  const [isCursorPopupOpen, setIsCursorPopupOpen] = useState(false);
  /**
   * The editor every command acts on. With a split open this FOLLOWS FOCUS — both panes report
   * themselves here when focused — so Find, Format, Undo and the status bar all target the pane the
   * user is actually typing in. Making one variable truthful is why ~40 existing call sites did not
   * have to learn about split view at all; the alternative (threading a "which pane?" argument
   * through every one of them) is how a feature like this quietly breaks half the menu.
   */
  const [editorInstance, setEditorInstance] = useState<any>(null);
  /** The LEFT pane specifically — for the effects that belong to the left group, not to focus. */
  const leftEditorRef = React.useRef<any>(null);
  /** Which group has focus. Forced to 'left' whenever no split is open. */
  const [focusedPane, setFocusedPane] = useState<'left' | 'right'>('left');
  const [isMobile, setIsMobile] = useState(false);
  // Phone bottom-tab bar (admin 2026-07-31): the "More" sheet holding the secondary dev tools.
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  // A2-A5: Editor display settings (persisted to localStorage)
  const [editorWordWrap, setEditorWordWrap] = useState<boolean>(() => localStorage.getItem('ide_wordWrap') !== 'off');
  const [editorMinimap, setEditorMinimap] = useState<boolean>(() => localStorage.getItem('ide_minimap') !== 'off');
  const [editorFontSize, setEditorFontSize] = useState<number>(() => Number(localStorage.getItem('ide_fontSize') || 14));
  const [editorTabSize, setEditorTabSize] = useState<number>(() => Number(localStorage.getItem('ide_tabSize') || 2));
  // A12: Format on Save; A13: Trim trailing whitespace; A14: Insert final newline
  const [editorFormatOnSave, setEditorFormatOnSave] = useState<boolean>(() => localStorage.getItem('ide_formatOnSave') !== 'off');
  const [editorTrimWhitespace, setEditorTrimWhitespace] = useState<boolean>(() => localStorage.getItem('ide_trimWhitespace') !== 'off');
  const [editorFinalNewline, setEditorFinalNewline] = useState<boolean>(() => localStorage.getItem('ide_finalNewline') !== 'off');
  // A17: Editor theme (dark/light)
  const [editorTheme, setEditorTheme] = useState<'vs-dark' | 'vs'>(() => (localStorage.getItem('ide_theme') as 'vs-dark' | 'vs') || 'vs-dark');
  // A10: Track per-file "saved" snapshots so we can show an unsaved-changes dot
  const savedFilesRef = React.useRef<Record<string, string>>({});
  const [dirtyTabs, setDirtyTabs] = useState<Set<string>>(new Set());
  // A24: Cursor position shown in status bar
  const [cursorPos, setCursorPos] = useState<{ line: number; col: number }>({ line: 1, col: 1 });
  // N1-N9: Selected code for AI action toolbar
  const [selectedCode, setSelectedCode] = useState<string>('');

  const handleScreenChange = (screen: IDEScreen) => {
    if (screen === 'shortcuts') {
      setIsShortcutsOpen(prev => !prev);
      return;
    }
    if (screen === 'cursor') {
      setIsCursorPopupOpen(prev => !prev);
      return;
    }
    setActiveScreen(screen);
    if (isMobile) {
      setIsSidebarOpen(true);
    }
  };

  // Responsive check
  useEffect(() => {
    const checkMobile = () => {
      // Find the app container to get its real width (since we constrained it to 500px)
      const appContainer = document.querySelector('.max-w-\\[500px\\]');
      const containerWidth = appContainer ? appContainer.clientWidth : window.innerWidth;
      
      const mobile = containerWidth < 800; // Increased threshold for "narrow" view
      setIsMobile(mobile);
      
      // If we just loaded with a saved oauth return screen, force sidebar open
      const hasRestoredScreen = localStorage.getItem('github_oauth_return_active_screen');
      if (hasRestoredScreen) {
        setIsSidebarOpen(true);
      } else {
        if (mobile) setIsSidebarOpen(false);
        else setIsSidebarOpen(true);
      }
    };
    checkMobile();
    // Use a small delay to ensure DOM is ready
    const timer = setTimeout(checkMobile, 100);
    window.addEventListener('resize', checkMobile);

    // Consume the one-shot OAuth-return screen key IMMEDIATELY so it can never linger to a later mount
    // and force the Git panel open again. ROOT CAUSE of "Git auto-opens every time": the old clear ran
    // on a 1000ms timer that unmount (line below) cancelled, so the key survived and re-opened Git on the
    // next IDE load. The initial `activeScreen`/`isSidebarOpen`/`hasRestoredScreen` reads above already
    // captured it for the legitimate single post-OAuth open; removing it now keeps that one-time behaviour
    // while guaranteeing Git only opens from an explicit menu click afterwards.
    localStorage.removeItem('github_oauth_return_active_screen');

    return () => {
      window.removeEventListener('resize', checkMobile);
      clearTimeout(timer);
    };
  }, []);

  // Sync tabs when active file changes
  useEffect(() => {
    if (activeFile && !openTabs.find(t => t.path === activeFile)) {
      setOpenTabs(prev => [...prev, { path: activeFile }]);
    }
  }, [activeFile]);

  // When the workspace file SET changes to a new project (e.g. a Cloud Sync GitHub-repo import replaces
  // all files), make sure the editor actually opens a REAL file: if the current activeFile no longer
  // exists in `files`, jump to the first file and reset the open tabs. Without this, after an import the
  // editor kept pointing at the previous project's file (e.g. index.html) — so the imported repo "didn't
  // show up" even though its files were already in the workspace. A normal edit keeps activeFile in
  // `files`, so this only fires on an import/replace, never on a keystroke.
  useEffect(() => {
    const keys = Object.keys(files);
    if (keys.length > 0 && (!activeFile || !(activeFile in files))) {
      setActiveFile(keys[0]);
      setOpenTabs([{ path: keys[0] }]);
    }
  }, [files]); // eslint-disable-line react-hooks/exhaustive-deps

  // A10: Snapshot file content when a tab is first opened (establishes the "saved" baseline)
  useEffect(() => {
    for (const tab of openTabs) {
      if (!(tab.path in savedFilesRef.current)) {
        savedFilesRef.current[tab.path] = files[tab.path] ?? '';
      }
    }
  }, [openTabs]); // eslint-disable-line react-hooks/exhaustive-deps

  // C21: Scroll editor to top whenever the active file changes.
  // Uses the LEFT editor explicitly, not `editorInstance`: that one follows focus, so with a split
  // open switching a LEFT tab would otherwise yank the RIGHT pane back to line 1 — losing the reader's
  // place in the very file they split the view to keep watching.
  useEffect(() => {
    const left = leftEditorRef.current;
    if (left) {
      left.revealLine(1);
      left.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });
    }
  }, [activeFile]); // eslint-disable-line react-hooks/exhaustive-deps

  // A24: subscribe to Monaco cursor position changes
  useEffect(() => {
    if (!editorInstance) return;
    const disposable = editorInstance.onDidChangeCursorPosition((e: any) => {
      setCursorPos({ line: e.position.lineNumber, col: e.position.column });
    });
    return () => disposable.dispose();
  }, [editorInstance]);

  // N1-N9: Track selected text for AI code action toolbar
  useEffect(() => {
    if (!editorInstance) return;
    const disposable = editorInstance.onDidChangeCursorSelection(() => {
      const selection = editorInstance.getSelection();
      if (selection && !selection.isEmpty()) {
        setSelectedCode(editorInstance.getModel()?.getValueInRange(selection) || '');
      } else {
        setSelectedCode('');
      }
    });
    return () => disposable.dispose();
  }, [editorInstance]);

  // Debounced live editor → preview sync: when the user edits a file in the Monaco
  // editor, refresh the preview automatically (after a short idle) using the SAME
  // build pipeline as the Run button — no duplicate bundler, no risk of a loop
  // (onRun rebuilds `generatedCode` from files; it never writes `files` back).
  const autoRunTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (autoRunTimer.current) clearTimeout(autoRunTimer.current); }, []);

  /**
   * Write an edit for ONE path. Extracted so the split pane edits its OWN file rather than whatever
   * the left pane happens to be showing — the bug that would make split view actively dangerous
   * (type in the right pane, corrupt the left pane's file).
   */
  const writeFileContent = (path: string, content: string) => {
    if (!path) return;
    const nextFiles = { ...files, [path]: content };
    onFilesChange(nextFiles);
    // A10: mark tab dirty if content differs from snapshot
    const savedContent = savedFilesRef.current[path] ?? content;
    setDirtyTabs(prev => {
      const next = new Set(prev);
      if (content !== savedContent) { next.add(path); } else { next.delete(path); }
      return next;
    });
    if (autoRunTimer.current) clearTimeout(autoRunTimer.current);
    autoRunTimer.current = setTimeout(() => { onRun(nextFiles); }, 900);
  };

  const handleFileChange = (content: string) => writeFileContent(activeFile, content);
  const handleSplitFileChange = (content: string) => writeFileContent(splitActive, content);

  /** Open the focused file in a second group beside the first (Ctrl+\ / View → Split Editor). */
  const handleSplitEditor = () => {
    // Never open a split on a phone: two Monaco panes would be ~180px each. Opening state we then
    // refuse to render is how a UI ends up with a border to nowhere.
    if (isMobile) return;
    const path = focusedPane === 'right' ? splitActive : activeFile;
    if (!path || files[path] === undefined) return;   // nothing real to split — never fake a pane
    setSplitTabs(prev => (prev.some(t => t.path === path) ? prev : [...prev, { path }]));
    setSplitActive(path);
    setFocusedPane('right');
  };

  const handleSplitTabClose = (path: string) => {
    setSplitTabs(prev => {
      const next = prev.filter(t => t.path !== path);
      if (path === splitActive) setSplitActive(next[next.length - 1]?.path || '');
      // Closing the last tab collapses the split, exactly as VS Code closes an empty editor group —
      // an empty pane taking half the screen is not a state anyone wants to be left in.
      if (next.length === 0) setFocusedPane('left');
      return next;
    });
  };

  /**
   * Save the focused file for real, and only report success once it is REALLY saved.
   *
   * Two steps, both required. `base.action.save` does the editor-side work (trim, final newline,
   * format-on-save, mark the tab clean). `onFlushEdits` then pushes the change to the durable
   * workspace and resolves once it is stored — the edit sync is debounced by 1.2s, so a "Saved ✓"
   * shown before that resolves would be a fake success message the user would trust and act on.
   * If the flush rejects, this rethrows and the button stays un-confirmed rather than lying.
   */
  const handleSaveActiveFile = async (): Promise<void> => {
    handleShortcut([], 'base.action.save');
    if (onFlushEdits) await onFlushEdits();
  };

  /** Collapse the second group entirely, returning focus to the first. */
  const closeSplitEditor = () => {
    setSplitTabs([]);
    setSplitActive('');
    setFocusedPane('left');
  };

  /** Open a path in the split pane (used by the split group's own go-to-definition / file links). */
  const openInSplit = (path: string) => {
    if (files[path] === undefined) return;
    setSplitTabs(prev => (prev.some(t => t.path === path) ? prev : [...prev, { path }]));
    setSplitActive(path);
    setFocusedPane('right');
  };

  // Keep the split group honest when files disappear (deleted, renamed, or a fresh build replaced the
  // workspace): a tab pointing at a file that no longer exists would render an empty editor that looks
  // like the file was emptied.
  useEffect(() => {
    if (splitTabs.length === 0) return;
    const surviving = splitTabs.filter(t => files[t.path] !== undefined);
    if (surviving.length === splitTabs.length) return;
    setSplitTabs(surviving);
    if (files[splitActive] === undefined) setSplitActive(surviving[surviving.length - 1]?.path || '');
    if (surviving.length === 0) setFocusedPane('left');
  }, [files]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTabClose = (path: string) => {
    const newTabs = openTabs.filter(t => t.path !== path);
    setOpenTabs(newTabs);
    if (activeFile === path) {
      setActiveFile(newTabs[newTabs.length - 1]?.path || '');
    }
  };

  const handleCreateFile = (name: string) => {
    onFilesChange({ ...files, [name]: '' });
    setActiveFile(name);
  };

  const handleDeleteFile = (path: string) => {
    const newFiles = { ...files };
    delete newFiles[path];
    onFilesChange(newFiles);
    handleTabClose(path);
    onFilesRemoved?.([path]);
  };

  // Batch delete (multi-select / delete-all): remove all paths in one state update + close tabs.
  const handleDeleteFiles = (paths: string[]) => {
    if (!paths.length) return;
    const newFiles = { ...files };
    for (const p of paths) delete newFiles[p];
    onFilesChange(newFiles);
    for (const p of paths) handleTabClose(p);
    onFilesRemoved?.(paths);
  };

  // N10-N12: Send a project-level AI action (no selection needed — whole project context)
  const sendProjectAction = (prompt: string) => {
    if (onSendDirect) {
      onSendDirect(prompt);
    } else {
      onChatInputChange(prompt);
    }
    handleScreenChange('ai');
    setIsSidebarOpen(true);
  };

  // N1-N9: Send selected code + action label to AI chat
  const sendCodeAction = (label: string, instruction: string) => {
    if (!selectedCode.trim()) return;
    const lang = activeFile.split('.').pop() || 'code';
    const prompt = `${instruction}:\n\n\`\`\`${lang}\n${selectedCode}\n\`\`\``;
    if (onSendDirect) {
      onSendDirect(prompt);
    } else {
      onChatInputChange(prompt);
    }
    handleScreenChange('ai');
    setIsSidebarOpen(true);
  };

  const handleRenameFile = (oldPath: string, newName: string) => {
    const target = (newName || '').trim();
    if (!target || target === oldPath || files[oldPath] === undefined) return;
    if (files[target] !== undefined) return; // don't overwrite an existing file
    // Rebuild preserving insertion order so the tree doesn't reshuffle.
    const next: Record<string, string> = {};
    for (const [p, c] of Object.entries(files)) next[p === oldPath ? target : p] = c;
    onFilesChange(next);
    setOpenTabs(prev => prev.map(t => (t.path === oldPath ? { path: target } : t)));
    if (activeFile === oldPath) setActiveFile(target);
  };

  const handleShortcut = (keys: string[], command?: string) => {

    // 1. Direct Editor Commands
    if (editorInstance && command && (command.startsWith('editor.') || command.startsWith('actions.') || command.startsWith('cursor') || command === 'undo' || command === 'redo' || command === 'acceptSelectedSuggestion')) {
      editorInstance.focus();
      editorInstance.trigger('keyboard', command, {});
    }

    // 2. Workbench/IDE Level Commands
    if (command) {
      switch (command) {
        case 'workbench.action.toggleSidebarVisibility':
          setIsSidebarOpen(prev => !prev);
          break;
        case 'workbench.actions.view.problems':
          setIsProblemsPanelOpen(prev => !prev);
          break;
        case 'workbench.action.terminal.toggleTerminal':
        case 'workbench.action.output.toggleOutput':
          setIsPanelOpen(prev => !prev);
          break;
        case 'workbench.view.explorer':
          setActiveScreen('files');
          setIsSidebarOpen(true);
          break;
        case 'workbench.action.findInFiles':
        case 'workbench.action.replaceInFiles':
          setActiveScreen('search');
          setIsSidebarOpen(true);
          break;
        case 'workbench.view.scm':
          setActiveScreen('git');
          setIsSidebarOpen(true);
          break;
        case 'workbench.view.debug':
          setActiveScreen('debug');
          setIsSidebarOpen(true);
          break;
        case 'workbench.view.extensions':
          setActiveScreen('extensions');
          setIsSidebarOpen(true);
          break;
        case 'editor.action.quickCommand':
          setIsCommandPaletteOpen(true);
          break;
        case 'workbench.action.openSettings':
          setActiveScreen('settings');
          setIsSidebarOpen(true);
          break;
        case 'workbench.action.toggleMaximizedPanel':
          setIsPanelOpen(prev => !prev);
          break;
        case 'workbench.action.files.saveAll': {
          // REAL save-all (was a console.log stub): apply the same trim/final-newline/format-on-save
          // rules base.action.save uses, to EVERY dirty tab, in one files update.
          if (dirtyTabs.size > 0) {
            const next = { ...files };
            dirtyTabs.forEach((path) => {
              let content = next[path] ?? '';
              if (editorTrimWhitespace) content = content.replace(/[^\S\n]+$/gm, '');
              if (editorFinalNewline && content.length > 0 && !content.endsWith('\n')) content += '\n';
              next[path] = content;
              savedFilesRef.current[path] = content;
            });
            onFilesChange(next);
            // Save All rewrites every buffer; push the result into whichever pane is focused, using
            // THAT pane's file — pushing activeFile's text into a focused right pane would overwrite
            // the wrong document on screen.
            {
              const visiblePath = splitOpen && focusedPane === 'right' ? splitActive : activeFile;
              if (next[visiblePath] !== undefined) editorInstance?.setValue(next[visiblePath]);
            }
            if (editorFormatOnSave) editorInstance?.getAction('editor.action.formatDocument')?.run();
            setDirtyTabs(new Set());
          }
          break;
        }
        case 'markdown.showPreview':
          // REAL: open the live Preview surface (was a console.log stub).
          setActiveScreen('preview');
          break;
        case 'workbench.action.quickOpen':
          setIsCommandPaletteOpen(true);
          break;
        case 'workbench.action.newWindow':
          window.open(window.location.href, '_blank');
          break;
        case 'workbench.action.closeActiveEditor':
          if (activeFile) handleTabClose(activeFile);
          break;
        case 'workbench.action.nextEditor':
        case 'workbench.action.nextEditorInGroup':
          if (activeFile) {
            const idx = openTabs.findIndex(t => t.path === activeFile);
            if (idx !== -1 && idx < openTabs.length - 1) setActiveFile(openTabs[idx + 1].path);
          }
          break;
        case 'workbench.action.previousEditor':
        case 'workbench.action.previousEditorInGroup':
          if (activeFile) {
            const idx = openTabs.findIndex(t => t.path === activeFile);
            if (idx > 0) setActiveFile(openTabs[idx - 1].path);
          }
          break;
        case 'workbench.action.openGlobalKeybindings':
          setIsShortcutsOpen(true);
          break;
        case 'workbench.action.terminal.new':
          setIsPanelOpen(true);
          break;
        case 'workbench.action.debug.start':
          // REAL: open the Debug panel (was a console.log stub).
          setIsDebugPanelOpen(true);
          break;
        case 'workbench.action.debug.stop':
          setIsDebugPanelOpen(false);
          break;
        case 'workbench.action.navigateBack':
          window.history.back();
          break;
        case 'workbench.action.navigateForward':
          window.history.forward();
          break;
        case 'workbench.action.toggleZenMode':
          // Toggle full screen or similar
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            document.documentElement.requestFullscreen();
          }
          break;
        case 'explorer.newFile': {
          // REAL New File (Ctrl+N was advertised but had no handler → did nothing).
          const name = (window.prompt('New file name (e.g. index.html)') || '').trim();
          if (name) handleCreateFile(name);
          break;
        }
        case 'workbench.action.splitEditor':
          handleSplitEditor();
          break;
        case 'workbench.action.focusFirstEditorGroup':
          if (editorInstance) editorInstance.focus();
          break;
        case 'workbench.action.toggleDevTools':
          // Cannot open Chrome dev tools via JS, but can log guidance
          console.log('Press F12 or Ctrl+Shift+I to open DevTools');
          break;
        case 'base.action.save': {
          // Ctrl+S saves the file you are LOOKING at. With a split open that is the focused pane's
          // file — saving the left pane's file while the user types in the right one would write the
          // wrong buffer to disk, which is the worst thing a save button can do.
          const savePath = splitOpen && focusedPane === 'right' ? splitActive : activeFile;
          if (!savePath) break;
          let finalContent = files[savePath] || '';
          // A13: Trim trailing whitespace
          if (editorTrimWhitespace) finalContent = finalContent.replace(/[^\S\n]+$/gm, '');
          // A14: Insert final newline
          if (editorFinalNewline && finalContent.length > 0 && !finalContent.endsWith('\n')) finalContent += '\n';
          if (finalContent !== (files[savePath] || '')) {
            onFilesChange({ ...files, [savePath]: finalContent });
            editorInstance?.setValue(finalContent);
          }
          // A12: Format on Save
          if (editorFormatOnSave) editorInstance?.getAction('editor.action.formatDocument')?.run();
          // A10: mark file as saved
          savedFilesRef.current[savePath] = finalContent;
          setDirtyTabs(prev => { const next = new Set(prev); next.delete(savePath); return next; });
          break;
        }
      }
    }

    // Keys-based fallback — ONLY when no command was handled above. ROOT-CAUSE FIX (admin 2026-07-31):
    // this block used to run UNCONDITIONALLY, so a tap that ALSO passed a command (every VirtualKeyboard
    // shortcut does) fired twice — e.g. "Toggle Sidebar" (Ctrl+B) toggled on THEN off = a dead no-op,
    // and "Select Next" (Ctrl+D) selected twice. Gating on `!command` makes each shortcut fire exactly
    // once, whether it comes from a tap (command given) or the global key listener (keys only).
    if (!command) {
      const shortcutStr = keys.join('+').toLowerCase();
      if (shortcutStr.includes('ctrl+shift+p')) {
        setIsCommandPaletteOpen(true);
      } else if (shortcutStr.includes('ctrl+b')) {
        setIsSidebarOpen(prev => !prev);
      } else if (shortcutStr.includes('ctrl+j')) {
        setIsPanelOpen(prev => !prev);
      } else if (shortcutStr.includes('ctrl+g')) {
        // A15: Go to Line
        editorInstance?.getAction('editor.action.gotoLine')?.run();
      } else if (shortcutStr.includes('ctrl+d')) {
        // A18: Select next occurrence (adds cursor to next match)
        editorInstance?.getAction('editor.action.addSelectionToNextFindMatch')?.run();
      }
    }
  };

  // GLOBAL KEYBOARD SHORTCUTS (admin 2026-07-31): CodeStudio had NO physical-keyboard listener, so the
  // workbench shortcuts (Ctrl+S / Ctrl+Shift+S / Ctrl+B / Ctrl+J / Ctrl+P / Ctrl+Shift+P) never fired —
  // the shortcuts looked dead. This wires them for real. We deliberately do NOT intercept the
  // editor-native combos (Ctrl+F find, Ctrl+G go-to-line, Ctrl+D add-selection) — Monaco already
  // handles those when the editor is focused (and the toolbar buttons cover them otherwise), so
  // intercepting here would double-fire. A ref keeps the listener pinned once while always calling the
  // latest handleShortcut closure (fresh files/activeFile/editor state).
  const shortcutHandlerRef = React.useRef(handleShortcut);
  shortcutHandlerRef.current = handleShortcut;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const call = (keys: string[], command?: string) => { e.preventDefault(); shortcutHandlerRef.current(keys, command); };
      switch (e.key.toLowerCase()) {
        case 'p': e.shiftKey ? call(['ctrl', 'shift', 'p']) : call(['ctrl', 'p'], 'workbench.action.quickOpen'); break;
        case 's': e.shiftKey ? call(['ctrl', 'shift', 's'], 'workbench.action.files.saveAll') : call(['ctrl', 's'], 'base.action.save'); break;
        case 'b': call(['ctrl', 'b']); break;
        case 'j': call(['ctrl', 'j']); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleCommandAction = (id: string) => {
    // Map palette command ids onto the existing shortcut/screen handlers.
    switch (id) {
      case 'files-new': {
        const name = (window.prompt('New file name (e.g. index.html)') || '').trim();
        if (name) handleCreateFile(name);
        break;
      }
      case 'settings-open': handleScreenChange('settings'); setIsSidebarOpen(true); break;
      case 'git-commit': handleScreenChange('git'); setIsSidebarOpen(true); break;
      case 'theme-dark': if (onThemeChange) onThemeChange('dark'); break;
      default: break;
    }
  };

  const renderSidebarContent = () => {
    switch (activeScreen) {
      case 'files':
        return (
          <FileExplorer
            files={files}
            activeFile={activeFile}
            onFileSelect={(f) => {
                setActiveFile(f);
                if (isMobile) setIsSidebarOpen(false);
            }}
            onFileCreate={handleCreateFile}
            onFileDelete={handleDeleteFile}
            onFilesDelete={handleDeleteFiles}
            onFileRename={handleRenameFile}
            dirtyTabs={dirtyTabs}
            githubRepoUrl={githubRepoContext?.html_url}
            githubBranch={githubRepoContext?.default_branch || 'main'}
          />
        );
      case 'search': {
        const q = searchQuery.trim();
        const results: { path: string; line: number; text: string }[] = [];
        if (q) {
          const needle = q.toLowerCase();
          for (const [path, content] of Object.entries(files)) {
            const lines = (content || '').split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(needle)) {
                results.push({ path, line: i + 1, text: lines[i].trim().slice(0, 140) });
                if (results.length > 500) break;
              }
            }
            if (results.length > 500) break;
          }
        }
        const fileCount = new Set(results.map(r => r.path)).size;
        const doReplaceAll = () => {
          if (!q) return;
          const next: Record<string, string> = {};
          for (const [path, content] of Object.entries(files)) {
            next[path] = (content || '').split(q).join(replaceQuery);
          }
          onFilesChange(next);
        };
        return (
           <div className="flex flex-col h-full bg-[#161b22]">
              <div className="p-4 space-y-2 border-b border-white/5 shrink-0">
                 <h3 className="text-white font-black uppercase tracking-widest text-[10px] mb-1 flex items-center gap-2"><Search className="w-3 h-3" /> Search</h3>
                 <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoFocus
                    className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-xs outline-none focus:border-indigo-500/50"
                    placeholder="Search all files…"
                 />
                 <div className="flex gap-2">
                    <input
                       value={replaceQuery}
                       onChange={(e) => setReplaceQuery(e.target.value)}
                       className="flex-1 bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-xs outline-none focus:border-indigo-500/50"
                       placeholder="Replace with…"
                    />
                    <button
                       onClick={doReplaceAll}
                       disabled={!q}
                       title="Replace all occurrences in every file"
                       className="px-3 rounded-lg bg-indigo-600 disabled:opacity-40 text-white text-[10px] font-bold flex items-center gap-1 whitespace-nowrap"
                    >
                       Replace All
                    </button>
                 </div>
                 {q && (
                    <p className="text-[10px] text-[#8b949e] font-medium">
                       {results.length}{results.length > 500 ? '+' : ''} match{results.length === 1 ? '' : 'es'} in {fileCount} file{fileCount === 1 ? '' : 's'}
                    </p>
                 )}
              </div>
              <div className="flex-1 overflow-y-auto">
                 {results.map((r, i) => (
                    <button
                       key={`${r.path}:${r.line}:${i}`}
                       onClick={() => { setActiveFile(r.path); if (isMobile) setIsSidebarOpen(false); }}
                       className="w-full text-left px-4 py-2 hover:bg-white/5 border-b border-white/[0.03]"
                    >
                       <div className="text-[10px] text-indigo-300 font-mono truncate">{r.path}:{r.line}</div>
                       <div className="text-[11px] text-[#c9d1d9] font-mono truncate">{r.text || '(empty line)'}</div>
                    </button>
                 ))}
                 {q && results.length === 0 && (
                    <p className="p-4 text-[11px] text-[#8b949e]">No matches for “{q}”.</p>
                 )}
                 {!q && (
                    <p className="p-4 text-[11px] text-[#8b949e]">Type above to search across all project files. Click a result to open it.</p>
                 )}
              </div>
           </div>
        );
      }
      case 'git': 
        return (
          <GitPanel 
            token={githubToken}
            user={githubUser}
            repoContext={githubRepoContext}
            isSyncing={isGHSyncing}
            isPushing={isGHPushing || false}
            onConnect={onGHConnect}
            onDisconnect={onGHDisconnect}
            onPush={onGHPush}
            files={files}
            firebaseToken={firebaseToken}
            firebaseUser={firebaseUser}
            onFirebaseConnect={onFirebaseConnect}
            onFirebaseDisconnect={onFirebaseDisconnect}
            onFilesChange={onFilesChange}
            onAgentChange={onAgentChange}
            onToggleView={(view) => {
              if (view === 'nbi_chat') {
                setActiveScreen('ai');
              } else {
                setActiveScreen(view);
              }
            }}
            onActivatePreview={onPreviewClick}
          />
        );
      case 'extensions': return <ExtensionMarket />;
      case 'ai':
        // Code Studio's AI chat IS NavBharatAI Pro v5.0 (AgentV3) — the SAME session/memory/file-write
        // engine as the main v5.0 panel, not the separate "Free" chat AI. Root-caused 2026-07-01: this
        // used to render <AIChat> wired to the Free-tier text-only endpoint, which has zero file
        // access and is explicitly instructed server-side to never write code — so it could only talk
        // ABOUT a file, never act on one. v3UserId/v3Email (already threaded in for the terminal below)
        // give it the same identity; getAgentV3SessionId/getAgentV3WorkspaceId (shared with
        // AgentV3Panel via the same localStorage key) put it on the exact same workspace.
        return <AgentV3MiniChat userId={v3UserId} email={v3Email} />;
      case 'settings':
        return (
          <div className="p-6 h-full bg-[#161b22] space-y-6">
             <h3 className="text-white font-black uppercase tracking-widest text-[10px]">User Preferences</h3>
             <div className="space-y-4">
                 {['General', 'Editor', 'Terminal', 'Extensions'].map(s => (
                    <div key={s} className="flex items-center justify-between p-3 bg-black/20 rounded-xl border border-white/5 hover:border-white/10 cursor-pointer">
                       <span className="text-xs font-medium text-[#c9d1d9]">{s}</span>
                       <ChevronDown className="w-3.5 h-3.5 text-[#484f58]" />
                    </div>
                 ))}
                 <div className="space-y-2">
                    <label className="text-[9px] font-black text-[#8b949e] uppercase">Interface Theme</label>
                    <select 
                       value={theme}
                       onChange={(e) => {
                         const newTheme = e.target.value as ThemeMode;
                         if (onThemeChange) onThemeChange(newTheme);
                       }}
                       className="w-full bg-black/20 border border-white/5 rounded-lg px-4 py-3 text-xs outline-none focus:border-indigo-500/50 appearance-none text-[#c9d1d9]"
                    >
                       {THEME_MODES.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                    </select>
                 </div>
             </div>
          </div>
        );
      case 'security':
        return (
          <div className="p-6 h-full bg-[#161b22] space-y-4">
             <h3 className="text-white font-black uppercase tracking-widest text-[10px]">Security Center</h3>
             <p className="text-[10px] text-[#8b949e] font-medium leading-relaxed">Launch a deep security audit of your codebase to identify vulnerabilities, secrets, and misconfigurations.</p>
             <button onClick={() => setActiveScreen('security')} className="w-full py-3 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-indigo-600/20">Enter Security Hub</button>
          </div>
        );
      default: return null;
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--theme-bg)] transition-colors duration-500 overflow-hidden relative">
      <CommandPalette 
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onAction={handleCommandAction}
      />

      <AnimatePresence>
        {isShortcutsOpen && (
          <VirtualKeyboard 
            onClose={() => setIsShortcutsOpen(false)} 
            onShortcutTrigger={handleShortcut}
            onToggleCursor={() => {
              setIsShortcutsOpen(false);
              setIsCursorPopupOpen(true);
            }}
          />
        )}
      </AnimatePresence>

      {/* IDE Top Helper Bar (Quick Access) */}
      <div className="h-9 bg-[var(--theme-card)] flex items-center justify-between px-3 shrink-0 border-b border-black/10 select-none">
         <div className="flex items-center gap-4">
            {/* IDE menu (☰ NavBharat IDE): opens the IDE's FILE EXPLORER sidebar — NOT the AI chat (admin
                2026-07-31). It used to only toggle isSidebarOpen, so if activeScreen was left on 'ai' the
                menu showed the AI panel. Force the 'files' screen; a second tap while already on files closes it. */}
            <div className="flex items-center gap-1.5 cursor-pointer hover:bg-white/5 px-2 py-1 rounded transition-colors" onClick={() => { if (isSidebarOpen && activeScreen === 'files') { setIsSidebarOpen(false); } else { setActiveScreen('files'); setIsSidebarOpen(true); } }}>
               <MenuIcon className="w-4 h-4 text-white/70" />
               <span className="text-[11px] text-white/80 font-medium">NavBharat IDE</span>
            </div>
            <div ref={menuBarRef} data-ide-menu className="hidden md:flex items-center gap-0.5 text-[11px] text-white/60 font-medium relative">
               {([
                 { name: 'File', items: [
                   { label: 'New File…', shortcut: 'Ctrl+N', run: () => handleShortcut([], 'explorer.newFile') },
                   { label: 'New Window', run: () => handleShortcut([], 'workbench.action.newWindow') },
                   { divider: true },
                   { label: 'Save', shortcut: 'Ctrl+S', run: () => handleShortcut([], 'base.action.save') },
                   { label: 'Save All', shortcut: 'Ctrl+Shift+S', run: () => handleShortcut([], 'workbench.action.files.saveAll') },
                   { divider: true },
                   { label: 'Close Editor', shortcut: 'Ctrl+W', run: () => handleShortcut([], 'workbench.action.closeActiveEditor') },
                   { divider: true },
                   { label: 'Settings', run: () => handleShortcut([], 'workbench.action.openSettings') },
                   { label: 'Keyboard Shortcuts', run: () => handleShortcut([], 'workbench.action.openGlobalKeybindings') },
                 ] },
                 { name: 'Edit', items: [
                   { label: 'Undo', shortcut: 'Ctrl+Z', run: () => handleShortcut([], 'undo') },
                   { label: 'Redo', shortcut: 'Ctrl+Y', run: () => handleShortcut([], 'redo') },
                   { divider: true },
                   { label: 'Cut', shortcut: 'Ctrl+X', run: () => handleShortcut([], 'editor.action.clipboardCutAction') },
                   { label: 'Copy', shortcut: 'Ctrl+C', run: () => handleShortcut([], 'editor.action.clipboardCopyAction') },
                   { label: 'Paste', shortcut: 'Ctrl+V', run: async () => {
                     // A menu click loses the native paste gesture, so read the clipboard explicitly (the
                     // browser may ask permission once) and insert at the cursor — a REAL paste, not a stub.
                     try {
                       const text = await navigator.clipboard.readText();
                       const sel = editorInstance?.getSelection();
                       if (text && sel) { editorInstance?.executeEdits('menu-paste', [{ range: sel, text, forceMoveMarkers: true }]); editorInstance?.focus(); }
                     } catch { /* clipboard permission denied — Ctrl+V still works in the editor */ }
                   } },
                   { divider: true },
                   { label: 'Find', shortcut: 'Ctrl+F', run: () => editorInstance?.getAction('actions.find')?.run() },
                   { label: 'Replace', shortcut: 'Ctrl+H', run: () => editorInstance?.getAction('editor.action.startFindReplaceAction')?.run() },
                   { label: 'Find in Files', shortcut: 'Ctrl+Shift+F', run: () => handleShortcut([], 'workbench.action.findInFiles') },
                   { divider: true },
                   { label: 'Toggle Line Comment', shortcut: 'Ctrl+/', run: () => editorInstance?.getAction('editor.action.commentLine')?.run() },
                   { label: 'Format Document', shortcut: 'Shift+Alt+F', run: () => editorInstance?.getAction('editor.action.formatDocument')?.run() },
                 ] },
                 { name: 'Selection', items: [
                   { label: 'Select All', shortcut: 'Ctrl+A', run: () => editorInstance?.getAction('editor.action.selectAll')?.run() },
                   { label: 'Expand Selection', shortcut: 'Shift+Alt+→', run: () => editorInstance?.getAction('editor.action.smartSelect.expand')?.run() },
                   { label: 'Add Next Occurrence', shortcut: 'Ctrl+D', run: () => editorInstance?.getAction('editor.action.addSelectionToNextFindMatch')?.run() },
                   { divider: true },
                   { label: 'Add Cursor Above', shortcut: 'Ctrl+Alt+↑', run: () => editorInstance?.getAction('editor.action.insertCursorAbove')?.run() },
                   { label: 'Add Cursor Below', shortcut: 'Ctrl+Alt+↓', run: () => editorInstance?.getAction('editor.action.insertCursorBelow')?.run() },
                   { divider: true },
                   { label: 'Move Line Up', shortcut: 'Alt+↑', run: () => editorInstance?.getAction('editor.action.moveLinesUpAction')?.run() },
                   { label: 'Move Line Down', shortcut: 'Alt+↓', run: () => editorInstance?.getAction('editor.action.moveLinesDownAction')?.run() },
                   { label: 'Copy Line Down', shortcut: 'Shift+Alt+↓', run: () => editorInstance?.getAction('editor.action.copyLinesDownAction')?.run() },
                 ] },
                 { name: 'View', items: [
                   // Split view was reachable only by Ctrl+\ — a feature nobody can find is a feature
                   // nobody has. It lives in View, exactly where VS Code puts it.
                   { label: splitOpen ? 'Close Split Editor' : 'Split Editor', shortcut: 'Ctrl+\\', run: () => (splitOpen ? closeSplitEditor() : handleSplitEditor()) },
                   { divider: true },
                   { label: 'Explorer', run: () => { setIsSidebarOpen(true); setActiveScreen('files'); } },
                   { label: 'Problems', run: () => handleShortcut([], 'workbench.actions.view.problems') },
                   { label: 'Terminal', shortcut: 'Ctrl+J', run: () => handleShortcut([], 'workbench.action.terminal.toggleTerminal') },
                   { divider: true },
                   { label: 'Command Palette', shortcut: 'Ctrl+Shift+P', run: () => setIsCommandPaletteOpen(true) },
                 ] },
                 { name: 'Run', items: [
                   { label: 'Open Preview', run: () => handleShortcut([], 'markdown.showPreview') },
                   { divider: true },
                   { label: 'Start Debugging', shortcut: 'F5', run: () => handleShortcut([], 'workbench.action.debug.start') },
                   { label: 'Stop Debugging', shortcut: 'Shift+F5', run: () => handleShortcut([], 'workbench.action.debug.stop') },
                   { divider: true },
                   { label: 'Problems Panel', run: () => handleShortcut([], 'workbench.actions.view.problems') },
                 ] },
                 { name: 'Terminal', items: [
                   { label: 'New Terminal', run: () => handleShortcut([], 'workbench.action.terminal.new') },
                   { label: 'Toggle Terminal', shortcut: 'Ctrl+J', run: () => handleShortcut([], 'workbench.action.terminal.toggleTerminal') },
                 ] },
                 { name: 'Help', items: [
                   { label: 'Command Palette', shortcut: 'Ctrl+Shift+P', run: () => setIsCommandPaletteOpen(true) },
                   { label: 'Keyboard Shortcuts', run: () => setIsShortcutsOpen(true) },
                   { divider: true },
                   { label: 'Toggle Full Screen', run: () => handleShortcut([], 'workbench.action.toggleZenMode') },
                 ] },
               ] as Array<{ name: string; items: Array<{ label?: string; shortcut?: string; run?: () => void; divider?: boolean }> }>).map((menu) => (
                 <div key={menu.name} className="relative">
                   <button
                     className={`px-2 py-1 rounded transition-colors ${openMenu?.name === menu.name ? 'bg-white/10 text-white' : 'hover:text-white hover:bg-white/5'}`}
                     onClick={(e) => {
                       if (openMenu?.name === menu.name) { setOpenMenu(null); return; }
                       const r = e.currentTarget.getBoundingClientRect();
                       setOpenMenu({ name: menu.name, x: r.left, y: r.bottom + 4 });
                     }}
                     onMouseEnter={(e) => {
                       if (!openMenu || openMenu.name === menu.name) return;
                       const r = e.currentTarget.getBoundingClientRect();
                       setOpenMenu({ name: menu.name, x: r.left, y: r.bottom + 4 });
                     }}
                   >{menu.name}</button>
                   {openMenu?.name === menu.name && createPortal(
                     <div
                       data-ide-menu
                       style={{ position: 'fixed', left: openMenu.x, top: openMenu.y }}
                       className="min-w-[230px] bg-[#1c2128] border border-white/10 rounded-lg shadow-2xl shadow-black/50 py-1 z-[9998]">
                       {menu.items.map((item, i) => item.divider ? (
                         <div key={i} className="h-px bg-white/10 my-1 mx-2" />
                       ) : (
                         <button
                           key={i}
                           className="w-full flex items-center justify-between gap-6 px-3 py-1.5 text-left text-[11px] text-white/80 hover:bg-indigo-600 hover:text-white transition-colors"
                           onClick={() => { setOpenMenu(null); item.run?.(); }}
                         >
                           <span>{item.label}</span>
                           {item.shortcut && <span className="text-[9px] opacity-50 font-mono">{item.shortcut}</span>}
                         </button>
                       ))}
                     </div>,
                     document.body,
                   )}
                 </div>
               ))}
            </div>
         </div>
         
         {/* A2-A6: Editor quick-settings toolbar */}
         <div className="hidden md:flex items-center gap-1 mx-4">
           <button
             onClick={() => { const v = !editorWordWrap; setEditorWordWrap(v); localStorage.setItem('ide_wordWrap', v ? 'on' : 'off'); }}
             title={`Word wrap: ${editorWordWrap ? 'on' : 'off'}`}
             className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest transition-all ${editorWordWrap ? 'text-indigo-400 bg-indigo-900/30' : 'text-[#484f58] hover:text-white'}`}
           >
             <AlignJustify className="w-3 h-3" />
           </button>
           <button
             onClick={() => { const v = !editorMinimap; setEditorMinimap(v); localStorage.setItem('ide_minimap', v ? 'on' : 'off'); }}
             title={`Minimap: ${editorMinimap ? 'on' : 'off'}`}
             className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest transition-all ${editorMinimap ? 'text-indigo-400 bg-indigo-900/30' : 'text-[#484f58] hover:text-white'}`}
           >
             <Map className="w-3 h-3" />
           </button>
           <button
             onClick={() => { const v = Math.max(10, editorFontSize - 1); setEditorFontSize(v); localStorage.setItem('ide_fontSize', String(v)); }}
             title="Decrease font size"
             className="p-0.5 text-[#484f58] hover:text-white rounded transition-colors"
           >
             <ChevronDown className="w-3 h-3" />
           </button>
           <span className="text-[9px] font-mono text-[#484f58] select-none w-5 text-center">{editorFontSize}</span>
           <button
             onClick={() => { const v = Math.min(30, editorFontSize + 1); setEditorFontSize(v); localStorage.setItem('ide_fontSize', String(v)); }}
             title="Increase font size"
             className="p-0.5 text-[#484f58] hover:text-white rounded transition-colors"
           >
             <ChevronUp className="w-3 h-3" />
           </button>
           {/* A5: Tab size selector */}
           <div className="flex items-center gap-0.5 bg-white/5 rounded px-1">
             {[2, 4].map(size => (
               <button
                 key={size}
                 onClick={() => { setEditorTabSize(size); localStorage.setItem('ide_tabSize', String(size)); }}
                 title={`Tab size: ${size}`}
                 className={`px-1 py-0.5 rounded text-[9px] font-mono transition-all ${editorTabSize === size ? 'text-indigo-400 font-black' : 'text-[#484f58] hover:text-white'}`}
               >
                 {size}
               </button>
             ))}
           </div>
           {/* A6: Format document */}
           <button
             onClick={() => editorInstance?.getAction('editor.action.formatDocument')?.run()}
             title="Format document (Shift+Alt+F)"
             className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest text-[#484f58] hover:text-white transition-all"
           >
             <Code2 className="w-3 h-3" />
           </button>
           {/* A17: Light/dark theme toggle */}
           <button
             onClick={() => { const v = editorTheme === 'vs-dark' ? 'vs' : 'vs-dark'; setEditorTheme(v); localStorage.setItem('ide_theme', v); }}
             title={`Editor theme: ${editorTheme === 'vs-dark' ? 'Dark' : 'Light'} (click to toggle)`}
             className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest transition-all ${editorTheme === 'vs' ? 'text-amber-400 bg-amber-900/20' : 'text-[#484f58] hover:text-white'}`}
           >{editorTheme === 'vs-dark' ? '🌙' : '☀️'}</button>
           {/* A12: Format on Save toggle */}
           <button
             onClick={() => { const v = !editorFormatOnSave; setEditorFormatOnSave(v); localStorage.setItem('ide_formatOnSave', v ? 'on' : 'off'); }}
             title={`Format on Save: ${editorFormatOnSave ? 'on' : 'off'} (Ctrl+S)`}
             className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest transition-all ${editorFormatOnSave ? 'text-indigo-400 bg-indigo-900/30' : 'text-[#484f58] hover:text-white'}`}
           >Fmt</button>
           {/* A13: Trim whitespace toggle */}
           <button
             onClick={() => { const v = !editorTrimWhitespace; setEditorTrimWhitespace(v); localStorage.setItem('ide_trimWhitespace', v ? 'on' : 'off'); }}
             title={`Trim trailing whitespace on Save: ${editorTrimWhitespace ? 'on' : 'off'}`}
             className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest transition-all ${editorTrimWhitespace ? 'text-indigo-400 bg-indigo-900/30' : 'text-[#484f58] hover:text-white'}`}
           >Trim</button>
           {/* A14: Final newline toggle */}
           <button
             onClick={() => { const v = !editorFinalNewline; setEditorFinalNewline(v); localStorage.setItem('ide_finalNewline', v ? 'on' : 'off'); }}
             title={`Insert final newline on Save: ${editorFinalNewline ? 'on' : 'off'}`}
             className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest transition-all ${editorFinalNewline ? 'text-indigo-400 bg-indigo-900/30' : 'text-[#484f58] hover:text-white'}`}
           >↵</button>
           {/* A9: Code folding */}
           <button
             onClick={() => editorInstance?.getAction('editor.foldAll')?.run()}
             title="Fold All (Ctrl+K Ctrl+0)"
             className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest text-[#484f58] hover:text-white transition-all"
           >
             <Minimize2 className="w-3 h-3" />
           </button>
           <button
             onClick={() => editorInstance?.getAction('editor.unfoldAll')?.run()}
             title="Unfold All (Ctrl+K Ctrl+J)"
             className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest text-[#484f58] hover:text-white transition-all"
           >
             <Maximize2 className="w-3 h-3" />
           </button>
           {/* A15/A16/A18: Quick-access shortcuts in toolbar */}
           <button
             onClick={() => editorInstance?.getAction('actions.find')?.run()}
             title="Find (Ctrl+F)"
             className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest text-[#484f58] hover:text-white transition-all"
           >
             <Search className="w-3 h-3" />
           </button>
           <button
             onClick={() => editorInstance?.getAction('editor.action.gotoLine')?.run()}
             title="Go to Line (Ctrl+G)"
             className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest text-[#484f58] hover:text-white transition-all"
           >
             G
           </button>
         </div>

         {/* N10-N12: Project-level AI actions */}
         <div className="hidden lg:flex items-center gap-0.5 border-l border-white/10 pl-2 ml-1">
           {([
             { label: 'README', icon: BookOpen, prompt: 'Generate a comprehensive README.md for this project based on the code. Include: project description, features, installation steps, usage examples, and tech stack.' },
             { label: '.env', icon: Key, prompt: 'Generate a .env.example file listing all environment variables needed by this project with placeholder values and brief comments.' },
             { label: 'API Docs', icon: Layers, prompt: 'Generate API documentation for all the backend routes and endpoints in this project. Include method, path, request body, and response format for each endpoint.' },
           ] as const).map(({ label, icon: Icon, prompt }) => (
             <button
               key={label}
               onClick={() => sendProjectAction(prompt)}
               title={`AI: Generate ${label}`}
               className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black text-[#484f58] hover:text-emerald-400 hover:bg-emerald-900/20 transition-all uppercase tracking-widest"
             >
               <Icon className="w-3 h-3" />
               {label}
             </button>
           ))}
         </div>

         <div className="flex-1 flex justify-center mx-4">
            <button
               onClick={() => setIsCommandPaletteOpen(true)}
               className="w-full max-w-sm h-6 bg-black/20 rounded-md border border-white/5 flex items-center justify-center gap-2 text-[10px] text-white/40 hover:bg-black/30 hover:border-white/10 transition-all font-medium"
            >
               <Search className="w-3 h-3" />
               Search Files & Commands (Ctrl+Shift+P)
            </button>
         </div>

         <div className="flex items-center gap-2">
            <button
              id="ide-social-chat-trigger"
              // Admin 2026-07-31: this must open the FULL NavBharatAI Pro v5.0 (the main nbi_pro_chat
              // surface — same workspace + memory, 100% synced), not the in-IDE mini panel. Wired via
              // onSocialChatTrigger; the internal mini stays only as a fallback if the parent doesn't wire it.
              onClick={() => { if (onSocialChatTrigger) onSocialChatTrigger(); else { handleScreenChange('ai'); setIsSidebarOpen(true); } }}
              className="w-16 h-7 bg-indigo-600 hover:bg-indigo-700 rounded-l-lg flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 active:scale-90 transition-all border-y border-l border-indigo-400/20"
              title="Open NavBharatAI Pro v5.0 (full)"
            >
              <Bot className="w-4 h-4 mr-1" />
              <span className="text-[10px] font-bold">AI</span>
            </button>
            <button
              onClick={() => handleScreenChange('preview')}
              className={cn(
                "w-20 h-7 rounded-r-lg flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 active:scale-90 transition-all border-y border-r border-l border-indigo-400/20",
                activeScreen === 'preview' ? "bg-indigo-700" : "bg-indigo-600 hover:bg-indigo-700"
              )}
              title="Open Preview"
            >
              <Monitor className="w-4 h-4 mr-1" />
              <span className="text-[10px] font-bold">Preview</span>
            </button>
         </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Activity Bar (Desktop) */}
        {!isMobile && (
           <ActivityBar 
             activeScreen={activeScreen}
             onScreenChange={handleScreenChange}
             isShortcutsOpen={isShortcutsOpen}
             isCursorPopupOpen={isCursorPopupOpen}
           />
        )}

        {/* Sidebar Panel */}
        <AnimatePresence mode="popLayout">
          {isSidebarOpen && activeScreen !== 'preview' && (
            <motion.div 
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: isMobile ? '100%' : ((activeScreen === 'ai' || activeScreen === 'git') ? 385 : 260), opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className={cn(
                "h-full z-40 bg-[#161b22] border-r border-[#2b2b2b] shrink-0 overflow-hidden flex flex-col select-none",
                isMobile && "absolute inset-0 top-9"
              )}
            >
               {isMobile && (
                  <div className="h-12 border-b border-white/5 flex items-center justify-between px-4 shrink-0 bg-[#0d1117]">
                     <span className="text-xs font-black uppercase tracking-widest text-white">{activeScreen}</span>
                     <button onClick={() => setIsSidebarOpen(false)} aria-label="Close sidebar" className="p-2 bg-white/5 rounded-xl"><X className="w-4 h-4" /></button>
                  </div>
               )}
               {renderSidebarContent()}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dynamic Main Workspace */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#1e1e1e] relative">
          {activeScreen === 'preview' ? (
             <PreviewPanel files={files} generatedCode={generatedCode} onRun={() => onRun(files)} />
          ) : activeScreen === 'security' ? (
             <SecurityScan files={files} />
          ) : Object.keys(files).length === 0 ? (
             <div className="flex-1 flex flex-col items-center justify-center text-center px-6 select-none">
                <div className="w-14 h-14 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center mb-4">
                   <FileCode className="w-7 h-7 text-indigo-400" />
                </div>
                <h3 className="text-white font-bold text-sm mb-1">Empty workspace</h3>
                <p className="text-[#8b949e] text-xs mb-5 max-w-xs leading-relaxed">No files yet. Create one to start coding, or ask the AI to build your app.</p>
                <div className="flex items-center gap-2">
                   <button
                      onClick={() => { const name = (window.prompt('New file name (e.g. index.html)') || '').trim(); if (name) handleCreateFile(name); }}
                      className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1.5"
                   >
                      <Plus className="w-3.5 h-3.5" /> New File
                   </button>
                   <button
                      onClick={() => handleScreenChange('ai')}
                      className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 text-xs font-bold flex items-center gap-1.5"
                   >
                      <Bot className="w-3.5 h-3.5" /> Ask AI
                   </button>
                </div>
             </div>
          ) : (
             /* One group, or two side by side. With `splitOpen` false this renders exactly the single
                Editor it always did — the wrapper is a plain flex row with one child. */
             <div className="flex-1 flex min-w-0 min-h-0">
             <div className={`flex-1 min-w-0 min-h-0 flex flex-col ${splitOpen && !isMobile ? 'border-r border-white/10' : ''}`}>
             <Editor
                content={files[activeFile] || ''}
                fileName={activeFile}
                activeTab={activeFile}
                openTabs={openTabs}
                language=""
                onChange={handleFileChange}
                onTabChange={setActiveFile}
                onTabClose={handleTabClose}
                onMount={(ed: any) => {
                  leftEditorRef.current = ed;
                  setEditorInstance(ed);
                  if (!ed) return;   // Editor reports null on unmount
                  // Report focus so every editor command targets the pane being typed in.
                  try { ed.onDidFocusEditorText(() => { setFocusedPane('left'); setEditorInstance(ed); }); } catch { /* older monaco */ }
                }}
                allFiles={files}
                onNavigateOpen={(path) => { if (files[path] !== undefined) setActiveFile(path); }}
                activeBreakpoints={breakpoints[activeFile] ?? []}
                onBreakpointToggle={handleToggleBreakpoint}
                onRun={() => onRun(files)}
                onDebug={() => setIsDebugPanelOpen(true)}
                onSave={handleSaveActiveFile}
                hideHeaderDebug={isMobile}
                dirtyTabs={dirtyTabs}
                editorTheme={editorTheme}
                editorOptions={{
                  wordWrap: editorWordWrap ? 'on' : 'off',
                  minimap: { enabled: editorMinimap },
                  fontSize: editorFontSize,
                  tabSize: editorTabSize,
                  stickyScroll: { enabled: true },
                  trimAutoWhitespace: editorTrimWhitespace,
                  // PHONE-FIRST editor (admin 2026-07-31): on a narrow screen a desktop editor is
                  // unusable — the minimap + sticky-scroll eat width/height, lines run off-screen, and
                  // the thin scrollbars are impossible to grab. These overrides make Monaco genuinely
                  // touch-friendly: no minimap, no sticky scroll, always word-wrap, a bigger font, and
                  // fat (14px) touch scrollbars. Desktop is untouched.
                  ...(isMobile ? {
                    minimap: { enabled: false },
                    stickyScroll: { enabled: false },
                    wordWrap: 'on' as const,
                    fontSize: Math.max(15, editorFontSize),
                    lineNumbersMinChars: 3,
                    lineDecorationsWidth: 6,
                    overviewRulerLanes: 0,
                    folding: true,
                    padding: { top: 8, bottom: 8 },
                    scrollbar: { verticalScrollbarSize: 14, horizontalScrollbarSize: 14, useShadows: false },
                  } : {}),
                }}
                onRevealInExplorer={(path) => {
                  setIsSidebarOpen(true);
                  setActiveScreen('files');
                  setActiveFile(path);
                }}
              />
             </div>

             {/* SECOND EDITOR GROUP. Its own tabs, its own active file, its own edits — the point of a
                 split is reading two DIFFERENT files at once. Desktop only: two Monaco panes on a phone
                 would leave each about 180px wide, which is worse than no split at all, so the command
                 simply never opens one there rather than shipping an unusable layout. */}
             {splitOpen && !isMobile && (
               <div className="flex-1 min-w-0 min-h-0 flex flex-col">
                 <Editor
                   content={files[splitActive] || ''}
                   fileName={splitActive}
                   activeTab={splitActive}
                   openTabs={splitTabs}
                   language=""
                   onChange={handleSplitFileChange}
                   onTabChange={setSplitActive}
                   onTabClose={handleSplitTabClose}
                   onMount={(ed: any) => {
                     if (!ed) {
                       // This pane is going away. Hand command focus back to the left editor —
                       // otherwise every menu action would keep firing at a disposed Monaco instance.
                       setFocusedPane('left');
                       setEditorInstance(leftEditorRef.current);
                       return;
                     }
                     try { ed.onDidFocusEditorText(() => { setFocusedPane('right'); setEditorInstance(ed); }); } catch { /* older monaco */ }
                   }}
                   allFiles={files}
                   onNavigateOpen={openInSplit}
                   activeBreakpoints={breakpoints[splitActive] ?? []}
                   onBreakpointToggle={handleToggleBreakpoint}
                   onRun={() => onRun(files)}
                   onDebug={() => setIsDebugPanelOpen(true)}
                   onSave={handleSaveActiveFile}
                   hideHeaderDebug={isMobile}
                   dirtyTabs={dirtyTabs}
                   editorTheme={editorTheme}
                   editorOptions={{
                     wordWrap: editorWordWrap ? 'on' : 'off',
                     // A split halves the available width, so the minimap costs proportionally twice as
                     // much of what you are reading. VS Code makes the same call.
                     minimap: { enabled: false },
                     fontSize: editorFontSize,
                     tabSize: editorTabSize,
                     stickyScroll: { enabled: true },
                     trimAutoWhitespace: editorTrimWhitespace,
                   }}
                   onRevealInExplorer={(path) => {
                     setIsSidebarOpen(true);
                     setActiveScreen('files');
                     setActiveFile(path);
                   }}
                 />
               </div>
             )}
             </div>
          )}

          <AnimatePresence>
            {isCursorPopupOpen && editorInstance && (
              <CursorPopup
                editor={editorInstance}
                onClose={() => setIsCursorPopupOpen(false)}
                onToggleKeyboard={() => setIsShortcutsOpen(!isShortcutsOpen)}
                isKeyboardOpen={isShortcutsOpen}
              />
            )}
          </AnimatePresence>

          {/* N1-N9: AI code action toolbar — appears when text is selected in editor */}
          <AnimatePresence>
            {selectedCode.trim() && activeScreen !== 'preview' && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.12 }}
                className="absolute top-10 right-2 z-[52] flex items-center gap-0.5 bg-[#0d1117] border border-white/15 rounded-xl shadow-2xl px-1.5 py-1 shadow-black/40"
              >
                <span className="text-[8px] font-black text-[#484f58] uppercase tracking-widest px-1 border-r border-white/10 mr-0.5">AI Actions</span>
                {([
                  { label: 'Explain', icon: MessageSquare, instruction: 'Explain this code' },
                  { label: 'Improve', icon: Sparkles, instruction: 'Improve and optimize this code' },
                  { label: 'Tests', icon: TestTube, instruction: 'Write unit tests for this code' },
                  { label: 'JSDoc', icon: FileText, instruction: 'Add JSDoc documentation to this code' },
                  { label: 'Find Bugs', icon: Bug, instruction: 'Find and fix bugs in this code' },
                  { label: 'Security', icon: ShieldCheck, instruction: 'Do a security review of this code and identify vulnerabilities' },
                  { label: 'To TS', icon: Braces, instruction: 'Convert this code to TypeScript with proper type annotations and interfaces' },
                  { label: 'Simplify', icon: Layers, instruction: 'Simplify and reduce the complexity of this code while preserving its behavior' },
                  { label: 'Dark Mode', icon: Moon, instruction: 'Add dark mode support to this component using CSS variables or Tailwind dark: classes' },
                  { label: 'Accessible', icon: Accessibility, instruction: 'Improve accessibility: add aria-labels, roles, keyboard navigation, and fix contrast issues' },
                  { label: 'Mobile', icon: Smartphone, instruction: 'Optimize this component for mobile: responsive layout, touch targets ≥44px, mobile-friendly interactions' },
                  { label: 'Mock Data', icon: Database, instruction: 'Generate realistic mock data and sample fixtures for this component or function' },
                  { label: 'Loading', icon: RefreshCw, instruction: 'Add loading states and skeleton placeholders to all async operations in this code' },
                  { label: 'Error Boundary', icon: Shield, instruction: 'Wrap this component with a React ErrorBoundary and add appropriate error fallback UI' },
                  { label: 'Auth Guard', icon: Lock, instruction: 'Add authentication guard to these routes: redirect to /login if the user is not authenticated' },
                  { label: 'React 19', icon: Package, instruction: 'Migrate this code to React 19 patterns: use() hook, server components, new form actions where applicable' },
                  { label: 'Zustand', icon: Users, instruction: 'Replace useState/useReducer in this component with a Zustand store for global state management' },
                  { label: 'Tailwind', icon: Type, instruction: 'Add Tailwind CSS to this project: install it, create config files, and migrate any existing CSS classes to Tailwind utilities' },
                  { label: 'To Func', icon: Cpu, instruction: 'Convert this class component to a React functional component using hooks (useState, useEffect, useRef, etc.)' },
                  { label: 'Storybook', icon: BookOpen, instruction: 'Write Storybook stories for this component: Default, Loading, Error, and interactive variant stories with argTypes' },
                  { label: 'Bundle', icon: BarChart2, instruction: 'Analyze this code for bundle size impact: identify heavy imports, suggest lazy loading, and tree-shaking opportunities' },
                  { label: 'Audit', icon: AlertTriangle, instruction: 'Run a dependency audit: identify outdated packages, security vulnerabilities, and suggest safe upgrade paths' },
                  { label: 'Perf', icon: Activity, instruction: 'Add Lighthouse CI configuration and performance budget to this project for automated performance testing in CI/CD' },
                ] as const).map(({ label, icon: Icon, instruction }) => (
                  <button
                    key={label}
                    onClick={() => sendCodeAction(label, instruction)}
                    title={instruction}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-[8px] font-black text-[#8b949e] hover:text-white hover:bg-indigo-600/80 transition-all"
                  >
                    <Icon className="w-2.5 h-2.5 shrink-0" />
                    {label}
                  </button>
                ))}
                <button
                  onClick={() => setSelectedCode('')}
                  title="Dismiss"
                  className="ml-0.5 p-0.5 rounded text-[#484f58] hover:text-white transition-colors"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* A24: Status bar — cursor position, language, file info */}
          {activeScreen !== 'preview' && activeScreen !== 'security' && Object.keys(files).length > 0 && (
            <div className="h-5 shrink-0 bg-[#007acc] flex items-center px-3 gap-4 select-none overflow-hidden">
              <span className="text-[10px] text-white/90 font-mono">Ln {cursorPos.line}, Col {cursorPos.col}</span>
              <span className="text-[10px] text-white/70 font-mono">{activeFile?.split('.').pop()?.toUpperCase() || 'TXT'}</span>
              <span className="text-[10px] text-white/60 font-mono ml-auto">UTF-8</span>
            </div>
          )}

          {/* Terminal / Panel */}
          <AnimatePresence>
              {isPanelOpen && (
                  <motion.div 
                     initial={{ height: 0 }}
                     animate={{ height: isPanelMaximized ? '100%' : '35%' }}
                     exit={{ height: 0 }}
                     className="absolute left-0 right-0 bottom-0 z-50 bg-[#0d1117] border-t border-white/10 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]"
                  >
                      {/* MULTI-TERMINAL (admin 2026-08-04): one panel, many independent sessions, with
                          the "+ New" dropdown inside the terminal itself. */}
                      <TerminalPanel
                        onClose={() => {
                          setIsPanelOpen(false);
                          setIsPanelMaximized(false);
                        }}
                        workspaceId={v3WorkspaceId}
                        userId={v3UserId}
                        email={v3Email}
                        isMaximized={isPanelMaximized}
                        onToggleMaximize={() => setIsPanelMaximized(prev => !prev)}
                      />
                  </motion.div>
              )}
          </AnimatePresence>

          {/* P-DEV.3 — Debugger panel (breakpoints list + honest deferred live-pause state) */}
          <AnimatePresence>
              {isDebugPanelOpen && (
                  <motion.div
                     initial={{ height: 0 }}
                     animate={{ height: '35%' }}
                     exit={{ height: 0 }}
                     className="absolute left-0 right-0 bottom-0 z-50 bg-[#0d1117] border-t border-white/10 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]"
                  >
                      <DebugPanel
                        onClose={() => setIsDebugPanelOpen(false)}
                        breakpoints={breakpoints}
                        onJumpToBreakpoint={handleJumpToBreakpoint}
                        onClearBreakpoint={handleClearBreakpoint}
                        onClearAll={handleClearAllBreakpoints}
                      />
                  </motion.div>
              )}
          </AnimatePresence>
          
          {/* Real Problems panel — esbuild compile errors from the live preview bundle */}
          <AnimatePresence>
              {isProblemsPanelOpen && (
                  <motion.div
                     initial={{ height: 0 }}
                     animate={{ height: '35%' }}
                     exit={{ height: 0 }}
                     className="absolute left-0 right-0 bottom-0 z-50 bg-[#0d1117] border-t border-white/10 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]"
                  >
                      <ProblemsPanel
                        problems={problems}
                        onOpen={handleJumpToBreakpoint}
                        onClose={() => setIsProblemsPanelOpen(false)}
                      />
                  </motion.div>
              )}
          </AnimatePresence>

          {/* Panel toggle handle — DESKTOP ONLY. On a phone the terminal now has exactly one entrance,
              the footer's Terminal tab (admin 2026-08-04: "ek jagah rakho, footer me only"). It used to
              have three (this handle, the More sheet, and nothing in the footer), which is how a user
              ends up unsure whether they opened the same terminal or a different one. Desktop has no
              footer, so the handle stays its way in. The Problems button is unrelated and stays. */}
          {!isPanelOpen && activeScreen !== 'preview' && (
             <div className="absolute bottom-4 right-4 z-[45] flex items-center gap-2">
               {problems.length > 0 && !isProblemsPanelOpen && (
                 <button
                   onClick={() => setIsProblemsPanelOpen(true)}
                   aria-label="Open Problems panel"
                   title={`${problems.length} problem${problems.length === 1 ? '' : 's'}`}
                   className="h-10 px-3 bg-amber-600/20 hover:bg-amber-600/30 rounded-lg border border-amber-500/30 flex items-center gap-1.5 text-amber-300 hover:text-amber-200 transition-all shadow-2xl text-xs font-bold"
                 >
                    <AlertCircle className="w-4 h-4" />
                    {problems.length}
                 </button>
               )}
               {!isMobile && (
                 <button
                   onClick={() => setIsPanelOpen(true)}
                   aria-label="Open terminal panel"
                   className="w-10 h-10 bg-[#333] hover:bg-[#444] rounded-lg border border-white/10 flex items-center justify-center text-white/50 hover:text-white transition-all shadow-2xl"
                 >
                    <ChevronUp className="w-5 h-5" />
                 </button>
               )}
             </div>
          )}
        </div>
      </div>

      {/* Activity Bar (Mobile Position) */}
      {/* PHONE BOTTOM-TAB IDE (admin 2026-07-31): a native-app-style bottom bar with the essentials —
          Code · Files · Terminal · Debug · More — instead of the shrunk desktop ActivityBar. Each tab
          reuses the same proven state transitions the desktop uses; "More" holds the secondary dev
          tools so nothing is lost. Desktop is unaffected.

          IT NEVER HIDES ITSELF (admin 2026-08-04: "yeh apne aap gayab ho jata hai"). It used to vanish
          whenever the AI overlay opened — which was the ONE moment the user most needed a way back,
          leaving the IDE with no visible navigation at all. A bottom bar that disappears is not a
          bottom bar; it is a trapdoor.

          AI and PREVIEW are deliberately NOT here: both already live as buttons in the top-right
          header, and offering the same action in two places on a phone-sized screen just costs a tab
          and makes the user wonder whether the two are different. Their slots went to TERMINAL and
          DEBUG, which previously had no home in the footer at all. */}
      {isMobile && (
         <>
           {mobileMoreOpen && (
             <>
               <div className="fixed inset-0 z-[55]" onClick={() => setMobileMoreOpen(false)} aria-hidden="true" />
               <div className="absolute right-2 bottom-[68px] z-[56] w-56 rounded-2xl border border-white/10 bg-[#161b22] shadow-2xl py-1.5">
                 {([
                   { label: 'Search', Icon: Search, onTap: () => handleScreenChange('search') },
                   { label: 'Source Control', Icon: GitBranch, onTap: () => handleScreenChange('git') },
                   { label: 'Security', Icon: ShieldCheck, onTap: () => handleScreenChange('security') },
                   { label: 'Shortcuts', Icon: Keyboard, onTap: () => setIsShortcutsOpen(true) },
                 ]).map(({ label, Icon, onTap }) => (
                   <button
                     key={label}
                     onClick={() => { setMobileMoreOpen(false); onTap(); }}
                     className="w-full flex items-center gap-3 px-4 py-3 text-sm text-[#c9d1d9] hover:bg-white/5 active:bg-white/10"
                   >
                     <Icon className="w-4 h-4 text-[#8b949e]" />
                     <span className="font-medium">{label}</span>
                   </button>
                 ))}
               </div>
             </>
           )}
           {/* Code Studio's own footer is now the BOTTOM-MOST bar on mobile — the global app footer is
               hidden inside the IDE (App.tsx, admin 2026-08-04), so this row sits directly on the device
               edge and must reserve the home-indicator inset itself. Without it the tap targets fall
               under the iPhone home bar. Content height stays a fixed 4rem; the inset is added below it. */}
           <div
             className="flex border-t border-[var(--theme-border)] bg-[var(--theme-card)] shrink-0 relative z-[57] select-none"
             style={{ height: 'calc(4rem + env(safe-area-inset-bottom, 0px))', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
           >
             {([
               { id: 'code', label: 'Code', Icon: Code2, active: !isSidebarOpen && activeScreen !== 'preview', onTap: () => { setMobileMoreOpen(false); if (activeScreen === 'preview') setActiveScreen('files'); setIsSidebarOpen(false); } },
               { id: 'files', label: 'Files', Icon: FilesIcon, active: isSidebarOpen && activeScreen === 'files', onTap: () => { setMobileMoreOpen(false); setActiveScreen('files'); setIsSidebarOpen(true); } },
               { id: 'terminal', label: 'Terminal', Icon: TerminalIcon, active: isPanelOpen, onTap: () => { setMobileMoreOpen(false); setIsPanelOpen(v => !v); } },
               { id: 'debug', label: 'Debug', Icon: Bug, active: isDebugPanelOpen, onTap: () => { setMobileMoreOpen(false); setIsDebugPanelOpen(v => !v); } },
               { id: 'more', label: 'More', Icon: MenuIcon, active: mobileMoreOpen, onTap: () => setMobileMoreOpen(v => !v) },
             ]).map(({ id, label, Icon, active, onTap }) => (
               <button
                 key={id}
                 onClick={onTap}
                 aria-label={label}
                 className={cn(
                   'flex-1 flex flex-col items-center justify-center gap-1 transition-all relative min-h-[44px]',
                   active ? 'text-indigo-400' : 'text-[#484f58] active:text-[#8b949e]'
                 )}
               >
                 <Icon className="w-5 h-5" />
                 <span className="text-[9px] font-black uppercase tracking-tight">{label}</span>
                 {active && <div className="absolute top-0 left-1/4 right-1/4 h-0.5 bg-indigo-500 rounded-full" />}
               </button>
             ))}
           </div>
         </>
      )}

    </div>
  );
}, (prev, next) => {
  return prev.files === next.files && 
         prev.activeIntent === next.activeIntent && 
         prev.isChatLoading === next.isChatLoading &&
         prev.messages.length === next.messages.length &&
         prev.chatInput === next.chatInput &&
         prev.problems === next.problems &&
         prev.activeAgent === next.activeAgent &&
         prev.onUnlockVishwakarma === next.onUnlockVishwakarma;
});
