import { useCallback, useEffect, useRef, useState } from 'react';
import { FilesPanel, type FilesPanelProps } from '../panels/FilesPanel';
import { AttachMenu } from '../AttachMenu';
import { SecretRequestCard } from './SecretRequestCard';
import { saveSecret } from '../../lib/secretsApi';
import {
  Bot, Send, Square, Loader2, Terminal, FileDiff, FolderOpen,
  History, CheckCircle2, AlertCircle, Rocket, Globe, ExternalLink, RotateCcw, Play,
  Settings, Check, X, Paperclip, FileText, Github, Circle, GitBranch,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  FileCode, Maximize2, Minimize2, ThumbsUp, ThumbsDown, Menu, Plus, Clock, Sparkles, Wallet, Copy,
  Star, Search, Mic, Camera, Volume2,
} from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { HostingChooser } from './HostingChooser';
import {  } from '../../lib/authHeaders';
import { authedFetch } from '../../lib/authedFetch';
import { importProjectArchive, importProjectFolder, pickProjectFolder, type MasterImportResult } from '../../lib/masterZipImport';
import { resolveImportWorkspaceId, importTargetUnavailableMessage } from './zipImportTarget';
import { combineScreenshotPrompt } from '../../lib/screenshotPrompt';
import { AppUpdateChatNotice } from '../AppUpdateChatNotice';
import type { ConversationMeta, QueueItemView } from '../../hooks/useAgentV3Build';
import { useAgentV3Build } from '../../hooks/useAgentV3Build';
import { isBuildBusyError, shouldRestoreFinishedBuild } from '../../hooks/agentV3StreamError';
import { sessionStatusMeta, groupSessionsByDate, legacyPrependMessages, filterSessionsByQuery, partitionPinnedSessions } from './agentV3History';
import { previewVisible, previewMounted, previewWrapClass, shouldPrewarmPreview } from './previewKeepAlive';
import { saveLastReport, readLastReport } from './reportCache';
import type { ReportPickerItem } from '../../lib/reportPicker';
import { reportKey, reportSendCount, bumpReportSendCount, reportButtonLabel, reportAlreadySentHint } from './reportSendCount';
import { footerSection, previewReadySignal, type V3FooterApi } from './v3FooterApi';
import { clampComposerHeight } from './composerHeight';
import { FoldableMessage } from './FoldableMessage';
import { MessageActions } from './MessageActions';
import { STARTER_TEMPLATES, partitionStarters } from './starterTemplates';
import { StarterSketch } from './StarterSketch';
import { loadSavedTemplates, saveTemplate, removeSavedTemplate, type SavedTemplate } from './savedTemplates';
import { checkAttachmentSizes, MAX_ATTACHMENT_BYTES } from '../../lib/attachmentLimits';
import { deployBlockedReason } from '../../lib/deployGuard';
import { simplifyHealthLines } from '../../lib/buildHealthDisplay';
import { speechRecognitionSupported } from '../../lib/voiceInput';
import { historyOpen404Action } from './historyOpenPolicy';
import { v3SessionStorageKey, readStickySession, clientWorkspaceId } from './v3SessionContinuity';
import { loadDraft, saveDraft } from './composerDraft';
import { decideAutoContinue } from './planAutoContinue';
import { shouldRunNextQueued } from './queueExecutor';
import { buildChatBlocks } from './activityTimeline';
import { ChatToolbar } from '../chat/ChatToolbar';
import { ProfessionalVoiceButton } from '../sonic/ProfessionalVoiceButton';
import { filterMessages, enterShouldSend, readSendOnEnter } from '../../lib/chatToolbar';
import { ActionGroupRow } from './ActivityTimelineRow';
import { trackEvent } from '../../lib/analytics';
import { normalizeUid } from '../../lib/agentv3Workspace';
import { deliverTextFile } from '../../lib/downloadFile';
import { FrameworkPicker, FRAMEWORKS } from './FrameworkPicker';
import { resolveFrameworkSelection } from '../../lib/frameworkDetect';
import { PreviewSurface } from './PreviewSurface';
import type { ActivityEntry, AgentCard, BuildHealth, GitCheckpoint, TodoItem, TodoStatus } from './agentV3Types';
import { canSteerMidBuild, showTeamHq, teamHqModel, formatElapsed } from './fullTeam';
import { db, sanitizeFirestoreData } from '../../App';

/** Best-effort Firebase ID-token header so the server can verify workspace ownership (IDOR guard).
 *  Returns {} for the synthetic admin / anonymous users (no Firebase user) — the server falls back
 *  to its claimed-id + random-sessionId check for those. */
