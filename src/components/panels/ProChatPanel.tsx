import React, { useState, useRef, useEffect } from 'react';
import { Rocket, RotateCcw, Layout, Minimize2, Maximize2, Eye } from 'lucide-react';
import { cn } from '../../lib/utils';
import { WorkspacePane } from './WorkspacePane';
import { DeployModal } from './DeployModal';
import { AIChat } from '../ide/AIChat';
import type { ThemeMode } from '../../lib/theme';
import type { Message, FileSystem, ChatSession, AgentMode } from '../../types';

// Build progress step type (mirrors what App.tsx uses for proBuildProgress)
interface BuildStep {
  label: string;
  sub: string;
  status: 'pending' | 'running' | 'done' | 'error';
  code?: string;
  expanded?: boolean;
}

interface BuildProgressState {
  active: boolean;
  stage: string;
  steps: BuildStep[];
  percent: number;
  generatedFiles: Record<string, { content: string; expanded: boolean }>;
  startedAt?: number;
  part?: number;
  tier?: 'vfs' | 'cloudrun' | 'e2b';
  codeReview?: import('../../services/buildService').CodeReviewResult;
}

export interface ProChatPanelProps {
  // Theme
  theme: ThemeMode;
  themeClasses: {
    bg: string;
    text: string;
    border: string;
    accent: string;
    card: string;
    raw: { bg: string; text: string; border: string; card: string };
  };

  // Mode
  mode: AgentMode;
  setMode: (mode: AgentMode) => void;

  // Build version stack
  buildVersionStack: Array<{ files: Record<string, string>; timestamp: string; request: string }>;
  handleUndoBuild: () => void;

  // Pro chat messages / input
  proMessages: Message[];
  proInput: string;
  setProInput: (v: string) => void;
  isProLoading: boolean;
  handleStopPro: () => void;

  // Deploy panel
  showDeployPanel: boolean;
  setShowDeployPanel: (v: boolean) => void;
  deployPlatform: 'vercel' | 'netlify' | 'github' | 'cloudflare';
  setDeployPlatform: (v: 'vercel' | 'netlify' | 'github' | 'cloudflare') => void;
  deployToken: string;
  setDeployToken: (v: string) => void;
  deployProjectName: string;
  setDeployProjectName: (v: string) => void;
  deployOwner: string;
  setDeployOwner: (v: string) => void;
  deployRepo: string;
  setDeployRepo: (v: string) => void;
  deployPanelError: string;
  setDeployPanelError: (v: string) => void;
  isDeploying: boolean;
  handleDeployApp: () => void;

  // Workspace
  showWorkspace: boolean;
  setShowWorkspace: React.Dispatch<React.SetStateAction<boolean>>;
  files: FileSystem | null;
  isAppBuilt: boolean;
  generatedCode: string;
  setFiles: (f: FileSystem) => void;
  updatePreview: (f: FileSystem) => void;
  toggleTab: (tab: string) => void;
  setIsMenuOpen: (v: boolean) => void;
  previewHistory: { id: string; label: string; ts: Date; html: string }[];
  setGeneratedCode: (html: string) => void;

  // Build progress & guider
  proBuildProgress: BuildProgressState;
  setProBuildProgress: React.Dispatch<React.SetStateAction<BuildProgressState>>;
  proGuiderPlan: { prompt: string; plan: any } | null;
  setProGuiderPlan: (v: { prompt: string; plan: any } | null) => void;
  proGuiderReplanning: boolean;
  setProGuiderReplanning: (v: boolean) => void;
  proGuiderSpecRef: React.MutableRefObject<{ spec: any; prompt: string } | null>;
  proGuiderRefineRef: React.MutableRefObject<number>;

  // Retry countdown (Phase 5.5)
  providerRetryCountdown: number | null;
  setProviderRetryCountdown: (v: number | null) => void;
  providerRetryTimerRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>;
  providerRetryPromptRef: React.MutableRefObject<string>;

  // Send
  handleSendForPro: (input?: string | File[], forceBuild?: boolean, isAutoContinue?: boolean, guiderApproved?: boolean) => void;

  // Sessions
  sessions: ChatSession[];
  currentProSessionId: string;
  togglePin: (sessionId: string) => void;

