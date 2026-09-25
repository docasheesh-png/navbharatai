import React, { lazy } from 'react';
import { ZipSizeModal } from '../ide/ZipSizeModal';
import type { ZipSizeModalVariant } from '../ide/ZipSizeModal';
import type { ViewType, FileSystem, ChatSession, Message } from '../../types';
import type { AgentMode } from '../../types';
import type { ThemeMode } from '../../lib/theme';
import type { PreviewProblem } from '../../lib/previewProblems';
import { getAgentV3WorkspaceId } from '../../lib/agentv3Workspace';
import { resolveAppSource, hasAnalysableApp } from '../../lib/workspaceSource';
import { hasConflictMarkers } from '../../lib/merge3';
import type { User as FirebaseUser } from 'firebase/auth';
import { AppLockGate } from '../AppLockGate';

// ── Lazy-loaded view components ─────────────────────────────────────────────
const _lz = <T extends object>(fn: () => Promise<T>, k: keyof T) =>
  lazy(() => fn().then(m => ({ default: m[k] as React.ComponentType<any> })));

// 🔴 THESE TWO WERE THE ONLY PANELS IN THIS FILE LOADED EAGERLY, AND THEY ARE THE TWO BIGGEST
// (2026-09-19, measured from the build's own sourcemap, not estimated).
//
// `ViewPanels` is imported statically by `App.tsx`, so anything IT imports statically lands in the
// entry chunk — the JavaScript a visitor must download, parse and compile before the first screen
// responds to anything. Forty-odd panels below are lazy for exactly that reason; these two were not,
// and they carried **177 KB of source into the entry chunk** (`PreviewSurface` 144 KB, `FilesPanel`
// 33 KB) for screens that render only behind `activeView === 'preview'` / `=== 'files'`.
//
// 🔒 SAFE BY CONSTRUCTION, not by hope: both render ONLY inside those two view gates, and every
// branch of this component renders inside the `<Suspense>` boundary App.tsx wraps the view switcher
// in (App.tsx ~3081). That is the same boundary the forty lazy panels already rely on — this adds no
// new failure mode, it joins an existing one.
//
// ⚠️ NOT written with `_lz`, deliberately. That helper casts to `ComponentType<any>`, which is why the
// props doc below warns the compiler will not tell you when a prop stops reaching a panel. The
// `.then(m => ({ default: m.X }))` form keeps the component's real prop types, so these two call sites
// stay type-checked exactly as they were when the import was static.
const PreviewSurface = lazy(() =>
  import('../agentv3/PreviewSurface').then(m => ({ default: m.PreviewSurface })));
const FilesPanel = lazy(() =>
  import('./FilesPanel').then(m => ({ default: m.FilesPanel })));

