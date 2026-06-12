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
import { AgentSelector } from './AgentSelector';
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
  Bot, Palette
} from 'lucide-react';

interface CodeStudioProps {
  files: Record<string, string>;
  onFilesChange: (files: Record<string, string>) => void;
  onRun: (files: Record<string, string>) => void;
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
}

export const CodeStudio: React.FC<CodeStudioProps> = React.memo(({
  files,
  onFilesChange,
  onRun,
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
}) => {
  const themeClasses = getThemeClasses(theme);
  console.log('[DEBUG CODE] CodeStudio rendered with activeAgent=', activeAgent);
  useEffect(() => {
    console.log('[DEBUG] CodeStudio mounted/remounted. activeAgent=', activeAgent, 'activeScreen=', activeScreen);
  }, [activeAgent]);
  const [activeScreen, setActiveScreen] = useState<IDEScreen>(() => {
    const saved = localStorage.getItem('github_oauth_return_active_screen');
    const screen = (saved as IDEScreen) || 'files';
    console.log('[DEBUG] CodeStudio activeScreen initialized to:', screen);
    return screen;
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

  const handleFileChange = (content: string) => {
    onFilesChange({ ...files, [activeFile]: content });
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

  const handleShortcut = (keys: string[], command?: string) => {
    console.log('IDE Shortcut Triggered:', { keys, command });
    
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
    console.log('Action:', id);
    // Real implementation based on ID
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
            onFileRename={() => {}} 
          />
        );
      case 'search':
        return (
           <div className="p-6 h-full bg-[#161b22]">
              <h3 className="text-white font-black uppercase tracking-widest text-[10px] mb-6 flex items-center gap-2">Global Search</h3>
              <div className="space-y-4">
                 <div className="space-y-1">
                    <label className="text-[9px] font-black text-[#8b949e] uppercase">Search</label>
                    <input className="w-full bg-black/20 border border-white/5 rounded-lg px-4 py-3 text-xs outline-none focus:border-indigo-500/50" placeholder="Find..." />
                 </div>
                 <div className="space-y-1">
                    <label className="text-[9px] font-black text-[#8b949e] uppercase">Replace</label>
                    <input className="w-full bg-black/20 border border-white/5 rounded-lg px-4 py-3 text-xs outline-none focus:border-indigo-500/50" placeholder="Replace..." />
                 </div>
              </div>
           </div>
        );
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
         
         <div className="flex-1 flex justify-center mx-10">
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
              title="Open NavBharatAI Pro"
            >
              <Bot className="w-4 h-4 mr-1" />
              <span className="text-[10px] font-bold">AI</span>
            </button>
             <div className="h-7 bg-indigo-600 border-l border-indigo-400/50 flex items-center px-1 rounded-r-lg border-y border-r border-indigo-400/20">
                <AgentSelector activeAgent={activeAgent} onAgentChange={onAgentChange || (() => {})} />
             </div>
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
             <PreviewPanel files={files} onRun={() => onRun(files)} />
          ) : activeScreen === 'security' ? (
             <SecurityScan files={files} />
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
