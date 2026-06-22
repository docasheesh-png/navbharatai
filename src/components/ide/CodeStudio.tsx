import React, { useState, useEffect } from 'react';
import { Editor } from './Editor';
import { FileExplorer } from './FileExplorer';
import { ActivityBar } from './ActivityBar';
import { TerminalPanel } from './TerminalPanel';
import { CommandPalette } from './CommandPalette';
import { ExtensionMarket } from './ExtensionMarket';
import { GitPanel } from './GitPanel';
import { PreviewPanel } from './PreviewPanel';
import { AIChat } from './AIChat';
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
  MessageSquare, Sparkles, TestTube, FileText, Bug, ShieldCheck
} from 'lucide-react';

interface CodeStudioProps {
  files: Record<string, string>;
  onFilesChange: (files: Record<string, string>) => void;
  onRun: (files: Record<string, string>) => void;
  /** The built preview HTML (same best-engine output the Pro preview uses). */
  generatedCode?: string;
  messages: any[];
  chatInput: string;
  onChatInputChange: (val: string) => void;
  onChatSend: () => void;
  isChatLoading: boolean;
  activeIntent?: string;
  problems?: string | null;
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
  onOpenProChat?: () => void;
  wallet?: any;
  onUnlockVishwakarma: () => void;
  /** N1-N9: Send a message directly to AI (bypasses controlled input state). */
  onSendDirect?: (text: string) => void;
}