const ProjectInsightsPanel = _lz(() => import('./ProjectInsightsPanel'), 'ProjectInsightsPanel');
const GalleryPanel = _lz(() => import('./GalleryPanel'), 'GalleryPanel');
const CodeStudio        = _lz(() => import('../ide/CodeStudio'),         'CodeStudio');
const TestPanel         = _lz(() => import('../ide/TestPanel'),          'TestPanel');
const DiffViewer        = _lz(() => import('../ide/DiffViewer'),         'DiffViewer');
const VoiceToApp        = _lz(() => import('../ide/VoiceToApp'),         'VoiceToApp');
const BotBuilder        = _lz(() => import('../ide/BotBuilder'),         'BotBuilder');
const CostEstimator     = _lz(() => import('../ide/CostEstimator'),      'CostEstimator');
const ScreenshotToCode  = _lz(() => import('../ide/ScreenshotToCode'),   'ScreenshotToCode');
const MultiPageBuilder  = _lz(() => import('../ide/MultiPageBuilder'),   'MultiPageBuilder');
const AppAnalytics      = _lz(() => import('../ide/AppAnalytics'),       'AppAnalytics');
const AIDebugger        = _lz(() => import('../ide/AIDebugger'),         'AIDebugger');
const WebsiteCheckup    = _lz(() => import('../ide/WebsiteCheckup'),     'WebsiteCheckup');
const PerformanceAnalyzer = _lz(() => import('../ide/PerformanceAnalyzer'), 'PerformanceAnalyzer');
const ComponentLibrary  = _lz(() => import('../ide/ComponentLibrary'),   'ComponentLibrary');
const SEOOptimizer      = _lz(() => import('../ide/SEOOptimizer'),       'SEOOptimizer');
const APKBuilder        = _lz(() => import('../ide/APKBuilder'),         'APKBuilder');
const FigmaImporter     = _lz(() => import('../ide/FigmaImporter'),      'FigmaImporter');
// Custom Domain now uses the REAL, workspace-scoped Firebase-native connect flow (root-cause fix
// 2026-07-27) — both this entry and Settings → App Settings → Domain share ONE real implementation.
// (The sidebar's third "Connect my website" door was removed on 2026-09-19 as a duplicate.)
const ConnectMyWebsitePanel = _lz(() => import('./ConnectMyWebsitePanel'), 'ConnectMyWebsitePanel');
const TeamCollaboration = _lz(() => import('../ide/TeamCollaboration'),  'TeamCollaboration');
const PWANotifications  = _lz(() => import('../ide/PWANotifications'),   'PWANotifications');
const CodeMinifier      = _lz(() => import('../ide/CodeMinifier'),       'CodeMinifier');
const DarkModeGenerator = _lz(() => import('../ide/DarkModeGenerator'),  'DarkModeGenerator');
const MonetizationWizard= _lz(() => import('../ide/MonetizationWizard'), 'MonetizationWizard');
const AIImageGenerator  = _lz(() => import('../ide/AIImageGenerator'),   'AIImageGenerator');
const CodeVersioning    = _lz(() => import('../ide/CodeVersioning'),     'CodeVersioning');
const APIMarketplace    = _lz(() => import('../ide/APIMarketplace'),     'APIMarketplace');
const NavAppStore       = _lz(() => import('../ide/NavAppStore'),        'NavAppStore');
const LiveCollaboration = _lz(() => import('../ide/LiveCollaboration'),  'LiveCollaboration');
const ShareForReview    = _lz(() => import('../ide/ShareForReview'),     'ShareForReview');
const AITestingSuite    = _lz(() => import('../ide/AITestingSuite'),     'AITestingSuite');
const LocalizationManager = _lz(() => import('../ide/LocalizationManager'), 'LocalizationManager');
const AICodeReview      = _lz(() => import('../ide/AICodeReview'),       'AICodeReview');
const DatabaseStudio    = _lz(() => import('../ide/DatabaseStudio'),     'DatabaseStudio');
const CICDPipeline      = _lz(() => import('../ide/CICDPipeline'),       'CICDPipeline');
const PluginSystem      = _lz(() => import('../ide/PluginSystem'),       'PluginSystem');
const WhitelabelBranding= _lz(() => import('../ide/WhitelabelBranding'), 'WhitelabelBranding');
const DesignSystem      = _lz(() => import('../ide/DesignSystem'),       'DesignSystem');
const AppHealthMonitor  = _lz(() => import('../ide/AppHealthMonitor'),   'AppHealthMonitor');
const APITester         = lazy(() => import('../ide/APITester'));
const DeveloperApiCard  = _lz(() => import('../devtools/DeveloperApiCard'), 'DeveloperApiCard');