import { doc, setDoc, deleteDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { authJsonHeaders } from '../../lib/authHeaders';

/**
 * AgentV3Panel — NavBharatAI Pro v5.0 (Vargen 3.0), a Claude-Code-style chat
 * app builder. You chat with it (it replies to anything, even "hello"); when you
 * describe an app it builds it for real, and the workspace surfaces (preview,
 * files, diff, terminal, git) update live alongside. All activity is REAL engine
 * output — nothing is a scripted animation.
 */
type SurfaceTab = 'preview' | 'files' | 'diff' | 'terminal' | 'history';
interface ChatMsg {
  role: 'user' | 'agent';
  agent?: string;
  text: string;
  ts: number;
  kind?: 'text' | 'thinking';
  streaming?: boolean;
}

const V3_EXT_COLOR: Record<string, string> = {
  html: 'text-orange-400', css: 'text-blue-400', js: 'text-yellow-400',
  ts: 'text-cyan-400', tsx: 'text-cyan-400', jsx: 'text-yellow-400',
  json: 'text-green-400', md: 'text-purple-400', py: 'text-emerald-400',
  svg: 'text-pink-400', png: 'text-pink-400', jpg: 'text-pink-400',
};

// Last `resume` nonce actually applied — at MODULE scope on purpose, so it SURVIVES the panel
// unmounting/remounting. A component useRef resets to 0 on every remount, which is exactly what let a
// stale (never-cleared) `resume` prop re-apply an old chat on each reopen. See the resume effect below.
let lastAppliedResumeNonce = 0;

export function AgentV3Panel({ userId, email, resume, freshOpenNonce, onFilesSync, onBeforeBuild, onOpenInIDE, onPreviewState, pendingFix, pendingDeploy, filesPanel, focusMode, mobileFooter, onFooterApi }: { userId?: string; email?: string; resume?: { sessionId: string; messages: ChatMsg[]; nonce: number } | null; freshOpenNonce?: number; onFilesSync?: (files: Record<string, string>) => void; onBeforeBuild?: () => Promise<void>; onOpenInIDE?: (path: string) => void; onPreviewState?: (s: { previewUrl?: string; workspaceId?: string; framework?: string; running?: boolean }) => void; pendingFix?: { text: string; nonce: number; autoSend?: boolean } | null; pendingDeploy?: { provider: string; nonce: number } | null; filesPanel?: FilesPanelProps; focusMode?: boolean; mobileFooter?: boolean; onFooterApi?: (api: V3FooterApi | null) => void }) {
  const { state, running, error, start, respond, restore, getCheckpoints, getGitStatus, restoreAllFiles, stop, unsend, reset, serverBuildRunning, resume: resumeBuild, shipToMain, revertLastMerge, queueNext, queueComplete, queueEnqueue, queueList, queueCancel, checkRunning, loadConversation, conversationLoadDiag, listConversations, deleteConversation, pinConversation, subscribeLive, billingBlock, clearBillingBlock } = useAgentV3Build();
  // B7 — hydrate the composer from any unsent draft persisted before a reload (see composerDraft.ts).
  const [prompt, setPrompt] = useState(() => loadDraft());
  // "Ship to main" / "Revert" (own-repo storage, slice 2): in-flight + last honest note for the bar.
  const [shipping, setShipping] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [shipNote, setShipNote] = useState<string | null>(null);
  // UNSEND (Slice 2) — true while a take-back purge is in flight (disables the button, prevents double-fire).
  const [unsending, setUnsending] = useState(false);
  // AP-3 (cross-restart resume) — a reopened build whose durable status is still 'running' with no live
  // build was cut off before it could finish (a server restart/crash mid-build). We honestly offer a
  // one-click Continue instead of silently resetting. Set on reopen; cleared once a build starts or the
  // user dismisses/continues.
  const [interruptedResume, setInterruptedResume] = useState(false);
  // ASK-USER (opt-in): dismiss state for the non-blocking clarify card. Reset whenever a NEW clarify
  // arrives so a fresh build's questions always show; the build itself never waits on this.
  const [clarifyDismissed, setClarifyDismissed] = useState(false);
  useEffect(() => { if (state.pendingClarify) setClarifyDismissed(false); }, [state.pendingClarify]);
  // Save-as-template: the user's own reusable starters (on-device), shown beside the built-in ones.
  const [savedTpls, setSavedTpls] = useState<SavedTemplate[]>(() => loadSavedTemplates());
  const handleSaveTemplate = (text: string) => setSavedTpls(saveTemplate('', text));
  const handleRemoveTemplate = (id: string) => setSavedTpls(removeSavedTemplate(id));
  // Paid-public (billing PR 5): whether THIS user is on paid billing (server-reported: paid-public flag
  // ON and not on the free-list) and, if so, their live wallet balance in ₹. Both stay off/null for
  // admin/free-list users and while the flag is off — so no money UI shows until billing actually applies.
  const [billed, setBilled] = useState(false);
  const [walletBalanceInr, setWalletBalanceInr] = useState<number | null>(null);
  // Billing Phase 2 — token-first display: tokens are the wallet's primary unit (₹ is secondary).
  const [walletTokens, setWalletTokens] = useState<number | null>(null);
  // ── 3-role model UI (FIX #6): composer mode + the per-app command queue ─────────────────────────
  // 'build' = the normal builder (Chat 1). 'planner'/'advisor' = the read-only role lanes (FIX #5)
  // that analyze the project and PROPOSE steps; the user approves them into the queue below.
  const [chatMode, setChatMode] = useState<'build' | 'planner' | 'advisor'>('build');
  // Mode dropup open/closed (admin 2026-07-07: the Build/Plan/Advise switcher moved back to the
  // composer as a dropdown selector — position only, identical function).
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  // Plan/Advise (read-only lanes) run on their OWN request, fully DECOUPLED from the build stream, so
  // they can be sent ANYTIME — even WHILE a build is running (the whole point of the model) — and can
  // never clobber the live build's state. `roleBusy` is their own in-flight flag (independent of the
  // build's `running`); role replies append to the shared thread (agentHistory). Admin fix 2026-07-06.
  const [roleBusy, setRoleBusy] = useState(false);
  const roleAbortRef = useRef<AbortController | null>(null);
  const [roleProposedSteps, setRoleProposedSteps] = useState<{ role: 'planner' | 'advisor'; steps: string[] } | null>(null);
  // Roadmap chip (admin 2026-07-21): the proposed plan/fixes render as a tiny pill above the composer
  // (never a block over the chat). Open = the expandable sheet; dismissedKey hides a specific proposal
  // (keyed by its steps) until a NEW one arrives.
  const [roadmapOpen, setRoadmapOpen] = useState(false);
  const [roadmapDismissedKey, setRoadmapDismissedKey] = useState<string | null>(null);
  // 3 SEPARATE PAGES (admin 2026-07-06): Build / Plan / Advise are 3 tabs, ONE shared session + project
  // memory but their OWN visible thread. The Build tab is the existing thread (userMsgs + agentHistory +
  // live state.narration); Plan/Advise each keep their own messages here so switching tabs shows a
  // distinct chat page while the build keeps running underneath.
  const [roleThreads, setRoleThreads] = useState<{ planner: ChatMsg[]; advisor: ChatMsg[] }>({ planner: [], advisor: [] });
  const [queueItems, setQueueItems] = useState<QueueItemView[]>([]);
  const [queueOpen, setQueueOpen] = useState(false);
  // Proposed steps already added this turn (disable their buttons — enqueue is idempotent-by-user).
  const [addedSteps, setAddedSteps] = useState<Set<string>>(new Set());
  const ghToken = () => { try { return localStorage.getItem('gh_token') || undefined; } catch { return undefined; } };
  // "made by NavBharatAI" signature preference (Settings → General, admin 2026-07-16). Default ON;
  // only 'off' turns the badge off. Read at send time so a toggle change applies to the next build.
  const appSignaturePref = () => { try { return localStorage.getItem('navbharat_app_signature') !== 'off'; } catch { return true; } };
  const doShipToMain = useCallback(async () => {
    if (!state.ownRepo || shipping) return;
    setShipping(true);
    setShipNote(null);
    try {
      const r = await shipToMain({ repo: state.ownRepo.repo, userId, email, githubToken: ghToken() });
      setShipNote(r.note);
    } finally {
      setShipping(false);
    }
  }, [state.ownRepo, shipping, shipToMain, userId, email]);
  const doRevertLastMerge = useCallback(async () => {
    if (!state.ownRepo || reverting) return;
    if (!window.confirm(`Revert the last change on ‘${state.ownRepo.baseBranch}’? This restores it to the previous state as a new commit (undoable).`)) return;
    setReverting(true);
    setShipNote(null);
    try {
      const r = await revertLastMerge({ repo: state.ownRepo.repo, userId, email, githubToken: ghToken() });
      setShipNote(r.note);
    } finally {
      setReverting(false);
    }
  }, [state.ownRepo, reverting, revertLastMerge, userId, email]);
  // Power level (admin tier→model redefinition 2026-07-13): weak (free tier, GLM/Kimi — never Claude) /
  // off="Normal" (Sonnet, adaptive) / mini="Strong" (Sonnet 100%) / medium="Powerful" (Opus medium
  // effort) / max="Full Team" (Opus max — ultracode). A FREE user
  // (server `powerUnlocked:false`) may pick ONLY 'weak'; a paid/free-list user gets all five, default Normal.
  // The server clamps free→weak regardless, so this is purely presentation.
  const [powerUnlocked, setPowerUnlocked] = useState<boolean>(false); // false until /status confirms paid
  const [powerLevel, setPowerLevel] = useState<'weak' | 'off' | 'mini' | 'medium' | 'max'>('off');
  // Once we know the account tier, snap the default: paid → Normal (off), free → weak (their only option).
  // Never fights a running build. Also clamps a stale paid-tier selection back to weak for a free user.
  useEffect(() => {
    setPowerLevel((cur) => (powerUnlocked ? cur : 'weak'));
  }, [powerUnlocked]);
  // Persist the selected tier so OTHER surfaces (e.g. the APK builder's build-repair) can route the AI
  // to the SAME models the user picked here — weak stays on the cheap coders, paid tiers get Sonnet/Opus.
  useEffect(() => {
    try { localStorage.setItem('nbai_power_level', powerLevel); } catch { /* storage unavailable — the reader falls back to the weak-safe default */ }
  }, [powerLevel]);
  // Derived for the existing boolean call sites (start/telemetry) — any Opus power level.
  const onlyOpus = powerLevel === 'mini' || powerLevel === 'medium' || powerLevel === 'max';
  const [planFirst, setPlanFirst] = useState(false); // chat-first: no forced plan gate by default
  const [thinking, setThinking] = useState(false); // adaptive thinking, off by default
  const [tab, setTab] = useState<SurfaceTab>('preview');
  // Workspace is collapsed by default so the chat takes the full width; opening a
  // header tab pill surfaces it. On mobile an open workspace takes over the area.
  const [showWorkspace, setShowWorkspace] = useState(false);
  // PREVIEW PERSISTENCE (admin 2026-07-07): once the Preview tab has been opened once, its
  // PreviewSurface (and the iframe inside) stays mounted for the whole session — hidden via CSS on
  // other tabs — so switching tabs / going back to chat never destroys the rendered preview. The
  // first mount stays lazy so a session that never opens Preview never pays its compile/boot cost.
  const [previewEverOpened, setPreviewEverOpened] = useState(false);
  useEffect(() => {
    if (previewVisible(showWorkspace, tab)) setPreviewEverOpened(true);
  }, [showWorkspace, tab]);
  // PREVIEW PRE-WARM (admin 2026-07-18): mount + compile the in-browser preview OFF-SCREEN as soon as a
  // build finishes (or a conversation with files loads), so opening Preview is instant instead of the
  // multi-minute cold compile the user hit before (the in-iframe whole-app Babel transpile is the real
  // cost; doing it in the background makes the click feel immediate). Sticky: once pre-warmed it stays
  // mounted (keep-alive), and the existing reloadSignal keeps it live-synced with later file changes.
  const [previewPrewarm, setPreviewPrewarm] = useState(false);
  useEffect(() => {
    if (shouldPrewarmPreview(running, serverBuildRunning, Object.keys(state.files || {}).length > 0)) {
      setPreviewPrewarm(true);
    }
  }, [running, serverBuildRunning, state.files]);
  // Local-only UI flag for the input-row settings popover (Planning/Thinking/Power). Declared BEFORE the
  // billing-status effect so opening the popover can trigger a fresh powerUnlocked check (admin scenario
  // 2026-07-12: "maine recharge kar liya fir bhi tiers locked" — the user recharges on the Wallet page and
  // comes back; without this refetch the tiers stayed 🔒 until a full page reload).
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Paid-public (billing PR 5): learn whether this user is on paid billing and, if so, their wallet
  // balance — so the header can show a live ₹ chip and the composer can warn before a build is refused.
  // Refetches when the user changes, after a build finishes (balance was just spent), after a 402, and
  // whenever the settings popover opens (fresh powerUnlocked right where the tiers are shown).
  useEffect(() => {
    if (!userId) { setBilled(false); setPowerUnlocked(false); setWalletBalanceInr(null); setWalletTokens(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const headers = await authJsonHeaders();
        const qs = `?userId=${encodeURIComponent(userId)}${email ? `&email=${encodeURIComponent(email)}` : ''}`;
        const sres = await fetch(`/api/agentv3/status${qs}`, { headers });
        const sj = await sres.json().catch(() => ({} as Record<string, unknown>));
        const isBilled = sres.ok && (sj as { billed?: unknown }).billed === true;
        if (cancelled) return;
        setBilled(isBilled);
        // Power-tier gating: show the paid tiers only when the server says this account is unlocked
        // (free-list admin/tester OR has ever purchased). Free users get 'weak' only.
        setPowerUnlocked(sres.ok && (sj as { powerUnlocked?: unknown }).powerUnlocked === true);
        if (!isBilled) { setWalletBalanceInr(null); setWalletTokens(null); return; }
        const wres = await fetch(`/api/wallet/${encodeURIComponent(userId)}${email ? `?email=${encodeURIComponent(email)}` : ''}`, { headers });
        const wj = await wres.json().catch(() => ({} as Record<string, unknown>));
        const bal = (wj as { remaining_balance?: unknown }).remaining_balance;
        const tok = (wj as { tokenBalance?: unknown }).tokenBalance;
        if (!cancelled) {
          setWalletBalanceInr(typeof bal === 'number' && Number.isFinite(bal) ? bal : null);
          setWalletTokens(typeof tok === 'number' && Number.isFinite(tok) ? tok : null);
        }
      } catch { if (!cancelled) { setBilled(false); setWalletBalanceInr(null); setWalletTokens(null); } }
    })();
    return () => { cancelled = true; };
  }, [userId, email, state.done, billingBlock, settingsOpen]);
  // Mode (Build / Plan / Advise) is the 3-tab switcher at the top of the chat — admin 2026-07-06.
  // Files the user attached for the next message (images, PDFs, Word/Excel/PPT,
  // ZIP, text/code). Read and analyzed by v5.0 — converted to base64 on send.
  const [files, setFiles] = useState<File[]>([]);
  // Composer: auto-growing textarea + expand/minimize + device-aware Enter behaviour.
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [composerExpanded, setComposerExpanded] = useState(false);
  // Shared composer toolbar state (admin 2026-08-10). The Enter preference is the ONE key every AI
  // reads — set it here and Doctor AI, the professionals and the free chat all follow.
  const [sendOnEnter, setSendOnEnter] = useState<boolean>(() => readSendOnEnter((k) => localStorage.getItem(k)));
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [showChatSearch, setShowChatSearch] = useState(false);
  // INLINE voice dictation (admin 2026-07-22): the mic types speech straight into the composer on this
  // page — no separate Voice-to-App page. Same Web Speech engine the standalone tool uses.
  const [listening, setListening] = useState(false);
  // Web Speech API types aren't in this project's TS lib — use `any`, as the standalone Voice tool does.
  const voiceRef = useRef<any>(null);
  const voiceBaseRef = useRef(''); // composer text captured when dictation started (interim appends after it)
  const voiceFinalRef = useRef(''); // finalized transcript accumulated this dictation session
  const speechSupported = speechRecognitionSupported();
  // INLINE "Screenshot → App": pick a screenshot from the gallery → build from it, right here (admin
  // 2026-07-22). A hidden gallery input drives BOTH entry points (the glowing template button AND the
  // Attach-menu option) — 2 entries, one system.
  const screenshotInputRef = useRef<HTMLInputElement | null>(null);
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  // Project-import (.zip) progress — a large archive takes real time, so the user always sees where it is.
  const [zipImporting, setZipImporting] = useState(false);
  const [zipProgress, setZipProgress] = useState('');
  // Rises once per import to ask the Preview to install-and-run the project it just received. A nonce
  // rather than a boolean because a SECOND import into the same workspace must boot again, and
  // PreviewSurface's own auto-resume is deliberately gated to once per workspace.
  const [previewBootSignal, setPreviewBootSignal] = useState(0);
  // Stop any live dictation when the panel unmounts (never leave the mic hot).
  useEffect(() => () => { try { voiceRef.current?.stop(); } catch { /* already stopped */ } }, []);
  // Fix 60 — Team HQ elapsed clock (Full Team tier): anchored when a build STARTS; ticks every
  // second while the premium card is visible. FREEZE-ON-STOP (admin 2026-07-21 — "time reset ho
  // jata hai, error ane par nahi hona chahiye"): the old effect zeroed the clock the moment
  // `running` flipped false, so an error event wiped the elapsed time on screen. Now the clock
  // only re-anchors on the false→true transition (a genuinely new build); an error/completion
  // freezes the last real value instead of erasing it.
  const buildStartRef = useRef<number>(0);
  const prevRunningRef = useRef(false);
  const [teamElapsedMs, setTeamElapsedMs] = useState(0);
  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    prevRunningRef.current = running;
    if (!running) return; // freeze — never zero a real elapsed time on stop/error
    if (!wasRunning || buildStartRef.current === 0) {
      buildStartRef.current = Date.now();
      setTeamElapsedMs(0);
    }
    if (powerLevel !== 'max') return;
    const t = setInterval(() => setTeamElapsedMs(Date.now() - buildStartRef.current), 1000);
    return () => clearInterval(t);
  }, [running, powerLevel]);
  // Touch-primary devices (phones) → Enter inserts a newline; only the Send button sends. A laptop
  // (fine pointer / physical keyboard) → Enter sends. Reactive to device/orientation changes.
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(pointer: coarse)');
    const update = () => setIsTouchDevice(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);
  // Auto-grow the composer to fit its content, capped at ~5 lines (then it scrolls internally). When
  // expanded, a CSS class drives the height instead, so we clear the inline height.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    if (composerExpanded) { el.style.height = ''; return; }
    el.style.height = 'auto';
    // Admin 2026-07-12 (82→44) + 2026-07-13 ("aur vertically chota") + 2026-07-18 (Android ~50% shorter)
    // + 2026-07-21 ("resting 1x, not 4x"): rest at EXACTLY one line. + 2026-07-21 ("type/enter karne par
    // vertical size increase hona chahiye"): but then GROW with the content — the old ~2-line cap made it
    // barely move, so multi-line typing felt like it wasn't growing at all. It now grows up to ~6 lines and
    // only then scrolls internally (very long prompts still use the Expand button → h-[50vh]). Measured from
    // the element's REAL computed line-height + padding, so it's a true single line on mobile too (the CSS
    // forces font-size:16px there, which the old hardcoded 20px line-height math didn't account for).
    const cs = getComputedStyle(el);
    const lineH = parseFloat(cs.lineHeight) || 20;
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    // clampComposerHeight (pure, unit-tested): rest at 1 line, grow up to ~6 lines, then scroll.
    el.style.height = `${clampComposerHeight(el.scrollHeight, lineH, padY)}px`;
  }, [prompt, composerExpanded]);
  // Composer action buttons (expand / send / stop) vertical placement. RESTING/GROWN composer: vertically
  // CENTERED — equidistant from the top and bottom border (admin 2026-07-21: "buttons ka center of mass
  // upper aur lower border se equal distance par ho"), instead of pinned to the lower edge. EXPANDED
  // editor (h-[50vh]): pinned near the bottom, since centering a button in a half-screen box reads wrong.
  const composerBtnY = composerExpanded ? 'bottom-2' : 'top-1/2 -translate-y-1/2';
  // Framework selector + import
  const [framework, setFramework] = useState('vite-react');
  // True once the user DELIBERATELY chose a framework (picker) or a reopened session carries one — that
  // choice then always wins over chat-text detection on the server (admin bidirectional-selection law
  // 2026-07-20). Stays false for a brand-new default session, so chat can still auto-select the framework.
  const [frameworkExplicit, setFrameworkExplicit] = useState(false);
  // The user picked a framework in the picker → mark it explicit so the server honours it over chat text.
  const pickFramework = useCallback((id: string) => { setFramework(id); setFrameworkExplicit(true); }, []);
  // A pending framework conflict (admin 2026-07-20): the user PICKED framework A but their message NAMES a
  // different framework B — confirm which one BEFORE building, never silently build the wrong stack.
  // `launch(fw)` re-runs the held build with the chosen framework (resolved, so it won't re-prompt).
  const [fwConflict, setFwConflict] = useState<{ picked: string; detected: string; launch: (fw: string) => void } | null>(null);
  const fwName = useCallback((id: string) => FRAMEWORKS.find((f) => f.id === id)?.name ?? id, []);
  const [importUrl, setImportUrl] = useState('');
  const [showFrameworkPicker, setShowFrameworkPicker] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  // ── GitHub repo picker (1-click import, admin plan 2026-07-04) ────────────────────────────
  // ghRepos: null = not loaded yet; [] = loaded but the account has no repos.
  const [ghRepos, setGhRepos] = useState<Array<{ fullName: string; url: string; isPrivate: boolean; updatedAt: number; description: string }> | null>(null);
  const [ghReposLoading, setGhReposLoading] = useState(false);
  // 'auth' = not connected / token expired (show Connect); anything else = a real fetch error.
  const [ghReposError, setGhReposError] = useState<string>('');
  // Immediate feedback for the "Connect GitHub" tap: the async connect (fetch → redirect) gave NO
  // visual response on mobile (no active/hover on touch), so users tapped it 5-6× (admin 2026-07-22).
  const [ghConnecting, setGhConnecting] = useState(false);
  // Paste-a-token fallback (admin 2026-07-22): the OAuth redirect can't return the token to the bundled
  // native app, so a user who "connected" still had no token → their PRIVATE repo failed to clone. A
  // pasted GitHub token (repo scope) is stored the same way and works on EVERY platform.
  const [showTokenPaste, setShowTokenPaste] = useState(false);
  const [pastedToken, setPastedToken] = useState('');
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenError, setTokenError] = useState('');
  const [repoSearch, setRepoSearch] = useState('');
  const [importSending, setImportSending] = useState(false);
  // ── Push mode (admin 2026-07-20): the SAME repo picker can PUSH the current app to a repo, so
  // connect + import + push all live in one place. 'import' clones a repo in; 'push' publishes out.
  const [modalMode, setModalMode] = useState<'import' | 'push'>('import');
  const [pushBusy, setPushBusy] = useState(false);
  const [pushResult, setPushResult] = useState<{ ok: boolean; text: string; url?: string } | null>(null);
  const [pushCommitMsg, setPushCommitMsg] = useState('');

  const loadGhRepos = useCallback(async () => {
    const token = (() => { try { return localStorage.getItem('gh_token'); } catch { return null; } })();
    if (!token) { setGhRepos(null); setGhReposError('auth'); return; }
    setGhReposLoading(true);
    setGhReposError('');
    try {
      const res = await fetch('/api/github/repos', { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401 || res.status === 403) { setGhRepos(null); setGhReposError('auth'); return; }
      if (!res.ok) throw new Error(`GitHub returned ${res.status} — try again in a moment.`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Unexpected response while listing your repositories.');
      setGhRepos(
        data
          .map((r: { full_name?: unknown; html_url?: unknown; private?: unknown; updated_at?: unknown; description?: unknown }) => ({
            fullName: typeof r.full_name === 'string' ? r.full_name : '',
            url: typeof r.html_url === 'string' ? r.html_url : '',
            isPrivate: r.private === true,
            updatedAt: typeof r.updated_at === 'string' ? (Date.parse(r.updated_at) || 0) : 0,
            description: typeof r.description === 'string' ? r.description : '',
          }))
          .filter((r) => r.fullName && r.url),
      );
    } catch (e) {
      setGhRepos(null);
      setGhReposError(e instanceof Error ? e.message : 'Could not load your repositories.');
    } finally {
      setGhReposLoading(false);
    }
  }, []);
  // Load the list the moment the modal opens (state 3: already connected → zero extra clicks).
  useEffect(() => {
    if (showImportModal) { setRepoSearch(''); setPushResult(null); setPushCommitMsg(''); void loadGhRepos(); }
  }, [showImportModal, loadGhRepos]);

  // Full-page OAuth redirect — the SAME proven flow the app-level GitHub connect uses (the
  // callback returns to this exact URL with #gh_token, which App.tsx stores in localStorage).
  // A redirect can't be killed by mobile popup blockers, unlike window.open.
  const connectGitHub = useCallback(async () => {
    if (ghConnecting) return; // guard against the 5-6 rapid taps — one connect at a time
    setGhConnecting(true);
    setGhReposError('');
    try {
      const state = window.location.href.split('#')[0];
      const redirectUri = 'https://navbharatai.com/api/github/callback';
      const reqUrl = new URL(`${window.location.origin}/api/auth/github/url`);
      reqUrl.searchParams.set('redirect_uri', redirectUri);
      reqUrl.searchParams.set('state', state);
      const response = await fetch(reqUrl.toString());
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data?.url !== 'string' || !data.url) throw new Error('Could not start GitHub sign-in — try again.');
      const githubUrl = new URL(data.url);
      if (data.clientId) githubUrl.searchParams.set('client_id', String(data.clientId));
      githubUrl.searchParams.set('redirect_uri', redirectUri);
      if (data.scope) githubUrl.searchParams.set('scope', String(data.scope));
      if (data.state) githubUrl.searchParams.set('state', String(data.state));
      window.location.href = githubUrl.toString();
      // NOTE: on success the line above navigates away, so `ghConnecting` intentionally stays true
      // (the button keeps showing "Connecting…") until the page leaves — never flickers back to idle.
    } catch (e) {
      setGhReposError(e instanceof Error ? e.message : 'Could not start GitHub sign-in.');
      setGhConnecting(false); // real failure → let the user tap again
    }
  }, [ghConnecting]);

  // "Wrong account?" — drop the current GitHub connection so the user can connect a DIFFERENT one
  // (without logging out of NavBharatAI). Clears the same keys App.tsx binds to the user, then
  // returns the picker to its Connect state.
  const disconnectGh = useCallback(() => {
    try {
      localStorage.removeItem('gh_token');
      localStorage.removeItem('gh_token_signal');
      localStorage.removeItem('gh_owner_uid');
    } catch { /* storage unavailable */ }
    setGhRepos(null);
    setGhReposError('auth');
  }, []);

  // Verify a pasted GitHub token against the real GitHub API, then store it exactly like the OAuth
  // token so the build request (which reads localStorage.gh_token) and the repo list both use it. This
  // is the reliable path when the OAuth redirect can't complete (e.g. inside the native app).
  const submitPastedToken = useCallback(async () => {
    const tok = pastedToken.trim();
    if (!tok || tokenBusy) return;
    setTokenBusy(true);
    setTokenError('');
    try {
      const res = await fetch('/api/github/user', { headers: { Authorization: `Bearer ${tok}` } });
      if (!res.ok) {
        throw new Error(res.status === 401
          ? 'GitHub rejected that token. Make sure it has the "repo" scope and hasn\'t expired.'
          : `GitHub returned ${res.status} — please try again.`);
      }
      try {
        localStorage.setItem('gh_token', tok);
        localStorage.setItem('gh_token_signal', tok); // notify other tabs, same as the OAuth flow
      } catch { /* storage unavailable */ }
      setPastedToken('');
      setShowTokenPaste(false);
      setGhReposError('');
      void loadGhRepos();
    } catch (e) {
      setTokenError(e instanceof Error ? e.message : 'Could not verify that token.');
    } finally {
      setTokenBusy(false);
    }
  }, [pastedToken, tokenBusy, loadGhRepos]);

  // 1-CLICK IMPORT: picking a repo sends the import message itself — the user just watches the
  // clone → Files/IDE → preview → AI survey happen (the #886/#890 Landing Pipeline server-side).
  // Deliberately a PLAIN function (not useCallback): it must close over the CURRENT render's
  // send() — a memoized version would freeze the first render's userId/email/session bindings.
  const importRepo = (repoUrl: string) => {
    if (running || importSending) return;
    setImportSending(true);
    setShowImportModal(false);
    void send({
      text: 'Import this app from my GitHub repository and give me a short survey of what it is and how it is structured. Do not change any files yet.',
      importUrl: repoUrl,
    }).finally(() => setImportSending(false));
  };

  // REAL push: publish the CURRENT app's files to the chosen GitHub repo via the safe (non-force)
  // push route. Reuses the repo picker — the user just clicks the repo to push to. Deliberately a
  // plain function (closes over the current render's workspaceFiles/loader/token), like importRepo.
  const pushToRepo = async (fullName: string) => {
    if (pushBusy || running || importSending) return;
    const token = ghToken();
    if (!token) { setPushResult({ ok: false, text: 'Connect GitHub first, then push.' }); setGhReposError('auth'); return; }
    const slash = fullName.indexOf('/');
    if (slash <= 0) { setPushResult({ ok: false, text: 'Pick a repository in the form owner/name.' }); return; }
    const owner = fullName.slice(0, slash).trim();
    const repo = fullName.slice(slash + 1).trim();

    setPushBusy(true);
    setPushResult({ ok: true, text: `Pushing to ${fullName}…` });
    try {
      // Use the loaded workspace file CONTENTS; fetch them if the panel hasn't cached them yet.
      let files = workspaceFiles;
      if (!files || Object.keys(files).length === 0) files = await loadWorkspaceFiles();
      if (!files || Object.keys(files).length === 0) {
        setPushResult({ ok: false, text: 'No app files to push yet — build or open an app first.' });
        return;
      }
      const res = await fetch('/api/github/push-enhanced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          owner, repo, files,
          visibility: 'private',
          branch: 'main',
          message: pushCommitMsg.trim() || 'Update from NavBharatAI Pro v5.0',
        }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (res.status === 401 || res.status === 403) { setPushResult({ ok: false, text: 'GitHub authorization expired — reconnect and try again.' }); setGhReposError('auth'); return; }
      if (res.status === 409 || data?.nonFastForward) { setPushResult({ ok: false, text: 'This repo has newer commits than your app. Import it first, then push — this protects your work.' }); return; }
      if (!res.ok || !data?.success) { setPushResult({ ok: false, text: typeof data?.error === 'string' ? data.error : 'Push failed — please try again.' }); return; }
      setPushResult({ ok: true, text: `Pushed to ${fullName} ✓`, url: typeof data.repoUrl === 'string' ? data.repoUrl : `https://github.com/${owner}/${repo}` });
    } catch {
      setPushResult({ ok: false, text: 'Push failed — check your connection and try again.' });
    } finally {
      setPushBusy(false);
    }
  };
  const [userMsgs, setUserMsgs] = useState<ChatMsg[]>([]);
  // Finalized agent replies from PREVIOUS turns. The live build state
  // (state.narration) is reset by start() on every new message, so without
  // persisting prior replies here they would vanish from the thread when the
  // next message begins. Snapshotted in send() right before start() runs.
  const [agentHistory, setAgentHistory] = useState<ChatMsg[]>([]);
  // Git checkpoints from PREVIOUS turns. Like state.narration, state.checkpoints
  // is reset by start() on every message, so the History tab would forget prior
  // checkpoints across an iterative session. Snapshotted in send() before start().
  const [checkpointHistory, setCheckpointHistory] = useState<GitCheckpoint[]>([]);
  // Phase G1 — honest restore feedback: a restore can fail if the SHA isn't in the CURRENT sandbox
  // (e.g. it recycled since that checkpoint, or we're in a fresh session). We tell the user the truth
  // instead of a silent no-op or a fake "restored".
  const [restoreNote, setRestoreNote] = useState<string>('');
  // Phase G2 — live working-tree git status (wired into the sync body). null until first load.
  const [gitStatus, setGitStatus] = useState<import('../../hooks/useAgentV3Build').GitStatus | null>(null);
  const handleRestoreCheckpoint = async (sha: string) => {
    setRestoreNote('Restoring…');
    // The SERVER decides the wording: it is the only side that knows whether the history is gone, the
    // workspace is cold, or git simply refused. This used to print one guess for all of them — and the
    // guess ("continue a build to make its history live again") was wrong for the most common case,
    // which was the request landing on a different Cloud Run instance.
    const { ok, message } = await restore(sha);
    setRestoreNote(`${ok ? '✅' : '⚠️'} ${message}`);
  };
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // A stable session id keeps the SAME sandbox + memory + workspace across messages,
  // so the build is iterative (each message continues the same project). "New session"
  // starts a fresh project.
  //
  // CRITICAL — the session id is PERSISTED in localStorage (per account), so a page
  // RELOAD or a tab switch reuses the SAME id → the same workspaceId
  // (agentv3-{uid}-{sessionId}) → the same memory and files. Without this, a reload
  // minted a fresh id, pointing the next message at an EMPTY new workspace — the
  // user's app/memory looked "lost". Reload now genuinely continues the project.
  const newSessionId = () =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const sessionStorageKey = v3SessionStorageKey(userId); // shared with App's ✕-close (single source of truth)
  // Persist the session id so a RELOAD continues the same project. localStorage can throw in some
  // Incognito/Private modes — fall back to sessionStorage so continuity holds within the tab session
  // instead of minting a fresh (empty) workspace on every reload.
  const persistSessionId = (id: string) => {
    try { localStorage.setItem(sessionStorageKey, id); return; } catch { /* try sessionStorage next */ }
    try { sessionStorage.setItem(sessionStorageKey, id); } catch { /* both storages unavailable */ }
  };
  const sessionIdRef = useRef<string>('');
  if (!sessionIdRef.current) {
    // ADMIN RULE (2026-07-05 — REPLACES the retired 2026-07-01 always-fresh rule): the v5.0 chat is
    // STICKY. A reload, a tab switch, the phone being switched off — none of them change the chat;
    // reopening v5.0 restores the SAME session where the user left it. The chat changes only via
    // ☰ "+New chat", ☰ opening another chat, or the header tab ✕ (which CLEARS the sticky id — see
    // App.closeTab → clearStickySession). The 07-01 rule existed for a once-stuck chat that could not
    // be cleared; that bug class is fixed and the admin retired the rule ("is rule ki need nahi hai").
    // ANON-KEY HEAL (Fix 26): a panel that mounted BEFORE auth resolved stored its sticky id under
    // the anon key; a later mount with the real uid must still find that session (same device, same
    // human) instead of minting a fresh empty one — the split-key half of the "sab gayab" wipe.
    sessionIdRef.current = readStickySession(userId) || readStickySession(undefined) || newSessionId();
    persistSessionId(sessionIdRef.current);
  }
  // The workspaceId THIS session expects — passed to checkRunning/resume/subscribeLive so the server
  // only auto-attaches/mirrors a build that actually belongs to THIS session, never one still running
  // under a DIFFERENT v5.0 chat on the same account (root-caused 2026-07-01: "+ New chat" — and, more
  // generally, opening any v5.0 session — could show an unrelated session's in-progress build).
  // ANON PARITY (Fix 26, report 2026-07-07): mirrors the server's deriveWorkspaceId INCLUDING the
  // anon identity — a signed-out/auth-degraded session builds under `agentv3-anon-<sid>`, and every
  // continuity feature must compute that same id instead of silently going dead (`undefined`).
  const expectedWorkspaceId = (): string | undefined =>
    state.workspaceId || clientWorkspaceId(userId, sessionIdRef.current) || undefined;

  // The chat thread merges the user's own messages with the engine's live
  // narration (which streams in word-by-word and finalizes in place), ordered by
  // timestamp. Reading narration straight from state means streaming updates show
  // live instead of being frozen into a one-time snapshot.
  // The BUILD tab's thread (its own messages + live build narration). Build keeps running underneath
  // regardless of which tab is showing.
  const buildConvo: ChatMsg[] = [
    ...agentHistory,
    ...userMsgs,
    ...state.narration.map((n) => ({
      role: 'agent' as const,
      agent: n.agent,
      text: n.text,
      ts: n.ts,
      kind: n.kind,
      streaming: n.streaming,
    })),
  ]
    // "⏱️ Still building… N min in" is a TRANSIENT live-progress line (server ETA heartbeat), not chat
    // history. Show it only while a build is running; once done, drop it so a finished session's thread
    // isn't left cluttered with stale "Still building…" bubbles that make a completed build look
    // permanently stuck. Filtering by the text marker (not just the live id) also cleans OLD sessions
    // that persisted these lines before the fix, and keeps them out of the History save (which reads
    // `convo` after `running` has cleared on the terminal result).
    .filter((m) => running || !/^⏱️\s*Still building…/.test(m.text || ''))
    .sort((a, b) => a.ts - b.ts);

  // The thread the ACTIVE tab renders — Build's, or the Plan/Advise lane's own page. History-save and
  // build activity/diffs are BUILD-only, so the role tabs render a clean read-only conversation.
  const convo: ChatMsg[] = chatMode === 'build'
    ? buildConvo
    : [...roleThreads[chatMode]].sort((a, b) => a.ts - b.ts);

  // Proposed steps to approve into the queue — from a Plan/Advise role turn (roleProposedSteps, the
  // decoupled lane) OR, for backward-compat, a build-stream turn (state.proposedSteps). The role one
  // wins when present. Shown even while a build runs (Plan/Advise are concurrent, read-only).
  const activeProposedSteps = roleProposedSteps ?? state.proposedSteps ?? null;

  // Claude-style chat timeline (admin redesign): prose bubbles interleaved with COLLAPSED action
  // rows — everything the engine did between two prose lines ("Created 33 files", "Ran `npm
  // install`", real +N/-M from the actual patches) in one glanceable, expandable row, instead of
  // the old flat spam of per-file ticks and ⏱ heartbeats. Pure grouping in activityTimeline.ts.
  // Build actions (activity/diffs) decorate ONLY the Build tab; the read-only Plan/Advise pages render a
  // clean conversation. Prior turns' archived activity (activityLog) is included so a finished build's
  // action rows + diff stats stay in the chat forever within the session (admin 2026-07-21 — no vanish).
  // SEARCH (shared composer toolbar, admin 2026-08-10) filters the messages the timeline is built
  // from, not `convo` itself — the empty-state below must keep answering "is this conversation
  // empty?", never "did the search match?", or a query with no hits would show the cold-start
  // template screen as if the user had never sent anything.
  const visibleConvo = filterMessages(convo, chatSearchQuery) as ChatMsg[];
  const chatBlocks = buildChatBlocks(
    visibleConvo,
    chatMode === 'build' ? [...state.activityLog, ...state.activity] : [],
    chatMode === 'build' ? state.diffs : {},
  );

  // All checkpoints across the session (prior turns + the live build), deduped by
  // sha so the History tab keeps showing earlier checkpoints across messages.
  const allCheckpoints: GitCheckpoint[] = (() => {
    const seen = new Set<string>();
    const out: GitCheckpoint[] = [];
    for (const c of [...checkpointHistory, ...state.checkpoints]) {
      const key = c.sha || c.id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    return out;
  })();

  // UNSEND (Slice 2) — the LAST user message can be taken back: stop any in-flight build AND purge it
  // from the server transcript + workspace memory, then drop it (and its reply) from the visible thread.
  // Only the newest user message is unsendable (its reply is always the live `narration`, never yet
  // flushed to agentHistory — so removing it can't strand an orphaned reply). Build lane only.
  const lastUserTs = chatMode === 'build'
    ? (() => { for (let i = convo.length - 1; i >= 0; i--) if (convo[i].role === 'user') return convo[i].ts; return null; })()
    : null;
  const handleUnsend = async (ts: number) => {
    if (unsending) return;
    setUnsending(true);
    try {
      // A message that reached the server (has a workspace) is purged server-side; a purely-local one
      // (no workspaceId yet — it never persisted) is just halted locally. Either way the reply lives in
      // `narration`, which unsend()/stop() clears.
      let purged = true;
      if (state.workspaceId) purged = await unsend();
      else stop();
      // On failure the message is NOT removed (it stays visible — honest, no fake "unsent"); the user
      // can simply try again. Never claim a purge that didn't happen.
      if (!purged) return;
      setUserMsgs((prev) => prev.filter((m) => m.ts < ts));
      setAgentHistory((prev) => prev.filter((m) => m.ts < ts));
    } finally {
      setUnsending(false);
    }
  };
  // EDIT (Slice 2) — take the message back (same full purge as Unsend) AND drop its text into the
  // composer so the user can re-write and send again. Only prefill on a genuine purge, so a failed
  // take-back can't leave the message both in the thread AND in the composer.
  const handleEdit = async (ts: number, text: string) => {
    if (unsending) return;
    setUnsending(true);
    try {
      let purged = true;
      if (state.workspaceId) purged = await unsend();
      else stop();
      if (!purged) return; // keep the message; never a fake "edited"
      setUserMsgs((prev) => prev.filter((m) => m.ts < ts));
      setAgentHistory((prev) => prev.filter((m) => m.ts < ts));
      setPrompt(text); // load the taken-back text back into the composer to re-write
      setTimeout(() => composerRef.current?.focus(), 0);
    } finally {
      setUnsending(false);
    }
  };

  // Auto-scroll the chat to the newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [convo.length, state.narration, running]);

  // Detect a build that is running server-side but is NOT attached here (its original
  // connection was lost) — so we can re-attach. Re-checks when the account loads and
  // whenever this UI goes idle.
  useEffect(() => {
    if (!running) checkRunning({ userId, email, workspaceId: expectedWorkspaceId() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, email, running, checkRunning]);

  // AUTO-RESUME on reload: when the server reports a build is still running but this
  // (freshly reloaded) UI isn't attached, re-attach automatically — the user should
  // never have to click "Resume" after a refresh. The button stays as a manual fallback.
  // Guarded so it fires once per detected running build.
  //
  // The re-arm condition below MUST also check `!running` — resumeBuild() itself clears
  // serverBuildRunning as its very first action (before the network call even resolves), so a
  // re-arm keyed on `!serverBuildRunning` alone flips autoResumedRef back to false the instant
  // resume() starts, defeating the "fires once" guard: any subsequent checkRunning() poll that
  // (re)detects the SAME still-running build (e.g. after a tab-visibility recheck) would fire a
  // brand-new resumeBuild() call moments later, silently re-attaching that old build's stream —
  // this was a real path for a just-abandoned build to reappear after "+ New chat".
  const autoResumedRef = useRef(false);
  // Layer 3 — how many times a paused (time-limit) build has been auto-continued this turn.
  // SPM-3: in project mode the decision lives in decideAutoContinue (progress-monotone on
  // planRemaining); these refs are its inputs. autoContinueRef counts deadline pauses (reset on
  // every real module progress), planContinuesRef counts plan-driven module rounds, and
  // lastPlanRemainingRef holds the previous plan result's remaining count for the strict-decrease
  // loop guard.
  const autoContinueRef = useRef(0);
  const planContinuesRef = useRef(0);
  const lastPlanRemainingRef = useRef<number | null>(null);
  // FleetOps 2026-07-20 — progress-driven wall-clock auto-continue: a big full-stack app needs several
  // 30-min windows. noProgressRef = consecutive pauses that added NO new files (a stuck build → stop
  // after PAUSE_CONTINUE_MAX); lastFilesWrittenRef = files at the previous pause, to detect real progress.
  const noProgressRef = useRef(0);
  const lastFilesWrittenRef = useRef<number | null>(null);
  useEffect(() => {
    if (serverBuildRunning && !running && !autoResumedRef.current) {
      autoResumedRef.current = true;
      void (async () => {
        const outcome = await resumeBuild({ userId, email, workspaceId: expectedWorkspaceId() });
        // "SAB CHALA GAYA" FIX (admin IMG_5822/5823, 2026-07-12): a build that FINISHED during the
        // stream drop comes back 'gone-notice' — resume() wiped the live state and left only a "that
        // build isn't running anymore" banner, so the chat showed just the prompt + banner and the
        // preview was blank, even though the whole build is durable server-side. Auto-run the SAME
        // durable restore the user gets by opening this chat from History — but PEEK the transcript
        // first and only restore when it genuinely has content, so we never blank the banner on a
        // transcript that hasn't finished saving yet.
        if (shouldRestoreFinishedBuild(outcome) && sessionIdRef.current) {
          const sid = sessionIdRef.current;
          const restored = await loadConversation({ userId, email, id: `v3_${sid}` }).catch(() => null);
          if (restored && restored.messages.length > 0 && sessionIdRef.current === sid) {
            await openConversation(`v3_${sid}`, { silent: true });
          }
        }
      })();
    }
    if (!serverBuildRunning && !running) autoResumedRef.current = false; // re-arm only once genuinely idle again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverBuildRunning, running, userId, email, resumeBuild]);

  // CONNECTION-DROP resilience: the build runs (and is buffered) server-side, so a lost CLIENT
  // connection must NEVER look like the app "stopped". Three real drop signals must each trigger an
  // immediate reconcile → re-attach of the still-running build (via the auto-resume effect above):
  //   • visibilitychange — a backgrounded tab / minimized app (mobile Safari/webview suspends timers
  //     and drops the stream); recover the instant it returns to the foreground.
  //   • ONLINE — a brief network cut (even 0.01s) while the tab stays VISIBLE never fires
  //     visibilitychange, so before this the ONLY recovery was start()'s bounded retry loop; once that
  //     gave up the user was stuck on a "network error" even though the network came back and the
  //     server build is alive. The `online` event fires exactly when connectivity is restored → reconcile.
  //   • FOCUS — window refocus (alt-tab / app switch on desktop) that doesn't flip document visibility.
  // Reconcile whenever we are NOT actively streaming OR an error is showing (a surfaced drop error must
  // be cleared by a successful re-attach — resume() calls setError(null)). checkRunning is a cheap,
  // idempotent GET; the auto-resume effect's own guards prevent any double-attach.
  const [liveNonce, setLiveNonce] = useState(0);
  useEffect(() => {
    const reconcile = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return; // still backgrounded
      if (!running || error) checkRunning({ userId, email, workspaceId: expectedWorkspaceId() });
      setLiveNonce((n) => n + 1); // re-arm the cross-device live poll
    };
    document.addEventListener('visibilitychange', reconcile);
    window.addEventListener('online', reconcile);
    window.addEventListener('focus', reconcile);
    return () => {
      document.removeEventListener('visibilitychange', reconcile);
      window.removeEventListener('online', reconcile);
      window.removeEventListener('focus', reconcile);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, error, userId, email, checkRunning]);

  // CROSS-DEVICE LIVE MIRROR (Slice B): while this panel is OPEN + VISIBLE and NOT running a build
  // locally, watch the shared LiveChannel so a build started on ANOTHER device shows its activity
  // here live. Cost-gated: only polls while visible, and the poller self-stops after ~30s of no
  // activity; re-armed by liveNonce on visibility. Stops the moment a local build starts (running).
  useEffect(() => {
    if (running || !userId) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const stop = subscribeLive({ userId, email, workspaceId: expectedWorkspaceId() });
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, userId, email, subscribeLive, liveNonce]);

  // D7 — on first open with a signed-in account, re-display the most recent persisted build's
  // chat history so a refresh/reconnect doesn't lose it (option (a): chat + git-restore). Runs
  // ONCE, and only when nothing is running and the panel is still empty, so it never clobbers a
  // live build or a thread already opened from History. Best-effort.
  // Keyed to the sessionId that has ALREADY been auto-restored. (Was a never-reset boolean, which let
  // an in-flight most-recent-conversation restore re-adopt the OLD chat AFTER "+ New chat" cleared the
  // thread — the verified S1 race.) Keying it to the session means: each session auto-restores at most
  // once, AND a deliberate session switch mid-load discards the stale result so New chat stays blank.
  const autoRestoredSessionRef = useRef<string>('');
  // Fresh-open discriminator (Bugs 1/3/4/5): App bumps freshOpenNonce ONLY when the user deliberately
  // opens v5.0 from the menu/sidebar → start a brand-new chat. A hard reload restores the v5.0 view
  // WITHOUT bumping the nonce (stays 0) → this effect takes the RESTORE branch instead, bringing the
  // same project's messages/files/preview back. Each distinct nonce is handled at most once.
  useEffect(() => {
    // ANON PARITY (Fix 26): no `!userId` gate — a signed-out/auth-degraded session restores exactly
    // like a signed-in one. The restore is a DIRECT lookup by the deterministic conversation id
    // (`v3_<sessionId>`, an unguessable UUID this device minted), which the server's anon bucket
    // serves without a verified identity — so this never exposes anyone else's data. Without this,
    // an anon session that lost its panel state (remount/tab close) had NO recovery path at all:
    // the admin's "tab switch → sab gayab" wipe (2026-07-07), where the durable data was intact
    // server-side but the client refused to restore it.
    if (running || state.narration.length > 0 || userMsgs.length > 0) return;
    // STICKY-SESSION RESTORE (admin rule 2026-07-05 — replaces the retired 2026-07-01 always-fresh
    // rule): opening v5.0 with an empty panel restores the STICKY session's saved chat — text back
    // where the user left it after a reload / phone-off / browser kill — and, if that session's build
    // is still running server-side, re-attaches it live (openConversation's resume-live path). Silent:
    // a brand-new sticky session with nothing saved yet simply stays a blank new chat (no error, no
    // "Transcript lost" branding). Runs at most once per session id; skipped while a History reopen
    // (v3Resume) is pending so it can never race a deliberate open.
    const sid = sessionIdRef.current;
    if (!sid || autoRestoredSessionRef.current === sid) return;
    if (resume && resume.nonce && resume.nonce !== lastAppliedResumeNonce) return; // History reopen wins
    autoRestoredSessionRef.current = sid;
    void openConversation(`v3_${sid}`, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, running, state.narration.length, userMsgs.length, freshOpenNonce]);

  // S4 — re-armed per workspace; the rehydrate EFFECT itself lives below loadWorkspaceFiles (declared
  // later) to avoid a temporal-dead-zone on workspaceFiles. New chat / open / resume reset it to ''.
  const rehydratedWsRef = useRef<string>('');

  // Resume a saved v5.0 conversation opened from History ("open chat"). Adopt its sessionId and
  // restore its saved thread into the chat.
  //
  // ROOT-CAUSE FIX (2026-07-02): a plain `useEffect` ALWAYS runs once on mount, and App never clears
  // `v3Resume` back to null — so after the user opened ANY chat from History once, EVERY later remount
  // (tab away/back, or ProV3Surface's loading→enabled transition) re-applied that stale value: it
  // repainted the old bubbles AND reset sessionIdRef to the OLD session id, defeating the "always mint
  // a fresh id" rule and re-attaching the old build. A component-level ref can't guard this because it
  // resets to 0 on every remount. So we track the last-applied nonce at MODULE scope (survives
  // remounts): a genuine History reopen mints a NEW nonce and still applies; a remount carrying the
  // SAME already-applied nonce is ignored, so the panel keeps its fresh session instead of reloading
  // the old chat.
  useEffect(() => {
    if (!resume || resume.nonce === lastAppliedResumeNonce) return;
    lastAppliedResumeNonce = resume.nonce;
    const sid = resume.sessionId;
    sessionIdRef.current = sid;
    persistSessionId(sid); // keep the reopened project sticky across reloads too
    autoRestoredSessionRef.current = sid; // explicit resume → mark handled (auto-restore must not override)
    rehydratedWsRef.current = '';         // re-arm file rehydrate for the resumed workspace
    reset();
    // Session switch = full surface switch: the resumed chat must not inherit the PREVIOUS session's
    // plan/advice threads, report history, git/ship state, or preview (same class as the "+New chat"
    // leak). Its own durable framework is adopted below when known.
    clearProjectSurfaces();
    setFramework('vite-react');
    // Seed instantly from the passed thread (legacy chat_sessions copy — may be empty for sessions
    // saved after the metadata-only cutover), then replace with the SERVER transcript below: the
    // server ConversationStore is the single source of truth for what was actually said.
    setUserMsgs(resume.messages.filter((m) => m.role === 'user'));
    setAgentHistory(resume.messages.filter((m) => m.role !== 'user'));
    setCheckpointHistory([]);
    setFiles([]);
    const fetchStarted = Date.now();
    void (async () => {
      const restored = await loadConversation({ userId, email, id: `v3_${sid}` });
      // Apply only if the user hasn't already switched away meanwhile.
      if (!restored || restored.messages.length === 0 || sessionIdRef.current !== sid) return;
      // Adopt the durable framework so a reopened non-Vite session's follow-up build stays correct.
      if (restored.framework) { setFramework(restored.framework); setFrameworkExplicit(true); }
      // REATTACH-ON-REOPEN: same as the ☰-menu open path — a build still running for this
      // session (closed mid-build) re-attaches its live stream instead of 409-ing on send.
      if (restored.workspaceId) void checkRunning({ userId, email, workspaceId: restored.workspaceId });
      setInterruptedResume(restored.unfinished === true); // AP-3 — offer Continue if a restart cut it off
      // Cross-cutover continuity: if the seeded legacy thread is provably disjoint from the server
      // transcript (a pre-cutover chat continued later), keep it IN FRONT of the server messages;
      // if it overlaps (old build sessions — both stores hold copies), drop it: server wins.
      const prepend = legacyPrependMessages(
        resume.messages.map((m) => ({ text: m.text, isUser: m.role === 'user' })),
        restored.messages.map((m) => m.text),
      );
      setUserMsgs((prev) => {
        // If the user already SENT a new message while the transcript was loading (its ts is a
        // fresh epoch stamp), keep the live thread — the new turn is persisted server-side and
        // will be restored on the next open; never hide what the user just typed.
        if (prev.some((m) => m.ts >= fetchStarted)) return prev;
        return [...prepend.filter((m) => m.role === 'user'), ...restored.messages].map((m) => ({ role: 'user' as const, text: m.text, ts: m.ts }));
      });
      setAgentHistory(prepend.filter((m) => m.role !== 'user').map((m) => ({ role: 'agent' as const, text: m.text, ts: m.ts })));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume?.nonce]);

  // Phase G1 — git as the third organ: load the DURABLE checkpoint timeline for this workspace and seed
  // it into checkpointHistory, so the History tab shows the full commit history even across sessions,
  // devices and sandbox recycles (not just this session's RAM). Runs on sign-in, on resume, and when a
  // build settles (to pick up just-persisted commits). Merged + deduped by sha; best-effort.
  useEffect(() => {
    // ANON PARITY (Fix 26): the checkpoint timeline loads for the anon identity too.
    if (!sessionIdRef.current) return;
    let cancelled = false;
    const workspaceId = state.workspaceId || clientWorkspaceId(userId, sessionIdRef.current);
    (async () => {
      let durable = await getCheckpoints({ workspaceId, userId, email });
      // IDENTITY-DEGRADATION FALLBACK (Fix 26): a session whose build ran anon keeps its checkpoints
      // under `agentv3-anon-<sid>` — try that candidate when the user-keyed workspace has none.
      const anonWs = clientWorkspaceId(undefined, sessionIdRef.current);
      if (durable.length === 0 && anonWs && anonWs !== workspaceId && workspaceId === clientWorkspaceId(userId, sessionIdRef.current)) {
        durable = await getCheckpoints({ workspaceId: anonWs, userId, email });
      }
      if (!cancelled && durable.length > 0) {
        setCheckpointHistory((prev) => {
          const seen = new Set<string>();
          const merged: GitCheckpoint[] = [];
          // Oldest-first to match how checkpointHistory is built across turns (durable comes newest-first).
          for (const c of [...durable].reverse().concat(prev)) {
            const key = c.sha || c.id;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            merged.push(c);
          }
          return merged;
        });
      }
      // Phase G2 — also pull the live working-tree git status so the History tab reflects the real
      // git organ state (clean / N uncommitted) tied to this same workspace.
      const status = await getGitStatus({ workspaceId, userId, email });
      if (!cancelled) setGitStatus(status);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, resume?.nonce, state.workspaceId, state.done, tab]);

  // HISTORY REBUILD (single source of truth, admin order 2026-07-02): the server ConversationStore
  // is the ONLY transcript writer — the client persists NO messages, ever. This effect now writes a
  // METADATA-ONLY row into chat_sessions (title/tags/lastUpdated, keyed by the stable sessionId) so
  // (a) the main sidebar History still lists v5.0 sessions and (b) sessions whose server record is
  // anon-degraded still get a list row here. It deliberately writes NO `messages` field: with
  // `{ merge: true }` an existing legacy transcript in the doc is left untouched (read-only legacy
  // data), and no client write can ever again shrink/erase a thread — the root cause of the
  // "old chat opens empty" corruption is structurally gone, not just guarded against.
  useEffect(() => {
    if (!userId || !sessionIdRef.current) return;
    // SWITCH GUARD: never write while openConversation is mid-switch — sessionIdRef still names the
    // PREVIOUS session while `convo` is already reduced, so a write here would retitle the previous
    // session's row from the wrong thread. The post-switch state change re-runs this effect safely.
    if (sessionSwitchRef.current) return;
    // Title from the BUILD thread (the durable session) regardless of which tab is active — a Plan/Advise
    // page's first message must never retitle the session.
    const firstUser = buildConvo.find((m) => m.role === 'user')?.text;
    if (!firstUser) return; // nothing meaningful to save yet
    const title = firstUser.slice(0, 40) + (firstUser.length > 40 ? '…' : '');
    const docId = `v3_${sessionIdRef.current}`;
    setDoc(
      doc(db, 'chat_sessions', docId),
      sanitizeFirestoreData({
        id: docId,
        uci: docId,
        userId,
        tab: 'engine_builder',
        original_agent: 'agentv3',
        current_agent: 'agentv3',
        title,
        lastUpdated: new Date().toISOString(),
        mode: 'build',
      }),
      { merge: true },
    ).catch(() => { /* history save is best-effort — never blocks the UI */ });
    // Fires on the FIRST user message (userMsgs.length — so a CHAT-only session gets a row too),
    // on build start (workspaceId), completion (done), and stop/timeout (running). Writes stay
    // bounded (userMsgs.length changes only when the user sends) and idempotent (same doc, merge).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.workspaceId, state.done, running, userId, userMsgs.length]);

  // Read a File as base64 (no data: prefix); downscale large images to keep the
  // payload small and vision-optimal, exactly like the other chat surfaces.
  const fileToAttachment = (file: File): Promise<{ name: string; type: string; base64: string }> =>
    new Promise((resolve) => {
      const isImage = file.type.startsWith('image/') && file.type !== 'image/svg+xml';
      const raw = () => {
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, type: file.type || 'application/octet-stream', base64: (reader.result as string).split(',')[1] || '' });
        reader.onerror = () => resolve({ name: file.name, type: file.type, base64: '' });
        reader.readAsDataURL(file);
      };
      if (!isImage) return raw();
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, 1568 / Math.max(img.width, img.height));
          if (scale === 1 && file.size <= 900 * 1024) { URL.revokeObjectURL(url); return raw(); }
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) { URL.revokeObjectURL(url); return raw(); }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve({ name: file.name.replace(/\.(png|webp|gif|bmp|heic|heif)$/i, '.jpg'), type: 'image/jpeg', base64: dataUrl.split(',')[1] || '' });
        } catch { URL.revokeObjectURL(url); raw(); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); raw(); };
      img.src = url;
    });

  // ROOT-CAUSE FIX (admin 2026-07-26: "zip upload complete ho jaata hai lekin files v5 me nahi
  // aati") — this used to filter out any file over a hardcoded 15 MB with NO feedback at all, so a
  // large zip silently vanished from the attachment list right here, before it ever reached the
  // send-time size guard (Fix 36a / checkAttachmentSizes) whose entire job is to explain WHY an
  // oversized upload can't go through. Two size limits had drifted apart — a silent one (15 MB, here)
  // and an honest one (MAX_ATTACHMENT_BYTES, attachmentLimits.ts) — and the silent one always won.
  // Now there is ONE limit, and a rejected file gets the same honest, actionable message as a
  // rejected send, immediately, so the user knows their upload never happened and why.
  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    const tooBig = incoming.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    const picked = incoming.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
    if (tooBig.length > 0) {
      const verdict = checkAttachmentSizes(tooBig);
      setUserMsgs((c) => [...c, { role: 'agent', text: `⚠️ ${verdict.reason || 'One or more files are too large to attach.'}`, ts: Date.now() }]);
    }
    if (picked.length > 0) setFiles((prev) => [...prev, ...picked].slice(0, 8));
  };

  // `override` — programmatic sends (the GitHub repo picker's 1-click import): supplies its own
  // text + importUrl and NEVER consumes the user's typed draft or staged attachments.
  const send = async (override?: { text: string; importUrl: string }) => {
    const text = (override?.text ?? prompt).trim();
    const sendFiles = override ? [] : files;
    if ((!text && sendFiles.length === 0) || running) return;
    // Stop live voice dictation the moment the message is sent (never leave the mic recording).
    if (listening) { try { voiceRef.current?.stop(); } catch { /* already stopped */ } setListening(false); }
    setInterruptedResume(false); // AP-3 — a new build/turn resolves any "unfinished build" offer
    // A fresh user message resets the Layer-3 auto-continue budgets for the new turn — the pause
    // budget, the plan-continue count, AND the plan-progress watermark (SPM-3), so a typed
    // "continue" after a stall starts a fresh progress-monotone chain.
    autoContinueRef.current = 0;
    planContinuesRef.current = 0;
    lastPlanRemainingRef.current = null;
    noProgressRef.current = 0;
    lastFilesWrittenRef.current = null;
    // Preserve the previous turn's agent replies BEFORE start() resets the live
    // build state — otherwise the prior reply (which lives only in state.narration)
    // disappears from the thread the moment the next message begins.
    if (state.narration.length > 0) {
      setAgentHistory((h) => [
        ...h,
        ...state.narration.map((n) => ({
          role: 'agent' as const,
          agent: n.agent,
          text: n.text,
          ts: n.ts,
          kind: n.kind,
        })),
      ]);
    }
    // Also preserve this turn's git checkpoints before start() resets them.
    if (state.checkpoints.length > 0) {
      setCheckpointHistory((h) => [...h, ...state.checkpoints]);
    }
    // SIZE GUARD (Fix 36a): an oversized zip dies at the platform's request-body limit BEFORE the
    // server sees it — the user only saw the stall banner ("zip upload band ho gayi"). Refuse it
    // HERE with the honest reason + the workable alternatives, and keep the composer state intact.
    if (sendFiles.length > 0) {
      const sizeVerdict = checkAttachmentSizes(sendFiles);
      if (!sizeVerdict.ok) {
        setUserMsgs((c) => [...c, { role: 'agent', text: `⚠️ ${sizeVerdict.reason}`, ts: Date.now() }]);
        return;
      }
    }
    const attachments = sendFiles.length > 0 ? await Promise.all(sendFiles.map(fileToAttachment)) : undefined;
    // A file with no text gets a sensible default prompt (the server requires one).
    const msgText = text || (sendFiles.length > 0 ? `Please read and analyze the attached file(s): ${sendFiles.map((f) => f.name).join(', ')}` : '');
    const displayText = text || `📎 ${sendFiles.map((f) => f.name).join(', ')}`;
    setUserMsgs((c) => [...c, { role: 'user', text: displayText, ts: Date.now() }]);
    if (!override) {
      setPrompt('');
      setFiles([]);
    }
    const pendingImportUrl = (override?.importUrl ?? importUrl).trim();
    if (!override) setImportUrl(''); // consume the set-by-hand import URL on first send
    // Phase S3 conflict guard: flush any pending IDE edits to v5.0's durable store BEFORE the build
    // starts, so the build reads the user's latest hand edits — never a stale file set. Best-effort:
    // a flush failure must never block the build (the syncer swallows its own errors).
    try { await onBeforeBuild?.(); } catch { /* flush is best-effort */ }
    // Run the build with a concrete framework. `resolved` marks the choice as final so neither the client
    // nor the server re-prompts on the same conflict.
    const launch = (fw: string, resolved: boolean) => start(msgText, {
      userId, email, onlyOpus, powerLevel, planFirst, thinking, sessionId: sessionIdRef.current, attachments,
      framework: fw, frameworkExplicit: frameworkExplicit || resolved, frameworkResolved: resolved, appSignature: appSignaturePref(),
      importUrl: pendingImportUrl || undefined,
      // 3-role model (FIX #6): Plan/Advise send the message down the read-only role lane instead of
      // the builder — same session, same workspace, so proposed steps land in THIS app's queue.
      chatRole: chatMode === 'build' ? undefined : chatMode,
    });
    // FRAMEWORK CONFLICT CONFIRM (admin 2026-07-20): only for a BUILD turn, and only when the user PICKED
    // one framework but the message NAMES a different one — pause and ask which to use instead of building
    // the wrong stack. A plan/advise turn or a no-conflict build proceeds immediately.
    const sel = chatMode === 'build'
      ? resolveFrameworkSelection({ picked: framework, explicit: frameworkExplicit, prompt: msgText })
      : { status: 'ok' as const, framework };
    if (sel.status === 'conflict') {
      setFwConflict({ picked: sel.picked, detected: sel.detected, launch: (fw: string) => launch(fw, true) });
      return;
    }
    launch(sel.framework, false);
  };

  // ── INLINE VOICE DICTATION (admin 2026-07-22) ────────────────────────────────────────────────
  // Tap the mic → speech types straight into the composer on THIS page (interim + final), tap again to
  // stop. Same Web Speech engine as the standalone tool. On a platform without Web Speech, fall back to
  // the dedicated Voice-to-App page so the feature still works.
  const stopVoice = () => {
    try { voiceRef.current?.stop(); } catch { /* already stopped */ }
    setListening(false);
  };
  const toggleVoice = () => {
    if (!speechSupported) {
      window.dispatchEvent(new CustomEvent('navbharat:navigate', { detail: { view: 'voice' } }));
      return;
    }
    if (listening) { stopVoice(); return; }
    const w = window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    const sr = new SR();
    sr.continuous = true;
    sr.interimResults = true;
    sr.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-IN';
    voiceBaseRef.current = prompt ? prompt.replace(/\s+$/, '') + ' ' : '';
    voiceFinalRef.current = '';
    sr.onresult = (event: any) => {
      let interim = '';
      let newFinal = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) newFinal += t; else interim += t;
      }
      if (newFinal) voiceFinalRef.current += (voiceFinalRef.current ? ' ' : '') + newFinal.trim();
      setPrompt((voiceBaseRef.current + voiceFinalRef.current + (interim ? ' ' + interim : '')).replace(/^\s+/, ''));
    };
    sr.onerror = () => setListening(false);
    sr.onend = () => setListening(false);
    voiceRef.current = sr;
    try { sr.start(); setListening(true); setTimeout(() => composerRef.current?.focus(), 0); } catch { setListening(false); }
  };

  // ── INLINE "SCREENSHOT → APP" (admin 2026-07-22) ─────────────────────────────────────────────
  // Open the gallery, read the chosen screenshot, turn it into a build spec (/api/screenshot/to-prompt,
  // which appends the intent-aware clone/anti-phishing policy), and start the build right here. Drives
  // both the glowing template button and the Attach-menu option.
  const openScreenshotGallery = () => { if (!running && !screenshotBusy) screenshotInputRef.current?.click(); };
  const handleScreenshotPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file || running || screenshotBusy) return;
    setScreenshotBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onloadend = () => resolve(String(r.result || ''));
        r.onerror = () => reject(new Error('read failed'));
        r.readAsDataURL(file);
      });
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const res = await fetch('/api/screenshot/to-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, imageType: file.type || 'image/png' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || typeof data.prompt !== 'string') {
        throw new Error((data && typeof data.error === 'string' && data.error) || 'Could not read the screenshot — try a clearer image.');
      }
      // KEEP WHAT THE USER TYPED (admin 2026-07-28). This flow used to send ONLY the prompt derived
      // from the image, silently discarding the composer text — so "make this page but in Hindi" lost
      // "but in Hindi", the single most likely thing a user adds to a screenshot. Their words come
      // LAST so they read as the overriding instruction, and the composer is cleared like a normal send.
      const typed = prompt.trim();
      const combined = combineScreenshotPrompt(data.prompt, typed);
      if (typed) setPrompt('');
      await send({ text: combined, importUrl: '' });
    } catch (err) {
      setUserMsgs((c) => [...c, { role: 'agent', text: `⚠️ ${err instanceof Error ? err.message : 'Screenshot could not be read. Try again.'}`, ts: Date.now() }]);
    } finally {
      setScreenshotBusy(false);
    }
  };

  // PROJECT IMPORT (.zip) — admin 2026-07-28. A zip is a PROJECT, not a chat attachment: it is
  // uploaded in chunks (so archive size is not a limit — see zipProjectUpload.ts), extracted and
  // landed SERVER-SIDE into this workspace, and then shown in Files. It never becomes base64 in a
  // build request, which is exactly what capped it at 18 MB and made a 161 MB import impossible.
  // ONE import runner, two entry points. The zip and folder paths differ ONLY in where the bytes come
  // from; every step after that — the precondition, the progress line, the honest summary, the Files
  // hand-off, the error surface — is identical, and duplicating it per entry point is how two ways in
  // start behaving differently for no reason anyone chose.
  const runProjectImport = async (
    announce: string,
    run: (workspaceId: string, onProgress: (p: { label: string }) => void) => Promise<MasterImportResult | null>,
  ) => {
    if (running || zipImporting) return;
    // PRECONDITION FIRST (admin report 2026-08-04). The workspace id is only used once the bytes are
    // already moving, so a missing one used to cost a 161 MB, multi-minute transfer before the server
    // could correctly refuse it. Resolve and validate here, in the first millisecond — the same shape as
    // the server's own size/disk preflight. This also fixes the id itself: the import was the one call
    // site passing `state.workspaceId` (empty until a build attaches) instead of the session's real id,
    // so a FRESH tab could never import at all.
    const targetWorkspaceId = resolveImportWorkspaceId({
      stateWorkspaceId: state.workspaceId,
      fallbackWorkspaceId: clientWorkspaceId(userId, sessionIdRef.current),
    });
    if (!targetWorkspaceId) {
      setUserMsgs((c) => [...c, { role: 'agent', text: `⚠️ ${importTargetUnavailableMessage()}`, ts: Date.now() }]);
      return;
    }
    setZipImporting(true);
    setUserMsgs((c) => [...c, { role: 'agent', text: announce, ts: Date.now() }]);
    try {
      const result = await run(targetWorkspaceId, (p) => setZipProgress(p.label));
      if (!result) return; // the user cancelled the picker — a normal outcome, not a failure
      // The tree is already in hand on the browser path — paint Files immediately instead of making the
      // user wait on a round trip for data this tab just read itself.
      if (result.files) { try { onFilesSync?.(result.files); } catch { /* the read-back below still covers it */ } }
      // The success line STATES what did not come in. A green tick over a silently-gutted project is the
      // product lying about its own result — the exact thing the second and third absolute rules forbid.
      // `dropSummary` is '' for a clean import, so a complete project reads exactly as before.
      setUserMsgs((c) => [...c, {
        role: 'agent',
        // It also says what happens NEXT, because the import now starts the app itself: the user should
        // be looking at the Preview, not wondering whether they still have to ask for something.
        text: result.dropSummary
          ? `✅ Imported “${result.fileName}”.\n\n${result.dropSummary}\n\nInstalling dependencies and starting your app in Preview — your files are in the Files tab.`
          : `✅ Imported ${result.fileCount} file${result.fileCount === 1 ? '' : 's'} from “${result.fileName}”. Installing dependencies and starting your app in Preview — your files are in the Files tab.`,
        ts: Date.now(),
      }]);
      // Pull the landed project into the IDE/Files view through the SAME bridge a build's own file
      // writes use, so an imported app behaves exactly like a built one from here on.
      try {
        const res = await fetch('/api/agentv3/workspace-files', {
          method: 'POST',
          headers: await authJsonHeaders(),
          body: JSON.stringify({ workspaceId: targetWorkspaceId, userId, email }),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.files && typeof data.files === 'object') onFilesSync?.(data.files);
      } catch { /* the files are already durable server-side; the Files view refreshes on next load */ }
      // IMPORT = INSTALL + RUN, WITH NO AI TURN (admin 2026-08-10: "koi user kitni bhi badi file upload
      // kyu na kare, usko LLM/provider tak bhejne ki need hi nahi hai — IDE/VS Code jaise install kar ke
      // preview chala dena hai bas").
      //
      // Landing the files was only half of what a user means by "open my project". The import used to
      // finish on the FILES tab with nothing running it, so the only way to see the app was to type a
      // message — which starts a full build turn and pushes the whole project through the model. A real
      // report showed exactly that: 37 imported files, 11 model calls, ~21-25k input tokens each, to do
      // what `npm install && npm run dev` does for free. Wrong twice over — it costs the user money for
      // nothing, and it makes the model responsible for an operation that is pure infrastructure.
      //
      // So the import ends on the PREVIEW and asks it to boot. The boot itself is PreviewSurface's
      // existing model-free path (`preview-diagnose`: hydrate the sandbox from the durable files, install
      // dependencies, start the dev server, publish the URL — zero model calls). Signalling it rather
      // than repeating it here keeps ONE boot implementation with one honest progress UI; a second copy
      // in this file would have raced the first and booted the same sandbox twice.
      setTab('preview');
      setPreviewBootSignal(Date.now());
      // CONNECT AUDIT (master import, part 4). Landing and running the project is plumbing — every
      // builder does it. What makes bringing an app HERE worth doing is being told something about it
      // you did not already know, for free, before spending anything. Deterministic and model-free
      // (the analyzers this repo already has), so it costs the user nothing and cannot start a build.
      //
      // Fire-and-forget on purpose, AFTER the preview boot is signalled: a courtesy finding must never
      // delay the thing the user actually asked for, and its absence must never look like a failed
      // import. The import is already complete and reported by the time this runs.
      void (async () => {
        try {
          const res = await fetch('/api/agentv3/connect-audit', {
            method: 'POST',
            headers: await authJsonHeaders(),
            body: JSON.stringify({ workspaceId: targetWorkspaceId, userId, email }),
          });
          const audit = await res.json().catch(() => null);
          if (audit?.message) setUserMsgs((c) => [...c, { role: 'agent', text: audit.message, ts: Date.now() }]);
        } catch { /* a bonus that did not arrive is never reported as an import failure */ }
      })();
    } catch (err) {
      setUserMsgs((c) => [...c, {
        role: 'agent',
        text: `⚠️ ${err instanceof Error ? err.message : 'The project could not be imported.'}`,
        ts: Date.now(),
      }]);
    } finally {
      setZipImporting(false);
      setZipProgress('');
    }
  };

  // A .zip: read in the browser, uploading only the surviving source; the chunked server upload stays
  // as an honest fallback when the browser genuinely cannot open it.
  const handleZipProject = (file: File) => runProjectImport(
    `📦 Importing “${file.name}” (${(file.size / 1024 / 1024).toFixed(1)} MB)…`,
    (workspaceId, onProgress) => importProjectArchive(file, workspaceId, userId, email, onProgress),
  );

  // A FOLDER: no zip, no archive, nothing staged — the browser reads the project where it already is.
  const handleOpenFolder = () => runProjectImport(
    '📂 Opening your project folder…',
    async (workspaceId, onProgress) => {
      const dir = await pickProjectFolder();
      if (!dir) return null; // cancelled
      return importProjectFolder(dir, dir.name || 'your project', workspaceId, userId, email, onProgress);
    },
  );

  // FULL TEAM mid-build steering (Fix 60, admin 2026-07-13): on the 'max' tier the composer stays
  // LIVE during a build — a sent message is queued server-side (/steer) and the AgentRunner injects
  // it as a real user turn at the next step boundary, Claude-Code style. The user's bubble appears
  // instantly; the server's "queued" + the runner's "picked up" narrations confirm honestly.
  const sendSteer = async () => {
    const text = prompt.trim();
    if (!text || !canSteerMidBuild(running, powerLevel, chatMode)) return;
    setUserMsgs((c) => [...c, { role: 'user', text, ts: Date.now() }]);
    setPrompt('');
    setComposerExpanded(false);
    try {
      const res = await fetch('/api/agentv3/steer', {
        method: 'POST',
        headers: await authJsonHeaders(),
        body: JSON.stringify({ userId, email, workspaceId: state.workspaceId ?? null, message: text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }));
        // Honest failure: the message did NOT reach the team (e.g. the build just finished). Keep the
        // user's bubble (it's their words) and say exactly what happened next to it.
        setUserMsgs((c) => [...c, { role: 'agent', text: `⚠️ ${data?.error || 'Your message could not reach the team — the build may have just finished. Send it again as a normal message.'}`, ts: Date.now() }]);
      }
    } catch {
      setUserMsgs((c) => [...c, { role: 'agent', text: '⚠️ Network error — your message did not reach the team. Send it again.', ts: Date.now() }]);
    }
  };

  // PLAN / ADVISE send (read-only lanes) — a DEDICATED request, decoupled from the build stream.
  // Works EVEN WHILE a build is running (it never touches the build lock server-side or the build's
  // `running`/abort state here), and streams its reply into the SHARED thread (agentHistory) so the
  // one session stays coherent. This is what fixes "can't send during a build" + "send → error".
  const sendRole = async (role: 'planner' | 'advisor', override?: string) => {
    const text = (override ?? prompt).trim();
    if (!text || roleBusy) return;
    // Append to THIS lane's own thread (Plan or Advise page) — not the Build thread.
    setRoleThreads((t) => ({ ...t, [role]: [...t[role], { role: 'user', text, ts: Date.now() }] }));
    if (override === undefined) { setPrompt(''); setComposerExpanded(false); }
    setRoleProposedSteps(null);
    setRoleBusy(true);
    const controller = new AbortController();
    roleAbortRef.current = controller;
    let prose = '';
    try {
      const res = await fetch('/api/agentv3/chat', {
        method: 'POST',
        headers: await authJsonHeaders(),
        body: JSON.stringify({ prompt: text, userId, email, sessionId: sessionIdRef.current, chatRole: role }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        let m = `request failed (${res.status})`;
        try { const j = await res.json(); if (j && typeof j.error === 'string') m = j.error; } catch { /* non-JSON */ }
        throw new Error(m);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: { type?: string; text?: string; steps?: unknown; message?: string };
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === 'narration' && typeof ev.text === 'string') prose = ev.text;
          else if (ev.type === 'proposed_steps' && Array.isArray(ev.steps)) {
            const steps = (ev.steps as unknown[]).filter((s): s is string => typeof s === 'string' && !!s.trim());
            if (steps.length > 0) setRoleProposedSteps({ role, steps });
          } else if (ev.type === 'error') throw new Error(ev.message || `${role} turn failed`);
        }
      }
      const reply = prose.trim() || `The ${role} had nothing to add.`;
      setRoleThreads((t) => ({ ...t, [role]: [...t[role], { role: 'agent', agent: 'architect', text: reply, ts: Date.now() }] }));
    } catch (e) {
      if (!controller.signal.aborted) {
        const msg = e instanceof Error ? e.message : String(e);
        setRoleThreads((t) => ({ ...t, [role]: [...t[role], { role: 'agent', agent: 'architect', text: `⚠️ The ${role} could not reply: ${msg}. Please try again.`, ts: Date.now() }] }));
      }
    } finally {
      setRoleBusy(false);
      roleAbortRef.current = null;
    }
  };

  // ── Layer 3: bounded auto-continue ──────────────────────────────────────────────
  // When a build ends `resumable`, automatically resume the SAME project without the user typing
  // "continue". Two shapes share one pure decision (decideAutoContinue): a wall-clock PAUSE keeps
  // the classic small pause budget (a genuinely stuck build can never loop or rack up unbounded
  // cost), while a project-mode MODULE turn (SPM-3, `planRemaining` on the result) continues for
  // as long as the plan STRICTLY advances — so a 40-module software project runs unattended, but
  // a stalled plan hands back honestly. Reuses the proven resume path (start('continue', …)).
  useEffect(() => {
    if (!state.done || !state.resumable || running) return;
    // SPM-3: one pure decision for both loops — the classic bounded deadline-pause continue AND
    // the project-mode module chain (continues only while planRemaining strictly decreases, with
    // a fresh pause budget per completed module and an absolute backstop).
    const filesWritten = typeof state.filesWritten === 'number' ? state.filesWritten : undefined;
    const madeProgress = typeof filesWritten === 'number'
      && (lastFilesWrittenRef.current == null || filesWritten > lastFilesWrittenRef.current);
    const decision = decideAutoContinue({
      planRemaining: state.planRemaining,
      lastPlanRemaining: lastPlanRemainingRef.current,
      pauseContinues: autoContinueRef.current,
      planContinues: planContinuesRef.current,
      filesWritten,
      lastFilesWritten: lastFilesWrittenRef.current,
      noProgressPauses: noProgressRef.current,
    });
    if (typeof state.planRemaining === 'number') lastPlanRemainingRef.current = state.planRemaining;
    if (!decision.proceed) {
      if (decision.stopMessage) {
        setAgentHistory((h) => [
          ...h,
          { role: 'agent' as const, agent: 'architect', text: decision.stopMessage as string, ts: Date.now() },
        ]);
      }
      return;
    }
    if (decision.isPlanContinue) {
      planContinuesRef.current += 1;
      if (decision.resetPauseBudget) autoContinueRef.current = 0;
      else autoContinueRef.current += 1;
    } else {
      // Classic wall-clock pause: keep the ABSOLUTE counter climbing (backstop), and reset/advance the
      // no-progress streak by whether this window actually added files. lastFilesWrittenRef tracks the
      // high-water mark so a later smaller scan can't look like "no progress".
      autoContinueRef.current += 1;
      noProgressRef.current = madeProgress ? 0 : noProgressRef.current + 1;
      if (typeof filesWritten === 'number') lastFilesWrittenRef.current = Math.max(lastFilesWrittenRef.current ?? 0, filesWritten);
    }
    // Preserve the paused turn's replies into history before start() resets the live state.
    if (state.narration.length > 0) {
      setAgentHistory((h) => [
        ...h,
        ...state.narration.map((n) => ({ role: 'agent' as const, agent: n.agent, text: n.text, ts: n.ts, kind: n.kind })),
      ]);
    }
    if (state.checkpoints.length > 0) setCheckpointHistory((h) => [...h, ...state.checkpoints]);
    start('continue', { userId, email, onlyOpus, powerLevel, planFirst, thinking, sessionId: sessionIdRef.current, framework, frameworkExplicit, appSignature: appSignaturePref() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.done, state.resumable, running]);

  // ── FIX #4.3 + #6: client-driven QUEUE executor + queue UI plumbing ─────────────────────────────
  // After a build SETTLES (and it is NOT a resumable SPM continue — handled above), this: (1) records
  // the outcome of the queued command that was running, then (2) claims + auto-submits the next queued
  // command. Runs one step at a time (the serial invariant), pauses on error, and is inert when the
  // queue is empty (the server short-circuits /queue/next without a write). shouldRunNextQueued is the
  // pure, tested gate; the two refs prevent double-complete and re-entrant double-submit.
  const activeQueuedItemRef = useRef<string | null>(null);
  const queueClaimInFlightRef = useRef(false);

  // Refresh the queue list shown in the UI (best-effort; also runs after enqueue/settle/cancel).
  const refreshQueue = useCallback(async () => {
    setQueueItems(await queueList(expectedWorkspaceId()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueList]);

  // Claim + run the next queued command NOW. Shared by the settle-effect and the post-enqueue kick
  // (a fresh idle session has no settled build, so the effect alone would never start the queue).
  // The server's claimNext is the real serial guard — it refuses while one is running, atomically.
  const claimAndRunNext = useCallback(async () => {
    if (running || queueClaimInFlightRef.current || state.pendingPermission) return;
    queueClaimInFlightRef.current = true;
    try {
      const item = await queueNext(expectedWorkspaceId());
      if (!item) return;
      activeQueuedItemRef.current = item.id;
      setUserMsgs((c) => [...c, { role: 'user', text: item.prompt, ts: Date.now() }]);
      if (state.narration.length > 0) {
        setAgentHistory((h) => [...h, ...state.narration.map((n) => ({ role: 'agent' as const, agent: n.agent, text: n.text, ts: n.ts, kind: n.kind }))]);
      }
      try { await onBeforeBuild?.(); } catch { /* flush is best-effort */ }
      start(item.prompt, { userId, email, onlyOpus, powerLevel, planFirst, thinking, sessionId: sessionIdRef.current, framework, frameworkExplicit, appSignature: appSignaturePref() });
      void refreshQueue();
    } finally {
      queueClaimInFlightRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, state.pendingPermission, state.narration, queueNext, start, userId, email, onlyOpus, powerLevel, planFirst, thinking, framework, refreshQueue]);

  useEffect(() => {
    const hasError = !!(error || state.error);
    // (1) A queued command's build just settled → record its outcome (a failure pauses the queue below).
    if (state.done && !running && activeQueuedItemRef.current) {
      const ok = !hasError && state.ok !== false;
      activeQueuedItemRef.current = null;
      void queueComplete(expectedWorkspaceId(), ok, ok ? undefined : (error || state.error || 'build did not complete')).then(() => refreshQueue());
    }
    // (2) Idle after a non-resumable settle → claim + run the next queued command.
    if (!shouldRunNextQueued({
      running,
      buildSettled: state.done && !running && !state.resumable,
      pendingGate: !!state.pendingPermission,
      hasError,
      claimInFlight: queueClaimInFlightRef.current,
    })) return;
    void claimAndRunNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.done, state.resumable, running, state.pendingPermission, error, state.error]);

  // FIX #6 — approve a role chat's proposed step into THIS app's queue (the user's explicit click;
  // nothing is ever auto-enqueued). If the app is idle, kick the executor so the queue starts NOW.
  const addStepsToQueue = useCallback(async (steps: string[], source: 'planner' | 'advisor') => {
    const ws = expectedWorkspaceId();
    for (const step of steps) {
      const ok = await queueEnqueue(ws, step, source);
      if (ok) setAddedSteps((prev) => new Set(prev).add(step));
    }
    await refreshQueue();
    if (!running && !state.pendingPermission) void claimAndRunNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueEnqueue, refreshQueue, running, state.pendingPermission, claimAndRunNext]);

  // A new role turn's proposals replace the previous ones — reset the added-marks + show the queue.
  // Fires for the decoupled Plan/Advise lane (roleProposedSteps) and the legacy build-stream path.
  useEffect(() => {
    if (roleProposedSteps || state.proposedSteps) { setAddedSteps(new Set()); void refreshQueue(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleProposedSteps, state.proposedSteps]);

  // Load this app's queue once on mount (and when the session changes), so a queue left from a
  // previous visit is visible (and resumable) immediately — the paused-queue-resumes-on-reopen story.
  useEffect(() => {
    void refreshQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshOpenNonce]);

  // Start a brand-new project: fresh sandbox/memory (new session id) and clear chat. Allowed even
  // while a build is actively streaming HERE — reset() detaches from that stream (the underlying
  // server build, if any, keeps running in the background and stays resumable from History) instead
  // of blocking navigation until the build finishes. Root-caused 2026-07-01: "+ New chat"/history
  // items used to silently no-op (`if (running) return`) for as long as the current session's build
  // was in progress — with auto-resume now correctly reattaching to a genuinely long build, this made
  // the panel look permanently "stuck" on whatever chat had an active build.
  // "+New chat" ROOT CAUSE (admin 2026-07-12: "new chat me sirf main chatbox naya hota hai — preview,
  // report, plan, advice sab purane build ke rehte hain"): startNewSession only cleared the CHAT
  // thread; every other per-project surface lived in its own state and silently survived into the new
  // session. This clears ALL of them in one place, shared by New-chat, resume, and open-chat so no
  // session switch can ever leak a previous project's surfaces again.
  const clearProjectSurfaces = () => {
    // Plan / Advice lanes — their threads, any streaming reply, proposed steps, and the step queue.
    roleAbortRef.current?.abort();
    setRoleBusy(false);
    setRoleThreads({ planner: [], advisor: [] });
    setRoleProposedSteps(null);
    setAddedSteps(new Set());
    setQueueItems([]);
    setQueueOpen(false);
    setChatMode('build');
    // Report surfaces — the past-builds dropdown and any picked past build.
    setSelectedHistoryBuildId(null);
    setHistoryReportItems([]);
    setHistoryReportOpen(false);
    setReportPickerOpen(false);
    setReportPickerItems([]);
    // Git / ship / billing footers from the previous project.
    setGitStatus(null);
    setRestoreNote('');
    setShipNote(null);
    setBilled(false);
    setInterruptedResume(false); // AP-3 — a fresh/other session never inherits an unfinished-build offer
    // Composer extras + workspace view: back to the defaults a truly new chat starts with. The
    // preview surface unmounts (previewEverOpened=false), so no stale iframe can survive; its own
    // workspaceId-keyed clear (PreviewSurface) covers the mounted case too.
    setImportUrl('');
    setTab('preview');
    setShowWorkspace(false);
    setPreviewEverOpened(false);
    setPreviewPrewarm(false); // a brand-new chat has no files yet — re-warm when its first build lands
  };

  const startNewSession = () => {
    sessionIdRef.current = newSessionId();
    persistSessionId(sessionIdRef.current); // the new project is now the sticky one across reloads
    autoRestoredSessionRef.current = sessionIdRef.current; // mark handled → auto-restore won't load the old chat over this blank one
    rehydratedWsRef.current = '';            // re-arm file rehydrate for the new (empty) workspace
    setWorkspaceFiles(null);
    setWorkspaceFilesFor(null); // clear the stale-switch tag so the new workspace's files load
    setSelectedFile(null);
    setUserMsgs([]);
    setAgentHistory([]);
    setCheckpointHistory([]);
    setFiles([]);
    clearProjectSurfaces();
    setFramework('vite-react'); // a new project starts on the default stack, not the previous one's
    reset();
  };

  // History menu: list this account's saved v5.0 chats and open any of them. Because conversations
  // are stored per-USER in Firestore (not per device), the same list — and continuing the SAME
  // project/memory — works from any device the user signs in on (Claude-style continuity).
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<ConversationMeta[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null);
  const [pinningHistoryId, setPinningHistoryId] = useState<string | null>(null);
  // Instant client-side history search: filters the already-loaded list by title (no server call).
  const [historyQuery, setHistoryQuery] = useState('');
  // LOUD open-failure: opening a history chat must NEVER silently do nothing (the admin read the
  // resulting no-op as "click hi nahi ho raha"). Any failed open sets this and a dismissible toast
  // shows the real reason.
  const [openChatError, setOpenChatError] = useState<string | null>(null);
  // TAP TRACER (diagnostic, admin-only via ?tapdebug=1 or localStorage nbai_tapdebug=1): the history
  // menu taps are reported dead on iPhone even after the rows became real <button>s, so hypotheses are
  // exhausted — this captures ground truth from the device itself. While the menu is open it listens
  // in CAPTURE phase on window (so it sees the event no matter which element wins the tap) for
  // touchstart/pointerdown/click and shows, inside the menu, WHICH element is topmost at the tap
  // point (document.elementFromPoint). One screenshot then names the tap-eater — or proves the click
  // fires and the fault is downstream. Zero cost unless the flag is on AND the menu is open.
  const [tapDebug] = useState<boolean>(() => {
    try {
      return new URLSearchParams(window.location.search).has('tapdebug') || localStorage.getItem('nbai_tapdebug') === '1';
    } catch { return false; }
  });
  const [lastTap, setLastTap] = useState('');
  useEffect(() => {
    if (!tapDebug || !historyOpen) return;
    const describe = (el: Element | null): string => {
      if (!el) return 'nothing';
      const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}`.slice(0, 90);
    };
    const at = (x: number, y: number, kind: string) =>
      setLastTap(`${kind}@${Math.round(x)},${Math.round(y)} → ${describe(document.elementFromPoint(x, y))}`);
    const onTouch = (e: TouchEvent) => { const t = e.touches[0]; if (t) at(t.clientX, t.clientY, 'touch'); };
    const onPointer = (e: PointerEvent) => at(e.clientX, e.clientY, 'down');
    const onClick = (e: MouseEvent) => setLastTap((prev) => `${prev} | click→${describe(e.target as Element)}`.slice(-180));
    window.addEventListener('touchstart', onTouch, true);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('touchstart', onTouch, true);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('click', onClick, true);
    };
  }, [tapDebug, historyOpen]);
  // READ-ONLY legacy transcripts (keyed by sessionId), stashed at list time. Since the
  // single-source-of-truth cutover the client writes NO messages — new chat_sessions rows are
  // metadata-only and the server ConversationStore holds every transcript. This stash exists purely
  // so PRE-cutover sessions (whose thread lives only in the frozen doc copy) still open with their
  // messages. It is never written back. See loadHistory + openConversation.
  const chatSessionMsgsRef = useRef<Map<string, Array<{ text: string; sender?: string; role?: string; timestamp?: string; ts?: number }>>>(new Map());
  // True while openConversation is switching sessions — blocks the chat_sessions save effect from
  // firing mid-switch (stale sessionIdRef + already-reduced convo), which used to OVERWRITE the
  // previous chat's saved doc with a shrunken thread. That gradual erasure is why old chats opened
  // empty ("history open nahi ho rahi").
  const sessionSwitchRef = useRef(false);
  // Reusable loader so both the initial open AND the "Try again" retry button can
  // re-fetch without duplicating the fetch/loading-state logic.
  //
  // Two sources are merged so EVERY v5.0 session shows: (1) the server conversation store
  // (/api/agentv3/conversations) — the single source of truth for transcripts, but its LIST is
  // keyed to the verified uid, so sessions persisted while identity degraded to anon don't list
  // there; and (2) the Firestore `chat_sessions` metadata rows (`v3_<sessionId>`), which this
  // panel writes for every session and which cover exactly that gap (opening resolves the server
  // record via candidate ids). Dedup by sessionId, preferring the server record when both exist.
  const loadHistory = async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const { items, error: loadErr } = await listConversations({ userId, email });

      // Pull this account's v5.0 sessions from chat_sessions (client SDK) — the reliable superset.
      let chatItems: ConversationMeta[] = [];
      chatSessionMsgsRef.current.clear();
      const prefix = `agentv3-${normalizeUid(userId)}-`;
      if (userId) {
        try {
          const snap = await getDocs(query(collection(db, 'chat_sessions'), where('userId', '==', userId)));
          chatItems = snap.docs
            .filter((d) => {
              const data = d.data() as any;
              return d.id.startsWith('v3_') || data?.tab === 'engine_builder'
                || data?.current_agent === 'agentv3' || data?.original_agent === 'agentv3';
            })
            .map((d) => {
              const data = d.data() as any;
              const sessionId = d.id.replace(/^v3_/, '');
              chatSessionMsgsRef.current.set(sessionId, Array.isArray(data.messages) ? data.messages : []);
              return {
                id: d.id,
                title: data.title || 'Untitled build',
                status: (data.status as string) || 'complete',
                workspaceId: `${prefix}${sessionId}`,
                updatedAt: data.lastUpdated ? (Date.parse(data.lastUpdated) || 0) : 0,
                // Marked when a previous open PROVED this pre-rebuild session's transcript is gone
                // everywhere — rendered honestly as lost instead of a chat that "won't open".
                deadTranscript: data.deadTranscript === true,
              } as ConversationMeta;
            });
        } catch { /* best-effort — the conversation-store list still shows below */ }
      }

      const sidOf = (c: ConversationMeta) =>
        (c.workspaceId && c.workspaceId.startsWith(prefix)) ? c.workspaceId.slice(prefix.length) : c.id;
      const bySession = new Map<string, ConversationMeta>();
      for (const c of chatItems) bySession.set(sidOf(c), c);   // baseline: every saved v5.0 session
      for (const c of items) bySession.set(sidOf(c), c);        // richer conversation-store record wins
      const merged = [...bySession.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      setHistoryItems(merged);
      // Only surface the conversation-store error when it produced NOTHING to show — if chat_sessions
      // gave us the history, a transient store error must not blank the list with a scary message.
      setHistoryError(merged.length > 0 ? null : (loadErr ?? null));
    } finally {
      setHistoryLoading(false);
    }
  };
  const toggleHistory = async () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next) await loadHistory();
  };
  // Open a specific saved conversation: load its thread + plan, and adopt its sessionId so a
  // follow-up continues THAT exact workspace/memory (same as the auto-restore of the most recent).
  // Allowed even while a build is actively streaming HERE — loadConversation() detaches from it (the
  // underlying server build, if any, keeps running in the background and stays resumable from History)
  // instead of silently no-op'ing until the current build finishes.
  const openConversation = async (id: string, opts?: { silent?: boolean }) => {
    // `silent` = the sticky-session AUTO-restore on open (not a user click): every "could not open"
    // outcome stays quiet (the panel simply remains a blank new chat) and NOTHING is ever branded —
    // but a genuinely-restored thread paints, and a still-running build still re-attaches live.
    const silent = opts?.silent === true;
    setOpenChatError(null);
    if (tapDebug) setLastTap((prev) => `${prev} | openConversation(${id.slice(0, 24)}…) FIRED`.slice(-180));
    // SWITCH GUARD: while a session switch is in flight, the chat_sessions save effect must NOT
    // run — after the clears below commit, sessionIdRef still points at the PREVIOUS session while
    // `convo` is already reduced, so the effect used to overwrite the previous chat's saved doc
    // with a shrunken thread (AI replies erased). That day-long, gradual corruption is why old
    // chats opened EMPTY. The finally below re-arms saving once the new session is fully adopted.
    sessionSwitchRef.current = true;
    setHistoryOpen(false);
    setMobileSheet(null); // opening from the mobile History sheet must also dismiss the sheet
    try {
      // DETACH the current build first (same as startNewSession): reset() aborts this UI's stream,
      // clears `running` (so the opened chat's composer is enabled, not stuck disabled) and bumps the
      // generation guard so the abandoned build can't re-attach over the one being opened. The server
      // build, if any, keeps running in the background and stays resumable from History — nothing is
      // killed. Without this, opening a chat during a (possibly stuck) build left `running` true and
      // the old stream still writing into the newly-opened session.
      reset();
      setWorkspaceFiles(null);
      setWorkspaceFilesFor(null); // clear the stale-switch tag so the new workspace's files load
      setSelectedFile(null);
      setAgentHistory([]);
      setCheckpointHistory([]);
      setFiles([]);
      // Session switch = full surface switch (same class as the "+New chat" leak): the opened chat
      // must not inherit the previous session's plan/advice threads, report history, git/ship state,
      // or preview. Its own durable framework is adopted just below when known.
      clearProjectSurfaces();
      setFramework('vite-react');
      const restored = await loadConversation({ userId, email, id });
      if (restored) {
        if (restored.workspaceId) {
          // The server may resolve a v3_ entry to its ANON-degraded workspace (agentv3-anon-<sid>) —
          // adopt the session id from EITHER prefix so a follow-up continues that exact project.
          for (const prefix of [`agentv3-${normalizeUid(userId)}-`, 'agentv3-anon-']) {
            if (restored.workspaceId.startsWith(prefix)) {
              const sid = restored.workspaceId.slice(prefix.length);
              if (sid) { sessionIdRef.current = sid; persistSessionId(sid); }
              break;
            }
          }
        }
        autoRestoredSessionRef.current = sessionIdRef.current; // explicit open → mark handled so auto-restore can't swap in the most-recent chat
        rehydratedWsRef.current = '';                          // re-arm file rehydrate for the opened workspace
        // Adopt the session's durable framework so a follow-up build/edit/deploy on a reopened
        // non-Vite session doesn't silently reset to vite-react (the framework-reset defect).
        if (restored.framework) { setFramework(restored.framework); setFrameworkExplicit(true); }
        // REATTACH-ON-REOPEN (test #5): if THIS session's build is still running server-side (the
        // user closed the tab/browser mid-build — the build keeps going by design), detect it now
        // so the auto-resume effect re-attaches its live stream immediately — instead of the user
        // discovering it via a "build already running" error when they try to type.
        if (restored.workspaceId) void checkRunning({ userId, email, workspaceId: restored.workspaceId });
        // AP-3: honestly flag a build that a restart cut off mid-flight (durable status still 'running').
        // The banner itself only renders when there's ALSO no live build (serverBuildRunning === false).
        setInterruptedResume(restored.unfinished === true);
        // Cross-cutover continuity: a pre-cutover session continued after the server became the
        // only transcript writer has its old turns ONLY in the frozen legacy chat_sessions copy.
        // When that legacy copy is provably disjoint from the server transcript, show it in front;
        // when it overlaps (old build sessions — copies in both stores), the server transcript wins.
        const legacy = chatSessionMsgsRef.current.get(sessionIdRef.current) ?? [];
        const legacyIsUser = (m: { sender?: string; role?: string }) => m.sender === 'user' || m.role === 'user';
        const legacyTs = (m: { timestamp?: string; ts?: number }) => m.ts ?? (m.timestamp ? (Date.parse(m.timestamp) || Date.now()) : Date.now());
        if (restored.messages.length > 0) {
          const prepend = legacyPrependMessages(
            legacy.map((m) => ({ text: m.text, isUser: legacyIsUser(m) })),
            restored.messages.map((m) => m.text),
          );
          setUserMsgs([
            ...prepend.filter((m) => m.role === 'user'),
            ...restored.messages,
          ].map((m) => ({ role: 'user' as const, text: m.text, ts: m.ts })));
          setAgentHistory(prepend.filter((m) => m.role !== 'user').map((m) => ({ role: 'agent' as const, text: m.text, ts: m.ts })));
        } else if (legacy.length > 0) {
          // The server record exists but returned no visible thread — the frozen legacy copy still
          // has it (pre-cutover session). Restore from it, read-only.
          setUserMsgs(legacy.filter(legacyIsUser).map((m) => ({ role: 'user' as const, text: m.text, ts: legacyTs(m) })));
          setAgentHistory(legacy.filter((m) => !legacyIsUser(m)).map((m) => ({ role: 'agent' as const, text: m.text, ts: legacyTs(m) })));
        } else {
          setUserMsgs([]);
          // The record exists but its thread is empty — opening it must not LOOK like a dead click.
          const why = conversationLoadDiag();
          if (why) console.error('[v3-open] empty transcript:', why);
          if (!silent) setOpenChatError(
            'This chat opened, but its saved transcript is empty (an earlier session-switch bug could erase saved messages — now fixed). Your project files and memory are safe: send a message to continue this project.'
            + (why ? `\n\nDiagnostic (send this to support): ${why}` : ''),
          );
        }
        return;
      }
      // FALLBACK: no server record — a PRE-cutover chat session (the plain-chat lane only started
      // persisting server-side at the single-source-of-truth cutover). Adopt its sessionId and
      // restore the frozen legacy thread stashed at list time (read-only); files rehydrate
      // automatically from the derived workspaceId (S4 effect).
      const sessionId = id.replace(/^v3_/, '');
      const saved = chatSessionMsgsRef.current.get(sessionId);
      if (!saved || saved.length === 0) {
        // NEVER a silent no-op (an empty [] stash is exactly as dead as a missing one): the tap DID
        // work and the open FAILED/restored nothing — say so, with the REAL server reason so this is
        // diagnosable in one click (404 = no transcript stored; 403 = ownership/token; empty = 0 turns).
        const why = conversationLoadDiag();
        if (why) console.error('[v3-open] could not restore:', why, 'id=', id);
        // A 404 alone is NOT proof of a destroyed transcript (IMG_5715: a chat built THE SAME HOUR was
        // permanently branded "Transcript lost" while its build was still running/saving). Probe whether
        // its build is STILL RUNNING and gate on the row's age BEFORE deciding (historyOpenPolicy):
        // running → re-attach live; young → honest "not saved yet" (no branding); old+idle → the
        // genuine pre-rebuild destroyed-transcript class (brand, as before).
        const row = historyItems.find((it) => it.id === id || it.id === `v3_${sessionId}`);
        let buildRunning = false;
        try {
          const params = new URLSearchParams();
          if (userId) params.set('userId', userId);
          if (email) params.set('email', email);
          if (row?.workspaceId) params.set('workspaceId', row.workspaceId);
          const probe = await fetch(`/api/agentv3/status?${params.toString()}`);
          const j = await probe.json().catch(() => ({} as Record<string, unknown>));
          buildRunning = row?.workspaceId ? (j as { buildRunningHere?: unknown })?.buildRunningHere === true : (j as { buildRunning?: unknown })?.buildRunning === true;
        } catch { /* probe unreachable — the age gate below still protects young chats from branding */ }
        const rowTs = row?.updatedAt ?? row?.createdAt;
        const action = historyOpen404Action({ ageMs: rowTs ? Date.now() - rowTs : Number.POSITIVE_INFINITY, buildRunning });
        if (action === 'resume-live') {
          // The user reopened an IN-FLIGHT chat — re-attach its live build instead of declaring it lost.
          sessionIdRef.current = sessionId;
          persistSessionId(sessionId);
          autoRestoredSessionRef.current = sessionId;
          rehydratedWsRef.current = '';
          await resumeBuild({ userId, email, workspaceId: row?.workspaceId, notice: 'This build is still running — re-attached to it live below.' });
          return;
        }
        if (silent) return; // sticky auto-restore of a chat with nothing saved yet (resume-live already returned above) → quietly stay a blank new chat, never brand
        if (action === 'not-saved-yet') {
          if (saved) {
            // Adopt the session so "send a message to continue" genuinely continues THIS project.
            sessionIdRef.current = sessionId;
            persistSessionId(sessionId);
            autoRestoredSessionRef.current = sessionId;
            rehydratedWsRef.current = '';
          }
          setOpenChatError(
            "This chat's transcript hasn't reached the server yet — the build may have just finished or is still saving. Nothing is lost: try opening it again in a moment, or send a message to continue this project."
            + (why ? `\n\nDiagnostic (send this to support): ${why}` : ''),
          );
          return;
        }
        setOpenChatError(
          (saved
            ? 'This is an OLD chat from before the history fix — its messages were destroyed by the earlier bug and cannot be recovered. It is now marked "Transcript lost" in the list. Your project files and memory are safe; every chat from today onward is saved permanently. Send a message to continue this project.'
            : 'This chat could not be opened: its saved transcript was not returned by the server (it may belong to a different sign-in state) and no local copy was stashed. Pull down to refresh, sign in again, or send a new message to continue the project.')
          + (why ? `\n\nDiagnostic (send this to support): ${why}` : ''),
        );
        if (saved) {
          // PROVABLY dead: no server record under any candidate id AND the legacy copy is empty —
          // a pre-rebuild session the old eraser destroyed. Mark the row durably (metadata field —
          // the single-writer rule only forbids transcript writes) so the list stops presenting it
          // as an ordinary chat that mysteriously "won't open" on every future visit.
          void setDoc(doc(db, 'chat_sessions', `v3_${sessionId}`), { deadTranscript: true }, { merge: true })
            .catch(() => { /* best-effort */ });
          setHistoryItems((prev) => prev.map((item) => (
            item.id === `v3_${sessionId}` || item.id === id ? { ...item, deadTranscript: true } : item
          )));
          // Still adopt the session so "send a message to continue" genuinely continues THIS project.
          sessionIdRef.current = sessionId;
          persistSessionId(sessionId);
          autoRestoredSessionRef.current = sessionId;
          rehydratedWsRef.current = '';
        }
        return;
      }
      sessionIdRef.current = sessionId;
      persistSessionId(sessionId);
      autoRestoredSessionRef.current = sessionId;
      rehydratedWsRef.current = '';
      const toTs = (m: { timestamp?: string; ts?: number }) => m.ts ?? (m.timestamp ? (Date.parse(m.timestamp) || Date.now()) : Date.now());
      const isUser = (m: { sender?: string; role?: string }) => m.sender === 'user' || m.role === 'user';
      setUserMsgs(saved.filter(isUser).map((m) => ({ role: 'user' as const, text: m.text, ts: toTs(m) })));
      setAgentHistory(saved.filter((m) => !isUser(m)).map((m) => ({ role: 'agent' as const, text: m.text, ts: toTs(m) })));
    } finally {
      sessionSwitchRef.current = false;
    }
  };
  const newChatFromHistory = () => { setHistoryOpen(false); setMobileSheet(null); startNewSession(); };
  // Delete a saved session from the history list. Confirms first (destructive + irreversible —
  // the Firestore record and its transcript are gone). If the deleted session is the one currently
  // open, starts a fresh session so the panel never keeps showing a chat that no longer exists.
  const handleDeleteConversation = async (e: React.MouseEvent, c: ConversationMeta) => {
    e.stopPropagation();
    if (deletingHistoryId) return;
    if (!window.confirm(`Delete "${c.title || 'Untitled chat'}"? This cannot be undone.`)) return;
    setDeletingHistoryId(c.id);
    try {
      const ok = await deleteConversation(c.id, { userId, email });
      if (ok) {
        // Also remove the chat_sessions row (list metadata + any frozen legacy transcript copy)
        // so the deleted session can't ghost back into either history list. Best-effort — the
        // server record (the source of truth) is already gone.
        const anonPrefix = 'agentv3-anon-';
        const ownPrefix = `agentv3-${normalizeUid(userId)}-`;
        const sid = c.workspaceId?.startsWith(ownPrefix) ? c.workspaceId.slice(ownPrefix.length)
          : c.workspaceId?.startsWith(anonPrefix) ? c.workspaceId.slice(anonPrefix.length)
          : c.id.replace(/^v3_/, '');
        void deleteDoc(doc(db, 'chat_sessions', `v3_${sid}`)).catch(() => { /* best-effort */ });
        chatSessionMsgsRef.current.delete(sid);
        setHistoryItems((prev) => prev.filter((item) => item.id !== c.id && item.id !== `v3_${sid}`));
        if (c.workspaceId && c.workspaceId === state.workspaceId) startNewSession();
      }
    } finally {
      setDeletingHistoryId(null);
    }
  };
  // Pin / unpin a saved session. Optimistic: flip the local `pinned` flag immediately (so the row
  // jumps to/from the Pinned section without a reload), then persist. On failure, revert. Pinning
  // never changes updatedAt, so the row keeps its real "time ago".
  const handleTogglePin = async (e: React.MouseEvent, c: ConversationMeta) => {
    e.stopPropagation();
    if (pinningHistoryId) return;
    const next = !c.pinned;
    setPinningHistoryId(c.id);
    setHistoryItems((prev) => prev.map((item) => (item.id === c.id ? { ...item, pinned: next } : item)));
    try {
      const result = await pinConversation(c.id, { userId, email, pinned: next });
      if (result === null) {
        // Persist failed — revert the optimistic flip so the UI never lies about pinned state.
        setHistoryItems((prev) => prev.map((item) => (item.id === c.id ? { ...item, pinned: c.pinned } : item)));
      }
    } finally {
      setPinningHistoryId(null);
    }
  };
  const relTime = (ts?: number): string => {
    if (!ts || typeof ts !== 'number') return '';
    const m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  };

  // Header tab pill: tapping a surface opens the workspace on it; tapping the
  // already-active pill collapses the workspace back to full-width chat.
  const openTab = (t: SurfaceTab) => {
    if (showWorkspace && tab === t) {
      setShowWorkspace(false);
      return;
    }
    setTab(t);
    setShowWorkspace(true);
  };
  // ── Mobile footer (admin 2026-07-07): v5.0 owns the app's bottom nav while it is the active view.
  // One sheet at a time: the footer's History and More items open bottom sheets anchored above the
  // nav; any footer navigation action closes them.
  const [mobileSheet, setMobileSheet] = useState<null | 'history' | 'more' | 'report'>(null);
  const openSurfaceFromFooter = (t: SurfaceTab) => {
    setMobileSheet(null);
    setTab(t);
    setShowWorkspace(true); // explicit open (never the toggle-collapse openTab does on re-tap)
  };
  // U3 (audit): error/failure banners must offer a next step, not dead-end. Prefill the composer with a
  // repair instruction, bring the chat into view, and focus — the user reviews and hits send (no
  // surprise auto-spend). Mirrors the existing sidebar "Fix with AI" prefill.
  const fixWithAI = (text: string) => {
    setPrompt(text);
    setShowWorkspace(false);
    setTimeout(() => composerRef.current?.focus(), 0);
  };
  const anyToggleOn = planFirst || thinking || onlyOpus;


  // Download the LAST build's diagnostics report (every issue v5.0 hit — provider fallbacks,
  // tool errors, "replied without building" nudges, readiness blockers, sandbox problems) as
  // JSON, so the admin can hand it to Claude and the rough edges get fixed in code.
  const [downloadingDiag, setDownloadingDiag] = useState(false);
  // Resolve the freshest diagnostics report. Prefer the SERVER copy: it is durable (survives a Cloud
  // Run instance rotation / reload, #657) AND fresher than the client's build-end copy — crucially it
  // carries PREVIEW errors captured AFTER the build finished (#666), which the client copy never sees.
  // Fall back to the client's local copy only if the server has nothing (e.g. a stream that dropped
  // mid-build before the durable save).
  // P-REPORT.4 — history: which past build's report to read instead of "latest" (null = latest).
  // Lets a small/quick recent build never permanently hide a previous, richer report.
  const [selectedHistoryBuildId, setSelectedHistoryBuildId] = useState<string | null>(null);
  const [historyReportOpen, setHistoryReportOpen] = useState(false);
  const [historyReportItems, setHistoryReportItems] = useState<Array<{ id: string; startedAt: number; endedAt?: number; ok?: boolean; rootCause?: string }>>([]);
  const [historyReportLoading, setHistoryReportLoading] = useState(false);
  const toggleHistoryReport = async () => {
    const next = !historyReportOpen;
    setHistoryReportOpen(next);
    if (next && state.workspaceId) {
      setHistoryReportLoading(true);
      try {
        const params = new URLSearchParams({ workspaceId: state.workspaceId, history: '1' });
        if (userId) params.set('userId', userId);
        if (email) params.set('email', email);
        const res = await fetch(`/api/agentv3/diagnostics?${params.toString()}`, { headers: await authJsonHeaders() });
        const data = await res.json().catch(() => ({}));
        setHistoryReportItems(Array.isArray(data?.history) ? data.history : []);
      } catch { setHistoryReportItems([]); }
      finally { setHistoryReportLoading(false); }
    }
  };

  const getLatestDiagnostics = useCallback(async (buildId?: string | null): Promise<unknown> => {
    try {
      const params = new URLSearchParams();
      if (userId) params.set('userId', userId);
      if (email) params.set('email', email);
      if (state.workspaceId) params.set('workspaceId', state.workspaceId);
      if (buildId) params.set('buildId', buildId);
      // P0 — for the LATEST-report path (no specific history buildId), assert the ACTIVE build's identity
      // so the server returns THIS build's report or aborts — never a previous, different app's report.
      else {
        if (state.buildId) params.set('activeBuildId', state.buildId);
        if (state.promptHash) params.set('promptHash', state.promptHash);
      }
      const res = await fetch(`/api/agentv3/diagnostics?${params.toString()}`, { headers: await authJsonHeaders() });
      if (res.ok) {
        const data = await res.json() as { diagnostics?: unknown };
        if (data.diagnostics) return data.diagnostics;
      }
    } catch { /* fall through to the local copy */ }
    // Latest-report fallbacks: the live state's copy, then the DEVICE-LOCAL cache (saved the moment
    // any report reached this device) — the last-resort layer that makes "No build report" impossible
    // on the device where the build ran, even fully offline (admin 2026-07-11, pukhta prabandh).
    return buildId ? null : (state.diagnostics ?? readLastReport());
  }, [userId, email, state.workspaceId, state.diagnostics, state.buildId, state.promptHash]);

  // Persist every report that reaches this device (rides the live result event) into the local
  // last-resort cache — see reportCache.ts. Quota-safe; never throws.
  useEffect(() => {
    if (state.diagnostics) saveLastReport(state.diagnostics);
  }, [state.diagnostics]);

  // mode 'download' saves the report JSON as a file; 'copy' (admin 2026-07-12 — re-add the removed
  // "Copy build report" button) writes the SAME resolved report to the clipboard. All the resolution
  // logic below is shared, so copy and download always carry the identical report.
  const downloadDiagnostics = async (mode: 'download' | 'copy' = 'download') => {
    if (downloadingDiag) return;
    setDownloadingDiag(true);
    try {
      let payload: unknown;
      if (selectedHistoryBuildId) {
        // A specific past build picked from the History dropdown → just that build's report.
        payload = await getLatestDiagnostics(selectedHistoryBuildId);
        if (!payload) { alert('No diagnostics found for that build.'); return; }
      } else if (state.workspaceId) {
        // Admin 2026-07-06 ("starting se lekar last tak"): default = the WHOLE session JSON — every
        // build 0 → last, stitched together — not just the latest message's build. The server keeps
        // each build in a durable per-workspace history behind the "latest" doc; scope=session
        // aggregates it (byte-budgeted server-side so mobile Safari can actually load it).
        //
        // DELIVERY GUARANTEE (admin 2026-07-06, "bas build report milni chahiye"): the session stitch
        // is the PREFERRED payload, never the only path. If its fetch fails for ANY reason (network
        // drop, an oversized response, a server hiccup), fall back to the single LATEST report
        // (getLatestDiagnostics: server latest → per-user durable copy → the client's local copy) so
        // the user still gets a report — a slightly smaller report always beats no report.
        try {
          const params = new URLSearchParams({ workspaceId: state.workspaceId, scope: 'session' });
          if (userId) params.set('userId', userId);
          if (email) params.set('email', email);
          // P0 — assert the active build so the session stitch's per-user fallback can't splice in a
          // previous, different app's report when this workspace's own history is momentarily empty.
          if (state.buildId) params.set('activeBuildId', state.buildId);
          if (state.promptHash) params.set('promptHash', state.promptHash);
          const res = await fetch(`/api/agentv3/diagnostics?${params.toString()}`, { headers: await authJsonHeaders() });
          if (res.ok) payload = await res.json();
        } catch { /* session stitch failed — the latest-report fallback below still delivers */ }
        if (!payload) {
          payload = await getLatestDiagnostics(null);
          if (!payload) { alert('No build report yet — build an app first, then download the report.'); return; }
        }
      } else if (userMsgs.length === 0 && agentHistory.length === 0) {
        // BLANK NEW CHAT (admin 2026-07-12, "+New chat" leak): zero messages + no workspace = this
        // chat has never built anything, so it honestly has NO report. Without this guard the
        // per-user "latest" fallback below would hand back the PREVIOUS project's report here.
        alert('No build report yet in this chat — build an app first, then download the report.');
        return;
      } else {
        // NO LIVE WORKSPACE (a reopened/remounted panel — Fix 26, the "No build report yet" after a
        // finished build, 2026-07-07): the report is stored per-WORKSPACE, and this session's workspace
        // is derivable even without a live build. Try the session-derived candidates (user-keyed, then
        // the anon-degraded twin) BEFORE the per-user "latest" fallback, which misses anon-run builds.
        for (const wsId of [clientWorkspaceId(userId, sessionIdRef.current), clientWorkspaceId(undefined, sessionIdRef.current)]) {
          if (!wsId || payload) continue;
          try {
            const params = new URLSearchParams({ workspaceId: wsId, scope: 'session' });
            if (userId) params.set('userId', userId);
            if (email) params.set('email', email);
            const res = await fetch(`/api/agentv3/diagnostics?${params.toString()}`, { headers: await authJsonHeaders() });
            if (res.ok) {
              const j = await res.json();
              // The session stitch returns an empty shell when the workspace has no reports — only
              // adopt a payload that actually carries content.
              if (j && (Array.isArray(j.builds) ? j.builds.length > 0 : true)) payload = j;
            }
          } catch { /* try the next candidate / the latest-report fallback */ }
        }
        if (!payload) payload = await getLatestDiagnostics(null);
        if (!payload) { alert('No build report yet — build an app first, then download the report.'); return; }
      }
      const reportText = JSON.stringify(payload, null, 2);
      if (mode === 'copy') {
        // Copy the full report JSON to the clipboard (re-added button). Falls back to a hidden textarea
        // + execCommand when the async Clipboard API is unavailable (older / insecure-context WebViews).
        let copied = false;
        try { await navigator.clipboard.writeText(reportText); copied = true; } catch { /* fall through */ }
        if (!copied) {
          try {
            const ta = document.createElement('textarea');
            ta.value = reportText; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select(); copied = document.execCommand('copy'); document.body.removeChild(ta);
          } catch { copied = false; }
        }
        alert(copied ? '✅ Build report copied to clipboard.' : 'Could not copy — try the Download button instead.');
      } else {
        // iOS Safari IGNORES <a download> (nothing saves) — deliverTextFile prefers the Web Share API
        // (share sheet → "Save to Files") on mobile and falls back to the anchor download on desktop.
        await deliverTextFile(`navbharatai-v3-build-diagnostics-${Date.now()}.json`, reportText);
      }
    } catch (e) {
      alert(`Could not ${mode === 'copy' ? 'copy' : 'download'} the report: ${e instanceof Error ? e.message : String(e)}.`);
    } finally {
      setDownloadingDiag(false);
    }
  };

  // REPORT TO ADMIN (admin 2026-07-29): the build report is ADMIN-ONLY now. The user can no longer
  // see, download or copy it — a single "Report" button submits the current build's report to the
  // admin inbox (POST /api/agentv3/report-to-admin), which resolves + snapshots it server-side. The
  // user gets only an acknowledgement; the report content never reaches the client. (The older
  // download/copy/history helpers above are no longer wired to any UI and are retained dormant to
  // avoid a risky large deletion in this file — they can be removed in a dedicated cleanup.)
  //
  // PICK WHICH BUILD (admin 2026-08-04): a chat is many builds — the first build and every edit
  // after it. "Report" could only ever send the LATEST one, so a bug from three edits ago was
  // unreportable: the user clicked Report and we received a report about a different, working build.
  // Clicking Report now opens the list of this chat's builds and they choose the one that broke.
  //
  // This does NOT re-open the report to users. Each row shows only what the user already watched
  // happen — when it ran, what they asked for, whether it worked (see `pickerItems`). Our analysis,
  // and every provider name in it, stays admin-only exactly as before.
  const [reportSending, setReportSending] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const [reportPickerOpen, setReportPickerOpen] = useState(false);
  const [reportPickerItems, setReportPickerItems] = useState<ReportPickerItem[]>([]);
  const [reportPickerLoading, setReportPickerLoading] = useState(false);
  // SEND COUNT (admin 2026-08-04, "report (1), report (2) aise — jisse duplicate report na ho"): the
  // old button flashed "Report sent" for 4s and then looked untouched again, so a user who missed the
  // flash re-sent the same build's report. The count is per BUILD and persisted, so the button tells
  // the truth after a reload too. See reportSendCount.ts.
  const reportIdKey = reportKey(state.workspaceId, state.buildId);
  const [reportCount, setReportCount] = useState(0);
  useEffect(() => { setReportCount(reportSendCount(reportIdKey)); }, [reportIdKey]);
  // The count belongs to the build that was actually REPORTED. A picked past build carries its own
  // `buildId`, so choosing it from the list counts against THAT build — not the one on screen — and
  // the header button keeps telling the truth about the current build.
  const countKeyFor = (picked?: ReportPickerItem): string =>
    reportKey(state.workspaceId, picked ? (picked.buildId || picked.id) : state.buildId);
  const sendReportToAdmin = useCallback(async (picked?: ReportPickerItem) => {
    if (reportSending) return;
    setReportSending(true);
    try {
      const body: Record<string, string> = {};
      if (state.workspaceId) body.workspaceId = state.workspaceId;
      // A picked past build resolves to exactly that report; without one the server falls back to the
      // latest, guarded by the active build's identity so it can't be a different app's report.
      if (picked) body.buildId = picked.id;
      if (state.buildId) body.activeBuildId = state.buildId;
      if (state.promptHash) body.promptHash = state.promptHash;
      const res = await fetch('/api/agentv3/report-to-admin', {
        method: 'POST',
        headers: { ...(await authJsonHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        setReportPickerOpen(false);
        // Count ONLY a genuinely accepted submission — a failed send must never inflate the tally
        // (the whole point of the number is that the user can trust it).
        const bumped = bumpReportSendCount(countKeyFor(picked));
        // Only move the HEADER's number when the header's build is the one that was reported.
        if (!picked || (picked.buildId || picked.id) === state.buildId) setReportCount(bumped);
        setReportSent(true);
        setTimeout(() => setReportSent(false), 4000);
      } else {
        alert(data?.error || 'Could not send the report right now — please try again in a moment.');
      }
    } catch (e) {
      alert(`Could not send the report: ${e instanceof Error ? e.message : String(e)}.`);
    } finally {
      setReportSending(false);
    }
  }, [reportSending, state.workspaceId, state.buildId, state.promptHash]);

  // Open the picker. One build in this chat means there is nothing to choose — sending straight away
  // keeps the common case a single click, which is what it has always been.
  // `surface` — the same list, shown where the tap came from: a popover under the desktop button, a
  // bottom sheet on mobile (a popover anchored to a footer button is unusable on a phone).
  const openReportPicker = useCallback(async (surface: 'popover' | 'sheet' = 'popover') => {
    if (reportSending || reportPickerLoading) return;
    if (!state.workspaceId) return;
    setReportPickerLoading(true);
    let builds: ReportPickerItem[] = [];
    try {
      const params = new URLSearchParams({ workspaceId: state.workspaceId, picker: '1' });
      if (userId) params.set('userId', userId);
      if (email) params.set('email', email);
      const res = await fetch(`/api/agentv3/diagnostics?${params.toString()}`, { headers: await authJsonHeaders() });
      const data = await res.json().catch(() => ({}));
      builds = Array.isArray(data?.builds) ? data.builds as ReportPickerItem[] : [];
    } catch { /* the list is a convenience — a failed fetch still reports the latest build below */ }
    finally { setReportPickerLoading(false); }
    setReportPickerItems(builds);
    // Fewer than two choices (including a history that hasn't landed yet, or a failed fetch) → send
    // the current build, exactly as the button did before. The picker must never become a wall
    // between the user and reporting a problem.
    if (builds.length < 2) { void sendReportToAdmin(); return; }
    if (surface === 'sheet') setMobileSheet('report');
    else setReportPickerOpen(true);
  }, [reportSending, reportPickerLoading, state.workspaceId, userId, email, sendReportToAdmin]);

  // One list, rendered by both surfaces — so the desktop popover and the mobile sheet can never drift
  // into showing different things (the drift that lets a field leak on one surface only).
  const reportPickerRows = (onPick: (b: ReportPickerItem) => void, mobile: boolean) => reportPickerItems.map((b, i) => {
    // Each row carries its OWN send count, so the duplicate-report guard works per build — the
    // reason the picker exists is that different builds are different problems.
    const sent = reportSendCount(countKeyFor(b));
    return (
      <button
        key={b.id}
        onClick={() => onPick(b)}
        disabled={reportSending}
        className={`w-full text-left hover:bg-zinc-800 disabled:opacity-40 border-b border-zinc-800/60 last:border-b-0 ${mobile ? 'px-4 py-3 touch-manipulation' : 'px-3 py-2'}`}
      >
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${b.ok === false ? 'bg-rose-400' : 'bg-emerald-400'}`} />
          <span className={`text-zinc-200 truncate ${mobile ? 'text-sm' : 'text-xs'}`}>{b.label}</span>
        </div>
        <div className="mt-0.5 pl-3.5 text-[10px] text-zinc-500">
          {i === 0 ? 'Latest · ' : ''}{new Date(b.startedAt).toLocaleString()}
          {sent > 0 && <span className="text-emerald-400/80"> · already sent{sent > 1 ? ` (${sent})` : ''}</span>}
        </div>
      </button>
    );
  });

  // ── Mobile footer API (admin 2026-07-07): registration moved BELOW the workspaceFiles state
  // declaration (it feeds the Files count + green-dot signal) — see the effect after it.
  useEffect(() => () => { onFooterApi?.(null); }, [onFooterApi]);

  // R5 §5.1 — the app's permanent LIVE deployment URL (Firebase Hosting). Restored durably from the
  // server so it survives a reconnect/new session, not just the current build stream.
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  // Hosting Phase 1 — the "Publish" chooser (host on NavBharatAI vs bring-your-own), opened from Deploy.
  const [showHostingChooser, setShowHostingChooser] = useState(false);

  // Fetch the persisted live URL whenever the workspace changes or a build/deploy finishes.
  useEffect(() => {
    const wsId = state.workspaceId;
    if (!wsId) return;
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams({ workspaceId: wsId });
        if (userId) params.set('userId', userId);
        if (email) params.set('email', email);
        const res = await fetch(`/api/agentv3/deployment?${params.toString()}`, { headers: await authJsonHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && typeof data?.url === 'string' && data.url) setLiveUrl(data.url);
      } catch { /* best-effort — no live URL shown */ }
    })();
    return () => { cancelled = true; };
  }, [state.workspaceId, state.done, userId, email]);

  // R5 §5.1 (no lock-in) — the hosting providers available + which the user picked. Fetched once;
  // only CONFIGURED providers are offered so a deploy can never target an unconfigured host.
  const [providers, setProviders] = useState<Array<{ id: string; name: string; configured: boolean; requirement: string }>>([]);
  const [deployProvider, setDeployProvider] = useState<string>('firebase');
  // Slice 3: whether the Firebase-native "connect your own domain" surface is live (server flag).
  const [customDomainsEnabled, setCustomDomainsEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams();
        if (userId) params.set('userId', userId);
        if (email) params.set('email', email);
        try { if (localStorage.getItem('gh_token')) params.set('hasGithub', 'true'); } catch { /* ignore */ }
        const res = await fetch(`/api/agentv3/deploy-providers?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (!cancelled && Array.isArray(data?.providers)) {
          setProviders(data.providers);
          if (typeof data.default === 'string') setDeployProvider(data.default);
          if (typeof data.customDomains === 'boolean') setCustomDomainsEnabled(data.customDomains);
        }
      } catch { /* best-effort — default to Firebase */ }
    })();
    return () => { cancelled = true; };
  }, [userId, email]);
  const configuredProviders = providers.filter((p) => p.configured);

  // One-click deploy: drive the REAL build+deploy pipeline (the agent runs `npm run build` then the
  // deploy tool, publishing to the CHOSEN provider's permanent public URL). Routed through the normal
  // stream so the user watches real progress; the live URL is then refreshed from the server.
  /**
   * Start a real publish. Returns an HONEST reason when it could NOT start, null when it did.
   *
   * ROOT CAUSE (admin 2026-08-02): this used to be `if (running || !state.workspaceId) return;` — a
   * SILENT no-op. The Publish modal closed itself first, so the user tapped a button, the sheet
   * vanished, and nothing happened: "sabhi button farzi hai". The precondition is now a reported
   * value (src/lib/deployGuard.ts) that every caller must surface — never a hidden branch.
   */
  /** Live state of the direct publish, so the button can report honestly instead of vanishing. */
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState('');

  /**
   * Start a real publish. Returns an HONEST reason when it could NOT start, null when it did.
   *
   * ROOT CAUSE (admin 2026-08-11: "publish button kisi kaam ka nahi hai"). This used to send the CHAT
   * PROMPT "run npm run build, then call the deploy tool" and hope the model complied. Publishing is a
   * DETERMINISTIC operation, and routing it through a language model made it non-deterministic (the
   * model might not call the tool at all), slow, and BILLED — for something that should cost nothing.
   * It now calls the server directly; the model is not involved.
   */
  const deployLive = (providerOverride?: string): string | null => {
    const prov0 = providerOverride || deployProvider;
    const blocked = deployBlockedReason({
      running,
      workspaceId: state.workspaceId,
      providerConfigured: configuredProviders.some((p) => p.id === prov0),
      providerName: providers.find((p) => p.id === prov0)?.name,
    });
    if (blocked) return blocked;
    if (publishing) return 'Your app is already being published — one moment.';
    if (providerOverride) setDeployProvider(providerOverride);

    setPublishing(true);
    setPublishMsg('Building your app…');
    void (async () => {
      try {
        let githubToken: string | undefined;
        try { githubToken = localStorage.getItem('gh_token') || undefined; } catch { /* optional */ }
        const res = await fetch('/api/agentv3/publish', {
          method: 'POST',
          headers: await authJsonHeaders(),
          body: JSON.stringify({ workspaceId: state.workspaceId, userId, email, deployProvider: prov0, githubToken }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // The server's own reason, verbatim — a generic "publish failed" is what made this button
          // feel dead. A build error carries the compiler's real output.
          setPublishMsg(data?.detail ? `${data.error}\n\n${data.detail}` : (data?.error || 'Could not publish your app.'));
          return;
        }
        if (typeof data?.url === 'string' && data.url) setLiveUrl(data.url);
        setPublishMsg(data?.url ? `Your app is live at ${data.url}` : (data?.message || 'Published.'));
      } catch (e) {
        setPublishMsg(e instanceof Error ? e.message : String(e));
      } finally {
        setPublishing(false);
      }
    })();
    return null;
  };

  // "Restore all files" — genuinely bring the whole project back into the workspace (the server
  // writes the durably-saved files back in), then show the real file list. Honest status, no fake.
  const [restoring, setRestoring] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState<string>('');
  const handleRestoreAll = async () => {
    if (restoring || !state.workspaceId) return;
    setRestoring(true);
    setRestoreMsg('');
    try {
      const r = await restoreAllFiles();
      if (!r.ok) { setRestoreMsg('Could not restore — please try again in a moment.'); return; }
      if (r.count === 0) { setRestoreMsg('No saved files found to restore for this project yet.'); return; }
      setRestoreMsg(r.restored ? `Restored ${r.count} file(s) into your workspace.` : `${r.count} file(s) are in your workspace.`);
      setTab('files');
      setShowWorkspace(true);
    } finally {
      setRestoring(false);
    }
  };

  // ── File-content viewer + sidebar sync ────────────────────────────────────
  // The Files surface only carries paths (state.files); the actual contents live
  // in the sandbox. We pull them on demand from the existing read endpoint, cache
  // them, and reuse the same map both to (a) show a file's content when clicked
  // and (b) sync the built project into the main app's Files view (onFilesSync).
  const [workspaceFiles, setWorkspaceFiles] = useState<Record<string, string> | null>(null);
  // ── Mobile footer API (admin 2026-07-07): register the panel's REAL actions with the app-level
  // bottom nav — the same code paths the desktop header uses (openTab, the history loader, the
  // diagnostics download). Re-registered whenever the active surface changes so the nav's highlight
  // tracks reality; unregistered on unmount (effect above) so a closed v5.0 never leaves stale
  // footer buttons. Lives below the workspaceFiles declaration it reads (TDZ).
  useEffect(() => {
    if (!onFooterApi) return;
    const realFileCount = state.files.length || (workspaceFiles ? Object.keys(workspaceFiles).length : 0);
    onFooterApi({
      section: footerSection(showWorkspace, tab),
      openHistory: () => {
        if (mobileSheet === 'history') { setMobileSheet(null); return; } // re-tap closes, no refetch
        setMobileSheet('history');
        void loadHistory();
      },
      openChat: () => { setMobileSheet(null); setShowWorkspace(false); },
      openPreview: () => openSurfaceFromFooter('preview'),
      openFiles: () => openSurfaceFromFooter('files'),
      openMore: () => setMobileSheet(mobileSheet === 'more' ? null : 'more'),
      // Admin 2026-07-07 — real state, never faked: the green dot fires only when the app is
      // genuinely viewable (live URL, or a finished OK build with real files), and the Files badge
      // shows the ACTUAL built/restored file count (live build list, else the rehydrated store).
      previewReady: previewReadySignal(!!state.previewUrl, state.done, state.ok, realFileCount),
      fileCount: realFileCount,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onFooterApi, showWorkspace, tab, reportSending, openReportPicker, mobileSheet, state.previewUrl, state.done, state.ok, state.files.length, workspaceFiles]);
  // Which workspaceId the cached `workspaceFiles` belong to. Guards a race: on a fast session switch,
  // an in-flight load for the OLD workspace could set `workspaceFiles`, then the rehydrate effect would
  // see it non-null and skip loading the NEW workspace — leaving stale files visible. Comparing this to
  // the current workspace makes the guard workspace-specific.
  const [workspaceFilesFor, setWorkspaceFilesFor] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string>('');
  // Heavy generated dirs are never shown/synced — the user cares about source.
  const FILE_EXCLUDE = /^(node_modules\/|\.git\/|dist\/|build\/|\.next\/|__pycache__\/)/;

  const loadWorkspaceFiles = async (wsIdArg?: string): Promise<Record<string, string> | null> => {
    // On a COLD reopen there is no live build yet, so state.workspaceId is empty — derive the durable
    // workspaceId from the session so files still rehydrate from storage (the server falls back to the
    // saved file store when the sandbox is cold). An explicit arg wins (the rehydrate effect passes it).
    // ANON PARITY (Fix 26): the anon identity derives its real `agentv3-anon-<sid>` workspace too.
    const wsId = wsIdArg || state.workspaceId || clientWorkspaceId(userId, sessionIdRef.current);
    if (!wsId) return null;
    // IDENTITY-DEGRADATION FALLBACK (Fix 26 — the "tab switch → sab gayab" wipe, 2026-07-07): a build
    // that ran while the auth token was transiently missing lives under `agentv3-anon-<sid>`, but a
    // signed-in client derives `agentv3-<uid>-<sid>` — a DIFFERENT, empty workspace. The transcript
    // reads already try both candidates (candidateConversationIds, #829/#837); files must do the
    // same, or the panel shows 0 files while every file sits safely in the durable store.
    const sid = sessionIdRef.current;
    const anonCandidate = clientWorkspaceId(undefined, sid);
    const candidates = [wsId, ...(anonCandidate && anonCandidate !== wsId && wsId === clientWorkspaceId(userId, sid) ? [anonCandidate] : [])];
    let lastError: unknown = null;
    for (const candidate of candidates) {
      try {
        const res = await fetch('/api/agentv3/workspace-files', {
          method: 'POST',
          headers: await authJsonHeaders(),
          body: JSON.stringify({ workspaceId: candidate, userId, email }),
        });
        if (!res.ok) throw new Error(`server returned ${res.status}`);
        const data = await res.json() as { files?: Record<string, string> };
        const files = data.files ?? {};
        if (Object.keys(files).length === 0 && candidate !== candidates[candidates.length - 1]) continue; // empty → try the anon-degraded candidate
        setWorkspaceFiles(files);
        setWorkspaceFilesFor(candidate); // tag which workspace these files belong to (stale-switch guard)
        return files;
      } catch (e) {
        lastError = e;
      }
    }
    setFileError(lastError instanceof Error ? lastError.message : 'Failed to load file contents');
    return null;
  };

  // Open a file in the viewer — fetch contents once, then read from cache.
  const openFile = async (path: string) => {
    setSelectedFile(path);
    setFileError('');
    if (workspaceFiles && path in workspaceFiles) return;
    setFileLoading(true);
    await loadWorkspaceFiles();
    setFileLoading(false);
  };

  // Sidebar sync (Task 2): when a build finishes, pull the real file contents and
  // push the source files up so they also appear in the app's main Files view.
  useEffect(() => {
    if (!state.done || !state.workspaceId || state.files.length === 0) return;
    let cancelled = false;
    loadWorkspaceFiles().then((files) => {
      if (cancelled || !files || !onFilesSync) return;
      const source = Object.fromEntries(
        Object.entries(files).filter(([p]) => !FILE_EXCLUDE.test(p)),
      );
      if (Object.keys(source).length > 0) onFilesSync(source);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.done, state.workspaceId]);

  // Lift the v5.0 preview state (live URL + workspace) up to the app shell so the MAIN slide-out
  // "Preview" menu can render the SAME working v5.0 preview — not the retired v2.0 generatedCode.
  // `framework`/`running` are ALSO lifted (2026-07-01) so the sidebar's PreviewSurface can reach full
  // feature parity with this in-panel one (auto-resume + framework-aware Diagnose need them).
  useEffect(() => {
    onPreviewState?.({ previewUrl: state.previewUrl, workspaceId: state.workspaceId, framework, running });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.previewUrl, state.workspaceId, framework, running]);

  // U5 (audit 2026-07-05): the payoff moment — the user's app becoming viewable — was hidden behind a
  // tap. Auto-open the Preview surface the FIRST time a build produces a live preview URL. Desktop only
  // (split view): on a phone opening the workspace hides the chat (that's gap U2), so mobile keeps the
  // chat + streaming progress and the user taps Preview when ready. Once (a ref) so closing it sticks.
  const autoOpenedPreviewRef = useRef(false);
  useEffect(() => {
    if (state.previewUrl && !autoOpenedPreviewRef.current && !isTouchDevice) {
      autoOpenedPreviewRef.current = true;
      setTab('preview');
      setShowWorkspace(true);
    }
  }, [state.previewUrl, isTouchDevice]);

  // U1 (audit Batch 4): a monotonic signal that bumps on every file write / diff, so the open Preview
  // surface can AUTO-REFRESH as the build progresses (see PreviewSurface's reloadSignal). The reducer
  // hands `state.files` / `state.diffs` a fresh identity on each file_changed / diff event, so watching
  // their reference is a faithful "the app just changed" trigger (PreviewSurface debounces the reload).
  const [filesVersion, setFilesVersion] = useState(0);
  useEffect(() => { setFilesVersion((v) => v + 1); }, [state.files, state.diffs]);

  // B7 — persist the composer draft on every keystroke so a reload (incl. B8's prompt SW-update
  // reloads, or a phone backgrounding the tab) never loses unsent text. Sending clears `prompt`, which
  // clears the stored draft too (saveDraft removes it on empty). Best-effort; never blocks typing.
  useEffect(() => { saveDraft(prompt); }, [prompt]);

  // "Fix with AI" clicked from the SIDEBAR preview (outside this panel's own UI) — prefill the chat
  // input with the error and bring the chat into view, mirroring this panel's OWN onFixError handler
  // for its in-panel Preview tab (below). Fires on each new pendingFix (nonce change).
  useEffect(() => {
    if (!pendingFix?.text) return;
    setPrompt(pendingFix.text);
    setShowWorkspace(false);
    // AUTO-SEND, but only when the caller says the user explicitly asked for a fix.
    //
    // The default stays PREFILL — a request that merely arrives should never spend the user's balance
    // on its own. But the APK panel's "Fix" button IS the consent: the user read "the build failed",
    // pressed a button labelled Fix, and expects the fix to start. Making them press send again is
    // the same dead-button feeling this whole path exists to remove.
    if (pendingFix.autoSend) void send({ text: pendingFix.text, importUrl: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFix?.nonce]);

  // Deploy requested from the Git panel (sidebar) for a specific real provider — run v5's REAL
  // build+deploy pipeline for that provider (the actual, tested deploy engine). Fires on each new
  // pendingDeploy (nonce change). If it CAN'T start, say why in the chat — this path used to drop
  // deployLive's silent no-op on the floor too (same dead-button class, admin 2026-08-02).
  useEffect(() => {
    if (!pendingDeploy?.provider) return;
    setShowWorkspace(false);
    const reason = deployLive(pendingDeploy.provider);
    if (reason) {
      setAgentHistory((h) => [...h, { role: 'agent' as const, agent: 'architect', text: `⚠️ ${reason}`, ts: Date.now() }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDeploy?.nonce]);

  // Load the file contents when the Files tab is opened (and not already loaded), so each file
  // row can show its line count — without the user having to click into a file first.
  useEffect(() => {
    if (showWorkspace && tab === 'files' && workspaceFiles === null && state.files.length > 0 && state.workspaceId) {
      void loadWorkspaceFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWorkspace, tab, workspaceFiles, state.files.length, state.workspaceId]);

  // Refresh the cached contents when a build finishes so line counts reflect the latest files.
  useEffect(() => {
    if (state.done && tab === 'files' && showWorkspace && state.workspaceId && state.files.length > 0) {
      void loadWorkspaceFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.done]);

  // S4 — REHYDRATE FILES + PREVIEW from durable storage on (re)open. The other file-load effects all
  // require state.files.length > 0, which is ALWAYS 0 after a reopen (the restored thread carries no
  // file events) — so files/preview looked "gone". This pulls the durable file contents for the shown
  // workspace the moment it is opened (and NOT mid-build), so the Files viewer is populated and the
  // in-browser preview (which renders from the same durable files server-side) comes back. Runs once
  // per workspace (rehydratedWsRef), re-armed on session switch; never during a live build.
  useEffect(() => {
    // ANON PARITY (Fix 26): rehydrate durable files for the anon identity too — `!userId` here is
    // why "sari file gone" showed after a panel reset even though the durable store held every file.
    if (running || !sessionIdRef.current) return;
    const wsId = state.workspaceId || clientWorkspaceId(userId, sessionIdRef.current);
    // Skip only if we've already rehydrated THIS workspace, or the cache already holds THIS workspace's
    // files. A stale in-flight load for a PREVIOUS workspace (workspaceFilesFor !== wsId) must NOT block
    // loading the current one.
    if (rehydratedWsRef.current === wsId || (workspaceFiles !== null && workspaceFilesFor === wsId)) return;
    rehydratedWsRef.current = wsId;
    void loadWorkspaceFiles(wsId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, state.workspaceId, running, workspaceFiles, workspaceFilesFor]);

  // Plan (todo list) collapse toggle (Task 3) — keeps the chat area readable.
  const [planCollapsed, setPlanCollapsed] = useState(false);

  const agents = Object.values(state.agents).sort((a, b) => b.updatedTs - a.updatedTs);
  const diffPaths = Object.keys(state.diffs);
  const planDone = state.todos.filter((t) => t.status === 'done').length;
  const currentTodo = state.todos.find((t) => t.status === 'in_progress')
    ?? state.todos.find((t) => t.status !== 'done');
  // "Plan complete" = every step is done. Once a build finishes, the whole 9/9 checklist kept sitting
  // expanded above the composer forever (admin: "jab plan pura ho gaya … bas 'done' likh kar aaye,
  // hamesha plan show ho aisa zaroori nahi"). So on the transition to complete we collapse it to a compact
  // "✓ Done" line; on the transition back to incomplete (a new/continued build) we reopen it. The user can
  // still expand/collapse manually in between — this only drives the two transitions, never every render.
  const planComplete = state.todos.length > 0 && state.todos.every((t) => t.status === 'done');
  const prevPlanCompleteRef = useRef(false);
  useEffect(() => {
    if (planComplete && !prevPlanCompleteRef.current) setPlanCollapsed(true);
    else if (!planComplete && prevPlanCompleteRef.current) setPlanCollapsed(false);
    prevPlanCompleteRef.current = planComplete;
  }, [planComplete]);

  // Shared session-history list — rendered by BOTH the desktop ☰ dropdown and the mobile footer's
  // History sheet, so there is exactly ONE history UI (same data, same live dots, same actions).
  // One saved-session row (shared by the Pinned section + the date-bucketed groups). It carries
  // TWO trailing actions — PIN and DELETE — as siblings of the full-width open <button> (valid HTML,
  // never nested interactives; the iOS tap fix below still holds).
  const renderSessionRow = (c: ConversationMeta) => {
    const meta = sessionStatusMeta(c.status, c.live);
    const isActive = !!c.workspaceId && c.workspaceId === state.workspaceId;
    const isDeleting = deletingHistoryId === c.id;
    const isPinning = pinningHistoryId === c.id;
    // MOBILE TAP FIX (kept): the open action is a REAL full-width <button> (guaranteed tap→click on
    // iOS + keyboard support); the pin/delete actions are SIBLING buttons, visible on touch and
    // hover-revealed on desktop. A pinned row keeps its pin visible so it can always be un-pinned.
    return (
      <div key={c.id} className={`relative group ${isDeleting ? 'opacity-40 pointer-events-none' : ''}`}>
        <button
          type="button"
          onClick={() => { if (!isDeleting) openConversation(c.id); }}
          disabled={isDeleting}
          title={c.deadTranscript ? 'Transcript lost to an old bug — files/memory intact' : (c.title || 'Untitled build')}
          className={`w-full flex items-center gap-2 pl-3 pr-16 py-2 text-left text-sm touch-manipulation ${isActive ? 'bg-indigo-500/10 text-white' : c.deadTranscript ? 'text-zinc-500 hover:bg-zinc-800 active:bg-zinc-800' : 'text-zinc-300 hover:bg-zinc-800 active:bg-zinc-800'}`}
        >
          <span className="relative shrink-0 flex items-center justify-center w-3.5 h-3.5">
            {/* Live = the app has an ACTIVE published deployment (server-verified) — soft glow halo,
                like a broadcast "on air" light. Static (running's pulse stays the only animation). */}
            <span
              className={`w-2 h-2 rounded-full ${c.deadTranscript ? 'bg-zinc-700' : meta.dot} ${meta.pulse && !c.deadTranscript ? 'animate-pulse' : ''} ${meta.live && !c.deadTranscript ? 'ring-2 ring-green-400/30 shadow-[0_0_6px_rgba(74,222,128,0.8)]' : ''}`}
              title={meta.live ? 'Live — this app is published' : meta.label}
            />
          </span>
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-1 min-w-0">
              {c.pinned && <Star className="w-3 h-3 shrink-0 text-indigo-400 fill-indigo-400" />}
              <span className="block truncate">{c.title || 'Untitled build'}</span>
            </span>
            <span className="flex items-center gap-1.5 text-[10px] text-zinc-600">
              {isActive && <span className="text-indigo-400 font-semibold">Current session ·</span>}
              {c.deadTranscript
                ? <span className="text-amber-600/80">Transcript lost (old bug) — files safe</span>
                : meta.label && <span className={meta.live ? 'text-green-400 font-semibold' : ''}>{meta.label}</span>}
              {c.updatedAt ? <span>· {relTime(c.updatedAt)}</span> : null}
            </span>
          </span>
        </button>
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          <button
            type="button"
            onClick={(e) => handleTogglePin(e, c)}
            disabled={isPinning || isDeleting}
            title={c.pinned ? 'Unpin this session' : 'Pin this session to the top'}
            aria-label={c.pinned ? 'Unpin this session' : 'Pin this session'}
            className={`p-1 rounded touch-manipulation disabled:opacity-40 focus:opacity-100 ${c.pinned ? 'text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 opacity-100' : 'text-zinc-500 hover:text-indigo-400 hover:bg-indigo-500/10 opacity-60 sm:opacity-0 sm:group-hover:opacity-100'}`}
          >
            {isPinning ? <TirangaLoader className="w-3.5 h-3.5" /> : <Star className={`w-3.5 h-3.5 ${c.pinned ? 'fill-current' : ''}`} />}
          </button>
          <button
            type="button"
            onClick={(e) => handleDeleteConversation(e, c)}
            disabled={running || isDeleting}
            title="Delete this session"
            aria-label="Delete this session"
            className="p-1 rounded touch-manipulation text-zinc-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40 opacity-60 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
          >
            {isDeleting ? <TirangaLoader className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    );
  };
  const historyListBody = (
    <>
      {tapDebug && (
        <div className="mx-2 mb-1 rounded bg-amber-500/10 border border-amber-500/40 px-2 py-1 text-[10px] font-mono text-amber-300 break-all select-text">
          {lastTap || 'tap tracer ON — now tap any chat'}
        </div>
      )}
      <button
        onClick={newChatFromHistory}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
      >
        <Plus className="w-4 h-4 text-indigo-400" /> New chat
      </button>
      <div className="my-1 border-t border-zinc-800" />
      {!historyLoading && !historyError && historyItems.length > 0 && (
        <div className="px-2 pb-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
            <input
              type="text"
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
              placeholder="Search sessions…"
              aria-label="Search sessions"
              className="w-full pl-7 pr-7 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
            />
            {historyQuery && (
              <button
                type="button"
                onClick={() => setHistoryQuery('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-500 hover:text-zinc-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
      {historyLoading ? (
        <div className="px-3 py-3 text-xs text-zinc-500 flex items-center gap-2"><TirangaLoader className="w-3.5 h-3.5" /> Loading sessions…</div>
      ) : historyError ? (
        <div className="px-3 py-4 text-xs text-center">
          <div className="flex items-center justify-center gap-1.5 text-amber-400">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>Couldn't load your history</span>
          </div>
          <div className="mt-1 text-zinc-500">{historyError}</div>
          <button
            onClick={loadHistory}
            className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded-md text-indigo-400 hover:text-indigo-300 hover:bg-zinc-800 font-medium"
          >
            <RotateCcw className="w-3 h-3" /> Try again
          </button>
        </div>
      ) : historyItems.length === 0 ? (
        <div className="px-3 py-4 text-xs text-zinc-500 text-center">No saved sessions yet.<br />Every build you start is saved here automatically.</div>
      ) : (() => {
        // Instant client-side search, then pinned-first: the Pinned section sits above the normal
        // date buckets so a user's important builds are always one glance away regardless of age.
        const filtered = filterSessionsByQuery(historyItems, historyQuery);
        if (filtered.length === 0) {
          return <div className="px-3 py-4 text-xs text-zinc-500 text-center">No sessions match “{historyQuery.trim()}”.</div>;
        }
        const { pinned, rest } = partitionPinnedSessions(filtered);
        return (
          <>
            {pinned.length > 0 && (
              <div>
                <div className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-indigo-400/80 flex items-center gap-1">
                  <Star className="w-3 h-3 fill-current" /> Pinned
                </div>
                {pinned.map(renderSessionRow)}
              </div>
            )}
            {groupSessionsByDate(rest, Date.now()).map((group) => (
              <div key={group.label}>
                <div className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">{group.label}</div>
                {group.items.map(renderSessionRow)}
              </div>
            ))}
          </>
        );
      })()}
    </>
  );

  return (
    <div className="flex flex-col h-full max-h-full w-full min-h-0 bg-zinc-950 text-zinc-100">
      {showHostingChooser && (
        <HostingChooser
          providers={configuredProviders}
          // The publish now happens in THIS panel, so the chooser must reflect it: a button that
          // starts real work and shows nothing is the dead button this whole change exists to kill.
          busy={running || publishing}
          publishStatus={publishMsg}
          workspaceId={state.workspaceId}
          customDomainsEnabled={customDomainsEnabled}
          ownRepo={state.ownRepo}
          githubConnected={!!ghToken()}
          onConnectGitHub={() => void connectGitHub()}
          authedFetch={authedFetch}
          // Lands on the database FORM, not the settings root — sending the user to a menu mid-publish
          // is how a helpful button becomes a dead end.
          onOpenDatabaseSettings={() => {
            setShowHostingChooser(false);
            window.dispatchEvent(new CustomEvent('navbharat:navigate', { detail: { view: 'settings', settingsScreen: 'database' } }));
          }}
          // Make an Android app → the APK Builder opens already targeted at this app (it reads the current
          // Pro session id), so the user never re-picks their app (admin 2026-08-13).
          onOpenApkBuilder={() => {
            setShowHostingChooser(false);
            window.dispatchEvent(new CustomEvent('navbharat:navigate', { detail: { view: 'apk' } }));
          }}
          onClose={() => setShowHostingChooser(false)}
          // STAYS OPEN, always. Closing on a successful start made sense while publishing streamed
          // into the chat — the user was sent somewhere that showed progress. Now the publish runs
          // directly and reports into THIS surface, so closing it would hide the very thing the user
          // is waiting for, and reproduce the "sheet vanished, nothing happened" complaint that the
          // blocked-reason plumbing was built to end. A refused publish still hands its reason back.
          onDeploy={(id) => deployLive(id)}
        />
      )}
      {/* Header: title + New, and the workspace tab pills (open/collapse the workspace) */}
      <div className="shrink-0 border-b border-zinc-800">
        {/* In focus mode the fixed Exit-Focus button lives at the top-right corner (App.tsx). Reserve
            room on the right so the header's own trailing controls (Stop/Resume) don't sit under it. */}
        <div className={`flex items-center gap-2 pl-4 pt-3 pb-2 ${focusMode ? 'pr-14' : 'pr-4'}`}>
          {/* History menu (3-line): this account's saved chats + New chat. Per-user (Firestore), so the
              same list and the same project/memory continue from any device the user signs in on.
              MOBILE FOOTER (admin 2026-07-07): on mobile/tablet the footer's History item owns this —
              the header ☰ hides there (hidden lg:block) so the control exists exactly once. */}
          <div className={mobileFooter ? 'relative hidden lg:block' : 'relative'}>
            <button
              onClick={toggleHistory}
              title="Chat history"
              aria-label="Chat history"
              className="flex items-center justify-center w-7 h-7 -ml-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800"
            >
              <Menu className="w-5 h-5" />
            </button>
            {historyOpen && (
              <>
                {/* cursor-pointer is load-bearing on iOS: without a direct listener (React delegates
                    to the root) Safari only synthesizes click on "clickable" elements, so a bare div
                    never closed the menu on tap-outside on iPhone. */}
                <div className="fixed inset-0 z-40 cursor-pointer touch-manipulation" onClick={() => setHistoryOpen(false)} aria-hidden="true" />
                <div className="absolute left-0 top-9 z-50 w-80 max-h-[70vh] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl py-1.5">
                  <div className="px-3 pb-1.5 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Session history</div>
                  {historyListBody}
                </div>
              </>
            )}
          </div>
          <Bot className="w-5 h-5 text-indigo-400" />
          <span className="font-semibold">NavBharatAI Pro v5.0</span>
          <span className="text-[10px] uppercase tracking-wide bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded">beta</span>
          {/* Paid-public (billing PR 5): a live wallet-balance chip — shown ONLY when this user is
              actually on paid billing (server `billed:true`), so admin/free-list users and the
              flag-off state never see it. Tapping it opens Wallet & Billing to top up. */}
          {billed && (walletTokens !== null || walletBalanceInr !== null) && (
            // Billing Phase 2 — token-first: the chip shows the wallet's PRIMARY unit (tokens); the ₹
            // equivalent lives in the tooltip. Falls back to ₹ only when the doc has no token balance.
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('navbharat:navigate', { detail: { view: 'billing' } }))}
              title={`Your NavBharatAI Pro token balance${walletBalanceInr !== null ? ` (≈ ₹${walletBalanceInr.toFixed(2)})` : ''} — tap to add more`}
              className={`flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border transition-all ${(walletTokens ?? walletBalanceInr ?? 0) <= 0 ? 'bg-amber-500/15 border-amber-500/30 text-amber-300 hover:bg-amber-500/25' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/20'}`}
            >
              <Wallet className="w-3 h-3" />
              {walletTokens !== null
                ? `${walletTokens.toLocaleString()} tokens`
                : `₹${(walletBalanceInr as number).toFixed(2)}`}
            </button>
          )}
          <button
            onClick={() => setShowFrameworkPicker(true)}
            className="flex items-center gap-1 text-[10px] bg-white/5 hover:bg-white/10 border border-white/5 text-zinc-400 hover:text-white px-2 py-0.5 rounded-full transition-all"
            title="Change framework"
          >
            <span>{FRAMEWORKS.find(f => f.id === framework)?.iconChar ?? '⚛'}</span>
            {/* Mobile (admin 2026-07-07): the header keeps only the framework ICON — the full
                name + picker entry lives in the footer's More sheet. */}
            <span className={mobileFooter ? 'hidden lg:inline' : ''}>{FRAMEWORKS.find(f => f.id === framework)?.name ?? 'React + Vite'}</span>
          </button>
          <span className="text-[9px] text-zinc-600 font-mono" title="Deployed build time — if this doesn't change after a deploy, your browser is serving cached code.">{(() => { try { return 'b:' + (typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '').slice(5, 16).replace('T', ' '); } catch { return ''; } })()}</span>
          {running ? (
            // Attached + streaming here → Stop.
            <button
              onClick={stop}
              title="Stop the running build"
              className="ml-auto flex items-center gap-1 text-xs text-white bg-red-600 hover:bg-red-500 rounded px-2 py-1"
            >
              <Square className="w-3.5 h-3.5" /> Stop
            </button>
          ) : serverBuildRunning ? (
            // A build is running server-side but this UI isn't attached → Resume + Stop.
            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => resumeBuild({ userId, email, workspaceId: expectedWorkspaceId() })}
                title="Open the running build — resume where it left off"
                className="flex items-center gap-1 text-xs text-white bg-indigo-600 hover:bg-indigo-500 rounded px-2 py-1"
              >
                <Play className="w-3.5 h-3.5" /> Resume
              </button>
              <button
                onClick={stop}
                title="Stop the running build"
                className="flex items-center gap-1 text-xs text-red-200 border border-red-700 hover:bg-red-950 rounded px-2 py-1"
              >
                <Square className="w-3.5 h-3.5" /> Stop
              </button>
            </div>
          ) : null}
        </div>
        {/* Row 2 (workspace pills + report/deploy actions): on mobile/tablet this whole row moves
            into the footer (direct items + the More sheet) — admin 2026-07-07. Desktop unchanged. */}
        <div className={`${mobileFooter ? 'hidden lg:flex' : 'flex'} gap-1 px-3 pb-2 overflow-x-auto whitespace-nowrap`} style={{ WebkitOverflowScrolling: 'touch' }}>
          <TabPill active={showWorkspace && tab === 'preview'} onClick={() => openTab('preview')} icon={<Globe className="w-3.5 h-3.5" />} dataTour="preview">Preview</TabPill>
          <TabPill active={showWorkspace && tab === 'files'} onClick={() => openTab('files')} icon={<FolderOpen className="w-3.5 h-3.5" />}>Files ({state.files.length})</TabPill>
          <TabPill active={showWorkspace && tab === 'diff'} onClick={() => openTab('diff')} icon={<FileDiff className="w-3.5 h-3.5" />}>Diff ({diffPaths.length})</TabPill>
          <TabPill active={showWorkspace && tab === 'terminal'} onClick={() => openTab('terminal')} icon={<Terminal className="w-3.5 h-3.5" />}>Terminal</TabPill>
          <TabPill active={showWorkspace && tab === 'history'} onClick={() => openTab('history')} icon={<History className="w-3.5 h-3.5" />}>History ({allCheckpoints.length})</TabPill>
          {/* Report to admin (admin 2026-07-29): the report itself stays admin-only — the user submits
              it and never sees the content. Since 2026-08-04 clicking it first asks WHICH build, so a
              problem from an earlier edit is reportable instead of always sending the newest build. */}
          <div className="relative">
            <button
              onClick={() => void openReportPicker()}
              disabled={reportSending || reportPickerLoading || !state.workspaceId}
              title={`Send a build's report to the NavBharatAI team so we can improve the build engine. (The report is reviewed by our team.)${reportCount > 0 ? ` ${reportAlreadySentHint(reportCount)}` : ''}`}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${reportSent || reportCount > 0 ? 'border-emerald-600 text-emerald-300' : 'border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500'}`}
            >
              {reportSending || reportPickerLoading ? <TirangaLoader className="w-3.5 h-3.5" /> : reportSent || reportCount > 0 ? <Check className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
              {reportButtonLabel({ sending: reportSending, justSent: reportSent, count: reportCount })}
            </button>
            {reportPickerOpen && (
              <>
                {/* Click-away layer, so the list closes the way every other popover here does. */}
                <div className="fixed inset-0 z-40" onClick={() => setReportPickerOpen(false)} />
                <div className="absolute right-0 z-50 mt-1 w-80 max-h-80 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
                  <div className="px-3 py-2 text-[11px] text-zinc-400 border-b border-zinc-800">
                    Which build had the problem?
                  </div>
                  {reportPickerRows((b) => void sendReportToAdmin(b), false)}
                </div>
              </>
            )}
          </div>
          {state.repoUrl && (
            <a
              href={state.repoUrl}
              target="_blank"
              rel="noreferrer"
              title={`Open this project's GitHub repo${state.repoFullName ? ` (${state.repoFullName})` : ''} — your code, branches, pull requests, CI and merges`}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors"
            >
              <Github className="w-3.5 h-3.5" />
              GitHub
              <ExternalLink className="w-3 h-3 opacity-60" />
            </a>
          )}
          {/* R5 §5.1 + Hosting Phase 1 — one "Publish" button opens the Hosting chooser: host on
              NavBharatAI (our free one-click hosting) OR bring your own provider (no lock-in). */}
          <button
            onClick={() => setShowHostingChooser(true)}
            data-tour="deploy"
            disabled={running || !state.workspaceId}
            title="Publish your app to a permanent public live URL (it stays online after the sandbox stops)"
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-emerald-700/60 text-emerald-300 hover:text-white hover:border-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Rocket className="w-3.5 h-3.5" />
            Publish
          </button>
          {liveUrl && (
            <a
              href={liveUrl}
              target="_blank"
              rel="noreferrer"
              title={`Your live site: ${liveUrl}`}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-emerald-700/60 bg-emerald-950/40 text-emerald-300 hover:text-white hover:border-emerald-500 transition-colors"
            >
              <Globe className="w-3.5 h-3.5" />
              Live site
              <ExternalLink className="w-3 h-3 opacity-60" />
            </a>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row flex-1 min-h-0">
        {/* LEFT: the chat. Full width when the workspace is collapsed. When the
            workspace is open it shares the width on desktop, and is HIDDEN on
            mobile (the workspace takes over so it's usable on a phone). */}
        <div className={`${showWorkspace ? 'hidden sm:flex sm:w-1/2 sm:border-r border-zinc-800' : 'flex flex-1'} flex-col min-h-0`}>
          {/* 3 PAGES: Build · Plan · Advise — one shared session + project memory, each its OWN
              visible thread. The switcher moved BACK to the composer's left column as a dropup
              selector (admin 2026-07-07: "old position me rakho, input box ke pas, dropdown selector"
              — position only, function unchanged). See the mode selector next to the settings button. */}
          {/* Conversation */}
          {/* Admin 2026-07-06: tighter padding (p-3 → px-2 py-2) + smaller gaps so more chat is visible. */}
          <div ref={scrollRef} className="flex-1 overflow-auto px-2 py-2 space-y-2.5 min-h-0">
            {(() => {
              const lastUser = [...convo].reverse().find((m) => m.role === 'user');
              return lastUser ? <AppUpdateChatNotice userText={lastUser.text} /> : null;
            })()}
            {convo.length === 0 && (
              <div className="text-sm text-zinc-500 mt-6 text-center">
                <Bot className="w-8 h-8 mx-auto mb-2 text-indigo-400/60" />
                {chatMode === 'planner'
                  ? <>🧠 <b className="text-zinc-300">Plan</b> — read-only. Describe a goal and I’ll plan it with you (aware of your build); approve the steps into the build queue.</>
                  : chatMode === 'advisor'
                  ? <>🔍 <b className="text-zinc-300">Advise</b> — read-only. Ask for an audit, bug/security scan or a comparison; nothing is built. Approve fixes into the queue.</>
                  : <>Say hi, or describe an app to build —<br />e.g. “build a todo app with categories”.</>}
                {/* Cold-start killer: one-tap RICH starters. Tapping drops a detailed prompt into the
                    composer to customise — it never auto-builds (the user stays in control). Build tab only. */}
                {/* The user's OWN saved templates (on-device) — shown first when present. Each is a one-tap
                    prompt with a remove (×). Saved via the 🔖 action on any message you sent. */}
                {chatMode === 'build' && savedTpls.length > 0 && (
                  <div className="mt-5">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-600 mb-2">Your templates</div>
                    <div className="flex flex-wrap justify-center gap-1.5 max-w-md mx-auto">
                      {savedTpls.map((t) => (
                        <span key={t.id} className="group/tpl inline-flex items-center rounded-full border border-amber-600/40 bg-amber-500/10 text-xs text-amber-200 overflow-hidden">
                          <button
                            type="button"
                            title={t.prompt}
                            onClick={() => { setPrompt(t.prompt); setTimeout(() => composerRef.current?.focus(), 0); }}
                            className="flex items-center gap-1 pl-2.5 pr-1.5 py-1 hover:bg-amber-500/15 transition-colors"
                          >
                            <span aria-hidden>🔖</span>{t.label}
                          </button>
                          <button
                            type="button"
                            title="Remove this template"
                            aria-label="Remove template"
                            onClick={() => handleRemoveTemplate(t.id)}
                            className="px-1.5 py-1 text-amber-400/70 hover:text-red-400 hover:bg-white/5 transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {/* Cold-start killer: one-tap RICH starters. Tapping drops a detailed prompt into the
                    composer to customise — it never auto-builds (the user stays in control). Build tab only. */}
                {chatMode === 'build' && (() => {
                  // TIER-AWARE starters (admin 2026-08-02): a FREE user (powerUnlocked=false) is only offered
                  // `simple` apps their weak tier actually ships, so their FIRST build works — plus a curated
                  // few LOCKED `pro` showcases that open the upgrade surface (the free→paid carrot). An
                  // unlocked user gets the whole library, tappable, no locks.
                  const { tappable: starterTappable, locked: starterLocked } = partitionStarters(powerUnlocked);
                  return (
                  <div className="mt-5">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-600 mb-2">Or start from a template</div>
                    {/* Cards, not bare pills (3.4): a row of identical grey chips makes a to-do app and a
                        CRM look the same, so the picker is harder to use than it appears. The tile is a
                        LAYOUT SKETCH — the shape of the app — never a screenshot of output we do not have. */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-w-lg mx-auto">
                      {starterTappable.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          title={t.prompt}
                          onClick={() => { setPrompt(t.prompt); setTimeout(() => composerRef.current?.focus(), 0); }}
                          className="group flex flex-col gap-1.5 p-2 rounded-xl border border-zinc-800 bg-zinc-900/60 text-left hover:border-indigo-500/60 hover:bg-indigo-500/5 transition-colors"
                        >
                          <StarterSketch id={t.id} className="group-hover:border-indigo-500/40 transition-colors" />
                          <div className="flex items-center gap-1 min-w-0">
                            <span aria-hidden className="shrink-0">{t.icon}</span>
                            <span className="text-xs text-zinc-300 group-hover:text-indigo-200 truncate">{t.label}</span>
                          </div>
                          <span className="text-[10px] text-zinc-600 -mt-1">{t.category}</span>
                        </button>
                      ))}
                    </div>
                    {/* Free→paid carrot: LOCKED pro showcases. Tapping opens the tier/upgrade popover (real
                        recharge surface) instead of dropping a prompt the weak tier would flail on. */}
                    {starterLocked.length > 0 && (
                      <div className="mt-4">
                        <div className="text-[11px] uppercase tracking-wide text-indigo-400/70 mb-2 flex items-center justify-center gap-1">
                          <span aria-hidden>⚡</span> Unlock with Pro
                        </div>
                        <div className="flex flex-wrap justify-center gap-1.5 max-w-md mx-auto">
                          {starterLocked.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              title={`${t.label} needs a Pro tier — the free tier is tuned for simple apps. Tap to unlock.`}
                              onClick={() => setSettingsOpen(true)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/5 text-xs text-indigo-300/80 hover:border-indigo-400/70 hover:bg-indigo-500/15 hover:text-indigo-200 transition-colors"
                            >
                              <span aria-hidden>{t.icon}</span>{t.label}<span aria-hidden className="ml-0.5 opacity-70">🔒</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* GLOWING "Screenshot → App" button (admin 2026-07-22) — sits with the templates as a
                        highlighted starter: tap → open the gallery → build an app from that screenshot,
                        inline. Second entry to the SAME flow as the Attach-menu option. */}
                    <div className="flex justify-center mt-3">
                      <button
                        type="button"
                        onClick={openScreenshotGallery}
                        disabled={screenshotBusy || running}
                        title="Pick a website/app screenshot from your gallery — v5.0 builds it"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold text-white bg-gradient-to-r from-indigo-500 to-violet-500 ring-1 ring-indigo-300/40 shadow-[0_0_18px_rgba(99,102,241,0.6)] hover:shadow-[0_0_26px_rgba(99,102,241,0.9)] transition-shadow disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {screenshotBusy ? <TirangaLoader className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
                        {screenshotBusy ? 'Reading screenshot…' : 'Screenshot → App'}
                      </button>
                    </div>
                  </div>
                  );
                })()}
              </div>
            )}
            {chatBlocks.map((b) => {
              if (b.kind !== 'msg') return <ActionGroupRow key={b.key} block={b} />;
              const isLastUser = lastUserTs !== null && b.msg.role === 'user' && b.msg.ts === lastUserTs && !unsending;
              return <Bubble key={b.key} msg={b.msg}
                onUnsend={isLastUser ? () => { void handleUnsend(b.msg.ts); } : undefined}
                onEdit={isLastUser ? () => { void handleEdit(b.msg.ts, b.msg.text); } : undefined}
                onSaveTemplate={b.msg.role === 'user' ? () => handleSaveTemplate(b.msg.text) : undefined} />;
            })}
            {/* AP-3 (cross-restart resume) — an honest offer to finish a build a server restart cut off
                mid-flight. Shows only when the reopened build's durable status was 'running' AND there is
                no live build anywhere (serverBuildRunning false) and nothing is streaming here. Files, plan
                and memory were all saved durably, so Continue picks up from where it stopped. */}
            {interruptedResume && !serverBuildRunning && !running && (
              <div className="mx-auto my-3 max-w-[92%] rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-100">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
                  <div className="flex-1">
                    <div className="font-medium">This build didn’t finish</div>
                    <div className="text-amber-200/80 text-xs mt-0.5">
                      It was interrupted before it could complete (usually a server restart). Your files, plan and progress are all saved — continue to finish the remaining steps.
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => { void send({ text: 'Continue the build from where it left off and finish the remaining steps.', importUrl: '' }); }}
                        className="px-2.5 py-1 rounded-md bg-amber-500 text-zinc-950 text-xs font-medium hover:bg-amber-400 transition-colors"
                      >
                        Continue building
                      </button>
                      <button
                        type="button"
                        onClick={() => setInterruptedResume(false)}
                        className="px-2.5 py-1 rounded-md text-amber-200/80 text-xs hover:text-amber-100 hover:bg-white/5 transition-colors"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {(running || state.activity.length > 0) && (
              <WorkingIndicator activity={state.activity} running={running} />
            )}
            {/* ASK-USER (opt-in) — a NON-BLOCKING clarify card. The engine is already building with
                sensible defaults for these; the user MAY refine any of them with a follow-up message, or
                dismiss. It never pauses the build (honours "text reply > build app"). */}
            {state.pendingClarify && !clarifyDismissed && state.pendingClarify.questions.length > 0 && (
              <div className="mx-auto my-3 max-w-[92%] rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-3 py-2.5 text-sm text-indigo-100">
                <div className="flex items-start gap-2">
                  <Bot className="w-4 h-4 mt-0.5 shrink-0 text-indigo-400" />
                  <div className="flex-1">
                    <div className="font-medium">Building your {state.pendingClarify.domain} app — a few things I assumed</div>
                    <div className="text-indigo-200/80 text-xs mt-0.5">
                      I’m already building with sensible defaults. Want to adjust any of these? Just reply below — no need to wait.
                    </div>
                    <ul className="mt-1.5 space-y-1">
                      {state.pendingClarify.questions.map((q, i) => (
                        <li key={i} className="text-xs text-indigo-100/90 flex gap-1.5"><span className="text-indigo-400">•</span><span>{q}</span></li>
                      ))}
                    </ul>
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => setClarifyDismissed(true)}
                        className="px-2.5 py-1 rounded-md text-indigo-200/80 text-xs hover:text-indigo-100 hover:bg-white/5 transition-colors"
                      >
                        Looks good — dismiss
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {/* FIX #6 → COMPACT (admin 2026-07-21 — "roadmap screen se hatao, chhota button bana do"):
                the proposed plan/fixes no longer render as a block here (it used to pin itself after
                the last AI message and hide the responses). It now lives as a small chip just above
                the composer — see the sticky footer below. */}
            {billingBlock && (
              // Paid-public (billing PR 5): credits ran out → the build was refused BEFORE it started, so
              // "Fix with AI" (the code-error treatment) would be wrong. This is its own actionable card:
              // add credits, or dismiss. Any build already running is unaffected (nothing was started).
              <div className="px-3 py-2.5 bg-amber-950/50 text-amber-100 text-xs rounded border border-amber-500/30">
                <div className="flex items-start gap-2">
                  <Wallet className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="font-semibold text-amber-200">Add credits to build</div>
                    <div className="mt-0.5 whitespace-pre-wrap break-words">{billingBlock.notice}</div>
                    {/* Billing Phase 2 — token-first: balance and estimate in the wallet's primary unit
                        (server-converted tokens); older servers without token fields fall back to ₹. */}
                    {(typeof billingBlock.balanceTokens === 'number' || typeof billingBlock.estimateTokens === 'number') ? (
                      <div className="mt-1 text-[11px] text-amber-300/80">
                        {typeof billingBlock.balanceTokens === 'number' && <span>Balance: {billingBlock.balanceTokens.toLocaleString()} tokens</span>}
                        {typeof billingBlock.balanceTokens === 'number' && typeof billingBlock.estimateTokens === 'number' && <span> · </span>}
                        {typeof billingBlock.estimateTokens === 'number' && <span>This build ≈ {billingBlock.estimateTokens.toLocaleString()} tokens</span>}
                      </div>
                    ) : (typeof billingBlock.balanceInr === 'number' || typeof billingBlock.estimateInr === 'number') && (
                      <div className="mt-1 text-[11px] text-amber-300/80">
                        {typeof billingBlock.balanceInr === 'number' && <span>Balance: ₹{billingBlock.balanceInr.toFixed(2)}</span>}
                        {typeof billingBlock.balanceInr === 'number' && typeof billingBlock.estimateInr === 'number' && <span> · </span>}
                        {typeof billingBlock.estimateInr === 'number' && <span>This build ≈ ₹{billingBlock.estimateInr.toFixed(2)}</span>}
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    onClick={() => window.dispatchEvent(new CustomEvent('navbharat:navigate', { detail: { view: 'billing' } }))}
                    title="Open Wallet & Billing to add credits"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-white bg-amber-600 hover:bg-amber-500 rounded px-2.5 py-1"
                  >
                    <Wallet className="w-3.5 h-3.5" /> Add credits
                  </button>
                  <button
                    onClick={clearBillingBlock}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-200 bg-white/5 hover:bg-white/10 rounded px-2.5 py-1"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
            {(error || state.error) && (
              <div className="px-3 py-2 bg-red-950/60 text-red-300 text-xs rounded">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" /> <span className="whitespace-pre-wrap break-words">{error || state.error}</span>
                </div>
                {!running && (
                  isBuildBusyError(error || state.error) ? (
                    // "A build is already running" is a LOCK, not a code error — "Fix with AI" would just
                    // re-send and re-hit the lock (the 100-retries loop). The real actions are STOP (free
                    // the lock) and CONNECT (attach to the build that's actually running). See isBuildBusyError.
                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        onClick={stop}
                        title="Stop the build that's holding your account, so you can send again"
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-white bg-red-600 hover:bg-red-500 rounded px-2.5 py-1"
                      >
                        <Square className="w-3.5 h-3.5" /> Stop
                      </button>
                      <button
                        onClick={() => resumeBuild({ userId, email, workspaceId: expectedWorkspaceId() })}
                        title="Connect to the build that's already running — attach and watch it live"
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded px-2.5 py-1"
                      >
                        <Play className="w-3.5 h-3.5" /> Connect
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => fixWithAI(`Fix this error and continue building the app:\n\n${error || state.error}`)}
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded px-2.5 py-1"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> Fix with AI
                    </button>
                  )
                )}
              </div>
            )}
            {/* T1-budget-ux: a budget-cap stop is an honest PAUSE, not a failure — calm state + a Continue that
                the user chooses (never a silent auto-continue that would keep spending). Work is already saved. */}
            {state.done && state.budgetReached && (
              <div className="px-3 py-2 bg-sky-950/50 text-sky-100 text-xs rounded border border-sky-900/60">
                <div className="flex items-start gap-2">
                  <Wallet className="w-4 h-4 shrink-0" />
                  <span className="whitespace-pre-wrap break-words">This build reached its budget for now — your files are saved. Continue to keep building (uses more of your balance), or stop here.</span>
                </div>
                {!running && (
                  <button
                    onClick={() => fixWithAI('Continue building from where you left off and finish the app — I understand this uses more of my budget.')}
                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-white bg-sky-600 hover:bg-sky-500 rounded px-2.5 py-1"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Continue building
                  </button>
                )}
              </div>
            )}
            {state.done && state.ok === false && !state.error && !state.budgetReached && state.summary && (
              <div className="px-3 py-2 bg-amber-950/50 text-amber-200 text-xs rounded">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" /> <span className="whitespace-pre-wrap break-words">{state.summary}</span>
                </div>
                {!running && (
                  <button
                    onClick={() => fixWithAI('Continue from where you left off and finish/fix the build so the app works end-to-end.')}
                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded px-2.5 py-1"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Fix with AI
                  </button>
                )}
              </div>
            )}
            {state.pendingSecrets && (
              <SecretRequestCard
                prompt={state.pendingSecrets.prompt}
                secrets={state.pendingSecrets.secrets}
                onSave={async (vals) => {
                  // Straight to the encrypted vault over the authenticated API — the value never goes
                  // back up the build stream, which is stored in the transcript and the admin report.
                  if (!userId) return false;
                  for (const [name, value] of Object.entries(vals)) {
                    await saveSecret(userId, name, value);
                  }
                  return true;
                }}
                onDone={(saved) => { respond(state.pendingSecrets!.callId, saved); }}
              />
            )}
            {state.pendingPermission && (
              <div className="px-3 py-2.5 bg-amber-950/50 border border-amber-900 rounded">
                <div className="flex items-center gap-2 text-xs text-amber-200 mb-2">
                  <AlertCircle className="w-4 h-4" /> {state.pendingPermission.action}
                </div>
                {state.todos.length > 0 && (
                  <div className="mb-2"><TodoList todos={state.todos} /></div>
                )}
                <div className="flex gap-2">
                  <button onClick={() => respond(state.pendingPermission!.callId, true)} className="px-3 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white">Approve &amp; build</button>
                  <button onClick={() => respond(state.pendingPermission!.callId, false)} className="px-3 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100">Reject</button>
                </div>
              </div>
            )}
            {fwConflict && (
              <div className="px-3 py-2.5 bg-indigo-950/50 border border-indigo-800 rounded">
                <div className="flex items-center gap-2 text-xs text-indigo-200 mb-1">
                  <AlertCircle className="w-4 h-4" /> Which framework should I use?
                </div>
                <div className="text-[11px] text-zinc-400 mb-2">
                  You selected <b className="text-zinc-200">{fwName(fwConflict.picked)}</b>, but your message mentions <b className="text-zinc-200">{fwName(fwConflict.detected)}</b>. Pick one — I&apos;ll build with it.
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => { setFramework(fwConflict.detected); setFrameworkExplicit(true); fwConflict.launch(fwConflict.detected); setFwConflict(null); }}
                    className="px-3 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white"
                  >Use {fwName(fwConflict.detected)} (from your message)</button>
                  <button
                    onClick={() => { setFramework(fwConflict.picked); setFrameworkExplicit(true); fwConflict.launch(fwConflict.picked); setFwConflict(null); }}
                    className="px-3 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100"
                  >Keep {fwName(fwConflict.picked)} (your selection)</button>
                  <button
                    onClick={() => setFwConflict(null)}
                    className="px-3 py-1 text-xs rounded bg-transparent hover:bg-white/5 text-zinc-500"
                  >Cancel</button>
                </div>
              </div>
            )}
            {state.done && (typeof state.billedInr === 'number' || typeof state.billedUsd === 'number') && (
              <div className="flex items-center gap-1 text-[11px] text-zinc-500" title="Customer bill (INR)">
                <Rocket className="w-3 h-3" />{' '}
                {typeof state.billedInr === 'number'
                  ? `₹${state.billedInr.toFixed(2)}`
                  : `$${(state.billedUsd as number).toFixed(4)}`}
              </div>
            )}
            {/* T1-cost-transparency — expandable "why this build cost ₹X" breakdown. */}
            {state.done && state.costBreakdown && (
              <details className="text-[11px] text-zinc-500">
                <summary className="cursor-pointer select-none hover:text-zinc-300" title="See how this build's charge was calculated">
                  Why this cost?
                </summary>
                <div className="mt-1 ml-1 flex flex-col gap-0.5 border-l border-zinc-700 pl-2">
                  <span>Input: {state.costBreakdown.inputTokens.toLocaleString()} tokens · Output: {state.costBreakdown.outputTokens.toLocaleString()} tokens</span>
                  <span>Engine: {state.costBreakdown.engine} · {state.costBreakdown.tier} tier</span>
                  <span>Total: ₹{state.costBreakdown.billedInr.toFixed(2)}</span>
                </div>
              </details>
            )}
            {/* P-UX.7 — token usage for this build (input + output), shown alongside the ₹ cost. */}
            {state.done && typeof state.tokens === 'number' && state.tokens > 0 && (
              <div className="flex items-center gap-1 text-[11px] text-zinc-500" title="Tokens used by this build (input + output)">
                <FileCode className="w-3 h-3" />
                {state.tokens >= 1000 ? `${(state.tokens / 1000).toFixed(1)}k` : state.tokens} tokens
              </div>
            )}
            {/* Billing Phase 1 — the REAL wallet deduction for this build (tokens out + balance left). */}
            {state.done && typeof state.walletTokensDebited === 'number' && state.walletTokensDebited > 0 && (
              <div className="flex items-center gap-1 text-[11px] text-zinc-500" title="Tokens deducted from your wallet for this build">
                <Wallet className="w-3 h-3" />
                −{state.walletTokensDebited.toLocaleString()} wallet tokens
                {typeof state.walletTokenBalance === 'number' ? ` · ${state.walletTokenBalance.toLocaleString()} left` : ''}
              </div>
            )}
            {state.done && state.buildHealth && <BuildHealthCard health={state.buildHealth} />}
            {/* P-UX.6 — lightweight CSAT: thumbs feedback on a finished build (once per workspace). */}
            {state.done && state.ok && state.workspaceId && <BuildFeedback workspaceId={state.workspaceId} />}
          </div>

          {/* Bottom: live AI-team chips + input (Claude-Code style — at the bottom).
              In focus mode (header hidden) the composer's outer frame — the solid bg-zinc-950
              block + the top border line — is dropped so the input/attach/filter read as a clean
              floating popup touching the lower edge. The inner elements keep their own borders,
              and pb-[env(safe-area-inset-bottom)] always stays so the composer never hides behind
              the phone browser's bottom search/address bar. Normal mode is unchanged. */}
          <div className={`shrink-0 sticky bottom-0 pb-[env(safe-area-inset-bottom)] ${focusMode ? '' : 'bg-zinc-950 border-t border-zinc-800'}`}>
            {/* FIX #6 — the 3-role model (Build = builder; Plan/Advise = read-only lanes) now lives in a
                COMPACT dropdown down in the input row (near the settings/attach icons) so it doesn't eat
                a whole row, and stays active during a build for multitasking. Only the command-queue chip
                remains here, and only when there's something queued (no empty row otherwise). */}
            {(() => {
              const pending = queueItems.filter((i) => i.status === 'pending').length;
              const runningQ = queueItems.some((i) => i.status === 'running');
              // Roadmap chip (admin 2026-07-21): the Plan/Advise proposed steps live HERE as a tiny
              // pill instead of a block glued under the last AI message — zero extra space when absent,
              // one 6px-tall row when present, chat never hidden.
              const roadmap = activeProposedSteps && activeProposedSteps.steps.length > 0
                && roadmapDismissedKey !== activeProposedSteps.steps.join('\n') ? activeProposedSteps : null;
              if (pending === 0 && !runningQ && !roadmap) return null;
              return (
                <div className="px-3 pt-1.5 flex items-center gap-1.5">
                  {roadmap && (
                    <button
                      type="button"
                      onClick={() => setRoadmapOpen((v) => !v)}
                      title={`${roadmap.role === 'planner' ? 'Proposed plan' : 'Proposed fixes'} — tap to review & queue`}
                      className={`flex items-center gap-1 px-2 h-6 rounded-full text-[10px] font-semibold border ${roadmapOpen ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-indigo-950/60 border-indigo-800 text-indigo-300 hover:text-white'}`}
                    >
                      🗺 {roadmap.role === 'planner' ? 'Plan' : 'Fixes'} · {roadmap.steps.length}
                    </button>
                  )}
                  {(pending > 0 || runningQ) && (
                    <button
                      type="button"
                      onClick={() => { setQueueOpen((v) => !v); void refreshQueue(); }}
                      title="This app's command queue — steps run one at a time"
                      className="ml-auto flex items-center gap-1 px-2 h-6 rounded-full text-[10px] font-semibold bg-zinc-900 border border-zinc-700 text-zinc-300 hover:text-white"
                    >
                      <Clock className="w-3 h-3" />
                      Queue {pending > 0 ? `${pending} pending` : ''}{runningQ ? (pending > 0 ? ' · 1 running' : '1 running') : ''}
                    </button>
                  )}
                </div>
              );
            })()}
            {/* Roadmap sheet — the proposed steps, expanded ONLY on tap (scrolls internally; the chat
                behind stays fully visible the rest of the time). Queue-all / per-step add / dismiss. */}
            {roadmapOpen && activeProposedSteps && activeProposedSteps.steps.length > 0
              && roadmapDismissedKey !== activeProposedSteps.steps.join('\n') && (
              <div className="mx-3 mt-1.5 p-2.5 bg-indigo-950/40 border border-indigo-900/60 rounded space-y-1.5 max-h-44 overflow-y-auto">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-300">
                    {activeProposedSteps.role === 'planner' ? 'Proposed plan' : 'Proposed fixes'} · {activeProposedSteps.steps.length} step{activeProposedSteps.steps.length > 1 ? 's' : ''}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => addStepsToQueue(activeProposedSteps.steps.filter((s) => !addedSteps.has(s)), activeProposedSteps.role)}
                      disabled={activeProposedSteps.steps.every((s) => addedSteps.has(s))}
                      className="text-[11px] font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded px-2 py-0.5"
                    >
                      {activeProposedSteps.steps.every((s) => addedSteps.has(s)) ? 'All queued ✓' : 'Queue all'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setRoadmapDismissedKey(activeProposedSteps.steps.join('\n')); setRoadmapOpen(false); setRoleProposedSteps(null); }}
                      title="Dismiss this roadmap"
                      className="text-zinc-500 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {activeProposedSteps.steps.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-zinc-300">
                    <button
                      type="button"
                      onClick={() => addStepsToQueue([s], activeProposedSteps.role)}
                      disabled={addedSteps.has(s)}
                      title={addedSteps.has(s) ? 'Queued' : 'Add this step to the build queue'}
                      className="shrink-0 mt-0.5 w-5 h-5 flex items-center justify-center rounded border border-indigo-700 text-indigo-300 hover:text-white hover:bg-indigo-700 disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      {addedSteps.has(s) ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                    </button>
                    <span className="whitespace-pre-wrap break-words">{i + 1}. {s}</span>
                  </div>
                ))}
                <div className="text-[10px] text-zinc-500">Queued steps run one at a time in the Build chat — you approve, it executes.</div>
              </div>
            )}
            {queueOpen && queueItems.length > 0 && (
              <div className="mx-3 mt-1.5 p-2 bg-zinc-900/80 border border-zinc-800 rounded space-y-1 max-h-40 overflow-y-auto">
                {queueItems.map((item) => (
                  <div key={item.id} className="flex items-start gap-2 text-[11px]">
                    <span className={`shrink-0 mt-0.5 ${item.status === 'running' ? 'text-indigo-400' : item.status === 'done' ? 'text-green-500' : item.status === 'failed' ? 'text-red-400' : item.status === 'cancelled' ? 'text-zinc-600' : 'text-zinc-400'}`}>
                      {item.status === 'running' ? <TirangaLoader className="w-3 h-3" /> : item.status === 'done' ? <Check className="w-3 h-3" /> : item.status === 'failed' ? <X className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
                    </span>
                    <span className={`flex-1 break-words ${item.status === 'cancelled' ? 'text-zinc-600 line-through' : item.status === 'done' ? 'text-zinc-500' : 'text-zinc-300'}`}>
                      {item.prompt}
                      {item.note ? <span className="text-zinc-500"> — {item.note}</span> : null}
                    </span>
                    {item.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => { void queueCancel(expectedWorkspaceId(), item.id).then(setQueueItems); }}
                        title="Cancel this queued step"
                        className="shrink-0 text-zinc-500 hover:text-red-400"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {/* OWN-REPO SHIP BAR (slice 2): when edits are stored on the user's own repo working branch,
                offer a one-click "Ship to main" — it merges navbharatai/work → the repo default via a PR,
                server-side merging ONLY on green CI (your main is never touched until you click this). */}
            {state.ownRepo && !running && (
              <div className="px-3 pt-2 flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={doShipToMain}
                  disabled={shipping || reverting}
                  title={`Merge ‘${state.ownRepo.workBranch}’ into ‘${state.ownRepo.baseBranch}’ (only if CI is green)`}
                  className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-colors"
                >
                  <Rocket className="w-3.5 h-3.5" />
                  {shipping ? 'Shipping…' : `Ship to ${state.ownRepo.baseBranch}`}
                </button>
                <button
                  type="button"
                  onClick={doRevertLastMerge}
                  disabled={shipping || reverting}
                  title={`Undo the last change on ‘${state.ownRepo.baseBranch}’ (restores the previous state as a new commit)`}
                  className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs font-medium border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-50 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {reverting ? 'Reverting…' : 'Revert last'}
                </button>
                <span className="text-[10px] text-zinc-500 truncate">
                  {shipNote ?? `Edits saved on ‘${state.ownRepo.workBranch}’ in ${state.ownRepo.owner}/${state.ownRepo.repo} — your ‘${state.ownRepo.baseBranch}’ is untouched until you ship.`}
                </span>
              </div>
            )}
            {/* Live plan progress (only when there's no pending plan-approval gate, which shows its
                own copy) — lets the user watch the AI work through its real todo list as it builds. */}
            {state.todos.length > 0 && !state.pendingPermission && (
              <div className="px-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPlanCollapsed((v) => !v)}
                  className="w-full flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-200"
                  title={planCollapsed ? 'Expand plan' : 'Minimize plan'}
                >
                  {planCollapsed ? <ChevronRight className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />}
                  {planComplete ? (
                    <span className="text-emerald-500 font-semibold flex items-center gap-1">✓ Done</span>
                  ) : (
                    <>
                      <span>Plan</span>
                      <span className="text-zinc-500">{planDone}/{state.todos.length}</span>
                      {planCollapsed && currentTodo && (
                        <span className="text-zinc-600 truncate normal-case font-normal">· {currentTodo.title}</span>
                      )}
                    </>
                  )}
                </button>
                {!planCollapsed && (
                  <div className="mt-1 max-h-28 overflow-auto">
                    <TodoList todos={state.todos} hideHeader />
                  </div>
                )}
              </div>
            )}
            {/* FULL TEAM HQ (Fix 60): on the 'max' tier a live build gets the premium team card —
                real roster, real plan progress squares, live clock, and the "message the team"
                affordance. Lower tiers keep the plain agent-chip strip (unchanged). */}
            {showTeamHq(running, powerLevel) ? (
              <TeamHqCard agents={state.agents} todos={state.todos} elapsedMs={teamElapsedMs} />
            ) : agents.length > 0 && (
              <div className="px-3 pt-2 flex gap-1.5 overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
                {agents.map((a) => <AgentChip key={a.agent} card={a} running={running} />)}
              </div>
            )}
            {files.length > 0 && (
              <div className="px-3 pt-2 flex flex-wrap gap-1.5">
                {files.map((f, i) => (
                  <span key={i} className="flex items-center gap-1 max-w-[200px] text-[11px] bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-300">
                    <FileText className="w-3 h-3 shrink-0 text-indigo-400" />
                    <span className="truncate">{f.name}</span>
                    <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="shrink-0 text-zinc-500 hover:text-white" title="Remove">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* File inputs now live inside <AttachMenu/> (photo / gallery / file) below. */}
            <div className="flex flex-col gap-1.5 px-2 py-0.5">
              {/* OPTION A (admin 2026-07-19 — "input box gadbad, reposition + attractive"): the input now
                  sits on its OWN full-width row (order-1) and the Build/Plan/Advise MODE SELECTOR + settings
                  + attach sit in a slim toolbar row BELOW it (order-2, flex-wrap so more controls can be
                  added later without squeezing the input). CSS `order` reorders VISUALLY without touching
                  DOM order or any handler — same setChatMode, same dropups (still open upward, now over the
                  input), running dot, thread counts. Input is full-width again (the phone squish is gone). */}
              <div className="flex items-center gap-1 order-2 flex-wrap">
              <div className="relative">
                {modeMenuOpen && (
                  <>
                    {/* outside-click catcher */}
                    <div className="fixed inset-0 z-10" onClick={() => setModeMenuOpen(false)} />
                    <div className="absolute bottom-full left-0 mb-2 z-20 w-60 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-1.5 space-y-0.5">
                      {([['build', 'Build', '🔨'], ['planner', 'Plan', '🧠'], ['advisor', 'Advise', '🔍']] as const).map(([m, label, icon]) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => { setChatMode(m); setModeMenuOpen(false); }}
                          title={m === 'build' ? 'Build — code, build & chat' : m === 'planner' ? 'Plan — read-only planning; approve steps into the build queue' : 'Advise — read-only analysis (audit / scan / compare)'}
                          className={`w-full flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors text-left ${chatMode === m ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                        >
                          <span>{icon}</span>{label}
                          {m === 'build' && running && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" title="A build is running" />}
                          {m === 'planner' && roleThreads.planner.length > 0 && <span className="text-[9px] opacity-70">{Math.ceil(roleThreads.planner.length / 2)}</span>}
                          {m === 'advisor' && roleThreads.advisor.length > 0 && <span className="text-[9px] opacity-70">{Math.ceil(roleThreads.advisor.length / 2)}</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setModeMenuOpen((v) => !v)}
                  title="Chat mode — Build / Plan / Advise"
                  className={`h-7 min-w-[80px] flex items-center justify-between gap-1 px-2 rounded border text-xs font-semibold ${modeMenuOpen ? 'border-indigo-500 text-indigo-300' : 'border-zinc-700 text-zinc-300 hover:text-white'}`}
                >
                  <span className="flex items-center gap-1">
                    <span>{chatMode === 'build' ? '🔨' : chatMode === 'planner' ? '🧠' : '🔍'}</span>
                    {chatMode === 'build' ? 'Build' : chatMode === 'planner' ? 'Plan' : 'Advise'}
                    {running && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" title="A build is running" />}
                  </span>
                  {modeMenuOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                </button>
              </div>
              <div className="flex gap-1 shrink-0">
              {/* Build-options popover (Planning / Thinking / Power) — anchored above the input */}
              <div className="relative shrink-0">
                {settingsOpen && (
                  <>
                    {/* outside-click catcher */}
                    <div className="fixed inset-0 z-10" onClick={() => setSettingsOpen(false)} />
                    <div className="absolute bottom-full left-0 mb-2 z-20 w-56 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-1.5 space-y-0.5">
                      <ToggleRow label="Planning" hint="Plan-first: the AI writes a step-by-step plan and waits for your approval before building" checked={planFirst} disabled={running} onClick={() => setPlanFirst((v) => !v)} />
                      <ToggleRow label="Thinking" hint="Deeper reasoning on build/edit/plan turns — a live reasoning summary streams in the chat (plain chat replies stay instant)" checked={thinking} disabled={running} onClick={() => setThinking((v) => !v)} />
                      {/* Power tiers (admin tier→model redefinition 2026-07-13): Weak (free — GLM/Kimi, never
                          Claude) / Normal (Sonnet, adaptive) / Strong (Sonnet 100%) / Powerful (Opus medium
                          effort) / Full Team (Opus max — ultracode). ALL FIVE are
                          always VISIBLE; a FREE user (powerUnlocked=false) sees the paid four LOCKED (🔒,
                          not selectable) until they recharge — and the server clamps free→weak regardless,
                          so a UI/API bypass can never reach a paid engine. Paid default = Normal. */}
                      <div className="px-3 py-2">
                        <div className="text-sm text-zinc-200 mb-1.5">Power</div>
                        <div className="flex flex-col gap-1">
                          {([
                            { key: 'weak', label: 'Weak' },
                            { key: 'off', label: 'Normal' },
                            { key: 'mini', label: 'Strong 💪' },
                            { key: 'medium', label: 'Powerful' },
                            { key: 'max', label: 'Full Team' },
                          ] as const).map((opt) => {
                            const locked = !powerUnlocked && opt.key !== 'weak';
                            return (
                              <button
                                key={opt.key}
                                type="button"
                                disabled={running || locked}
                                title={locked ? 'Add credits to unlock this tier' : undefined}
                                onClick={() => { if (!locked) setPowerLevel(opt.key); }}
                                className={`w-full px-2.5 py-1.5 rounded text-xs font-medium text-left transition-colors disabled:opacity-50 ${
                                  powerLevel === opt.key
                                    ? 'bg-indigo-600 text-white'
                                    : locked
                                    ? 'bg-zinc-800/50 text-zinc-500 cursor-not-allowed'
                                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                                }`}
                              >
                                <span className="flex items-center justify-between">
                                  <span>{opt.label}</span>
                                  {locked && <span aria-hidden>🔒</span>}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-1">
                          {powerLevel === 'weak'
                            ? 'Free engine — fast & lightweight'
                            : powerLevel === 'off'
                            ? 'Normal — balanced (Sonnet)'
                            : powerLevel === 'mini'
                            ? 'Sonnet · 100%'
                            : powerLevel === 'medium'
                            ? 'Opus · medium effort'
                            : 'Opus · ultracode (max effort)'}
                          {!powerUnlocked && ' · 🔒 recharge (any amount) to unlock all tiers'}
                        </div>
                      </div>
                      <div className="border-t border-zinc-800 my-1" />
                      <button
                        className="w-full flex items-center justify-between px-3 py-2 rounded hover:bg-zinc-800 text-left"
                        onClick={() => { setShowFrameworkPicker(true); setSettingsOpen(false); }}
                      >
                        <span className="text-xs text-zinc-300">Framework</span>
                        <span className="text-[11px] text-indigo-400 font-medium">{FRAMEWORKS.find(f => f.id === framework)?.name ?? 'React + Vite'}</span>
                      </button>
                      <button
                        className="w-full flex items-center justify-between px-3 py-2 rounded hover:bg-zinc-800 text-left"
                        onClick={() => { setShowImportModal(true); setSettingsOpen(false); }}
                      >
                        <span className="text-xs text-zinc-300">Import Repo</span>
                        {importUrl ? <span className="text-[10px] text-green-400 truncate max-w-[100px]">✓ set</span> : <span className="text-[10px] text-zinc-500">GitHub / URL</span>}
                      </button>
                    </div>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setSettingsOpen((v) => !v)}
                  title="Build options"
                  className={`relative h-7 w-9 flex items-center justify-center rounded border ${settingsOpen ? 'border-indigo-500 text-indigo-300' : 'border-zinc-700 text-zinc-400 hover:text-white'}`}
                >
                  <Settings className="w-4 h-4" />
                  {anyToggleOn && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-indigo-400" />}
                </button>
              </div>
              {/* Attach — also carries the "Screenshot → App" option (admin 2026-07-22): people send photos
                  through Attach anyway, so it opens the gallery and builds from the screenshot right here
                  (the SAME flow as the glowing template button — 2 entries, one system). */}
              <AttachMenu
                onFiles={(fl) => addFiles(fl)}
                fileAccept="image/*,.pdf,.txt,.md,.csv,.json,.html,.docx,.xlsx,.xls,.pptx,.js,.ts,.tsx,.jsx,.py,.css"
                disabled={running}
                badge={files.length}
                title="Attach (photo, gallery, file, or a website screenshot → app)"
                buttonClassName="h-7 w-9 flex items-center justify-center rounded border border-zinc-700 text-zinc-400 hover:text-white disabled:opacity-40"
                onZipProject={(f) => void handleZipProject(f)}
                onOpenFolder={() => void handleOpenFolder()}
              />
              {/* Voice to App — INLINE dictation (admin 2026-07-22): tap to speak → text types into THIS
                  input box live; tap again to stop. No separate page. Turns red/pulsing while listening. */}
              <button
                type="button"
                onClick={toggleVoice}
                disabled={running}
                title={listening ? 'Listening… tap to stop' : 'Voice to App — speak to type'}
                aria-pressed={listening}
                className={`h-7 w-9 flex items-center justify-center rounded border disabled:opacity-40 ${listening ? 'border-red-500 text-red-400 bg-red-500/10 animate-pulse' : 'border-zinc-700 text-zinc-400 hover:text-white'}`}
              >
                <Mic className="w-4 h-4" />
              </button>
              {/* TALK TO NAVBHARATAI BY VOICE (admin 2026-08-10: "sabhi me laga do"). Distinct from
                  the dictation mic on its left, which types speech into this box — this opens a live
                  spoken conversation. PAID: the button opens a consent card stating the per-second
                  price in the user's own language first, and renders nothing unless voice is enabled
                  and the user is signed in. */}
              <ProfessionalVoiceButton
                title="Talk to NavBharatAI by voice"
                className="h-7 w-9 flex items-center justify-center rounded border border-zinc-700 text-zinc-400 hover:text-emerald-300"
                icon={<Volume2 className="w-4 h-4" />}
                getHistory={() => convo
                  .filter((m) => (m.text || '').trim())
                  .slice(-12)
                  .map((m) => ({
                    role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
                    content: String(m.text || ''),
                  }))}
              />
              {/* Hidden gallery picker — drives the inline "Screenshot → App" flow for BOTH entry points
                  (the glowing template button and the Attach-menu option). accept=image/* (no capture) so
                  it opens the photo gallery/library. */}
              <input ref={screenshotInputRef} type="file" accept="image/*" className="hidden" onChange={handleScreenshotPicked} />
              </div>{/* /settings + attach row */}
              </div>{/* /toolbar row (order-2): mode selector + settings + attach — below the input */}
              {/* LIVE IMPORT PROGRESS (admin report 2026-08-04). A 161 MB project takes minutes to
                  transfer, and the panel tracked `zipProgress` in state but rendered it NOWHERE — so the
                  screen showed one static "Importing…" line for minutes, which is indistinguishable from
                  a crash ("sab ruk gaya"). A real percentage is the difference between working and frozen. */}
              {zipImporting && (
                <div className="order-1 w-full mb-1 flex items-center gap-2 px-3 py-1.5 rounded-lg border border-indigo-800/60 bg-indigo-950/40 text-[11px] text-indigo-200">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span className="flex-1 truncate">{zipProgress || 'Preparing your project…'}</span>
                  <span className="shrink-0 text-indigo-400">Large projects take a few minutes</span>
                </div>
              )}
              {/* THE SHARED COMPOSER TOOLBAR (admin 2026-08-10: "wahi sabhi jagah laga do"). order-0 so
                  it sits directly above the input, matching every other AI. Clear starts a NEW SESSION
                  rather than emptying the message array: a v5.0 thread owns a workspace, a build lock,
                  a preview and a report, and blanking only the bubbles would leave all of that live
                  underneath — the exact "+New chat leak" class this panel has been root-caused for twice. */}
              <div className="order-0 w-full mb-1">
                <ChatToolbar
                  messageCount={convo.length}
                  sendOnEnter={sendOnEnter}
                  onSendOnEnterChange={setSendOnEnter}
                  searchQuery={chatSearchQuery}
                  onSearchQueryChange={setChatSearchQuery}
                  searchOpen={showChatSearch}
                  onSearchOpenChange={setShowChatSearch}
                  searchMatches={visibleConvo.length}
                  onClear={running ? undefined : newChatFromHistory}
                  charCount={prompt.length}
                />
              </div>
              <div className="relative w-full order-1" data-tour="chat">
                <textarea
                  ref={composerRef}
                  className={`w-full bg-zinc-900 border border-zinc-700 rounded-xl pl-3 pr-16 py-1 text-sm resize-none focus:outline-none focus:border-indigo-500 overflow-y-auto ${composerExpanded ? 'h-[50vh]' : ''}`}
                  rows={1}
                  placeholder={
                    chatMode === 'planner'
                      ? '🧠 Plan mode (read-only) — describe a goal; I plan it with you, then you queue it for the build…'
                      : chatMode === 'advisor'
                      ? '🔍 Advise mode (read-only) — ask for an audit / bug scan / comparison; nothing is built…'
                      : canSteerMidBuild(running, powerLevel, chatMode)
                      ? '⚡ Message the team while they build — they will act on it at the next step…'
                      : 'Type…'
                  }
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onPaste={(e) => {
                    const imgs = (Array.from(e.clipboardData.items) as DataTransferItem[])
                      .filter((it) => it.type.startsWith('image/'))
                      .map((it) => it.getAsFile())
                      .filter((f): f is File => !!f);
                    if (imgs.length > 0) { e.preventDefault(); setFiles((prev) => [...prev, ...imgs].slice(0, 8)); }
                  }}
                  onKeyDown={(e) => {
                    // U7 (audit): Esc stops a running build from the composer.
                    if (e.key === 'Escape' && running) { e.preventDefault(); stop(); return; }
                    // Fix 60 — Full Team steering: while a 'max'-tier build runs, Enter sends the
                    // message TO THE WORKING TEAM (never a new turn — the build lock stays untouched).
                    const steering = canSteerMidBuild(running, powerLevel, chatMode);
                    // U7: Cmd/Ctrl+Enter ALWAYS sends — even on touch or in the expanded editor — so a
                    // finished multiline message ships without reaching for the button.
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && prompt.trim()) { e.preventDefault(); if (steering) sendSteer(); else if (chatMode === 'build') send(); else sendRole(chatMode); return; }
                    // The Enter behaviour used to be GUESSED from the device: laptop sends, phone
                    // inserts a newline. That guess is wrong in both directions — a phone user with a
                    // Bluetooth keyboard could not send from it, and a laptop user writing a long
                    // multi-line spec could not get a newline. It is now the user's own choice via the
                    // toolbar toggle above (shared with every other AI), so nobody is stuck with a
                    // decision the app made for them. The expanded editor still always inserts a
                    // newline — that is an explicit "I am writing something long" mode.
                    if (!composerExpanded && enterShouldSend({
                      key: e.key,
                      shiftKey: e.shiftKey,
                      sendOnEnter,
                      hasContent: !!prompt.trim(),
                      isBusy: false, // a running build is steerable; the branch below picks the right send
                      isComposing: (e.nativeEvent as any)?.isComposing,
                    })) {
                      e.preventDefault();
                      if (steering) sendSteer(); else if (chatMode === 'build') send(); else sendRole(chatMode);
                    }
                  }}
                />
                {/* Expand / minimize the composer so a long message can be read & edited.
                    Hidden while Full Team steering is live — Stop takes this slot then (Fix 60). */}
                {!canSteerMidBuild(running, powerLevel, chatMode) && (
                  <button
                    type="button"
                    onClick={() => setComposerExpanded((v) => !v)}
                    title={composerExpanded ? 'Minimize' : 'Expand'}
                    className={`absolute right-9 ${composerBtnY} h-6 w-6 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800`}
                  >
                    {composerExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                  </button>
                )}
                {chatMode !== 'build' ? (
                  // Plan/Advise are read-only lanes: ALWAYS a Send button (even while a build runs) — they
                  // never take the build lock, so they must be sendable anytime. Disabled only while THEIR
                  // own turn is streaming.
                  <button onClick={() => sendRole(chatMode)} disabled={!prompt.trim() || roleBusy} title={roleBusy ? `${chatMode === 'planner' ? 'Planning' : 'Advising'}…` : 'Send'} className={`absolute right-2 ${composerBtnY} h-6 w-6 flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg text-white`}>
                    {roleBusy ? <TirangaLoader className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                  </button>
                ) : canSteerMidBuild(running, powerLevel, chatMode) ? (
                  // FULL TEAM (Fix 60): the composer stays LIVE mid-build — Send messages the working
                  // team (server /steer); Stop moves to the smaller slot so it stays one tap away.
                  <>
                    <button onClick={stop} title="Stop the build" className={`absolute right-9 ${composerBtnY} h-6 w-6 flex items-center justify-center rounded-lg text-red-400 hover:text-white hover:bg-red-600/80`}>
                      <Square className="w-4 h-4" />
                    </button>
                    <button onClick={sendSteer} disabled={!prompt.trim()} title="Message the team (they act on it at the next step)" className={`absolute right-2 ${composerBtnY} h-6 w-6 flex items-center justify-center bg-gradient-to-br from-indigo-500 to-fuchsia-600 hover:from-indigo-400 hover:to-fuchsia-500 disabled:opacity-40 rounded-lg text-white shadow-[0_0_12px_rgba(129,80,255,0.45)]`}>
                      <Send className="w-4 h-4" />
                    </button>
                  </>
                ) : running ? (
                  <button onClick={stop} title="Stop" className={`absolute right-2 ${composerBtnY} h-6 w-6 flex items-center justify-center bg-red-600 hover:bg-red-500 rounded-lg text-white`}>
                    <Square className="w-4 h-4" />
                  </button>
                ) : (
                  <button onClick={() => { send(); setComposerExpanded(false); }} disabled={!prompt.trim() && files.length === 0} title="Send" className={`absolute right-2 ${composerBtnY} h-6 w-6 flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg text-white`}>
                    <Send className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: merged workspace surfaces. Opened from the header tab pills;
            collapses back to full-width chat via the ✕ button (or re-tapping the
            active pill). On mobile it takes over the area; on desktop it shares.
            PREVIEW PERSISTENCE (admin 2026-07-07): the pane stays MOUNTED and is hidden via CSS when
            collapsed — unmounting it destroyed the preview iframe, so every tab switch / back-to-chat
            lost the rendered preview and forced a full re-build of it. */}
        <div className={`flex-1 sm:flex-none sm:w-1/2 flex-col min-h-0 ${showWorkspace ? 'flex' : 'hidden'}`}>
          <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 border-b border-zinc-800 text-xs">
            <span className="font-medium text-zinc-300 capitalize">{tab}</span>
            <button onClick={() => setShowWorkspace(false)} title="Close workspace (back to chat)" className="flex items-center gap-1 text-zinc-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* U2 (audit Batch 4): on a PHONE, opening the workspace hides the chat column (hidden sm:flex
              above), so the live build progress vanished the moment the user tapped Preview. Keep a
              compact progress strip here — MOBILE ONLY (sm:hidden; desktop keeps the chat split with the
              full indicator) — so the user can watch the preview AND still see what the build is doing.
              Same real WorkingIndicator (current action + elapsed + expandable real activity log). */}
          {(running || state.activity.length > 0) && (
            <div className="sm:hidden shrink-0 px-3 py-1.5 border-b border-zinc-800 bg-zinc-950">
              <WorkingIndicator activity={state.activity} running={running} />
            </div>
          )}

          {/* PREVIEW PERSISTENCE: once the preview has been opened ONCE, PreviewSurface stays
              mounted for the rest of the session (hidden via CSS on other tabs / collapsed chat) —
              the iframe + its rendered app survive tab switches instead of being torn down. First
              mount stays LAZY (previewEverOpened) so a user who never opens Preview never pays the
              in-browser compile / sandbox auto-resume cost. */}
          {previewMounted(previewEverOpened, showWorkspace, tab, previewPrewarm) && (
            <div className={previewWrapClass(showWorkspace, tab)}>
              <PreviewSurface
                url={state.previewUrl}
                // Prefer the live build's workspace, but FALL BACK to this session's derived id when a
                // restored/idle session has no live workspace in state (the "preview gaya" half of the
                // stream-drop bug): PreviewSurface then recompiles from the durable files, exactly like
                // the file-rehydrate effect already does. During a live build state.workspaceId wins.
                workspaceId={expectedWorkspaceId()}
                userId={userId}
                email={email}
                framework={framework}
                // U1 — auto-refresh the preview as files are written during the build (debounced inside).
                reloadSignal={filesVersion}
                // C1 — when the panel is idle (no build running), let the preview auto-boot a dead
                // sandbox ONCE on reopen so a returning user's live preview restores itself instead of
                // requiring a manual "Diagnose" click. Suppressed during an active build (the live URL
                // arrives from the build itself — no need to boot a second sandbox).
                autoResume={!running}
                // A just-imported project must RUN, not sit in Files waiting to be asked about. C1's
                // auto-resume is once-per-workspace by design (it must never loop), so an import into a
                // workspace whose preview already resumed would never boot — this nonce is the explicit
                // "these are new files, install and start them" request. Same model-free path either way.
                bootSignal={previewBootSignal}
                onFixError={(errText) => {
                  // P-UX.3 — prepopulate the chat with the preview error and bring the chat into view
                  // (collapse the workspace) so the user can review and send the fix request.
                  setPrompt(
                    `The in-browser preview failed to build with this error:\n\n${errText}\n\n` +
                      'Please find the cause in the project files and fix it so the app builds and runs.',
                  );
                  setShowWorkspace(false);
                }}
                onFileEdited={(path, content) => {
                  // Visual Editor saved a real edit — keep this panel's OWN Files-tab cache honest, and
                  // push it through the SAME onFilesSync bridge a build's own file writes use, so the
                  // main app's shared files state (Code Studio, sidebar Files, Git) picks it up too.
                  setWorkspaceFiles((prev) => (prev ? { ...prev, [path]: content } : prev));
                  onFilesSync?.({ [path]: content });
                }}
                onAskAiAboutElement={(context) => {
                  // World-best-preview (2026-08-06): the user picked an EXACT element in the preview
                  // (the selection carries its true source location). Prefill the chat with that
                  // reference and bring the chat into view — the user just says WHAT to change, and
                  // the engine edits exactly that element instead of guessing from a description.
                  setPrompt(`I selected the ${context} in the preview. Change this exact element as follows: `);
                  setShowWorkspace(false);
                }}
              />
            </div>
          )}
          {!showWorkspace ? null : tab === 'preview' ? null : tab === 'files' ? (
            // Unified Files — the SAME rich FilesPanel the sidebar "Files" menu uses, so both
            // entry points are ONE feature with two gates. It shows the union of the live v5.0
            // sandbox files (workspaceFiles) and the main-app files (user uploads + already-synced
            // builds via onFilesSync) — i.e. exactly "the files v5.0 built OR the user uploaded".
            // Empty state keeps v5.0's own restore-all safety net (the sandbox-level restore the
            // sidebar's History tab does not provide).
            (() => {
              const unified: Record<string, string> = { ...(filesPanel?.files || {}), ...(workspaceFiles || {}) };
              const hasAny = Object.keys(unified).length > 0;
              if (filesPanel && hasAny) {
                return (
                  <FilesPanel
                    {...filesPanel}
                    files={unified}
                    hasGeneratedCode={hasAny}
                    // REAL delete in the unified view: the parent's onDeleteFile purges the main-app
                    // state + IndexedDB + the v5.0 durable store — but this panel's OWN sandbox-files
                    // cache (workspaceFiles) also lists the path, so purge it here too or the row
                    // reappears in the union and the delete looks fake.
                    onDeleteFile={(path: string) => {
                      setWorkspaceFiles((prev) => {
                        if (!prev) return prev;
                        const next = { ...prev };
                        delete next[path];
                        return next;
                      });
                      filesPanel.onDeleteFile?.(path);
                    }}
                  />
                );
              }
              return (
                <div className="flex-1 overflow-auto p-3 font-mono text-xs">
                  <div className="flex flex-col items-start gap-2">
                    <Empty>No files shown.</Empty>
                    {state.workspaceId && (
                      <button
                        onClick={handleRestoreAll}
                        disabled={restoring}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-indigo-700/60 text-indigo-300 hover:text-white hover:border-indigo-500 disabled:opacity-40"
                      >
                        {restoring ? <TirangaLoader className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                        {restoring ? 'Restoring…' : 'Restore all files'}
                      </button>
                    )}
                    {restoreMsg && <span className="text-[11px] text-zinc-400">{restoreMsg}</span>}
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="flex-1 overflow-auto p-3 font-mono text-xs">
              {tab === 'diff' && (diffPaths.length === 0 ? <Empty>No diffs yet.</Empty> : (
                <div className="space-y-3">
                  {diffPaths.map((p) => <div key={p}><div className="text-zinc-400 mb-1">{p}</div><pre className="whitespace-pre-wrap">{colorizeDiff(state.diffs[p])}</pre></div>)}
                </div>
              ))}
              {tab === 'terminal' && (state.terminal.length === 0 ? <Empty>No terminal output yet.</Empty> : (
                <pre className="whitespace-pre-wrap text-zinc-300">{state.terminal.join('\n')}</pre>
              ))}
              {tab === 'history' && (
                <div className="space-y-2">
                  {/* Restore the WHOLE project at once — a real restore (files written back into the
                      workspace), available even when there are no in-session checkpoints (e.g. after a reload). */}
                  {state.workspaceId && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={handleRestoreAll}
                        disabled={restoring}
                        title="Bring your whole project back into the workspace"
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-indigo-700/60 text-indigo-300 hover:text-white hover:border-indigo-500 disabled:opacity-40"
                      >
                        {restoring ? <TirangaLoader className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                        {restoring ? 'Restoring…' : 'Restore all files'}
                      </button>
                      {restoreMsg && <span className="text-[11px] text-zinc-400">{restoreMsg}</span>}
                    </div>
                  )}
                  {gitStatus && (
                    <div className="mb-2 flex items-center gap-2 text-[11px] px-2 py-1 rounded bg-zinc-800/60 border border-white/5">
                      <GitBranch className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                      {!gitStatus.available ? (
                        <span className="text-zinc-500">Workspace is dormant — send a message to bring it back online.</span>
                      ) : gitStatus.live === false ? (
                        <span className="text-zinc-400">Last saved: working tree clean{gitStatus.head ? ` · on ${gitStatus.head}` : ''}{gitStatus.lastCommit ? ` · ${gitStatus.lastCommit.slice(0, 48)}` : ''}</span>
                      ) : gitStatus.clean ? (
                        <span className="text-emerald-400">Working tree clean{gitStatus.head ? ` · on ${gitStatus.head}` : ''}</span>
                      ) : (
                        <span className="text-amber-400">{gitStatus.changed} uncommitted change{gitStatus.changed === 1 ? '' : 's'}{gitStatus.head ? ` · on ${gitStatus.head}` : ''}</span>
                      )}
                    </div>
                  )}
                  {restoreNote && (
                    <div className="mb-2 text-[11px] text-zinc-400 bg-zinc-800/60 border border-white/5 rounded px-2 py-1">{restoreNote}</div>
                  )}
                  {allCheckpoints.length === 0 ? <Empty>No checkpoints yet.</Empty> : (
                    <ul className="space-y-1">
                      {allCheckpoints.map((c) => (
                        <li key={c.id} className="flex items-center gap-2">
                          <History className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                          <span className="text-zinc-500 shrink-0">{c.sha.slice(0, 7) || '—'}</span>
                          <span className="flex-1 truncate">{c.message}</span>
                          {c.sha && (
                            <button onClick={() => handleRestoreCheckpoint(c.sha)} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 shrink-0" title="Restore to this checkpoint">
                              <RotateCcw className="w-3 h-3" /> Restore
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Mobile footer sheets (admin 2026-07-07): History and More open as bottom sheets anchored
          above the app's bottom nav (which stays tappable — backdrop and sheet sit BELOW its z-150).
          lg:hidden — on desktop these controls live in the header exactly as before. */}
      {mobileFooter && mobileSheet && (
        <>
          <div className="fixed inset-0 z-[140] bg-black/50 cursor-pointer touch-manipulation lg:hidden" onClick={() => setMobileSheet(null)} aria-hidden="true" />
          <div
            className="fixed inset-x-0 z-[145] lg:hidden max-h-[70vh] overflow-y-auto rounded-t-2xl border-t border-zinc-700 bg-zinc-900 shadow-2xl pb-2"
            style={{ bottom: 'calc(3.5rem + env(safe-area-inset-bottom, 0px))' }}
          >
            <div className="sticky top-0 z-10 bg-zinc-900 flex items-center justify-between px-4 pt-3 pb-2 border-b border-zinc-800">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                {mobileSheet === 'history' ? 'Session history' : mobileSheet === 'report' ? 'Which build had the problem?' : 'More'}
              </span>
              <button onClick={() => setMobileSheet(null)} aria-label="Close" className="p-1 rounded text-zinc-400 hover:text-white touch-manipulation">
                <X className="w-4 h-4" />
              </button>
            </div>
            {mobileSheet === 'history' ? (
              <div className="py-1.5">{historyListBody}</div>
            ) : mobileSheet === 'report' ? (
              <div>{reportPickerRows((b) => { setMobileSheet(null); void sendReportToAdmin(b); }, true)}</div>
            ) : (
              <div className="py-1.5">
                {/* Framework — moved here from the header (admin: "React + Vite ko More me bhej do") */}
                <button
                  onClick={() => { setMobileSheet(null); setShowFrameworkPicker(true); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-800 touch-manipulation"
                >
                  <span className="w-4 text-center shrink-0">{FRAMEWORKS.find(f => f.id === framework)?.iconChar ?? '⚛'}</span>
                  <span className="flex-1 text-left">Framework</span>
                  <span className="text-xs text-zinc-500">{FRAMEWORKS.find(f => f.id === framework)?.name ?? 'React + Vite'}</span>
                </button>
                <button onClick={() => openSurfaceFromFooter('diff')} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-800 touch-manipulation">
                  <FileDiff className="w-4 h-4 shrink-0 text-zinc-400" />
                  <span className="flex-1 text-left">Diff</span>
                  <span className="text-xs text-zinc-500">{diffPaths.length}</span>
                </button>
                <button onClick={() => openSurfaceFromFooter('terminal')} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-800 touch-manipulation">
                  <Terminal className="w-4 h-4 shrink-0 text-zinc-400" />
                  <span className="flex-1 text-left">Terminal</span>
                </button>
                <button onClick={() => openSurfaceFromFooter('history')} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-800 touch-manipulation">
                  <History className="w-4 h-4 shrink-0 text-zinc-400" />
                  <span className="flex-1 text-left">Checkpoints</span>
                  <span className="text-xs text-zinc-500">{allCheckpoints.length}</span>
                </button>
                {/* Report to admin (admin 2026-07-29): one action, admin-only report — no download,
                    no copy, no history browser. Submits this build's report to NavBharatAI. */}
                <button
                  onClick={() => { setMobileSheet(null); void openReportPicker('sheet'); }}
                  disabled={reportSending || !state.workspaceId}
                  className="w-full flex items-start gap-3 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-40 touch-manipulation"
                >
                  {reportSent || reportCount > 0
                    ? <Check className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                    : <FileText className="w-4 h-4 shrink-0 mt-0.5 text-zinc-400" />}
                  <span className="flex-1 text-left">
                    {reportButtonLabel({ sending: reportSending, justSent: reportSent, count: reportCount })}
                    {/* The count alone answers "did mine go through?"; this line says outright that a
                        second send adds nothing — the actual ask behind "duplicate report na ho". */}
                    {reportCount > 0 && !reportSending && (
                      <span className="block text-[11px] text-zinc-500 leading-snug">{reportAlreadySentHint(reportCount)}</span>
                    )}
                  </span>
                </button>
                {state.repoUrl && (
                  <a
                    href={state.repoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-800 touch-manipulation"
                  >
                    <Github className="w-4 h-4 shrink-0 text-zinc-400" />
                    <span className="flex-1 text-left">GitHub{state.repoFullName ? ` — ${state.repoFullName}` : ''}</span>
                    <ExternalLink className="w-3 h-3 opacity-60" />
                  </a>
                )}
                <button
                  onClick={() => { setMobileSheet(null); setShowHostingChooser(true); }}
                  disabled={running || !state.workspaceId}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-emerald-300 hover:bg-zinc-800 disabled:opacity-40 touch-manipulation"
                >
                  <Rocket className="w-4 h-4 shrink-0" />
                  <span className="flex-1 text-left">Publish — host on NavBharatAI or your own provider</span>
                </button>
                {liveUrl && (
                  <a
                    href={liveUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-emerald-300 hover:bg-zinc-800 touch-manipulation"
                  >
                    <Globe className="w-4 h-4 shrink-0" />
                    <span className="flex-1 text-left truncate">Live site — {liveUrl.replace(/^https?:\/\//, '')}</span>
                    <ExternalLink className="w-3 h-3 opacity-60" />
                  </a>
                )}
                <div className="my-1 border-t border-zinc-800" />
                <button
                  onClick={newChatFromHistory}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-800 touch-manipulation"
                >
                  <Plus className="w-4 h-4 shrink-0 text-indigo-400" />
                  <span className="flex-1 text-left">New chat</span>
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* LOUD open-failure toast — a history chat that fails to open must say WHY, never no-op. */}
      {openChatError && (
        <div className="fixed inset-x-3 bottom-20 z-[70] sm:left-auto sm:right-4 sm:max-w-md rounded-xl border border-red-500/40 bg-red-950/95 text-red-100 text-xs leading-relaxed shadow-2xl p-3 pr-8">
          {openChatError}
          <button
            type="button"
            onClick={() => setOpenChatError(null)}
            aria-label="Dismiss"
            className="absolute top-2 right-2 p-1 rounded text-red-300 hover:text-white touch-manipulation"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Framework Picker Modal */}
      {showFrameworkPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowFrameworkPicker(false)} />
          {/* Capped + scrollable — an uncapped modal grows past a phone screen and everything below the
              fold becomes unreachable (see the Import/Push modal below for the reported instance). */}
          <div className="relative z-10 w-full max-w-sm max-h-[85vh] overflow-y-auto overscroll-contain bg-[#0d1117] border border-white/10 rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-widest">Choose Framework</h3>
                <p className="text-[10px] text-[#8b949e] mt-0.5">Pick the technology stack for your new project</p>
              </div>
              <button onClick={() => setShowFrameworkPicker(false)} className="text-zinc-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <FrameworkPicker value={framework} onChange={pickFramework} />
            <button
              onClick={() => setShowFrameworkPicker(false)}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-all"
            >
              Confirm
            </button>
          </div>
        </div>
      )}

      {/* Import Repo Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowImportModal(false)} />
          {/* ROOT CAUSE of "PUSH button kaam ka nahi hai" (admin 2026-08-03): this card had NO height cap
              and NO scroll, so on a phone it grew past the screen. In PUSH mode the commit-message field
              and — critically — the push RESULT banner render near the BOTTOM, i.e. below the fold with
              no way to reach them. The push itself ran fine (real blobs → tree → commit → ref); its only
              feedback was simply off-screen, so the button felt dead. Same class as the Publish sheet
              (#2037) — this was its surviving sibling. Cap at the viewport and scroll. */}
          <div className="relative z-10 w-full max-w-sm max-h-[85vh] overflow-y-auto overscroll-contain bg-[#0d1117] border border-white/10 rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-widest">{modalMode === 'push' ? 'Push to GitHub' : 'Import Project'}</h3>
                <p className="text-[10px] text-[#8b949e] mt-0.5">{modalMode === 'push' ? 'Publish your current app to one of your GitHub repos' : 'Clone a GitHub repo into your v5.0 workspace'}</p>
              </div>
              <button onClick={() => setShowImportModal(false)} className="text-zinc-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* Import / Push toggle — one connection, both directions. */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-black/40 rounded-xl border border-white/10">
              {(['import', 'push'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setModalMode(m); setPushResult(null); }}
                  className={`py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all ${modalMode === m ? 'bg-indigo-600 text-white' : 'text-[#8b949e] hover:text-white'}`}
                >
                  {m === 'import' ? 'Import' : 'Push'}
                </button>
              ))}
            </div>
            {/* PRIMARY: the 1-click repo picker (states: connect → loading → list/empty → error) */}
            {ghReposError === 'auth' ? (
              <div className="space-y-2 text-center py-2">
                <p className="text-[11px] text-[#8b949e]">Connect your GitHub once — then every import is a single click on a repo.</p>
                <button
                  type="button"
                  onClick={() => void connectGitHub()}
                  disabled={ghConnecting}
                  aria-busy={ghConnecting}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 active:scale-[0.98] disabled:opacity-70 disabled:cursor-wait text-white text-sm font-bold rounded-xl transition-all touch-manipulation"
                >
                  {ghConnecting
                    ? <><TirangaLoader className="w-4 h-4" /> Connecting…</>
                    : <><Github className="w-4 h-4" /> Connect GitHub</>}
                </button>
                <p className="text-[10px] text-[#484f58]">You'll be taken to GitHub to sign in and approve access (private repos included), then brought right back here.</p>
                {/* Reliable fallback (works even inside the app, where the OAuth redirect can't return): */}
                <button
                  type="button"
                  onClick={() => setShowTokenPaste((v) => !v)}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 underline touch-manipulation"
                >
                  {showTokenPaste ? 'Hide token option' : 'Not working? Paste a GitHub token instead'}
                </button>
                {showTokenPaste && (
                  <div className="space-y-2 text-left bg-white/5 border border-white/10 rounded-xl p-3">
                    <p className="text-[10px] text-[#8b949e] leading-relaxed">
                      Create a token at{' '}
                      <a href="https://github.com/settings/tokens/new?scopes=repo,workflow&description=NavBharatAI" target="_blank" rel="noopener noreferrer" className="text-indigo-400 underline">github.com/settings/tokens</a>{' '}
                      with the <span className="font-mono text-indigo-300">repo</span> scope, then paste it here — this works for your private repos on any device.
                    </p>
                    <input
                      type="password"
                      value={pastedToken}
                      onChange={(e) => setPastedToken(e.target.value)}
                      placeholder="ghp_… or github_pat_…"
                      autoComplete="off"
                      className="w-full bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-[#484f58] font-mono focus:outline-none focus:border-indigo-500/50"
                    />
                    <button
                      type="button"
                      onClick={() => void submitPastedToken()}
                      disabled={!pastedToken.trim() || tokenBusy}
                      className="w-full flex items-center justify-center gap-2 py-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 active:scale-[0.98] disabled:opacity-60 disabled:cursor-wait text-white text-xs font-bold rounded-lg transition-all touch-manipulation"
                    >
                      {tokenBusy ? <><TirangaLoader className="w-3.5 h-3.5" /> Verifying…</> : 'Use this token'}
                    </button>
                    {tokenError && <p className="text-[10px] text-amber-300">{tokenError}</p>}
                  </div>
                )}
              </div>
            ) : ghReposLoading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-[#8b949e] text-xs">
                <TirangaLoader className="w-4 h-4" /> Loading your repositories…
              </div>
            ) : ghReposError ? (
              <div className="space-y-2 text-center py-2">
                <p className="text-[11px] text-amber-300">{ghReposError}</p>
                <button type="button" onClick={() => void loadGhRepos()} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-zinc-200 text-xs font-semibold rounded-xl touch-manipulation">Retry</button>
              </div>
            ) : ghRepos && ghRepos.length === 0 ? (
              <p className="text-[11px] text-[#8b949e] text-center py-3">No repositories found on your GitHub account — paste a URL below instead.</p>
            ) : ghRepos ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={repoSearch}
                  onChange={(e) => setRepoSearch(e.target.value)}
                  placeholder={`Search ${ghRepos.length} repositories…`}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-[#484f58] focus:outline-none focus:border-indigo-500/50"
                />
                <div className="max-h-56 overflow-y-auto rounded-xl border border-white/10 divide-y divide-white/5">
                  {ghRepos
                    .filter((r) => !repoSearch.trim() || r.fullName.toLowerCase().includes(repoSearch.trim().toLowerCase()))
                    .slice(0, 60)
                    .map((r) => (
                      <button
                        key={r.fullName}
                        type="button"
                        onClick={() => (modalMode === 'push' ? void pushToRepo(r.fullName) : importRepo(r.url))}
                        disabled={running || importSending || pushBusy}
                        title={running ? 'A build is running — wait for it to finish' : modalMode === 'push' ? `Push your current app to ${r.fullName}` : `Import ${r.fullName} into this workspace`}
                        className="w-full text-left px-3 py-2.5 hover:bg-white/5 active:bg-white/10 disabled:opacity-40 touch-manipulation"
                      >
                        <span className="flex items-center gap-2">
                          <Github className="w-3.5 h-3.5 text-[#8b949e] shrink-0" />
                          <span className="text-xs text-white truncate font-medium">{r.fullName}</span>
                          {r.isPrivate && <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20">private</span>}
                          {r.updatedAt > 0 && <span className="shrink-0 ml-auto text-[10px] text-[#484f58]">{relTime(r.updatedAt)}</span>}
                        </span>
                        {r.description && <span className="block mt-0.5 pl-5 text-[10px] text-[#8b949e] truncate">{r.description}</span>}
                      </button>
                    ))}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] text-[#484f58]">{modalMode === 'push' ? 'Click a repo to push your current app to it. New repos are created automatically.' : 'Click a repo — it imports, opens in Files/IDE, boots the preview, and the AI surveys it. One click.'}</p>
                  <button type="button" onClick={disconnectGh} className="shrink-0 text-[10px] text-[#8b949e] hover:text-white underline underline-offset-2 touch-manipulation">Wrong account?</button>
                </div>
              </div>
            ) : null}

            {/* PUSH mode: an optional commit message; the click on a repo above does the real push. */}
            {modalMode === 'push' && ghReposError !== 'auth' && (
              <div className="pt-1 border-t border-white/10 space-y-2">
                <label className="text-[10px] font-bold text-[#8b949e] uppercase tracking-widest">Commit message (optional)</label>
                <input
                  type="text"
                  value={pushCommitMsg}
                  onChange={e => setPushCommitMsg(e.target.value)}
                  placeholder="Update from NavBharatAI Pro v5.0"
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-[#484f58] focus:outline-none focus:border-indigo-500/50"
                />
                <p className="text-[10px] text-[#484f58]">Secrets (.env, keys, service-account files) are never pushed. If a repo already has newer commits, we ask you to import first instead of overwriting.</p>
              </div>
            )}

            {/* SECONDARY (import only): paste any repo URL (e.g. someone else's public repo) */}
            {modalMode === 'import' && (
              <div className="pt-1 border-t border-white/10 space-y-2">
                <label className="text-[10px] font-bold text-[#8b949e] uppercase tracking-widest">Or paste a repository URL</label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={importUrl}
                    onChange={e => setImportUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo"
                    className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-[#484f58] focus:outline-none focus:border-indigo-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => { const u = importUrl.trim(); if (u) { setImportUrl(''); importRepo(u); } }}
                    disabled={running || importSending || !/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+/.test(importUrl.trim())}
                    className="shrink-0 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold rounded-xl touch-manipulation"
                  >
                    Import
                  </button>
                </div>
              </div>
            )}

            {/* Push status / result (honest: shows pushing, success with a real repo link, or the reason).
                STICKY: this is the ONLY feedback a push gives, and it lives below the repo list — on a
                phone that put it off-screen, which is exactly why the button felt dead. Pinned to the
                bottom of the scroll area so the answer is visible the moment a repo is tapped. */}
            {(pushBusy || pushResult) && (
              <div className={`sticky bottom-0 z-10 flex items-start gap-2 p-3 rounded-xl border text-[11px] backdrop-blur-sm ${pushResult && !pushResult.ok ? 'bg-amber-950/80 border-amber-500/30 text-amber-200' : 'bg-indigo-950/80 border-indigo-500/30 text-indigo-100'}`}>
                {pushBusy ? <TirangaLoader className="w-4 h-4 shrink-0 mt-0.5" /> : pushResult?.ok ? <Github className="w-4 h-4 shrink-0 mt-0.5" /> : <X className="w-4 h-4 shrink-0 mt-0.5" />}
                <div className="min-w-0">
                  <p>{pushResult?.text || 'Pushing…'}</p>
                  {pushResult?.ok && pushResult.url && (
                    <a href={pushResult.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 break-all hover:text-white">{pushResult.url}</a>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A live, waving Indian flag (tiranga) 🇮🇳 shown while an agent is working — replacing the old
 * loading spinner. The wave is driven by requestAnimationFrame writing an INLINE transform each
 * frame (not a CSS animation), so it cannot be killed by the global prefers-reduced-motion reset
 * that was freezing the spinner. When the work finishes, the caller swaps this for a green check.
 */
function WavingTiranga({ size = 16 }: { size?: number }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    let raf = 0;
    let start = 0;
    const tick = (t: number) => {
      // Respect the user's "Reduce Animations" choice (Settings → General): hold the flag static.
      if (document.documentElement.classList.contains('nb-reduce-motion')) {
        if (ref.current) ref.current.style.transform = 'none';
        raf = requestAnimationFrame(tick); // keep checking so it resumes if they toggle back
        return;
      }
      if (!start) start = t;
      const e = (t - start) / 1000;
      // Flutter: the trailing (right) edge swings while the pole (left) edge stays — a cloth-in-wind feel.
      const skew = Math.sin(e * 6) * 9;
      const rot = Math.sin(e * 6 + 0.9) * 3.2;
      const sy = 1 + Math.sin(e * 6) * 0.07;
      if (ref.current) ref.current.style.transform = `skewY(${skew}deg) rotate(${rot}deg) scaleY(${sy})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const h = Math.max(8, Math.round(size * 0.7));
  const chakra = Math.max(2.5, h / 3.2);
  return (
    <span
      ref={ref}
      role="img"
      aria-label="Indian flag waving"
      className="inline-flex flex-col rounded-[1.5px] overflow-hidden shrink-0 shadow-sm"
      style={{ width: size, height: h, transformOrigin: 'left center', willChange: 'transform' }}
    >
      <span style={{ flex: 1, background: '#FF9933' }} />
      <span style={{ flex: 1, background: '#ffffff', position: 'relative' }}>
        <span style={{ position: 'absolute', top: '50%', left: '50%', width: chakra, height: chakra, transform: 'translate(-50%,-50%)', borderRadius: '50%', border: '1px solid #000080' }} />
      </span>
      <span style={{ flex: 1, background: '#138808' }} />
    </span>
  );
}

/** Pick a small icon for an activity entry from its kind / action verb. */
function activityIcon(e: ActivityEntry): string {
  if (e.kind === 'file') return '📄';
  if (e.kind === 'agent') return '👥';
  if (e.kind === 'preview') return '🌐';
  if (e.kind === 'plan') return '🗒️';
  // tool — derive from the human verb so reading/writing/running each read distinctly.
  if (/^writing/.test(e.text)) return '✍️';
  if (/^editing/.test(e.text)) return '✏️';
  if (/^reading/.test(e.text)) return '📖';
  if (/^running/.test(e.text)) return '⌨️';
  if (/^searching|^listing/.test(e.text)) return '🔍';
  if (/^recalling/.test(e.text)) return '🧠';
  if (/^evaluating/.test(e.text)) return '🔬';
  return '⚙️';
}


function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

/**
 * Live, Claude-style "working…" indicator. Collapsed it shows the CURRENT action (the latest real
 * engine activity) + elapsed time + a chevron; expanded it reveals the full ordered activity log
 * (every tool call, file write, command, agent spawn, preview) plus todo progress — so the user can
 * see exactly what the build is doing instead of a frozen-looking "working… 12s". All entries are
 * REAL engine events (state.activity); no synthetic activity. Renders while running, and stays as a
 * collapsed "view activity" expander after the build finishes so the work is reviewable.
 */
function WorkingIndicator({ activity, running }: { activity: ActivityEntry[]; running: boolean }) {
  const [nowTick, setNowTick] = useState(() => Date.now());
  const mountTsRef = useRef(Date.now());

  // Tick the elapsed clock only while running. On stop (done OR error) the time FREEZES at the
  // last real value — it is derived from the activity timestamps, so it can never reset to 0.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const startTs = activity.length ? activity[0].ts : mountTsRef.current;
  const endTs = running ? nowTick : (activity.length ? activity[activity.length - 1].ts : startTs);
  const elapsed = fmtElapsed(endTs - startTs);

  // Current action: the newest still-in-flight tool, else the newest entry.
  const current = [...activity].reverse().find((a) => a.active) ?? activity[activity.length - 1];

  // Admin 2026-07-21 ("sari file last me time ke sath dikhane se behatar — chat me hi dikhe; last me
  // bas time"): the per-step log that used to expand here duplicated the chat's action rows, where
  // every file already streams live. The indicator is now a single honest line — the live current
  // action + clock while running, just "Done · <time>" once finished.
  return (
    <div className="text-xs text-zinc-500 w-full max-w-[90%]">
      <div className="flex items-center gap-2 w-full text-left">
        {running ? <WavingTiranga size={16} /> : <span className="text-emerald-400">✓</span>}
        <span className="truncate flex-1">{running ? `${current ? `${activityIcon(current)} ${current.text}` : 'working…'}` : 'Done'}</span>
        {running && current?.active && <span className="inline-block w-1 h-3 bg-current animate-pulse shrink-0" />}
        <span className="shrink-0 tabular-nums text-zinc-600">{elapsed}</span>
      </div>
    </div>
  );
}

/**
 * Smooth typewriter reveal. Provider chunks can arrive in bursts (a whole line at
 * once); this reveals the text at a steady character cadence so the typing always
 * looks smooth, then snaps to the full text the moment streaming ends. Reveal speed
 * auto-catches up when a lot of text is buffered, so it never lags far behind.
 */
function TypewriterText({ text, streaming }: { text: string; streaming?: boolean }) {
  const [shown, setShown] = useState(streaming ? 0 : text.length);
  useEffect(() => {
    if (!streaming) { setShown(text.length); return; }
    const id = setInterval(() => {
      setShown((s) => {
        if (s >= text.length) return s;
        const behind = text.length - s;
        // Steady ~2 chars/tick (~120 cps), but speed up if we're far behind so the
        // visible text never trails the real output by more than a moment.
        const step = behind > 240 ? Math.ceil(behind / 60) : 2;
        return Math.min(text.length, s + step);
      });
    }, 16);
    return () => clearInterval(id);
  }, [text, streaming]);
  return <>{streaming ? text.slice(0, Math.min(shown, text.length)) : text}</>;
}

function Bubble({ msg, onUnsend, onEdit, onSaveTemplate }: { msg: ChatMsg; onUnsend?: () => void; onEdit?: () => void; onSaveTemplate?: () => void }) {
  if (msg.role === 'user') {
    return (
      <div className="group flex flex-col items-end">
        <div className="max-w-[85%] bg-indigo-600 text-white rounded-2xl rounded-br-sm px-3 py-2 text-sm break-words">
          <FoldableMessage text={msg.text} className="whitespace-pre-wrap" />
        </div>
        {/* Copy / fold on every user message; Edit + Unsend attach ONLY to the LAST user message (slice 2). */}
        <div className="mt-0.5 pr-1 opacity-70 group-hover:opacity-100 transition-opacity">
          <MessageActions text={msg.text} onUnsend={onUnsend} onEdit={onEdit} onSaveTemplate={onSaveTemplate} />
        </div>
      </div>
    );
  }
  const isThinking = msg.kind === 'thinking';
  const cursor = msg.streaming ? <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle bg-current animate-pulse" /> : null;
  return (
    <div className="group flex flex-col items-start">
      <div className="max-w-[90%]">
        {msg.agent && msg.agent !== 'architect' && (
          <div className="text-[10px] uppercase tracking-wide text-indigo-400 mb-0.5">{msg.agent}</div>
        )}
        <div
          className={
            isThinking
              ? 'text-zinc-500 italic text-xs px-3 py-2 whitespace-pre-wrap break-words'
              : 'bg-zinc-900 text-zinc-100 rounded-2xl rounded-bl-sm px-3 py-2 text-sm break-words'
          }
        >
          {/* A finished AI reply folds when long + gets a copy action; while streaming it just types out. */}
          {msg.streaming
            ? <><TypewriterText text={msg.text} streaming={msg.streaming} />{cursor}</>
            : <FoldableMessage text={msg.text} className="whitespace-pre-wrap" />}
        </div>
      </div>
      {!isThinking && !msg.streaming && (
        <div className="mt-0.5 pl-1 opacity-70 group-hover:opacity-100 transition-opacity">
          <MessageActions text={msg.text} />
        </div>
      )}
    </div>
  );
}

/** Status icon for a single todo — lets the user watch the agent work through its plan live. */
function todoStatusIcon(status: TodoStatus) {
  switch (status) {
    case 'done': return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
    case 'in_progress': return <TirangaLoader className="w-3.5 h-3.5 text-indigo-400 shrink-0" />;
    case 'blocked': return <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
    default: return <Circle className="w-3.5 h-3.5 text-zinc-600 shrink-0" />; // pending
  }
}

/**
 * R2 §4.6 — Build-health card. Shows the OBJECTIVE readiness verdict from the mandatory quality
 * gate (real `evaluate` scan): a 0–100 score, READY / NOT READY, and the exact blockers/warnings.
 * Honest by construction — the same gate that decides whether a build is reported as a success.
 */
/**
 * P-UX.6 — CSAT feedback on a finished build. Fires trackEvent('feedback', …) and remembers (per
 * workspace, in localStorage) so the user is asked at most once per build. Dependency-free.
 */
function BuildFeedback({ workspaceId }: { workspaceId: string }) {
  const key = `nbai:feedback:${workspaceId}`;
  const [rated, setRated] = useState<null | 'up' | 'down'>(() => {
    try { const v = localStorage.getItem(key); return v === 'up' || v === 'down' ? v : null; } catch { return null; }
  });
  const rate = (score: 'up' | 'down') => {
    if (rated) return;
    setRated(score);
    try { localStorage.setItem(key, score); } catch { /* ignore */ }
    try { trackEvent('feedback', { score: score === 'up' ? 1 : -1, surface: 'agentv3_build', workspaceId }); } catch { /* best-effort */ }
  };
  if (rated) {
    return <div className="mt-1 text-[11px] text-zinc-500">Thanks for the feedback{rated === 'down' ? ' — we’ll keep improving.' : '!'}</div>;
  }
  return (
    <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
      <span>Was this build helpful?</span>
      <button onClick={() => rate('up')} aria-label="Helpful" className="p-1 rounded hover:bg-white/5 hover:text-emerald-400 transition-colors">
        <ThumbsUp className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => rate('down')} aria-label="Not helpful" className="p-1 rounded hover:bg-white/5 hover:text-rose-400 transition-colors">
        <ThumbsDown className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/**
 * The user-facing build-health card. The readiness engine's lines are deliberately FORENSIC
 * ("hardcoded-secret @ server/index.js:24 — …") because the repair loop and the admin Report need
 * file:line precision. But the CARD is a user surface, so it renders SHORT plain-language lines via
 * simplifyHealthLines — de-duplicated and capped (admin 2026-08-02: "itna bada aur complex likhne ki
 * need nahi hai — simple aur short karo"). Every detail stays available in the Report.
 */
function BuildHealthCard({ health }: { health: BuildHealth }) {
  const ready = health.ready;
  const blockers = simplifyHealthLines(health.blockers, 3);
  const warnings = simplifyHealthLines(health.warnings, 2);
  const more = blockers.more + warnings.more;
  return (
    <div className={`mt-1 rounded-lg border px-2.5 py-1.5 text-[11px] ${ready ? 'border-emerald-800/60 bg-emerald-950/30' : 'border-amber-800/60 bg-amber-950/30'}`}>
      <div className="flex items-center gap-1.5 font-semibold">
        {ready
          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          : <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
        <span className={ready ? 'text-emerald-300' : 'text-amber-300'}>Build health: {ready ? 'READY' : 'NOT READY'}</span>
        <span className="text-zinc-500">· {health.score}/100</span>
      </div>
      {blockers.lines.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-amber-200/90">
          {blockers.lines.map((b, i) => (
            <li key={`b${i}`} className="flex gap-1"><span className="text-amber-500">✗</span><span>{b}</span></li>
          ))}
        </ul>
      )}
      {warnings.lines.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-zinc-400">
          {warnings.lines.map((w, i) => (
            <li key={`w${i}`} className="flex gap-1"><span className="text-zinc-500">•</span><span>{w}</span></li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <div className="mt-1 text-[10px] text-zinc-500">+{more} more · see Report for details</div>
      )}
    </div>
  );
}

/**
 * The agent's live plan/todo list with real status (done ✓ / in-progress ⏳ / pending ○ / blocked ⚠)
 * and a progress count — so the build is engaging and honest: the user sees exactly what the AI is
 * doing and how far along it is, driven by real `todo_updated` events (never a fake animation).
 */
function TodoList({ todos, hideHeader }: { todos: TodoItem[]; hideHeader?: boolean }) {
  if (!todos.length) return null;
  const done = todos.filter((t) => t.status === 'done').length;
  return (
    <div className="text-left">
      {!hideHeader && (
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 mb-1">
          <span>Plan</span>
          <span className="text-zinc-500">{done}/{todos.length}</span>
        </div>
      )}
      <ul className="space-y-1">
        {todos.map((t) => (
          <li key={t.id} className="flex items-center gap-1.5 text-xs">
            {todoStatusIcon(t.status)}
            <span className={t.status === 'done' ? 'line-through text-zinc-500' : 'text-zinc-200'}>{t.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}


/**
 * FULL TEAM HQ (Fix 60) — the 'max' tier's premium live-team card, shown above the composer while
 * a build runs. Everything on it is REAL engine state (admin rule: no scripted animation):
 *   • roster = the Architect + every spawned specialist (agent_spawned/agent_done events),
 *   • the working pulse = each agent's live `active` flag,
 *   • progress squares = the REAL plan (todos done / in-progress / pending),
 *   • the clock = real elapsed wall time.
 * Visual language mirrors the Claude-Code background-task card (name · N agents · elapsed · squares).
 */
function TeamHqCard({ agents, todos, elapsedMs }: { agents: Record<string, AgentCard>; todos: TodoItem[]; elapsedMs: number }) {
  const m = teamHqModel(agents, todos);
  const squares = m.progress.total > 0 ? todos.slice(0, 24) : [];
  return (
    <div className="mx-2 mt-2 rounded-xl p-[1px] bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-amber-400 shadow-[0_0_18px_rgba(129,80,255,0.25)]">
      <div className="rounded-[11px] bg-zinc-950/95 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide">
            <span className="bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-amber-300 bg-clip-text text-transparent">⚡ FULL TEAM</span>
            <span className="text-zinc-500 font-normal">
              {m.roster.length > 0 ? `${m.roster.length} agent${m.roster.length > 1 ? 's' : ''}` : 'assembling…'}
              {m.activeCount > 0 && ` · ${m.activeCount} working`}
            </span>
          </span>
          <span className="text-[11px] font-mono text-zinc-400 tabular-nums">{formatElapsed(elapsedMs)}</span>
        </div>
        {squares.length > 0 && (
          <div className="mt-1.5 flex items-center gap-[3px]" title={`Plan: ${m.progress.done}/${m.progress.total} steps done`}>
            {squares.map((t) => (
              <span
                key={t.id}
                className={`h-2 w-2 rounded-[2px] ${
                  t.status === 'done' ? 'bg-emerald-500'
                  : t.status === 'in_progress' ? 'bg-indigo-400 animate-pulse'
                  : 'bg-zinc-700'
                }`}
              />
            ))}
            <span className="ml-1.5 text-[10px] text-zinc-500 tabular-nums">{m.progress.done}/{m.progress.total}</span>
          </div>
        )}
        {m.roster.length > 0 && (
          <div className="mt-1.5 flex gap-1.5 overflow-x-auto no-scrollbar" style={{ WebkitOverflowScrolling: 'touch' }}>
            {m.roster.map((a) => (
              <span key={a.agent} title={a.lastAction} className={`flex items-center gap-1 shrink-0 text-[10px] rounded-full px-2 py-0.5 border ${a.active ? 'border-indigo-500/60 bg-indigo-500/10 text-indigo-200' : 'border-zinc-700 bg-zinc-900 text-zinc-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${a.active ? 'bg-indigo-400 animate-pulse' : 'bg-emerald-500'}`} />
                <span className="capitalize font-medium">{a.agent}</span>
                <span className="max-w-[120px] truncate text-zinc-500">{a.lastAction}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentChip({ card, running }: { card: AgentCard; running: boolean }) {
  // While the build is running, every team member shows a spinning ring (work in
  // progress). Once the build finishes, it turns into a green check. (Per-tool-call
  // active flags flicker between tools, so the chip tracks the whole-build state.)
  return (
    <div className="flex items-center gap-1 text-[11px] bg-zinc-900 rounded-full px-2 py-1" title={card.lastAction}>
      {running
        ? <WavingTiranga size={14} />
        : <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
      <span className="font-medium capitalize text-zinc-200">{card.agent}</span>
    </div>
  );
}

function TabPill({ active, onClick, icon, children, dataTour }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode; dataTour?: string }) {
  return (
    <button
      onClick={onClick}
      data-tour={dataTour}
      className={`flex items-center gap-1 shrink-0 px-3 py-1 rounded-full text-xs border whitespace-nowrap ${
        active
          ? 'bg-indigo-600 border-indigo-500 text-white'
          : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600'
      }`}
    >
      {icon} {children}
    </button>
  );
}

function ToggleRow({ label, hint, checked, disabled, onClick }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left disabled:opacity-40 ${
        checked ? 'text-indigo-200 bg-indigo-500/10' : 'text-zinc-300 hover:bg-zinc-800'
      }`}
    >
      <span className={`w-4 h-4 shrink-0 flex items-center justify-center rounded border ${checked ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-zinc-600'}`}>
        {checked && <Check className="w-3 h-3" />}
      </span>
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[10px] text-zinc-500">({hint})</span>}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-zinc-600 italic">{children}</div>;
}

function fileDot(kind: string): string {
  const base = 'inline-block w-2 h-2 rounded-full ';
  if (kind === 'create') return base + 'bg-emerald-500';
  if (kind === 'delete') return base + 'bg-red-500';
  return base + 'bg-amber-500';
}

function colorizeDiff(patch: string): React.ReactNode {
  return patch.split('\n').map((line, i) => {
    const cls = line.startsWith('+') ? 'text-emerald-400' : line.startsWith('-') ? 'text-red-400' : 'text-zinc-400';
    return <div key={i} className={cls}>{line}</div>;
  });
}
