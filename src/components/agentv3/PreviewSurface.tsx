// Shared v5.0 preview surface — the "Live server" + "In-browser" preview the v5.0 build produces.
//
// Extracted from AgentV3Panel so BOTH the v5.0 panel AND the main slide-out "Preview" menu render the
// SAME, working v5.0 preview (driven by the live sandbox URL or the in-browser build of the saved
// files). Previously the main-menu Preview rendered the retired v2.0 `generatedCode`, which a v5.0
// build never writes — so the preview looked permanently "disconnected" from the v5.0 engine.

import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, ExternalLink, Loader2, Wand2, Stethoscope, Pen, Eye, Smartphone, Tablet, Monitor, Maximize2, Terminal, Sparkles } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { auth } from '../../App';
import { newReloadTracker, shouldReloadOnSignal } from './previewAutoReload';
import { shouldAutoRebootPreview } from './previewAutoReboot';
import { fixWithAiAfterDeepRefresh } from './previewDeepRefresh';
import { shouldFailoverToLive, liveFailoverNotice } from './previewLiveFailover';
import { configuredPreviewSandboxUrl, PREVIEW_HTML_MESSAGE } from '../../lib/previewOrigin';
import { ashokChakraSvg } from '../../lib/ashokChakra';
import { type PreviewViewport, DEVICE_DIMS, computeDeviceScale } from './previewViewport';
import { frameworkRunsInBrowser, serverFrameworkLabel } from '../../lib/frameworkDetect';

async function authJsonHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const tok = await auth.currentUser?.getIdToken();
    if (tok) headers.Authorization = `Bearer ${tok}`;
  } catch { /* no token — server soft-falls-back */ }
  return headers;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-zinc-500 text-sm text-center leading-relaxed">{children}</div>;
}

// RESPONSIVE VIEWPORTS (admin 2026-07-17): the preview can render at a REAL device width so the built
// app's OWN @media breakpoints fire exactly as they would on that device — not a cosmetic label. An
// <iframe>'s content viewport equals the iframe element's width, so constraining that width to 390px
// genuinely makes a `@media (max-width: …)` rule match. Works identically for BOTH previews (the live
// sandbox URL and the in-browser build) because both are just iframes. "Auto" fills the panel (today's
// behavior). Device modes show the true device pixel box, visually scaled to fit the panel when needed
// (the scale is cosmetic — the app still LAYS OUT at the true device width, so the test stays honest).
// The viewport model + sizing math live in ./previewViewport (pure, unit-tested).

/**
 * Wrap a preview <iframe> so it renders at the chosen viewport. In 'auto' it fills the panel (unchanged
 * behavior). In a device mode it constrains the iframe to the true device pixel size (so the app's
 * media queries respond for real) and scales the whole device box down to fit the panel when it's
 * larger than the available room. The child iframe must be `w-full h-full` to fill the box.
 */