export interface ViewPanelsProps {
  /** The app's resolved device mode, handed to the full-page panels so a desktop screen is not given a
   *  phone-width column (admin report 2026-08-19; see src/lib/panelWidth.ts).
   *  ⚠️ The lazy `_lz` loader above erases prop types (ComponentType<any>), so the compiler will NOT
   *  tell you if this stops being passed to a panel below — hence the test that checks it. */
  effectiveDeviceMode: 'mobile' | 'tablet' | 'desktop';
  activeView: ViewType;
  /**
   * Where App Mart should OPEN, when the caller knew (the publish sheet's "Publish on App Mart"
   * button, admin 2026-09-18). Absent ⇒ the store opens on Browse exactly as before.
   *
   * ⚠️ `_lz` erases prop types, so the compiler cannot tell you if these stop reaching NavAppStore —
   * the same hazard `effectiveDeviceMode` documents above, and the reason a test asserts the wiring.
   */
  storeInitialTab?: 'browse' | 'publish' | 'mine' | 'review';
  storePublishWorkspaceId?: string | null;
  generatedCode: string;
  setGeneratedCode: (code: string) => void;
  files: FileSystem;
  setFiles: (files: any) => void;
  /** THE shared hand-edit seam (App.applyIdeFileChange): local state + preview + DURABLE sync. */
  onIdeFilesChange: (files: any) => void;
  /** Force pending edits to the durable store and resolve once stored — powers an honest "Saved". */
  onFlushIdeEdits: () => Promise<void>;
  /** An uploaded ZIP landed server-side — REPLACE the app's file set with it (see App.tsx). */
  onReplaceProjectFiles: (files: Record<string, string>) => void;
  /** Clear deleted paths from durable storage (IDE file-explorer multi-delete). */
  onFilesRemoved?: (paths: string[]) => void;
  hasGeneratedCode: boolean;
  setIsAppBuilt: (v: boolean) => void;
  setHasGeneratedCode: (v: boolean) => void;
  user: FirebaseUser | null;
  activeAgent: string;
  mode: AgentMode;
  setMode: (mode: AgentMode) => void;
  isAppBuilt: boolean;
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  messages: Message[];
  input: string;
  setInput: (v: string) => void;
  setProInput: (v: string) => void;
  isLoading: boolean;
  activeIntent: string;
  handleSendForTab: (tabId: ViewType, overrideMessage?: string) => void;
  toggleTab: (view: ViewType) => void;
  /** Open the ONE mode picker (admin 2026-09-21); undefined on a phone, where the bottom bar has it. */
  onOpenModePicker?: (() => void) | undefined;
  /** Opens chat history from a composer's left column; absent while the phone's bottom bar carries it. */
  onOpenHistory?: (() => void) | undefined;
  updatePreview: (files: any) => void;
  addLog: (msg: string, level: string) => void;
  addToast: (msg: string, type: string) => void;
  handleAgentChange: (agent: string) => void;
  githubToken: string;
  githubUser: any;
  githubRepoContext: any;
  isGHSyncing: boolean;
  pendingGHEdit: any;
  handleGHConfirmPush: () => void;
  isPushing: boolean;
  connectGitHub: () => void;
  disconnectGitHub: () => void;
  pushToRepo: () => void;
  firebaseToken: string;
  firebaseUser: any;
  connectFirebase: () => void;
  disconnectFirebase: () => void;
  sessions: ChatSession[];
  currentSessionId: string;
  togglePin: (id: string) => void;
  currentProSessionId: string;
  previewHistory: { id: string; label: string; ts: Date; html: string }[];
  fileUploadConflict: { file: File; existingKey: string; isZip: boolean } | null;
  resolveFileConflict: (choice: 'replace' | 'merge') => void;
  handleFilesUpload: (file: File) => void;
  downloadAppZip: (deployFiles: Record<string, string>, appName: string) => void;
  setActiveFile: (path: string) => void;
  wallet: any;
  setShowAuth: (v: boolean) => void;
  zipSizeModal: { variant: ZipSizeModalVariant; fileName: string; fileSizeMB: number } | null;
  setZipSizeModal: (v: { variant: ZipSizeModalVariant; fileName: string; fileSizeMB: number } | null) => void;
  /** The v5.0 build's live preview URL + workspace, lifted from AgentV3Panel so the main "Preview"
   *  menu shows the SAME working v5.0 preview instead of the retired v2.0 generatedCode.
   *  `framework` + `running` (2026-07-01) let the sidebar PreviewSurface reach feature parity with
   *  the in-panel one (auto-resume + framework-aware Diagnose). */
  v3Preview?: { previewUrl?: string; workspaceId?: string; framework?: string; running?: boolean };
  /** Snapshot of the files taken before the last v5.0 build — the Diff Viewer's "previous version". */
  previousFiles?: Record<string, string>;
  /** "Fix with AI" clicked from the sidebar preview — prefills the v5.0 chat with the error. */
  onV3FixError?: (errText: string) => void;
  /** Hand a build prompt to the REAL engine: prefills the Pro v5.0 composer and switches to that
   *  view, where Send starts a genuine live build. Used by tools like Voice to App whose old
   *  "generate" path called a non-existent endpoint (display-only, admin autopsy 2026-07-20). */
  onBuildViaV5Prompt?: (prompt: string) => void;
  /** Auto-fix: open the SCANNED Pro v5 app in the v5 page with a fix prompt prefilled (admin 2026-07-24). */
  onAutoFixInV5?: (workspaceId: string, text: string) => void;
  /** Time Machine: switch the workspace to another of the user's apps by its v5 sessionId. */
  onSwitchApp?: (sessionId: string) => void;
  /** Real compile-error problems from the live preview bundle, surfaced in Code Studio's Problems panel. */
  problems?: PreviewProblem[];
  /** Code Studio's "Preview" button: open NavBharatAI Pro in its own window, ON its Preview surface
   *  (admin 2026-09-15). App owns it because only App can both switch the tab and hand the Pro panel
   *  the nonce that tells it which surface to land on. */
  onOpenProPreview: () => void;
}