  // Auth / user
  user: { uid: string; email?: string | null; displayName?: string | null } | null;
  setShowAuth: (v: boolean) => void;
  handleRestoreUci?: (uci: string) => Promise<boolean>;

  // GitHub
  pendingGHEdit: { path: string; content: string; message: string; sha?: string } | null;
  handleGHConfirmPush: () => void;
  isPushing: boolean;

  // Wallet
  wallet: any;

  // Download
  downloadAppZip: (deployFiles: Record<string, string>, appName: string) => void;

  // Intent
  activeIntent: string;
}

export const ProChatPanel: React.FC<ProChatPanelProps> = (props) => {
  const hasWorkspaceApp = props.isAppBuilt && !!props.files && Object.keys(props.files).length > 0;
  const workspaceVisible = hasWorkspaceApp && props.showWorkspace;

  // Mobile: preview shows as expandable overlay (not pushing chat up)
  const [mobilePreviewExpanded, setMobilePreviewExpanded] = useState(false);

  // Resizable split: chat pane width as percentage (20–80, default 44)
  const [chatWidthPct, setChatWidthPct] = useState(44);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidthPct = useRef(44);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const deltaPct = ((e.clientX - dragStartX.current) / rect.width) * 100;
      setChatWidthPct(Math.min(80, Math.max(20, dragStartWidthPct.current + deltaPct)));
    };
    const onMouseUp = () => { isDragging.current = false; };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // Auto-open workspace on build complete (desktop only)
  const prevBuildActive = useRef(false);
  useEffect(() => {
    const justFinished = prevBuildActive.current && !props.proBuildProgress.active;
    const hasFiles = props.isAppBuilt && !!props.files && Object.keys(props.files).length > 0;
    if (justFinished && hasFiles && window.innerWidth >= 768) {
      props.setShowWorkspace(true);
    }
    prevBuildActive.current = props.proBuildProgress.active;
  }, [props.proBuildProgress.active]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={containerRef} className={cn("flex-1 overflow-hidden h-full min-h-0 max-h-full relative group flex flex-col md:flex-row md:divide-y-0", props.themeClasses.bg)}>

      {/* Chat pane — full width on mobile, partial on desktop when workspace open */}
      <div
        className="flex flex-col h-full min-h-0 max-h-full overflow-hidden min-w-0"
        style={workspaceVisible ? { flexBasis: `${chatWidthPct}%`, flexGrow: 0, flexShrink: 0 } : { flex: '1 1 0%' }}
      >
          <div className="flex items-center justify-between px-3 py-1 bg-indigo-950/20 border-b border-indigo-500/20 text-[9px] font-black uppercase tracking-widest text-[#8b949e]">
             <div className="flex items-center gap-2">
               <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping shrink-0" />
               <span>NAVBHARATAI V2.0</span>
               {props.mode === 'auto'     && <span className="px-1.5 py-0.5 bg-indigo-900/30 border border-indigo-600/30 text-indigo-400 rounded text-[8px]">AUTO</span>}
               {props.mode === 'planning' && <span className="px-1.5 py-0.5 bg-amber-900/30 border border-amber-600/30 text-amber-400 rounded text-[8px]">PLANNING</span>}
               {props.mode === 'build' && <span className="px-1.5 py-0.5 bg-orange-900/30 border border-orange-600/30 text-orange-400 rounded text-[8px]">BUILD</span>}
               {/* D19: Execution tier badge — persists after build completes */}
               {props.isAppBuilt && props.proBuildProgress.tier && (
                 <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${
                   props.proBuildProgress.tier === 'e2b' ? 'bg-green-500/15 border border-green-500/30 text-green-400' :
                   props.proBuildProgress.tier === 'cloudrun' ? 'bg-blue-500/15 border border-blue-500/30 text-blue-400' :
                   'bg-white/5 border border-white/10 text-[#484f58]'
                 }`} title="Execution tier used for this build">
                   {props.proBuildProgress.tier === 'e2b' ? '☁ E2B' : props.proBuildProgress.tier === 'cloudrun' ? '⚙ Server' : '💾 Local'}
                 </span>
               )}
             </div>
             <div className="flex items-center gap-2">
               {props.buildVersionStack.length > 0 && (
                 <button
                   onClick={props.handleUndoBuild}
                   title={`Undo: "${props.buildVersionStack[0].request}"`}
                   className="flex items-center gap-1 px-2 py-0.5 bg-amber-900/30 hover:bg-amber-900/50 border border-amber-600/30 rounded text-[8px] text-amber-400 hover:text-amber-300 transition-all"
                 >
                   <RotateCcw className="w-2.5 h-2.5" />
                   Undo ({props.buildVersionStack.length})
                 </button>
               )}
               {props.mode === 'planning' && props.proMessages.length > 2 && (
                 <button
                   onClick={() => {
                     const content = props.proMessages.map(m => `${m.sender === 'user' ? '👤 Doctor' : '🤖 NavBharatAI'}: ${m.text.replace(/__SWITCH_TO_BUILD__|__URGENT_BUILD__/g, '').trim()}`).join('\n\n---\n\n');
                     const blob = new Blob([`# NavBharatAI — Product Requirements Document\nGenerated: ${new Date().toLocaleString('en-IN')}\n\n${content}`], { type: 'text/plain' });
                     const url = URL.createObjectURL(blob);
                     const a = document.createElement('a'); a.href = url; a.download = 'navbharat-prd.txt';
                     document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                   }}
                   className="flex items-center gap-1 px-2 py-0.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded text-[8px] text-[#8b949e] hover:text-white transition-all"
                 >
                   ⬇ Export PRD
                 </button>
               )}
               {/* D5/D6: Lines of code + file count shown after successful build */}
               {props.isAppBuilt && props.files && Object.keys(props.files).length > 0 && (() => {
                 const fileList = Object.entries(props.files as Record<string, string>);
                 const totalLines = fileList.reduce((sum, [, c]) => sum + (c || '').split('\n').length, 0);
                 const tsxCount = fileList.filter(([p]) => /\.(tsx?|jsx?)$/.test(p)).length;
                 const cssCount = fileList.filter(([p]) => /\.css$/.test(p)).length;
                 return (
                   <span className="text-[7px] font-mono text-[#484f58]" title={`${fileList.length} files · ${totalLines.toLocaleString()} lines`}>
                     {fileList.length}F · {totalLines > 999 ? `${(totalLines/1000).toFixed(1)}K` : totalLines}L
                     {tsxCount > 0 && ` · ${tsxCount}TS`}
                     {cssCount > 0 && ` · ${cssCount}CSS`}
                   </span>
                 );
               })()}
               {props.isAppBuilt && props.files && Object.keys(props.files).length > 0 && (
                 <button
                   onClick={() => { props.setDeployPanelError(''); props.setShowDeployPanel(true); }}
                   title="Deploy your app to Vercel, Netlify, or GitHub Pages"
                   className="flex items-center gap-1 px-2 py-0.5 bg-emerald-900/30 hover:bg-emerald-900/50 border border-emerald-600/30 rounded text-[8px] text-emerald-400 hover:text-emerald-300 transition-all"
                 >
                   <Rocket className="w-2.5 h-2.5" />
                   Deploy
                 </button>
               )}
               {hasWorkspaceApp && (
                 <>
                   {/* Desktop: side-pane toggle */}
                   <button
                     onClick={() => props.setShowWorkspace(v => !v)}
                     title={workspaceVisible ? 'Hide live workspace' : 'Show live workspace (code + preview)'}
                     className={cn(
                       "hidden md:flex items-center gap-1 px-2 py-0.5 rounded text-[8px] border transition-all",
                       workspaceVisible
                         ? "bg-indigo-900/40 border-indigo-600/40 text-indigo-300 hover:text-indigo-200"
                         : "bg-white/5 border-white/10 text-[#8b949e] hover:text-white",
                     )}
                   >
                     <Layout className="w-2.5 h-2.5" />
                     {workspaceVisible ? 'Hide app' : 'Show app'}
                   </button>
                   {/* Mobile: preview overlay toggle */}
                   <button
                     onClick={() => setMobilePreviewExpanded(v => !v)}
                     className="flex md:hidden items-center gap-1 px-2 py-0.5 rounded text-[8px] border bg-indigo-900/40 border-indigo-600/40 text-indigo-300 hover:text-indigo-200 transition-all"
                   >
                     <Eye className="w-2.5 h-2.5" />
                     Preview
                   </button>
                 </>
               )}
               <span className="font-mono text-indigo-400">{props.sessions.find(s => s.id === props.currentProSessionId)?.uci || ''}</span>
             </div>
          </div>
          {/* Phase 5.5 — provider-down retry countdown banner */}
          {props.providerRetryCountdown !== null && (
            <div className="flex items-center justify-between gap-3 px-4 py-2 bg-amber-950/40 border-b border-amber-600/30 text-xs">
              <div className="flex items-center gap-2 text-amber-300">
                <span className="text-base">⏱</span>
                <span>AI providers temporarily unavailable — retry in <strong>{props.providerRetryCountdown}s</strong></span>
              </div>
              <button
                onClick={() => {
                  if (props.providerRetryTimerRef.current) clearInterval(props.providerRetryTimerRef.current);
                  props.setProviderRetryCountdown(null);
                  const prompt = props.providerRetryPromptRef.current;
                  if (prompt) { props.setProInput(prompt); props.handleSendForPro(prompt); }
                }}
                className="shrink-0 px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold text-[10px] uppercase tracking-widest transition-all"
              >
                Retry Now
              </button>
            </div>
          )}
          <AIChat
            messages={props.proMessages}
            input={props.proInput}
            onInputChange={props.setProInput}
            onSend={(files) => { props.handleSendForPro(files); }}
            isLoading={props.isProLoading}
            activeIntent={props.activeIntent}
            isPinned={props.sessions.find(s => s.id === props.currentProSessionId)?.isPinned || false}
            onTogglePin={() => props.togglePin(props.currentProSessionId)}
            isLoggedIn={!!props.user}
            onShowLogin={() => props.setShowAuth(true)}
            mode={props.mode}
            onModeChange={props.setMode}
            activeAgent={'navbharatai-pro'}
            pendingGHEdit={props.pendingGHEdit}
            onConfirmPush={props.handleGHConfirmPush}
            isPushing={props.isPushing}
            isAppBuilt={props.isAppBuilt}
            theme={props.theme}
            onPreviewClick={() => {
                props.toggleTab('preview');
                props.setIsMenuOpen(false);
            }}
            userId={props.user?.uid}
            activeUci={props.user ? (props.sessions.find(s => s.id === props.currentProSessionId)?.uci || '') : ''}
            onRestoreUci={props.user ? props.handleRestoreUci : undefined}
            restoredMessages={props.sessions.find(s => s.id === props.currentProSessionId)?.restoredMessages || []}
            memorySummary={props.sessions.find(s => s.id === props.currentProSessionId)?.memorySummary || ''}
            wallet={props.wallet}
            buildProgress={props.proBuildProgress}
            guiderPlan={props.proGuiderPlan?.plan || null}
            guiderReplanning={props.proGuiderReplanning}
            onGuiderApprove={() => {
              const p = props.proGuiderPlan;
              if (!p) return;
              // Arm the grade→refine loop with the approved spec for this build.
              props.proGuiderSpecRef.current = { spec: p.plan?.spec || null, prompt: p.prompt };
              props.proGuiderRefineRef.current = 0;
              props.setProGuiderPlan(null);
              void props.handleSendForPro(p.prompt, true, false, true);
            }}
            onGuiderSend={(refinement) => {
              const p = props.proGuiderPlan;
              if (!p || !refinement.trim()) return;
              const augmented = `${p.prompt}\n\n[User refinement to the plan]: ${refinement.trim()}`;
              props.setProGuiderReplanning(true);
              fetch('/api/guider/plan', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: augmented, files: {}, isEdit: false, agentic: true }),
              })
                .then(r => r.json())
                .then((pr: any) => {
                  if (pr?.confirm && pr?.plan) props.setProGuiderPlan({ prompt: augmented, plan: pr.plan });
                  else { props.setProGuiderPlan(null); void props.handleSendForPro(augmented, true, false, true); }
                })
                .catch(() => {/* keep the current card */})
                .finally(() => props.setProGuiderReplanning(false));
            }}
            onBuildStepToggle={(i) => props.setProBuildProgress(prev => ({
              ...prev,
              steps: prev.steps.map((s, idx) => idx === i ? { ...s, expanded: !s.expanded } : s),
            }))}
            onDownloadZip={props.downloadAppZip}
            onSendSuggestion={(text) => { props.setProInput(text); props.handleSendForPro(text); }}
            onStop={props.isProLoading ? props.handleStopPro : undefined}
          />
        </div>

      {/* Drag handle — hidden on mobile, visible on desktop when workspace is open */}
      {workspaceVisible && (
        <div
          className="hidden md:flex w-[5px] shrink-0 relative items-center justify-center cursor-col-resize bg-white/5 hover:bg-indigo-500/40 active:bg-indigo-500/60 transition-colors select-none z-10 group/handle"
          onMouseDown={(e) => {
            isDragging.current = true;
            dragStartX.current = e.clientX;
            dragStartWidthPct.current = chatWidthPct;
            e.preventDefault();
          }}
        >
          {/* wider invisible hit area */}
          <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
          {/* visual grip dots */}
          <div className="flex flex-col gap-1 opacity-0 group-hover/handle:opacity-100 transition-opacity pointer-events-none">
            <span className="w-[3px] h-[3px] rounded-full bg-white/50" />
            <span className="w-[3px] h-[3px] rounded-full bg-white/50" />
            <span className="w-[3px] h-[3px] rounded-full bg-white/50" />
            <span className="w-[3px] h-[3px] rounded-full bg-white/50" />
            <span className="w-[3px] h-[3px] rounded-full bg-white/50" />
          </div>
        </div>
      )}

      {/* Desktop: live workspace docked to the right */}
      {workspaceVisible && (
        <div className="hidden md:flex flex-1 min-w-0 h-full min-h-0 max-h-full overflow-hidden">
          <WorkspacePane
            files={props.files as any}
            generatedCode={props.generatedCode}
            onFilesChange={(nf) => props.setFiles(nf as any)}
            onRun={(f) => props.updatePreview(f || (props.files as any))}
            onOpenStudio={() => props.toggleTab('studio')}
            onDeploy={() => { props.setDeployPanelError(''); props.setShowDeployPanel(true); }}
            canDeploy={props.isAppBuilt && !!props.files && Object.keys(props.files).length > 0}
            previewHistory={props.previewHistory}
            onRestoreHistory={(html) => props.setGeneratedCode(html)}
            onHtmlChange={(html) => props.setGeneratedCode(html)}
          />
        </div>
      )}

      {/* Mobile: preview as full-screen overlay (does NOT push chat up) */}
      {mobilePreviewExpanded && hasWorkspaceApp && (
        <div className="md:hidden absolute inset-0 z-50 flex flex-col bg-[#0d1117]">
          <div className="flex items-center justify-between px-4 py-2.5 bg-indigo-950/60 border-b border-indigo-500/20 shrink-0">
            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-300">App Preview</span>
            <button
              onClick={() => setMobilePreviewExpanded(false)}
              className="flex items-center gap-1 px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[9px] font-black text-[#8b949e] hover:text-white transition-all"
            >
              <Minimize2 className="w-3 h-3" />
              Minimize
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <WorkspacePane
              files={props.files as any}
              generatedCode={props.generatedCode}
              onFilesChange={(nf) => props.setFiles(nf as any)}
              onRun={(f) => props.updatePreview(f || (props.files as any))}
              onOpenStudio={() => props.toggleTab('studio')}
              onDeploy={() => { props.setDeployPanelError(''); props.setShowDeployPanel(true); }}
              canDeploy={props.isAppBuilt && !!props.files && Object.keys(props.files).length > 0}
              previewHistory={props.previewHistory}
              onRestoreHistory={(html) => props.setGeneratedCode(html)}
              onHtmlChange={(html) => props.setGeneratedCode(html)}
            />
          </div>
        </div>
      )}

      {/* G8 — One-click Deploy Panel (modal overlay) */}
      {props.showDeployPanel && (
        <DeployModal
          platform={props.deployPlatform}
          token={props.deployToken}
          projectName={props.deployProjectName}
          owner={props.deployOwner}
          repo={props.deployRepo}
          error={props.deployPanelError}
          isDeploying={props.isDeploying}
          onClose={() => props.setShowDeployPanel(false)}
          onPlatformChange={props.setDeployPlatform}
          onTokenChange={props.setDeployToken}
          onProjectNameChange={props.setDeployProjectName}
          onOwnerChange={props.setDeployOwner}
          onRepoChange={props.setDeployRepo}
          onClearError={() => props.setDeployPanelError('')}
          onDeploy={props.handleDeployApp}
        />
      )}
    </div>
  );
};