export const CodeStudio: React.FC<CodeStudioProps> = React.memo(({
  files,
  onFilesChange,
  onRun,
  generatedCode,
  messages,
  chatInput,
  onChatInputChange,
  onChatSend,
  isChatLoading,
  activeIntent = 'social',
  problems,
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
  onOpenProChat,
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
  
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isPanelMaximized, setIsPanelMaximized] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    return !!localStorage.getItem('github_oauth_return_active_screen') || true;
  });
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isCursorPopupOpen, setIsCursorPopupOpen] = useState(false);
  const [editorInstance, setEditorInstance] = useState<any>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  // A2-A5: Editor display settings (persisted to localStorage)
  const [editorWordWrap, setEditorWordWrap] = useState<boolean>(() => localStorage.getItem('ide_wordWrap') !== 'off');
  const [editorMinimap, setEditorMinimap] = useState<boolean>(() => localStorage.getItem('ide_minimap') !== 'off');
  const [editorFontSize, setEditorFontSize] = useState<number>(() => Number(localStorage.getItem('ide_fontSize') || 14));
  const [editorTabSize, setEditorTabSize] = useState<number>(() => Number(localStorage.getItem('ide_tabSize') || 2));
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

    // Clear the redirect storage after a short delay so subsequent refreshes start fresh
    const clearTimer = setTimeout(() => {
      localStorage.removeItem('github_oauth_return_active_screen');
    }, 1000);

    return () => {
      window.removeEventListener('resize', checkMobile);
      clearTimeout(timer);
      clearTimeout(clearTimer);
    };
  }, []);

  // Sync tabs when active file changes
  useEffect(() => {
    if (activeFile && !openTabs.find(t => t.path === activeFile)) {
      setOpenTabs(prev => [...prev, { path: activeFile }]);
    }
  }, [activeFile]);

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

  const handleFileChange = (content: string) => {
    const nextFiles = { ...files, [activeFile]: content };
    onFilesChange(nextFiles);
    if (autoRunTimer.current) clearTimeout(autoRunTimer.current);
    autoRunTimer.current = setTimeout(() => { onRun(nextFiles); }, 900);
  };

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
        case 'workbench.action.terminal.toggleTerminal':
        case 'workbench.action.output.toggleOutput':
        case 'workbench.actions.view.problems':
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
        case 'workbench.action.files.saveAll':
          console.log('Save All Files Triggered');
          break;
        case 'markdown.showPreview':
          console.log('Markdown Preview Triggered');
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
          console.log('Debug Started');
          break;
        case 'workbench.action.debug.stop':
          console.log('Debug Stopped');
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
        case 'workbench.action.splitEditor':
          console.log('Split Editor Triggered');
          break;
        case 'workbench.action.focusFirstEditorGroup':
          if (editorInstance) editorInstance.focus();
          break;
        case 'workbench.action.toggleDevTools':
          // Cannot open Chrome dev tools via JS, but can log guidance
          console.log('Press F12 or Ctrl+Shift+I to open DevTools');
          break;
        case 'base.action.save':
          console.log('File Saved');
          break;
      }
    }

    // Map keys to specific IDE actions if needed (fallback/manual)
    const shortcutStr = keys.join('+').toLowerCase();
    
    if (shortcutStr.includes('ctrl+shift+p')) {
      setIsCommandPaletteOpen(true);
    } else if (shortcutStr.includes('ctrl+b')) {
      setIsSidebarOpen(prev => !prev);
    } else if (shortcutStr.includes('ctrl+j')) {
      setIsPanelOpen(prev => !prev);
    }
  };

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
            onFileRename={handleRenameFile}
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
        return (
          <AIChat 
            activeAgent={activeAgent}
            messages={messages}
            input={chatInput}
            onInputChange={onChatInputChange}
            onSend={onChatSend}
            isLoading={isChatLoading}
            activeIntent={activeIntent}
            pendingGHEdit={pendingGHEdit}
            onConfirmPush={onConfirmPush}
            isPushing={isGHPushing}
            isPinned={isPinned}
            onTogglePin={onTogglePin}
            isLoggedIn={isLoggedIn}
            onShowLogin={onShowLogin}
            mode={mode}
            onModeChange={onModeChange}
            isAppBuilt={isAppBuilt}
            onPreviewClick={onPreviewClick}
            theme={theme}
            onGoToMain={onGoToMain}
            wallet={wallet}
            onUnlockVishwakarma={onUnlockVishwakarma}
          />
        );
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
            <div className="flex items-center gap-1.5 cursor-pointer hover:bg-white/5 px-2 py-1 rounded transition-colors" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
               <MenuIcon className="w-4 h-4 text-white/70" />
               <span className="text-[11px] text-white/80 font-medium">NavBharat IDE</span>
            </div>
            <div className="hidden md:flex items-center gap-4 text-[11px] text-white/50 font-medium">
               <span className="hover:text-white cursor-pointer transition-colors">File</span>
               <span className="hover:text-white cursor-pointer transition-colors">Edit</span>
               <span className="hover:text-white cursor-pointer transition-colors">Selection</span>
               <span className="hover:text-white cursor-pointer transition-colors">Run</span>
               <span className="hover:text-white cursor-pointer transition-colors">Terminal</span>
               <span className="hover:text-white cursor-pointer transition-colors">Help</span>
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
              onClick={() => onOpenProChat ? onOpenProChat() : (handleScreenChange('ai'), setIsSidebarOpen(true))}
              className="w-16 h-7 bg-indigo-600 hover:bg-indigo-700 rounded-l-lg flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 active:scale-90 transition-all border-y border-l border-indigo-400/20"
              title="Open NavBharatAI v2.0"
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
                     <button onClick={() => setIsSidebarOpen(false)} className="p-2 bg-white/5 rounded-xl"><X className="w-4 h-4" /></button>
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
                      onClick={() => (onOpenProChat ? onOpenProChat() : handleScreenChange('ai'))}
                      className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 text-xs font-bold flex items-center gap-1.5"
                   >
                      <Bot className="w-3.5 h-3.5" /> Ask AI
                   </button>
                </div>
             </div>
          ) : (
             <Editor
                content={files[activeFile] || ''}
                fileName={activeFile}
                activeTab={activeFile}
                openTabs={openTabs}
                language=""
                onChange={handleFileChange}
                onTabChange={setActiveFile}
                onTabClose={handleTabClose}
                onMount={setEditorInstance}
                onRun={() => onRun(files)}
                onDebug={() => setIsPanelOpen(true)}
                editorOptions={{
                  wordWrap: editorWordWrap ? 'on' : 'off',
                  minimap: { enabled: editorMinimap },
                  fontSize: editorFontSize,
                  tabSize: editorTabSize,
                  stickyScroll: { enabled: true },
                }}
              />
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
                      <TerminalPanel 
                        onClose={() => {
                          setIsPanelOpen(false);
                          setIsPanelMaximized(false);
                        }} 
                        files={files}
                        onFilesChange={onFilesChange}
                        activeFile={activeFile}
                        onActiveFileChange={setActiveFile}
                        isMaximized={isPanelMaximized}
                        onToggleMaximize={() => setIsPanelMaximized(prev => !prev)}
                      />
                  </motion.div>
              )}
          </AnimatePresence>
          
          {/* Panel Toggle Handle */}
          {!isPanelOpen && activeScreen !== 'preview' && (
             <button 
               onClick={() => setIsPanelOpen(true)}
               className="absolute bottom-4 right-4 z-[45] w-10 h-10 bg-[#333] hover:bg-[#444] rounded-lg border border-white/10 flex items-center justify-center text-white/50 hover:text-white transition-all shadow-2xl"
             >
                <ChevronUp className="w-5 h-5" />
             </button>
          )}
        </div>
      </div>

      {/* Activity Bar (Mobile Position) */}
      {isMobile && activeScreen !== 'ai' && (
         <ActivityBar 
            isMobile
            activeScreen={activeScreen}
            onScreenChange={handleScreenChange}
            isShortcutsOpen={isShortcutsOpen}
            isCursorPopupOpen={isCursorPopupOpen}
         />
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