function ResponsiveFrame({ viewport, children }: { viewport: PreviewViewport; children: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const dims = viewport === 'auto' ? null : DEVICE_DIMS[viewport];

  useEffect(() => {
    if (!dims) { setScale(1); return; }
    const el = wrapRef.current;
    if (!el) return;
    // 24px accounts for the padding around the device so it never touches the panel edges.
    const recompute = () => setScale(computeDeviceScale(el.clientWidth - 24, el.clientHeight - 24, dims.w, dims.h));
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dims?.w, dims?.h]);

  // CONSTANT tree depth in EVERY mode — stage → footprint → device-box → iframe. Viewport changes flow
  // ONLY through inline style/className; the tree SHAPE never changes, so switching Auto↔device (or
  // between devices, or on rotate) never reparents the iframe. ROOT-CAUSE FIX (2026-07-18): the previous
  // version returned a 1-div tree for Auto and a 3-div tree for a device, so toggling Auto↔device moved
  // the iframe to a different parent — which React implements as unmount+remount, i.e. a full iframe
  // RELOAD. On the live sandbox that reloads the running app (losing its SPA route, scroll position and
  // any typed-in form state); on the in-browser preview it re-imports the CDN bundle (a blank flash).
  // One stable tree with style-only differences keeps the running preview alive across every switch.
  //
  // • Auto: all layers are transparent flex fills — byte-for-byte the old fill behaviour.
  // • Device: footprint reserves the SCALED on-screen size (so centring never clips); the device-box is
  //   the TRUE device px the app lays out against (media queries are real), visually scaled to fit. The
  //   stage top-aligns (items-start) so the top edge is always reachable via the scroll container even in
  //   the degenerate sub-padding panel where the fit-scale floors at 1.
  const footprintStyle: React.CSSProperties = dims
    ? { width: Math.round(dims.w * scale), height: Math.round(dims.h * scale), flexShrink: 0 }
    : { flex: '1 1 auto', minWidth: 0, minHeight: 0, display: 'flex' };
  const deviceBoxStyle: React.CSSProperties = dims
    ? { width: dims.w, height: dims.h, transform: `scale(${scale})`, transformOrigin: 'top left' }
    : { flex: '1 1 auto', minWidth: 0, minHeight: 0, display: 'flex' };
  return (
    <div
      ref={wrapRef}
      className={`flex-1 min-h-0 flex ${dims ? 'overflow-auto bg-zinc-950/40 items-start justify-center p-3' : ''}`}
    >
      <div style={footprintStyle}>
        <div style={deviceBoxStyle} className={dims ? 'overflow-hidden rounded-[14px] ring-1 ring-zinc-700 shadow-2xl bg-white' : ''}>
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Dual preview:
 *  • "Live server" — the running app in the cloud sandbox (full fidelity). Shown the moment the
 *    build emits a live URL; explains honestly when none exists yet (E2B off / still starting).
 *  • "In-browser" — a self-contained HTML build of the workspace files in an <iframe srcDoc>, no
 *    running server. Works even when the sandbox is unavailable, and (via the server's saved-files
 *    fallback) even after the sandbox is gone. In-browser defaults on when there is no live URL yet.
 */
// Visual-editor toolbar helpers (pure — read the selected element's reported styles into control state).
export function veIsBold(styles: Record<string, string>): boolean {
  const w = styles.fontWeight || '';
  return w === 'bold' || parseInt(w, 10) >= 600;
}
export function veFontPx(styles: Record<string, string>): number {
  const n = parseFloat(styles.fontSize || '');
  return Number.isFinite(n) && n > 0 ? n : 16;
}
export function veRgbToHex(color: string): string {
  const m = (color || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return '#000000';
  const h = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${h(+m[1])}${h(+m[2])}${h(+m[3])}`;
}

export function PreviewSurface({ url, workspaceId, userId, email, framework, autoResume, reloadSignal, onFixError, onFileEdited, onAskAiAboutElement }: { url?: string; workspaceId?: string; userId?: string; email?: string; framework?: string; autoResume?: boolean; reloadSignal?: number; onFixError?: (errorText: string) => void; onFileEdited?: (path: string, content: string) => void; onAskAiAboutElement?: (context: string) => void }) {
  // A4 (unified preview): in-browser is the DETERMINISTIC DEFAULT — it always renders the current
  // files instantly with no server, so the preview is never a dead "No live preview yet" empty state
  // that depends on an ephemeral E2B sandbox being up. "Live server" (full-fidelity, real runtime) is
  // an explicit opt-in toggle the user picks (or auto-selects via Diagnose). Root cause: the live URL
  // dies on sandbox idle-pause / recycle, so defaulting to it made the preview flaky.
  const [mode, setMode] = useState<'live' | 'inbrowser'>('inbrowser');
  // Chosen responsive viewport — shared across BOTH previews (live + in-browser), so switching the
  // preview source keeps the device you were testing at. 'auto' = fill the panel (default).
  const [viewport, setViewport] = useState<PreviewViewport>('auto');
  const [html, setHtml] = useState<string>('');
  const [kind, setKind] = useState<string>('');
  // Task #64 — honest full-stack state: the in-browser preview compiles only the frontend, so when the
  // built app also has a backend its API calls fail here. The server reports this on the preview
  // response so we can show a clear "needs a Live server" banner instead of a silently-broken preview.
  const [hasBackend, setHasBackend] = useState(false);
  const [backendReason, setBackendReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>('');
  // Honest elapsed counter while the in-browser preview loads — "loading vs stuck" must be
  // visible at a glance, with a slow-note once it crosses the typical fast path.
  const [loadSeconds, setLoadSeconds] = useState(0);
  useEffect(() => {
    if (!loading) { setLoadSeconds(0); return; }
    const started = Date.now();
    const t = setInterval(() => setLoadSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [loading]);
  // Live-server iframe load indicator: the sandbox page itself can take seconds to answer after
  // a boot — show a thin working strip until the iframe actually finishes loading.
  const [liveLoading, setLiveLoading] = useState(false);
  // null = serving fine / not checked; string[] = the server answered but did NOT serve the app.
  const [notServing, setNotServing] = useState<string[] | null>(null);
  const [sandbox, setSandbox] = useState<{ livePreviewAvailable: boolean; actuator: string; previewDomainWarning: string | null } | null>(null);
  // LIVE FAILOVER (admin report 858f6d7b) — a broken in-browser preview must never be a dead end while
  // the real app is running on the sandbox. Both refs are once-per-workspace guards; `failoverNote`
  // keeps the switch honest instead of letting the view jump for no visible reason.
  const failedOverToLive = useRef(false);
  const userPickedInBrowser = useRef(false);
  const [failoverNote, setFailoverNote] = useState('');
  const [liveReloadKey, setLiveReloadKey] = useState(0);
  // "Diagnose" — reuses the build loop's real dev-server boot sequence (install/pre-kill/start/
  // port-wait/one retry) instead of guessing, so the empty state can show the REAL internal
  // reason the live preview isn't up (and self-heal + restore the URL when it actually comes up).
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagResult, setDiagResult] = useState<{ ok: boolean; reason: string; detail: string } | null>(null);
  // Live progress of the streamed diagnose: REAL stage labels + stage-based percentage from the
  // server (never a fake time-based bar) + a seconds heartbeat proving the boot is still alive.
  const [diagStage, setDiagStage] = useState<{ label: string; pct: number; seconds: number } | null>(null);
  const [foundUrl, setFoundUrl] = useState<string>('');

  // A4: do NOT force the view to "live" just because a live URL arrived — that yanked the user off the
  // reliable in-browser render onto an ephemeral sandbox URL (the flakiness source). Live is opt-in via
  // the toggle; the "Live server" button lights up as available whenever `effectiveUrl` exists.
  // A new/changed workspace never inherits ANY of the previous project's surface: not a stale
  // diagnosis, and — the "+New chat" bug (admin 2026-07-12) — not the previous app's compiled HTML.
  // `html` only ever loads under a truthy workspaceId, so it must die with that workspaceId; without
  // this, "+New chat" reset state.workspaceId to '' but the old app kept rendering in the iframe.
  // Reset the viewport to Auto on a new/changed workspace too — a leftover Mobile/Tablet device frame
  // from the previous app would otherwise misrepresent the next one.
  useEffect(() => {
    setFoundUrl(''); setDiagResult(null); setHtml(''); setKind(''); setHasBackend(false); setBackendReason(''); setErr(''); setViewport('auto');
    // The failover guards are per-project state: a new workspace gets a fresh chance to rescue itself.
    failedOverToLive.current = false; userPickedInBrowser.current = false; setFailoverNote('');
  }, [workspaceId]);

  const runDiagnose = useCallback(async () => {
    if (!workspaceId) return;
    setDiagnosing(true);
    setDiagResult(null);
    setDiagStage({ label: 'Contacting the sandbox', pct: 5, seconds: 0 });
    try {
      const res = await fetch('/api/agentv3/preview-diagnose', {
        method: 'POST',
        headers: await authJsonHeaders(),
        // stream:true → NDJSON: real stage events (+ seconds heartbeat during the long
        // install/boot step) followed by the terminal result — so a 30-90s cold boot shows
        // WHAT is happening and that it is alive, instead of one silent spinner.
        body: JSON.stringify({ workspaceId, userId, email, framework, stream: true }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data?.error === 'string' ? data.error : `server returned ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let terminal: Record<string, unknown> | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: { type?: string; label?: string; pct?: number; seconds?: number } & Record<string, unknown>;
          try { evt = JSON.parse(line); } catch { continue; }
          if (evt.type === 'stage' && typeof evt.label === 'string') {
            setDiagStage((prev) => ({ label: evt.label as string, pct: typeof evt.pct === 'number' ? evt.pct : prev?.pct ?? 0, seconds: prev?.seconds ?? 0 }));
          } else if (evt.type === 'tick' && typeof evt.seconds === 'number') {
            setDiagStage((prev) => (prev ? { ...prev, seconds: evt.seconds as number } : prev));
          } else if (evt.type === 'result') {
            terminal = evt;
          }
        }
      }
      const data = terminal ?? {};
      const reason = typeof data?.reason === 'string' ? data.reason : (typeof data?.error === 'string' ? data.error : 'Diagnosis failed — no details returned.');
      const detail = typeof data?.detail === 'string' ? data.detail : '';
      setDiagResult({ ok: !!data?.ok, reason, detail });
      if (data?.ok && typeof data?.previewUrl === 'string' && data.previewUrl) {
        setFoundUrl(data.previewUrl);
        setMode('live');
        // A genuinely successful boot resets the watchdog's failure STREAK (the total backstop and
        // the cooldown still apply) — so the next sandbox death hours later can heal again.
        healRef.current.streak = 0;
      }
    } catch (e) {
      setDiagResult({ ok: false, reason: e instanceof Error ? e.message : 'Network error — could not reach the server.', detail: '' });
    } finally {
      setDiagnosing(false);
      setDiagStage(null);
    }
  }, [workspaceId, userId, email, framework]);

  const effectiveUrl = url || foundUrl;
  // Arm the live-iframe working strip whenever the live view (re)loads a URL; the iframe's own
  // onLoad clears it — real load state, not a timer.
  useEffect(() => { if (mode === 'live' && effectiveUrl) setLiveLoading(true); }, [mode, effectiveUrl, liveReloadKey]);

  const refreshSandbox = useCallback(async () => {
    try {
      const res = await fetch('/api/agentv3/preview-status');
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (data && typeof data.livePreviewAvailable === 'boolean') {
        setSandbox({ livePreviewAvailable: data.livePreviewAvailable, actuator: String(data.actuator || ''), previewDomainWarning: data.previewDomainWarning ?? null });
      }
    } catch { /* non-fatal — the tab just falls back to a generic message */ }
  }, []);
  useEffect(() => { void refreshSandbox(); }, [refreshSandbox]);

  // C1 — auto-restore the LIVE preview on reopen. After 2-3 days the sandbox is garbage-collected, so
  // a reopened session's live preview is dead and the user had to hunt for the "Diagnose" button. When
  // the caller says it's idle (autoResume — NOT mid-build), the Live tab is showing, the backend
  // actually supports a live preview (E2B configured — otherwise there is nothing to boot), and we
  // have a workspace with no live URL, run the SAME real rehydrate-and-reboot the Diagnose button uses,
  // automatically. Gated to ONCE per workspace so it can never loop or repeatedly boot a sandbox.
  const autoResumedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!autoResume || mode !== 'live' || !workspaceId) return;
    if (url || foundUrl || diagnosing) return;
    if (sandbox?.livePreviewAvailable !== true) return; // no live backend here → nothing to resume
    if (autoResumedFor.current === workspaceId) return;
    autoResumedFor.current = workspaceId;
    void runDiagnose();
  }, [autoResume, mode, workspaceId, url, foundUrl, diagnosing, sandbox, runDiagnose]);

  // C1b — auto-REBOOT a dead live preview behind an EXISTING URL. C1 above only fires when there is NO
  // url — but a preview URL is PERMANENT while the dev server behind it is EPHEMERAL (sandbox
  // idle/pause kills the process): a reopened session rendered E2B's "Closed Port Error" page inside
  // the iframe and nothing auto-healed (admin report 2026-07-07). URL presence is NOT liveness — probe
  // the server's REAL preview health and, when it is sleeping/crashed, run the SAME rehydrate-and-
  // reboot as the Diagnose button.
  //
  // V2 — a CONTINUOUS watchdog, not a one-shot (admin 2026-08-03, "preview chal jane ke baad gayab na
  // ho"): the old once-per-workspace latch healed the FIRST death only; a tab left open past the next
  // sandbox idle-pause stayed dead forever. Now the health probe re-runs every WATCH_INTERVAL while
  // the Live tab is visible AND when the window regains focus (the "back from lunch" moment), and the
  // heal decision is the pure cooldown+bounded-attempts policy (previewAutoReboot.ts) — repeat deaths
  // self-heal; a boot-crash-boot hammer stays impossible (cooldown, streak cap, absolute total cap).
  const healRef = useRef<{ ws: string | null; streak: number; total: number; lastAt: number | null }>({ ws: null, streak: 0, total: 0, lastAt: null });
  const probeInFlight = useRef(false);
  const probeAndMaybeHeal = useCallback(async () => {
    if (!autoResume || mode !== 'live' || !workspaceId || diagnosing || probeInFlight.current) return;
    const hasUrl = !!(url || foundUrl);
    if (!hasUrl || sandbox?.livePreviewAvailable !== true) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return; // never boot behind a hidden tab
    if (healRef.current.ws !== workspaceId) healRef.current = { ws: workspaceId, streak: 0, total: 0, lastAt: null };
    probeInFlight.current = true;
    try {
      let status: string | null = null;
      try {
        const res = await fetch('/api/agentv3/preview-health', {
          method: 'POST',
          headers: await authJsonHeaders(),
          // Send the URL we are ACTUALLY displaying: the server used to probe a port guessed from the
          // framework name (vite-react ⇒ 5173) while a full-stack app serves on its own port.
          body: JSON.stringify({ workspaceId, userId, email, framework, previewUrl: url || foundUrl || '' }),
        });
        const health = await res.json().catch(() => null) as { status?: unknown; serving?: unknown; servingProblems?: unknown } | null;
        if (res.ok && health && typeof health.status === 'string') status = health.status;
        // NOT-SERVING (admin report 2026-08-06): the port answers but the page is a 404 / "Cannot GET".
        // We used to render that page inside the iframe AS the user's app. Record it so the UI can say
        // the truth instead — see the banner in the live view below.
        if (res.ok && health && typeof health.serving === 'boolean') {
          setNotServing(health.serving === false
            ? (Array.isArray(health.servingProblems) ? health.servingProblems.filter((x): x is string => typeof x === 'string') : [])
            : null);
        }
      } catch { /* probe failed → status stays null → never reboot on a guess */ }
      const h = healRef.current;
      const decide = shouldAutoRebootPreview({
        autoResume: !!autoResume, liveTabShown: mode === 'live', hasUrl,
        liveBackend: sandbox?.livePreviewAvailable === true, diagnosing,
        streak: h.streak, total: h.total,
        msSinceLastAttempt: h.lastAt === null ? Infinity : Date.now() - h.lastAt,
        healthStatus: status,
      });
      if (decide) {
        h.streak += 1; h.total += 1; h.lastAt = Date.now();
        await runDiagnose(); // a SUCCESSFUL diagnose resets the streak (see runDiagnose)
      }
    } finally {
      probeInFlight.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoResume, mode, workspaceId, url, foundUrl, diagnosing, sandbox, userId, email, framework, runDiagnose]);
  /** How often the open Live tab re-checks that its preview is still actually alive. */
  const WATCH_INTERVAL_MS = 150_000;
  useEffect(() => {
    if (!autoResume || mode !== 'live' || !workspaceId) return;
    void probeAndMaybeHeal(); // immediate check on mount / url / workspace change (the old C1b moment)
    const timer = setInterval(() => { void probeAndMaybeHeal(); }, WATCH_INTERVAL_MS);
    const onWake = () => { if (document.visibilityState === 'visible') void probeAndMaybeHeal(); };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoResume, mode, workspaceId, url, foundUrl, sandbox, probeAndMaybeHeal]);

  // Guards a compile from overlapping itself (a debounced auto-refresh must not fire a second fetch
  // while the first is still in flight — the slower response could otherwise clobber the newer one).
  const inFlight = useRef(false);
  // Returns true when the preview rendered (non-empty HTML) — the "Fix with AI" deep-refresh flow
  // uses this to decide whether the app recovered (skip the AI) or still needs a fix. `fresh:true`
  // asks the server to BYPASS its render cache so a stale cached render can't mask a recovery.
  const loadInBrowser = useCallback(async (opts?: { fresh?: boolean }): Promise<boolean> => {
    // SSR / meta framework (Next.js, Nuxt, …) or a backend has no browser SPA entry, so the in-browser
    // bundler would fail with a misleading "No React entry module found" (CrewHub 2026-07-20). Don't
    // attempt it — the framework-aware panel below tells the user honestly to use the Live server.
    if (!frameworkRunsInBrowser(framework)) { setErr(''); setLoading(false); return false; }
    if (!workspaceId) { setErr('Build something first — there are no files to preview yet.'); return false; }
    if (inFlight.current) return false;
    inFlight.current = true;
    setLoading(true);
    setErr('');
    try {
      const res = await fetch('/api/agentv3/inbrowser-preview', {
        method: 'POST',
        headers: await authJsonHeaders(),
        // Send our own origin so the server loads the self-hosted preview compiler via an absolute
        // same-origin URL (a root-relative path doesn't resolve inside the sandboxed iframe srcDoc).
        body: JSON.stringify({ workspaceId, userId, email, origin: window.location.origin, fresh: opts?.fresh === true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `server returned ${res.status}`);
      const nextHtml = typeof data.html === 'string' ? data.html : '';
      setHtml(nextHtml);
      setKind(typeof data.kind === 'string' ? data.kind : '');
      setHasBackend(data.hasBackend === true);
      setBackendReason(typeof data.backendReason === 'string' ? data.backendReason : '');
      return nextHtml.length > 0;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setHtml('');
      return false;
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [workspaceId, userId, email, framework]);

  // "Fix with AI" on a broken preview — try a FREE deep refresh BEFORE spending an AI turn. A blank/
  // failed preview is frequently just a stale cached render or a transient cold-start miss (admin
  // report fae70e42: a blank canvas that fixed itself on a clean re-publish, no code change). The
  // deep refresh recompiles from scratch (server bypasses its render cache); if the app now renders
  // the user never needed the AI. Only if it STILL fails do we hand the error to the AI (onFixError).
  const [deepRefreshing, setDeepRefreshing] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const fixWithAiAfterRefresh = useCallback(async (errorText: string) => {
    if (!onFixError) return;
    setRecovered(false);
    setDeepRefreshing(true);
    try {
      await fixWithAiAfterDeepRefresh({
        errorText,
        deepRefresh: () => loadInBrowser({ fresh: true }),
        onRecovered: () => setRecovered(true),
        onNeedsAi: (text) => onFixError(text),
      });
    } finally {
      setDeepRefreshing(false);
    }
  }, [onFixError, loadInBrowser]);
  // The "recovered — no AI needed" note is transient; auto-clear it after a few seconds and whenever
  // the workspace changes, so it never lingers stale over a later different state.
  useEffect(() => {
    if (!recovered) return;
    const t = setTimeout(() => setRecovered(false), 6_000);
    return () => clearTimeout(t);
  }, [recovered]);
  useEffect(() => { setRecovered(false); }, [workspaceId]);

  useEffect(() => {
    // Auto-(re)load the in-browser preview whenever the tab is shown or the workspace (re)appears.
    // NOTE: we intentionally retry even if a prior attempt errored — after a server cold-start the
    // first fetch can 404 ("no files yet") while the durable saved files are still loading; reopening
    // the session must re-attempt (the server falls back to the durable files) instead of showing the
    // stale error forever. This only re-runs on mode/workspaceId change, so it can never loop.
    if (mode === 'inbrowser' && !html && !loading && workspaceId) { void loadInBrowser(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, workspaceId]);

  // INVARIANT (admin 2026-07-07: "file hai aur app already build hai — to preview chalna hi chalna
  // chahiye"): the in-browser EMPTY state is never terminal while a workspace exists. A full browser
  // close-and-reopen restored Files (19) but landed on "No preview yet — build something first" —
  // whatever race skipped the one-shot auto-load above (workspaceId arriving around the effect's
  // single run, a transiently-empty response), nothing ever retried. This effect watches the empty
  // state itself and self-heals with a BOUNDED retry (3 attempts, 1.2s apart — the guard deps reset
  // it on success/error/tab-switch, and `err` routes to the existing error+Fix-with-AI surface, so
  // it can never loop forever).
  const emptyRetries = useRef(0);
  useEffect(() => {
    // An SSR/backend framework never renders in-browser — the honest panel handles it, so don't retry.
    if (mode !== 'inbrowser' || !workspaceId || html || loading || err || !frameworkRunsInBrowser(framework)) { emptyRetries.current = 0; return; }
    if (emptyRetries.current >= 3) return;
    const t = setTimeout(() => { emptyRetries.current += 1; void loadInBrowser(); }, 1_200);
    return () => clearTimeout(t);
  }, [mode, workspaceId, html, loading, err, loadInBrowser, framework]);

  // U1 — AUTO-REFRESH the preview as the build writes files. The parent bumps `reloadSignal` on every
  // file_changed/diff event; we DEBOUNCE so a burst of writes (a 20-file batch) triggers ONE reload
  // after they settle, not one per file. In-browser re-compiles from the fresh files; live re-connects
  // the sandbox iframe (belt-and-suspenders on top of Vite HMR). The surface is only mounted on the
  // Preview tab, so a hidden preview never wastes a compile. `shouldReloadOnSignal` skips the initial
  // value (the mount load already covers it) and any unchanged re-render.
  const reloadTracker = useRef(newReloadTracker());
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!shouldReloadOnSignal(reloadTracker.current, reloadSignal)) return;
    if (!workspaceId) return;
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => {
      if (mode === 'inbrowser') { void loadInBrowser(); }
      else if (mode === 'live' && effectiveUrl) { setLiveReloadKey((k) => k + 1); }
    }, 900);
    return () => { if (reloadTimer.current) clearTimeout(reloadTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadSignal]);

  // CONSOLE DRAWER (world-best-preview, 2026-08-06): the preview's mirrored console — every log/warn/
  // error the running app prints, streamed up from the iframe (see ReactPreview's console mirror).
  // What Replit surfaces via embedded devtools and Bolt leaves to F12, here is one tap — and every
  // error row carries "Fix with AI". A ring buffer so a chatty app can never grow it unbounded.
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleEntries, setConsoleEntries] = useState<Array<{ level: string; text: string; at: number }>>([]);
  const consoleErrorCount = consoleEntries.reduce((n, e) => n + (e.level === 'error' ? 1 : 0), 0);
  useEffect(() => {
    const onConsoleMsg = (e: MessageEvent) => {
      const d = e.data as { __nbaiPreviewConsole?: boolean; level?: string; text?: string } | null;
      if (!d || d.__nbaiPreviewConsole !== true || typeof d.text !== 'string') return;
      const level = d.level === 'error' || d.level === 'warn' || d.level === 'info' ? d.level : 'log';
      setConsoleEntries((prev) => [...prev, { level, text: d.text!, at: Date.now() }].slice(-200));
    };
    window.addEventListener('message', onConsoleMsg);
    return () => window.removeEventListener('message', onConsoleMsg);
  }, []);

  // Capture in-browser preview failures (postMessage'd up from the sandboxed srcdoc iframe) into the
  // build's diagnostics report, so a build that "succeeded" but doesn't render shows the REAL preview
  // error in the downloadable report — no separate screenshot needed. Best-effort, fire-and-forget.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { __nbaiPreviewError?: boolean; source?: string; message?: string } | null;
      if (!d || d.__nbaiPreviewError !== true || !workspaceId || typeof d.message !== 'string') return;
      // RESCUE FIRST, then record. Before this, a broken in-browser preview was only ever WRITTEN DOWN
      // (into the report the user never opens) while a working live server sat one unclicked button
      // away — so a build that genuinely succeeded read as "the app didn't build". Reporting the
      // failure honestly is necessary; leaving the user staring at it when we can fix it is not.
      const source: 'in-browser' | 'live' = d.source === 'live' ? 'live' : 'in-browser';
      if (shouldFailoverToLive({
        mode, hasLiveUrl: !!effectiveUrl, errorSource: source,
        alreadyFailedOver: failedOverToLive.current, userPickedInBrowser: userPickedInBrowser.current,
      })) {
        failedOverToLive.current = true;
        setFailoverNote(liveFailoverNotice());
        setMode('live');
      }
      fetch('/api/agentv3/preview-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, userId, email, source, message: d.message.slice(0, 4000) }),
        keepalive: true,
      }).catch(() => { /* best-effort — capturing the error must never disrupt the preview */ });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // `mode` + `effectiveUrl` are read by the failover decision, so the listener must be re-bound when
    // they change — a stale closure would judge the failover against a previous render's state.
  }, [workspaceId, userId, email, mode, effectiveUrl]);

  // VISUAL EDITOR (v1, in-browser mode only — see ReactPreview.ts's injected inspector script).
  // Clicking an element in edit mode reports back {file, line, column, newText}; this applies it via
  // the REAL AST-based endpoint (never a guess), then reloads the in-browser preview from the freshly
  // saved source so the edit is confirmed against what actually compiled, and notifies the parent
  // (onFileEdited) so Files/Code Studio/Git pick up the change immediately too — same as any other
  // v5.0 file write.
  const inBrowserIframeRef = useRef<HTMLIFrameElement | null>(null);
  // SECURITY Phase 4 — when a separate preview origin is configured (VITE_PREVIEW_ORIGIN), the
  // in-browser preview loads a tiny host page on THAT origin and receives the built HTML via
  // postMessage, so the untrusted app runs in an isolated origin (can't read the platform's Firebase
  // token). Null → keep the exact current same-origin srcDoc path (unchanged, safe under the allowlist).
  const previewSandboxUrl = (() => {
    try { return configuredPreviewSandboxUrl(window.location.origin); } catch { return null; }
  })();
  // Cross-origin path only: re-post the built HTML to the isolated host whenever it changes (a static
  // `src` iframe doesn't auto-reload the way `srcDoc` does). The onLoad handler covers the first mount.
  useEffect(() => {
    if (!previewSandboxUrl || !html) return;
    try { inBrowserIframeRef.current?.contentWindow?.postMessage({ [PREVIEW_HTML_MESSAGE]: html }, new URL(previewSandboxUrl).origin); } catch { /* best-effort */ }
  }, [previewSandboxUrl, html]);
  const [editMode, setEditMode] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');
  // Phase 2 (admin 2026-07-29): the element picked in edit mode + its current styles, so the toolbar (font
  // size / color / bold / align) opens showing real values and edits the RIGHT element.
  type VisualSelection = { file: string; line: number; column: number; tag: string; styles: Record<string, string> };
  const [selection, setSelection] = useState<VisualSelection | null>(null);
  const postToIframe = useCallback((msg: Record<string, unknown>) => {
    try { inBrowserIframeRef.current?.contentWindow?.postMessage(msg, '*'); } catch { /* best-effort */ }
  }, []);
  const setIframeEditMode = useCallback((on: boolean) => {
    postToIframe({ __nbaiSetEditMode: on });
    if (!on) setSelection(null);
  }, [postToIframe]);
  // Apply an inline-style change to the selected element: LIVE in the iframe (instant), then PERSIST to the
  // real source via the visual-edit endpoint (styleUpdates → applyVisualStyleEdit). No reload — the live DOM
  // already reflects it and the source is saved, so rapid tweaks (bold, size±) stay smooth. On a server
  // error the message shows honestly.
  // Persist a style change to the real source (no live re-apply — the iframe already reflects it, either
  // from applyStyle's postMessage or from a resize/move drag the iframe applied itself).
  const persistStyle = useCallback((loc: { file: string; line: number; column: number }, styleUpdates: Record<string, string>) => {
    if (!workspaceId || !loc.file) return;
    setSavingEdit(true); setEditError('');
    void (async () => {
      try {
        const res = await fetch('/api/agentv3/visual-edit', {
          method: 'POST',
          headers: await authJsonHeaders(),
          body: JSON.stringify({ workspaceId, userId, email, file: loc.file, line: loc.line, column: loc.column, styleUpdates }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `server returned ${res.status}`);
        onFileEdited?.(loc.file, typeof data.content === 'string' ? data.content : '');
      } catch (err) {
        setEditError(err instanceof Error ? err.message : String(err));
      } finally {
        setSavingEdit(false);
      }
    })();
  }, [workspaceId, userId, email, onFileEdited]);
  // Toolbar edit: live-apply in the iframe (instant), then persist. No reload → rapid tweaks stay smooth.
  const applyStyle = useCallback((sel: VisualSelection, styleUpdates: Record<string, string>) => {
    postToIframe({ __nbaiApplyStyle: styleUpdates });
    persistStyle(sel, styleUpdates);
  }, [postToIframe, persistStyle]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { __nbaiSelect?: boolean; __nbaiVisualEditCommit?: boolean; __nbaiStyleCommit?: boolean; file?: string; line?: number; column?: number; newText?: string; tag?: string; styles?: Record<string, string>; styleUpdates?: Record<string, string> } | null;
      if (!d || typeof d !== 'object') return;
      // The iframe reports which element the user picked (+ its current styles) → show the toolbar.
      if (d.__nbaiSelect === true && typeof d.file === 'string') {
        setSelection({ file: d.file, line: typeof d.line === 'number' ? d.line : 0, column: typeof d.column === 'number' ? d.column : 0, tag: typeof d.tag === 'string' ? d.tag : '', styles: d.styles && typeof d.styles === 'object' ? d.styles : {} });
        return;
      }
      // A resize/move drag finished in the iframe → persist the final width/height/transform (no re-apply).
      if (d.__nbaiStyleCommit === true && workspaceId && typeof d.file === 'string' && d.styleUpdates && typeof d.styleUpdates === 'object') {
        persistStyle({ file: d.file, line: typeof d.line === 'number' ? d.line : 0, column: typeof d.column === 'number' ? d.column : 0 }, d.styleUpdates);
        return;
      }
      if (d.__nbaiVisualEditCommit !== true || !workspaceId || typeof d.file !== 'string') return;
      setSavingEdit(true);
      setEditError('');
      void (async () => {
        try {
          const res = await fetch('/api/agentv3/visual-edit', {
            method: 'POST',
            headers: await authJsonHeaders(),
            body: JSON.stringify({ workspaceId, userId, email, file: d.file, line: d.line, column: d.column, newText: d.newText ?? '' }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || `server returned ${res.status}`);
          onFileEdited?.(d.file as string, typeof data.content === 'string' ? data.content : '');
          setSelection(null); // the reload builds a new document — drop the stale selection
          await loadInBrowser(); // reload from the freshly-saved source so the preview reflects the real edit
        } catch (err) {
          setEditError(err instanceof Error ? err.message : String(err));
        } finally {
          setSavingEdit(false);
        }
      })();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, userId, email, onFileEdited, persistStyle]);
  // Turn edit mode off whenever we leave in-browser mode or the preview reloads with fresh content —
  // the iframe itself is a NEW document after a reload, so any prior postMessage toggle is gone anyway;
  // this just keeps the button's own displayed state honest.
  useEffect(() => { if (mode !== 'inbrowser') setEditMode(false); }, [mode]);
  useEffect(() => { setEditMode(false); }, [html]);

  // In-browser first (the default). "Live server" shows a ● when a live URL is available so the
  // full-fidelity view is discoverable even though we no longer auto-switch to it.
  const switcher = (
    <div className="flex items-center gap-1">
      <button onClick={() => { userPickedInBrowser.current = true; setMode('inbrowser'); }} className={`px-2 py-0.5 rounded text-[11px] border ${mode === 'inbrowser' ? 'bg-zinc-800 text-white border-zinc-600' : 'text-zinc-400 border-zinc-700 hover:text-zinc-200'}`} title="Instant, always-available preview rendered in your browser — no server needed (default)">In-browser</button>
      <button onClick={() => setMode('live')} className={`px-2 py-0.5 rounded text-[11px] border ${mode === 'live' ? 'bg-zinc-800 text-white border-zinc-600' : 'text-zinc-400 border-zinc-700 hover:text-zinc-200'}`} title="The running app in the cloud sandbox (full fidelity — real npm/runtime)">{effectiveUrl ? '● ' : ''}Live server</button>
    </div>
  );

  // Responsive viewport switcher — REAL device-width rendering (not a label), shown on BOTH previews.
  const viewportSwitcher = (
    <div className="flex items-center gap-0.5 rounded border border-zinc-700 p-0.5">
      {([
        ['auto', Maximize2, 'Auto — fills the panel (responsive to the available width)'],
        ['mobile', Smartphone, DEVICE_DIMS.mobile.label],
        ['tablet', Tablet, DEVICE_DIMS.tablet.label],
        ['desktop', Monitor, DEVICE_DIMS.desktop.label],
      ] as const).map(([v, Icon, tip]) => (
        <button
          key={v}
          onClick={() => setViewport(v)}
          className={`p-1 rounded transition-colors ${viewport === v ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
          title={tip}
          aria-label={tip}
          aria-pressed={viewport === v}
        >
          <Icon className="w-3.5 h-3.5" />
        </button>
      ))}
    </div>
  );

  if (mode === 'live' && effectiveUrl) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 text-xs text-zinc-400">
          {switcher}
          {viewportSwitcher}
          <span className="truncate flex-1">{effectiveUrl}</span>
          <button onClick={() => setLiveReloadKey((k) => k + 1)} className="flex items-center gap-1 hover:text-zinc-200" title="Reload the live preview (reconnect to the sandbox)"><RotateCcw className="w-3.5 h-3.5" /></button>
          <a href={effectiveUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-zinc-200" title="Open in new tab"><ExternalLink className="w-3.5 h-3.5" /></a>
        </div>
        {failoverNote && (
          <div className="flex items-start gap-2 px-3 py-1.5 border-b border-sky-900/60 bg-sky-950/40 text-[11px] text-sky-200">
            <span className="flex-1">{failoverNote}</span>
            <button onClick={() => setFailoverNote('')} className="shrink-0 text-sky-400 hover:text-sky-200" title="Dismiss">✕</button>
          </div>
        )}
        {/* HONEST STATE, NOT A RENDERED 404 (admin report 2026-08-06). The server answers, so the old
            code happily iframed whatever came back — the user was shown a raw "Cannot GET /customer/home"
            page labelled as their live app. A page that does not render is not the app, and saying so is
            the whole point; the iframe still shows below so nothing is hidden from the user. */}
        {notServing && (
          <div className="flex items-start gap-2 px-3 py-2 border-b border-amber-900/60 bg-amber-950/40 text-[11px] text-amber-200">
            <span className="flex-1">
              <span className="font-semibold">This is not your app yet.</span>{' '}
              The server is answering, but it is not serving your pages
              {notServing.length > 0 ? ` — ${notServing[0]}` : ''}. If the build is still running, give it
              a few more seconds. Meanwhile the{' '}
              <button onClick={() => setMode('inbrowser')} className="underline hover:text-amber-100">In-browser preview</button>{' '}
              renders your files right now.
            </span>
          </div>
        )}
        {liveLoading && (
          <div className="h-0.5 bg-zinc-800 overflow-hidden">
            <div className="h-full w-1/3 bg-indigo-500 animate-pulse" />
          </div>
        )}
        <ResponsiveFrame viewport={viewport}>
          <iframe key={liveReloadKey} title="Live preview" src={effectiveUrl} onLoad={() => setLiveLoading(false)} className="w-full h-full bg-white border-0" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
        </ResponsiveFrame>
      </div>
    );
  }

  if (mode === 'live') {
    const sandboxOff = sandbox && sandbox.livePreviewAvailable === false;
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 text-xs text-zinc-400">
          {switcher}
          <span className="flex-1 truncate">Live server</span>
          <button onClick={() => void refreshSandbox()} className="flex items-center gap-1 hover:text-zinc-200" title="Re-check for the live preview (after the sandbox finishes starting)"><RotateCcw className="w-3.5 h-3.5" /></button>
        </div>
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div className="max-w-md text-sm text-zinc-400 space-y-2">
            {sandboxOff ? (
              <>
                <p className="text-zinc-200 font-medium">Live server preview isn't available on this deployment.</p>
                <p>The full-fidelity live preview runs your app inside a cloud sandbox (E2B), which isn't configured here. Your app still builds and runs — use the <button onClick={() => setMode('inbrowser')} className="underline hover:text-zinc-200">In-browser preview</button> to see it.</p>
                <p className="text-zinc-500 text-xs">Admin: set <code className="text-zinc-400">E2B_API_KEY</code> in the server environment to enable the live cloud preview.</p>
              </>
            ) : (
              <>
                <p className="text-zinc-200 font-medium">No live preview yet.</p>
                <p>The live server appears the moment the agent starts your app. While you wait, the <button onClick={() => setMode('inbrowser')} className="underline hover:text-zinc-200">In-browser preview</button> renders the current files instantly.</p>
                {sandbox?.previewDomainWarning && (
                  <p className="text-amber-400/80 text-xs">{sandbox.previewDomainWarning}</p>
                )}
                {workspaceId && (
                  <div className="pt-1">
                    <button
                      onClick={() => void runDiagnose()}
                      disabled={diagnosing}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold"
                      title="Check the real state of the dev server inside your sandbox — installs, starts, and reports the exact cause if it still doesn't come up"
                    >
                      {diagnosing ? <TirangaLoader className="w-3.5 h-3.5" /> : <Stethoscope className="w-3.5 h-3.5" />}
                      {diagnosing ? 'Starting the live server…' : 'Diagnose'}
                    </button>
                  </div>
                )}
                {diagnosing && diagStage && (
                  // REAL staged progress from the server stream (stage-based %, never time-faked) +
                  // a live seconds counter proving the long install/boot step is still alive.
                  <div className="mt-3 text-left space-y-1 max-w-sm mx-auto">
                    <div className="flex items-center justify-between text-[11px] text-zinc-400">
                      <span className="truncate">{diagStage.label}…</span>
                      <span className="shrink-0 pl-2 font-mono">{diagStage.pct}%{diagStage.seconds > 0 ? ` · ${diagStage.seconds}s` : ''}</span>
                    </div>
                    <div className="h-1.5 rounded bg-zinc-800 overflow-hidden">
                      <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${diagStage.pct}%` }} />
                    </div>
                    {diagStage.seconds >= 30 && (
                      <p className="text-[10px] text-zinc-600">A cold sandbox install can take up to ~90s — this is a real install, not a stuck screen.</p>
                    )}
                  </div>
                )}
                {diagResult && (
                  <div className={`mt-2 text-left rounded-lg border p-3 text-xs ${diagResult.ok ? 'border-emerald-800 bg-emerald-950/40 text-emerald-200' : 'border-amber-800 bg-amber-950/30 text-amber-200'}`}>
                    <p className="font-medium">{diagResult.reason}</p>
                    {diagResult.detail && (
                      <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[11px] text-zinc-400 font-mono">{diagResult.detail}</pre>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 text-xs text-zinc-400">
        {switcher}
        {viewportSwitcher}
        <span className="flex-1 truncate">{kind ? `In-browser preview (${kind})` : 'In-browser preview'}</span>
        {savingEdit && <TirangaLoader className="w-3.5 h-3.5 text-indigo-400" />}
        {!!html && !err && (
          <button
            onClick={() => { const next = !editMode; setEditMode(next); setIframeEditMode(next); }}
            disabled={savingEdit}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] border disabled:opacity-40 ${editMode ? 'bg-emerald-600 text-white border-emerald-500' : 'text-zinc-400 border-zinc-700 hover:text-zinc-200'}`}
            title={editMode ? 'Exit visual editing' : 'Visual Editor — click any element to select it (toolbar: text size, colour, bold, align); double-click to edit its text'}
          >
            {editMode ? <Eye className="w-3.5 h-3.5" /> : <Pen className="w-3.5 h-3.5" />}
            {editMode ? 'Editing…' : 'Edit'}
          </button>
        )}
        <button
          onClick={() => setConsoleOpen((v) => !v)}
          className={`relative flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] ${consoleOpen ? 'bg-zinc-700 text-white border-zinc-600' : 'text-zinc-400 border-zinc-700 hover:text-zinc-200'}`}
          title="Console — everything your app prints, right here (no F12 needed)"
        >
          <Terminal className="w-3.5 h-3.5" />
          {consoleErrorCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center">
              {consoleErrorCount > 99 ? '99+' : consoleErrorCount}
            </span>
          )}
        </button>
        <button onClick={() => void loadInBrowser()} disabled={loading || !workspaceId} className="flex items-center gap-1 hover:text-zinc-200 disabled:opacity-40" title="Rebuild the in-browser preview from the current files">
          {loading ? <TirangaLoader className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
        </button>
      </div>
      {consoleOpen && (
        <div className="border-b border-zinc-800 bg-black/60 text-[11px] font-mono">
          <div className="max-h-40 overflow-y-auto px-3 py-1.5 space-y-0.5">
            {consoleEntries.length === 0 && <p className="text-zinc-600">Console is empty — your app has not printed anything yet.</p>}
            {consoleEntries.map((c, i) => (
              <div key={`${c.at}-${i}`} className="flex items-start gap-2">
                <span className={`flex-1 min-w-0 whitespace-pre-wrap break-words ${c.level === 'error' ? 'text-rose-300' : c.level === 'warn' ? 'text-amber-300' : 'text-zinc-300'}`}>
                  {c.text}
                </span>
                {c.level === 'error' && onFixError && (
                  <button
                    onClick={() => onFixError(c.text)}
                    className="shrink-0 px-1.5 rounded border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/10 text-[10px]"
                    title="Hand this error to the AI to fix"
                  >
                    Fix with AI
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end px-3 py-1 border-t border-zinc-800/60">
            <button onClick={() => setConsoleEntries([])} className="text-[10px] text-zinc-500 hover:text-zinc-300">Clear</button>
          </div>
        </div>
      )}
      {editMode && selection && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 bg-zinc-900/80 text-[11px] text-zinc-300 flex-wrap">
          <span className="font-mono text-zinc-500">&lt;{selection.tag || 'el'}&gt;</span>
          <button onClick={() => applyStyle(selection, { fontWeight: veIsBold(selection.styles) ? 'normal' : 'bold' })}
            className={`w-6 h-6 rounded border font-bold ${veIsBold(selection.styles) ? 'bg-emerald-600 text-white border-emerald-500' : 'border-zinc-700 hover:text-white'}`} title="Bold">B</button>
          <div className="flex items-center gap-1">
            <button onClick={() => applyStyle(selection, { fontSize: `${Math.max(8, Math.round(veFontPx(selection.styles)) - 2)}px` })} className="w-6 h-6 rounded border border-zinc-700 hover:text-white" title="Smaller text">A−</button>
            <span className="w-9 text-center tabular-nums text-zinc-400">{Math.round(veFontPx(selection.styles))}px</span>
            <button onClick={() => applyStyle(selection, { fontSize: `${Math.min(200, Math.round(veFontPx(selection.styles)) + 2)}px` })} className="w-6 h-6 rounded border border-zinc-700 hover:text-white" title="Bigger text">A+</button>
          </div>
          <label className="flex items-center gap-1 cursor-pointer" title="Text color">
            <span className="text-zinc-500">Color</span>
            <input type="color" value={veRgbToHex(selection.styles.color)} onChange={(e) => applyStyle(selection, { color: e.target.value })} className="w-6 h-6 rounded border border-zinc-700 bg-transparent cursor-pointer p-0" />
          </label>
          <div className="flex items-center gap-0.5">
            {(['left', 'center', 'right'] as const).map((a) => (
              <button key={a} onClick={() => applyStyle(selection, { textAlign: a })}
                className={`w-6 h-6 rounded border text-[10px] font-semibold uppercase ${selection.styles.textAlign === a ? 'bg-emerald-600 text-white border-emerald-500' : 'border-zinc-700 hover:text-white'}`} title={`Align ${a}`}>{a[0]}</button>
            ))}
          </div>
          <span className="text-zinc-600 hidden sm:inline">drag = move · corner = resize</span>
          <div className="flex-1" />
          {onAskAiAboutElement && (
            // THE Lovable-class move (world-best-preview, 2026-08-06): the selection already knows its
            // exact source location (file:line:column via the data-nbai-src stamp) — hand it to the
            // chat so the user just says WHAT to change and the engine edits exactly THAT element.
            <button
              onClick={() => onAskAiAboutElement(`<${selection.tag || 'element'}> in ${selection.file} (line ${selection.line}, column ${selection.column})`)}
              className="flex items-center gap-1 px-2 h-6 rounded border border-indigo-500/50 text-indigo-300 hover:bg-indigo-500/10"
              title="Tell the AI what to change about this exact element"
            >
              <Sparkles className="w-3 h-3" /> Ask AI
            </button>
          )}
          <button onClick={() => postToIframe({ __nbaiEditText: true })} className="px-2 h-6 rounded border border-zinc-700 hover:text-white" title="Edit this element's text (or double-click it)">Edit text</button>
          <button onClick={() => { setSelection(null); postToIframe({ __nbaiDeselect: true }); }} className="px-2 h-6 rounded border border-zinc-700 hover:text-white" title="Deselect">Done</button>
        </div>
      )}
      {editError && (
        <div className="px-3 py-1.5 text-[11px] text-amber-300 bg-amber-950/40 border-b border-amber-900">{editError}</div>
      )}
      {recovered && (
        // The deep refresh made a previously-broken preview render again — tell the user honestly
        // that no AI fix was needed (and no credit was spent).
        <div className="px-3 py-1.5 text-[11px] text-emerald-300 bg-emerald-950/40 border-b border-emerald-900 flex items-center justify-between gap-2">
          <span>✓ Preview recovered after a deep refresh — no AI fix was needed.</span>
          <button onClick={() => setRecovered(false)} className="shrink-0 text-emerald-500 hover:text-emerald-300">Dismiss</button>
        </div>
      )}
      {mode === 'inbrowser' && hasBackend && (
        // Task #64 — honest full-stack state. The in-browser preview compiles only the frontend, so an
        // app with a backend renders here with its data/API features non-functional. Say so plainly and
        // point to the Live server (which actually boots the backend) instead of a silently-broken app.
        <div className="px-3 py-1.5 text-[11px] text-sky-200 bg-sky-950/40 border-b border-sky-900 flex items-center justify-between gap-2">
          <span>
            ℹ️ This app has {backendReason || 'a backend'} — the in-browser preview shows the frontend
            only, so its data/API features won't work here. Switch to the Live server to run it fully.
          </span>
          <button onClick={() => setMode('live')} className="shrink-0 px-2 py-0.5 rounded bg-sky-800 hover:bg-sky-700 text-sky-100 font-semibold">Live server</button>
        </div>
      )}
      {mode === 'inbrowser' && !frameworkRunsInBrowser(framework) ? (
        // SSR / meta framework (Next.js, Nuxt, …) or a backend — no browser SPA entry, so the in-browser
        // bundler can't run it (it used to show a misleading "No React entry module found" as if the app
        // were broken). Say so honestly and send the user to the Live server, which boots the real app.
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="w-12 h-12" dangerouslySetInnerHTML={{ __html: ashokChakraSvg(48, '#4f6ef7') }} />
          <p className="text-zinc-200 font-medium">{serverFrameworkLabel(framework)} runs on the Live server</p>
          <p className="text-[12px] text-zinc-500 max-w-sm">
            This is a {serverFrameworkLabel(framework)} app — it renders on a real Node/SSR server (pages,
            API routes, server components), so the lightweight in-browser preview can&apos;t run it. Your app
            isn&apos;t broken — switch to the Live server to see it fully.
          </p>
          <button onClick={() => setMode('live')} className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold">
            {effectiveUrl ? '● ' : ''}Open Live server
          </button>
        </div>
      ) : loading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-500 text-sm">
          {/* Ashok Chakra loader (admin 2026-07-07) — same spinner the in-iframe boot overlay uses. */}
          <div className="w-12 h-12 animate-spin" style={{ animationDuration: '1.6s' }} dangerouslySetInnerHTML={{ __html: ashokChakraSvg(48, '#4f6ef7') }} />
          <div className="flex items-center">Loading files &amp; compiling preview…{loadSeconds > 0 ? <span className="ml-1.5 font-mono text-zinc-600">{loadSeconds}s</span> : null}</div>
          {loadSeconds >= 8 && (
            <p className="text-[11px] text-zinc-600 max-w-xs text-center">Still working — the first load after a long gap fetches your saved files from storage, which can take a few extra seconds. Repeat opens are much faster.</p>
          )}
        </div>
      ) : err ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
          <Empty>Couldn't build the in-browser preview: {err}</Empty>
          {onFixError && (
            // P-UX.3 + deep refresh (admin 2026-07-12): clicking "Fix with AI" first runs a FREE deep
            // refresh (cache-bypassing recompile) — the preview often just recovers, so no AI turn is
            // spent. Only if it still fails does the exact error get prepopulated into the chat (the
            // user reviews + sends) rather than firing silently, so a destructive auto-fix never runs
            // without the user's go-ahead.
            <button
              onClick={() => void fixWithAiAfterRefresh(err)}
              disabled={deepRefreshing}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold"
              title="First deep-refreshes the preview (it may just start working); only if it still fails does it send the error to the AI"
            >
              {deepRefreshing ? <TirangaLoader className="w-3.5 h-3.5" /> : <Wand2 className="w-3.5 h-3.5" />}
              {deepRefreshing ? 'Deep-refreshing preview…' : 'Fix with AI'}
            </button>
          )}
          {deepRefreshing && (
            <p className="text-[11px] text-zinc-500 max-w-xs text-center">Trying a clean rebuild first — it may just start working without an AI fix.</p>
          )}
        </div>
      ) : html && previewSandboxUrl ? (
        // SECURITY Phase 4 — CROSS-ORIGIN preview (VITE_PREVIEW_ORIGIN set): the iframe loads a tiny
        // host page on the SEPARATE preview origin and receives the built HTML via postMessage (below),
        // so the untrusted app runs in an isolated origin. `allow-same-origin` is safe now — it's the
        // preview origin's (empty) localStorage, never the platform's Firebase token — and `import()`
        // still works because the preview origin is a real https origin.
        <ResponsiveFrame viewport={viewport}>
          <iframe
            ref={inBrowserIframeRef}
            title="In-browser preview"
            src={previewSandboxUrl}
            onLoad={() => {
              // Hand the built HTML to the isolated host once it's loaded (the effect below re-posts on
              // every subsequent html change, since a static `src` iframe won't auto-reload like srcDoc).
              try { inBrowserIframeRef.current?.contentWindow?.postMessage({ [PREVIEW_HTML_MESSAGE]: html }, new URL(previewSandboxUrl).origin); } catch { /* best-effort */ }
            }}
            className="w-full h-full bg-white border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </ResponsiveFrame>
      ) : html ? (
        // DEFAULT (no separate preview origin configured) — same-origin srcDoc. allow-same-origin is
        // REQUIRED here: without it the srcDoc has an opaque origin and the dynamic ES-module import()
        // (how the preview loads React from the CDN) is blocked → "Missing dependency react". Safe under
        // the allowlist (trusted admins only); Phase 4 cross-origin isolation activates once
        // VITE_PREVIEW_ORIGIN is set. The live-server iframe above already sets allow-same-origin.
        <ResponsiveFrame viewport={viewport}>
          <iframe
            ref={inBrowserIframeRef}
            title="In-browser preview"
            srcDoc={html}
            className="w-full h-full bg-white border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </ResponsiveFrame>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
          <Empty>{workspaceId ? 'Loading your saved files into the preview…' : 'No live preview yet — it appears the moment the agent starts the app.'}</Empty>
          {workspaceId && (
            // Manual escape hatch for the invariant "files exist ⇒ the preview renders": if every
            // bounded auto-retry above somehow lost, one tap reloads from the durable files.
            <button
              onClick={() => { emptyRetries.current = 0; void loadInBrowser(); }}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
              title="Compile the saved files into the in-browser preview"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Load preview
            </button>
          )}
        </div>
      )}
    </div>
  );
}