export function ViewPanels({
  effectiveDeviceMode,
  activeView, storeInitialTab, storePublishWorkspaceId, generatedCode, setGeneratedCode, files, setFiles, onIdeFilesChange, onFlushIdeEdits, onReplaceProjectFiles, onFilesRemoved,
  hasGeneratedCode, setIsAppBuilt, setHasGeneratedCode,
  user, activeAgent, mode, setMode, isAppBuilt, theme, setTheme,
  messages, input, setInput, setProInput, isLoading, activeIntent,
  handleSendForTab, toggleTab, onOpenModePicker, onOpenHistory, updatePreview, addLog, addToast,
  handleAgentChange, githubToken, githubUser, githubRepoContext, isGHSyncing,
  pendingGHEdit, handleGHConfirmPush, isPushing, connectGitHub, disconnectGitHub,
  pushToRepo, firebaseToken, firebaseUser, connectFirebase, disconnectFirebase,
  sessions, currentSessionId, togglePin, currentProSessionId,
  previewHistory, fileUploadConflict, resolveFileConflict, handleFilesUpload,
  downloadAppZip, setActiveFile, wallet, setShowAuth,
  zipSizeModal, setZipSizeModal, v3Preview, previousFiles, onV3FixError, onBuildViaV5Prompt, onAutoFixInV5, onSwitchApp, onOpenProPreview, problems = [],
}: ViewPanelsProps) {
  return (
    <>
      {activeView === 'studio' && (
        /* 🔒 APP LOCK — Code Studio (admin 2026-09-13). Default OFF: the gate renders its children
           untouched unless the user ticked this area in Settings → Profile Settings → General → App Lock, so a
           user who never switched it on sees exactly the screen they saw before.

           Wrapping (rather than overlaying, as the Pro builder needs) is right here: CodeStudio already
           force-remounts on `key={activeAgent}`, so it holds nothing across a remount that a gate could
           destroy. */
        <div className="flex-1 h-full overflow-hidden">
          {/* ⚠️ `user`, NOT `firebaseUser`. This file has both, and they are different things: `firebaseUser`
              is the user's OWN Firebase project connection (BYO database, sitting between `firebaseToken`
              and `connectFirebase` in the props), while `user` is the signed-in NavBharatAI account. The
              lock keyed to the wrong one would ask the server about a uid that is not the caller's, be
              refused by `requireUserMatch`, and then render OPEN — a gate that fails silently. */}
          <AppLockGate userId={user?.uid ?? ''} area="code_studio" render={() => (
          <CodeStudio
            key={activeAgent}
            activeAgent={activeAgent}
            onAgentChange={handleAgentChange}
            files={files}
            onFilesChange={onIdeFilesChange}
            onFlushEdits={onFlushIdeEdits}
            /* ONE PREVIEW EVERYWHERE — extended to Code Studio (admin 2026-08-05: "code studio
               preview = slidebar preview = v5 preview, sab ek hi hone chahiye"). Code Studio was the
               last surface still rendering the retired v2.0 generatedCode preview, which the v5
               engine never writes — so it showed "Waiting for magic…" while the real app was running
               and the status bar said PREVIEW LIVE · 13 FILES. It now gets the same state the
               slide-menu Preview does, and renders the same PreviewSurface from it. */
            v3Preview={v3Preview}
            onReplaceProjectFiles={onReplaceProjectFiles}
            onFilesRemoved={onFilesRemoved}
            onRun={(f: any) => updatePreview(f || files)}
            generatedCode={generatedCode}
            messages={messages}
            chatInput={input}
            onChatInputChange={setInput}
            onChatSend={() => handleSendForTab('nbi_pro_chat' as ViewType)}
            isChatLoading={isLoading}
            activeIntent={activeIntent}
            problems={problems}
            v3WorkspaceId={user?.uid ? getAgentV3WorkspaceId(user.uid) : undefined}
            v3UserId={user?.uid}
            v3Email={user?.email || undefined}
            githubToken={githubToken}
            githubUser={githubUser}
            githubRepoContext={githubRepoContext}
            isGHSyncing={isGHSyncing}
            firebaseToken={firebaseToken}
            firebaseUser={firebaseUser}
            onFirebaseConnect={connectFirebase}
            onFirebaseDisconnect={disconnectFirebase}
            onGHConnect={connectGitHub}
            onGHDisconnect={disconnectGitHub}
            onGHPush={pushToRepo}
            isPinned={sessions.find(s => s.id === currentSessionId)?.isPinned || false}
            onTogglePin={() => togglePin(currentSessionId)}
            isLoggedIn={!!user}
            onShowLogin={() => setShowAuth(true)}
            mode={mode}
            onModeChange={setMode}
            isAppBuilt={isAppBuilt}
            // IDE top-bar "Preview" button → the SAME NavBharatAI Pro window the AI button opens, landing
            // on Pro's own Preview page (admin 2026-09-15: "ide me koi user preview press kare to
            // navbharatai pro, open hi preview wala page"). It used to open the standalone 'preview' tab
            // — a third preview surface beside Pro's. That tab still exists and is still reachable from
            // the slide menu and the default bottom nav; it is simply no longer what the IDE shows you.
            onPreviewClick={onOpenProPreview}
            // IDE top-bar "AI" button → open the FULL NavBharatAI Pro (same session/workspace/memory,
            // so it is 100% in sync with what's open in the IDE), not the in-IDE mini chat (admin 2026-07-31).
            onSocialChatTrigger={() => toggleTab('nbi_pro_chat')}
            theme={theme}
            onThemeChange={setTheme}
            pendingGHEdit={pendingGHEdit}
            onConfirmPush={handleGHConfirmPush}
            isGHPushing={isPushing}
            onGoToMain={() => {
              toggleTab('nbi_pro_chat');
              addLog('Cognitive memory layer successfully merged and redirected to main cockpit.', 'info');
            }}
            wallet={wallet}
            onSendDirect={(text: string) => handleSendForTab('nbi_pro_chat' as ViewType, text)}
          />
          )} />
        </div>
      )}

      {activeView === 'preview' && (
        <div className="flex-1 h-full overflow-hidden">
          {/* ONE PREVIEW EVERYWHERE (admin 2026-07-07: "3 gate, andar sab same — v5.0 wala hi"):
              every entry point (the v5.0 panel tab, the footer PREVIEW tab, the slide-menu Preview)
              renders the SAME v5.0 PreviewSurface. The retired v2.0 PreviewPanel branch (generatedCode,
              which the v3 engine never writes) is removed — with no v3 workspace yet, PreviewSurface
              shows its own honest "it appears the moment the agent starts the app" state. Porting the
              old panel's download/install/tags extras into PreviewSurface is tracked in PROGRESS.md. */}
          <PreviewSurface
            url={v3Preview?.previewUrl}
            workspaceId={v3Preview?.workspaceId}
            userId={user?.uid}
            email={user?.email ?? undefined}
            framework={v3Preview?.framework}
            // Always true here by construction: this mount is inside `activeView === 'preview'`, so it
            // UNMOUNTS when the user navigates away and its timers go with it.
            paneVisible
            autoResume={!v3Preview?.running}
            onFixError={onV3FixError}
            onFileEdited={(path, content) => setFiles((prev: any) => ({ ...prev, [path]: content }))}
          />
        </div>
      )}

      {/* ZIP size modal — appears regardless of active view */}
      {zipSizeModal && (
        <ZipSizeModal
          variant={zipSizeModal.variant}
          fileName={zipSizeModal.fileName}
          fileSizeMB={zipSizeModal.fileSizeMB}
          onClose={() => setZipSizeModal(null)}
        />
      )}

      {activeView === 'files' && (
        <div className="flex flex-col h-full overflow-hidden">
          {(() => {
            // The standalone Diff Viewer tile was removed (redundant with v5's inline diffs + Diff tab),
            // but its merge-CONFLICT resolver is kept: whenever a workspace file carries conflict markers
            // (e.g. a GitHub import of a repo with unresolved conflicts), surface a Resolve entry that opens
            // the conflict resolver. Fires only when real markers exist — never dead UI. (admin 2026-07-24)
            const conflicted = Object.entries(files as Record<string, string>)
              .filter(([, c]) => typeof c === 'string' && hasConflictMarkers(c))
              .map(([p]) => p);
            if (conflicted.length === 0) return null;
            return (
              <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b text-xs"
                style={{ background: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.3)', color: 'var(--brand-warn-text)' }}>
                <span className="flex-1 min-w-0">
                  ⚠ {conflicted.length} file{conflicted.length > 1 ? 's have' : ' has'} unresolved merge conflicts
                  {' '}(<span className="font-mono">{conflicted.slice(0, 2).join(', ')}{conflicted.length > 2 ? `, +${conflicted.length - 2}` : ''}</span>).
                </span>
                <button onClick={() => toggleTab('diff')}
                  className="shrink-0 px-2.5 py-1 rounded font-semibold"
                  style={{ background: 'rgba(245,158,11,0.25)', color: 'var(--brand-warn-text)' }}>
                  Resolve
                </button>
              </div>
            );
          })()}
        <FilesPanel
          files={files}
          hasGeneratedCode={hasGeneratedCode}
          fileUploadConflict={fileUploadConflict}
          onResolveConflict={resolveFileConflict}
          onUpload={handleFilesUpload}
          onDownloadZip={() => downloadAppZip(files as any, 'NavBharatApp')}
          onOpenFile={(path: string) => { setActiveFile(path); toggleTab('studio'); }}
          onAddFile={(path: string) => {
            const next = { ...(files as Record<string, string>), [path]: '' };
            setFiles(next as any);
            setActiveFile(path);
            toggleTab('studio');
          }}
          onDeleteFile={(path: string) => {
            const next = { ...(files as Record<string, string>) };
            delete next[path];
            setFiles(next as any);
            // REAL delete: also purge IndexedDB + the v5.0 durable workspace, or the file
            // silently resurrects on the next reload (fake delete).
            onFilesRemoved?.([path]);
          }}
          onRenameFile={(oldPath: string, newPath: string) => {
            const prev = files as Record<string, string>;
            // Source must verifiably hold a string — writing `undefined` into the map crashed the
            // whole app at render (report 2026-07-07: "undefined is not an object ('ce.split')").
            if (prev[newPath] !== undefined || typeof prev[oldPath] !== 'string') return; // target exists / source unreadable, abort
            const next = { ...prev, [newPath]: prev[oldPath] };
            delete next[oldPath];
            setFiles(next as any);
          }}
          onDuplicateFile={(sourcePath: string, targetPath: string) => {
            const prev = files as Record<string, string>;
            if (prev[targetPath] !== undefined || typeof prev[sourcePath] !== 'string') return; // target exists / source unreadable, abort
            setFiles({ ...prev, [targetPath]: prev[sourcePath] } as any);
          }}
          sessionId={currentProSessionId}
          onRestoreVersion={(restoredFiles: any, commitMsg: string) => {
            setFiles(restoredFiles);
            addLog(`Restored to: ${commitMsg}`, 'success');
            toggleTab('studio');
          }}
        />
        </div>
      )}

      {/* Phase 3 — Testing System */}
      {activeView === 'testing' && (
        <div className="flex-1 h-full overflow-hidden">
          <TestPanel generatedCode={generatedCode} files={files} />
        </div>
      )}

      {/* THE NAVBHARATAI API — Other → Developer Tools → NavBharatAI API (admin 2026-09-17). A full page
          rather than a card on the tools grid: a key is made, tested and controlled here, and that
          needs room. Signed-out visitors see what they would get and are asked to sign in. */}
      {activeView === 'devapi' && (
        <div className="flex-1 h-full overflow-y-auto">
          <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-6">
            <DeveloperApiCard signedIn={!!user} onShowLogin={() => setShowAuth(true)} />
          </div>
        </div>
      )}

      {/* Phase 3 — API Tester */}
      {activeView === 'api' && (
        <div className="flex-1 h-full overflow-hidden">
          <APITester />
        </div>
      )}

      {/* Phase 3 — Diff Viewer */}
      {activeView === 'diff' && (
        <div className="flex-1 h-full overflow-hidden">
          <DiffViewer
            files={files}
            previousFiles={previousFiles}
            onRevertFile={(fileName: string, content: string) => {
              // The same persist path the conflict resolver already uses — one way to write a file
              // back, so a revert lands exactly where a resolve does and the preview follows both.
              const next = { ...(files as Record<string, string>), [fileName]: content };
              setFiles(next as any);
              updatePreview(next as any);
              addToast(`Reverted ${fileName} \u2713`, 'success');
            }}
            onResolveConflicts={(fileName: string, resolved: string) => {
              // P-DEV.4 — write the marker-free resolved content back to the workspace + refresh preview.
              const next = { ...(files as Record<string, string>), [fileName]: resolved };
              setFiles(next as any);
              updatePreview(next as any);
              addToast(`Resolved conflicts in ${fileName} ✓`, 'success');
            }}
          />
        </div>
      )}

      {/* The 'database' view was REMOVED (admin 2026-07-27): its only real content was a link to
          Settings → App Settings → Database, so it read as a second, different database to set up.
          The real screen (DatabaseSettings) is unchanged and still lives in Settings. */}

      {/* Voice to App — REAL path (admin 2026-07-20): the spoken prompt is handed to the Pro v5.0
          engine (composer prefill + view switch); Send there starts a genuine live build. The old
          onAppGenerated flow rendered nothing real (its /api/generate endpoint never existed). */}
      {activeView === 'voice' && (
        <div className="flex-1 h-full overflow-hidden">
          <VoiceToApp onBuildViaV5={(prompt: string) => onBuildViaV5Prompt?.(prompt)} />
        </div>
      )}

      {/* Bot Builder — the designed flow can now be BUILT for real via the Pro v5.0 handoff
          (admin 2026-07-20); previously the designer ended at a JSON export and built nothing. */}
      {activeView === 'botbuilder' && (
        <div className="flex-1 h-full overflow-hidden">
          <BotBuilder />
        </div>
      )}

      {/* Phase 4 — Cost Estimator */}
      {activeView === 'cost' && (
        <div className="flex-1 h-full overflow-hidden">
          <CostEstimator />
        </div>
      )}

      {/* Phase 5 — Screenshot to Code */}
      {activeView === 'screenshot' && (
        <div className="flex-1 h-full overflow-hidden">
          <ScreenshotToCode onBuildViaV5={(prompt: string) => onBuildViaV5Prompt?.(prompt)} />
        </div>
      )}

      {/* Phase 5 — Multi-Page Builder */}
      {activeView === 'multipages' && (
        <div className="flex-1 h-full overflow-hidden">
          <MultiPageBuilder
            initialCode={generatedCode}
            sessionId={currentProSessionId}
            onExport={(pages: any) => {
              // EVERY page is now written into the user's real app by the tool itself. This handler
              // only mirrors the home page into the preview so the result is visible straight away —
              // it used to be the ONLY thing that happened, which silently discarded every other page.
              const home = pages['index.html'] ?? Object.values(pages)[0];
              if (home) { setGeneratedCode(home as string); toggleTab('preview'); }
            }}
            onBuildViaV5={(prompt: string) => onBuildViaV5Prompt?.(prompt)}
          />
        </div>
      )}

      {/* Phase 5 — Analytics */}
      {activeView === 'analytics' && (
        <div className="flex-1 h-full overflow-hidden">
          <AppAnalytics userId={user?.uid} />
        </div>
      )}

      {/* Insights & Integrations — surfaces SLO / SBOM / Webhooks (wiring sweep) */}
      {activeView === 'insights' && (
        <div className="flex-1 h-full overflow-hidden">
          <ProjectInsightsPanel user={user} files={files as Record<string, string>} workspaceId={v3Preview?.workspaceId} />
        </div>
      )}

      {/* Community gallery / remix (ROADMAP §2). Publishing lands as `pending`; only an admin can
          make an app public, so this screen never claims an app is live. */}
      {activeView === 'gallery' && (
        <div className="flex-1 h-full overflow-hidden">
          <GalleryPanel user={user} files={files as Record<string, string>} onOpenPlans={() => toggleTab('billing')} />
        </div>
      )}

      {/* Phase 6 — AI Debugger */}
      {activeView === 'debugger' && (
        <div className="flex-1 h-full overflow-hidden">
          <AIDebugger files={files} onAutoFixInV5={onAutoFixInV5} />
        </div>
      )}

      {/* Website Checkup — passive health check of the user's OWN published site */}
      {activeView === 'checkup' && (
        <div className="flex-1 h-full overflow-hidden">
          <WebsiteCheckup />
        </div>
      )}

      {/* Phase 6 — Performance Analyzer */}
      {activeView === 'performance' && (
        <div className="flex-1 h-full overflow-hidden">
          <PerformanceAnalyzer generatedCode={generatedCode} files={files as Record<string, string>} liveUrl={v3Preview?.previewUrl} />
        </div>
      )}

      {/* Phase 6 — Component Library */}
      {activeView === 'components' && (
        <div className="flex-1 h-full overflow-hidden">
          {/* The component is written into the user's chosen app file by the tool itself (admin
              2026-07-27) — this handler only mirrors the change into the on-screen preview, so what
              was just saved is visible immediately as well. */}
          <ComponentLibrary sessionId={currentProSessionId} onInsert={(html: string) => {
            const src = resolveAppSource(generatedCode, files as Record<string, string>);
            if (!hasAnalysableApp(src)) return;
            const merged = src.html.includes('</body>')
              ? src.html.replace('</body>', html + '\n</body>')
              : src.html + '\n' + html;
            if (src.kind === 'files') {
              const next = { ...(files as Record<string, string>), 'index.html': merged };
              setFiles(next as any); updatePreview(next as any);
            } else {
              setGeneratedCode(merged);
            }
          }} />
        </div>
      )}

      {/* Phase 6 — SEO Optimizer */}
      {activeView === 'seo' && (
        <div className="flex-1 h-full overflow-hidden">
          <SEOOptimizer generatedCode={generatedCode} files={files as Record<string, string>} appName="NavBharatAI App" sessionId={currentProSessionId} onCodeUpdate={(c: string) => setGeneratedCode(c)} />
        </div>
      )}

      {/* Phase 7 — APK Builder */}
      {activeView === 'apk' && (
        <div className="flex-1 h-full overflow-hidden">
          <APKBuilder
            effectiveDeviceMode={effectiveDeviceMode}
            generatedCode={generatedCode}
            appName="NavBharatAI App"
            sessionId={currentProSessionId}
            githubToken={githubToken}
            githubUser={githubUser}
            onConnectGitHub={connectGitHub}
            onDisconnectGitHub={disconnectGitHub}
            onMakeIcon={() => toggleTab('imagegen')}
          />
        </div>
      )}

      {/* Phase 7 — Figma Importer */}
      {activeView === 'figma' && (
        <div className="flex-1 h-full overflow-hidden">
          <FigmaImporter
            sessionId={currentProSessionId}
            onCodeGenerated={(code: string) => { setGeneratedCode(code); toggleTab('preview'); }}
            onBuildViaV5={(prompt: string) => onBuildViaV5Prompt?.(prompt)}
          />
        </div>
      )}

      {/* Custom Domain — the REAL, workspace-scoped Firebase-native connect flow (honest
          pending/active/not-configured states), same implementation as Settings → App Settings → Domain. */}
      {activeView === 'domain' && (
        <div className="flex-1 h-full overflow-y-auto">
          <ConnectMyWebsitePanel onBack={() => toggleTab('studio')} uid={user?.uid} />
        </div>
      )}

      {/* Phase 7 — Team Collaboration */}
      {activeView === 'team' && (
        <div className="flex-1 h-full overflow-hidden">
          <TeamCollaboration userId={user?.uid} projectName="NavBharatAI Project" />
        </div>
      )}

      {/* Phase 8 — PWA Notifications */}
      {activeView === 'pwa' && (
        <div className="flex-1 h-full overflow-hidden">
          <PWANotifications generatedCode={generatedCode} onCodeUpdate={(c: string) => setGeneratedCode(c)} />
        </div>
      )}

      {/* Phase 8 — Code Minifier */}
      {activeView === 'minifier' && (
        <div className="flex-1 h-full overflow-hidden">
          <CodeMinifier generatedCode={generatedCode} files={files as Record<string, string>} sessionId={currentProSessionId} onOptimized={(c: string) => { setGeneratedCode(c); toggleTab('preview'); }} />
        </div>
      )}

      {/* Phase 8 — Dark Mode Generator */}
      {activeView === 'darkmode' && (
        <div className="flex-1 h-full overflow-hidden">
          <DarkModeGenerator generatedCode={generatedCode} files={files as Record<string, string>} sessionId={currentProSessionId} onCodeUpdate={(c: string) => setGeneratedCode(c)} />
        </div>
      )}

      {/* Phase 8 — Monetization Wizard */}
      {activeView === 'monetize' && (
        <div className="flex-1 h-full overflow-hidden">
          <MonetizationWizard
            sessionId={currentProSessionId}
            userId={user?.uid}
            githubToken={githubToken}
            onConnectGitHub={connectGitHub}
          />
        </div>
      )}

      {/* Phase 9 — AI Image Generator */}
      {activeView === 'imagegen' && (
        <div className="flex-1 h-full overflow-hidden">
          <AIImageGenerator onOpenModePicker={onOpenModePicker} onOpenHistory={onOpenHistory} onImageGenerated={(url: string, prompt: string) => {
            setGeneratedCode(generatedCode + `\n<!-- Generated Image: ${prompt} -->\n<img src="${url}" alt="${prompt}" style="max-width:100%;border-radius:12px;" />`);
          }} />
        </div>
      )}

      {/* Phase 9 — Code Versioning */}
      {activeView === 'versioning' && (
        <div className="flex-1 h-full overflow-hidden">
          <CodeVersioning
            generatedCode={generatedCode}
            files={files as Record<string, string>}
            sessionId={currentProSessionId}
            onRestore={(c: string) => setGeneratedCode(c)}
            onRestoreFiles={(f: any) => { setFiles(f as any); updatePreview(f as any); setIsAppBuilt(true); setHasGeneratedCode(true); addToast('Version restored ✓', 'success'); }}
            onSwitchApp={onSwitchApp}
          />
        </div>
      )}

      {/* Phase 9 — API Marketplace */}
      {activeView === 'apimarket' && (
        <div className="flex-1 h-full overflow-hidden">
          <APIMarketplace onCodeInsert={(code: string) => setGeneratedCode(generatedCode + '\n\n' + code)} />
        </div>
      )}

      {/* Nav App Store (admin 2026-07-27) — replaces the old App Store Publisher, which was a
          metadata checklist that never published anything. The Play/App Store listing guidance it
          offered now lives, step by step, inside the APK Builder's publishing guide; this screen is
          the real thing: upload an .apk, and install apps other people have published. */}
      {activeView === 'appstore' && (
        <div className="flex-1 h-full overflow-hidden">
          <NavAppStore initialTab={storeInitialTab} initialPublishWorkspaceId={storePublishWorkspaceId} />
        </div>
      )}

      {/* Phase 10 — Live Collaboration */}
      {activeView === 'collab' && (
        <div className="flex-1 h-full overflow-hidden">
          <LiveCollaboration
            generatedCode={generatedCode}
            onCodeUpdate={(c: string) => setGeneratedCode(c)}
            userId={user?.uid}
            userName={user?.displayName || user?.email?.split('@')[0]}
            userEmail={user?.email || undefined}
          />
        </div>
      )}

      {/* E1 (trust sprint) — Share for review: a read-only client link, surfaced as its own tool so the
          feature is discoverable instead of buried three levels deep in Settings → Deploy. */}
      {activeView === 'sharereview' && (
        <div className="flex-1 h-full overflow-auto p-4">
          <ShareForReview generatedCode={generatedCode} />
        </div>
      )}

      {/* Phase 10 — AI Testing Suite */}
      {activeView === 'aitesting' && (
        <div className="flex-1 h-full overflow-hidden">
          <AITestingSuite generatedCode={generatedCode} onCodeUpdate={(c: string) => setGeneratedCode(c)} />
        </div>
      )}

      {/* Phase 10 — Localization Manager */}
      {activeView === 'localization' && (
        <div className="flex-1 h-full overflow-hidden">
          <LocalizationManager />
        </div>
      )}

      {/* Phase 10 — AI Code Review */}
      {activeView === 'codereview' && (
        <div className="flex-1 h-full overflow-hidden">
          <AICodeReview generatedCode={generatedCode} onCodeUpdate={(c: string) => setGeneratedCode(c)} sessions={sessions} githubToken={githubToken} />
        </div>
      )}

      {activeView === 'dbstudio' && (
        <div className="flex-1 h-full overflow-hidden">
          <DatabaseStudio />
        </div>
      )}

      {activeView === 'cicd' && (
        <div className="flex-1 h-full overflow-hidden">
          <CICDPipeline githubToken={githubToken} onConnectGitHub={connectGitHub} />
        </div>
      )}

      {activeView === 'plugins' && (
        <div className="flex-1 h-full overflow-hidden">
          <PluginSystem onCodeInsert={(code: string) => setGeneratedCode(generatedCode + code)} />
        </div>
      )}

      {activeView === 'whitelabel' && (
        <div className="flex-1 h-full overflow-hidden">
          <WhitelabelBranding />
        </div>
      )}


      {activeView === 'designsys' && (
        <div className="flex-1 h-full overflow-hidden">
          <DesignSystem generatedCode={generatedCode} files={files as Record<string, string>} sessionId={currentProSessionId} onCodeUpdate={(c: string) => setGeneratedCode(c)} />
        </div>
      )}

      {activeView === 'healthmon' && (
        <div className="flex-1 h-full overflow-hidden">
          <AppHealthMonitor />
        </div>
      )}
    </>
  );
}
