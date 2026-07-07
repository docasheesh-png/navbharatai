// Shared v3.0 preview surface — the "Live server" + "In-browser" preview the v3.0 build produces.
//
// Extracted from AgentV3Panel so BOTH the v3.0 panel AND the main slide-out "Preview" menu render the
// SAME, working v3.0 preview (driven by the live sandbox URL or the in-browser build of the saved
// files). Previously the main-menu Preview rendered the retired v2.0 `generatedCode`, which a v3.0
// build never writes — so the preview looked permanently "disconnected" from the v3.0 engine.

import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, ExternalLink, Loader2, Wand2, Stethoscope, Pen, Eye } from 'lucide-react';
import { auth } from '../../App';
import { newReloadTracker, shouldReloadOnSignal } from './previewAutoReload';
import { shouldAutoRebootPreview } from './previewAutoReboot';
import { ashokChakraSvg } from '../../lib/ashokChakra';

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

/**
 * Dual preview:
 *  • "Live server" — the running app in the cloud sandbox (full fidelity). Shown the moment the
 *    build emits a live URL; explains honestly when none exists yet (E2B off / still starting).
 *  • "In-browser" — a self-contained HTML build of the workspace files in an <iframe srcDoc>, no
 *    running server. Works even when the sandbox is unavailable, and (via the server's saved-files
 *    fallback) even after the sandbox is gone. In-browser defaults on when there is no live URL yet.
 */
export function PreviewSurface({ url, workspaceId, userId, email, framework, autoResume, reloadSignal, onFixError, onFileEdited }: { url?: string; workspaceId?: string; userId?: string; email?: string; framework?: string; autoResume?: boolean; reloadSignal?: number; onFixError?: (errorText: string) => void; onFileEdited?: (path: string, content: string) => void }) {
  // A4 (unified preview): in-browser is the DETERMINISTIC DEFAULT — it always renders the current
  // files instantly with no server, so the preview is never a dead "No live preview yet" empty state
  // that depends on an ephemeral E2B sandbox being up. "Live server" (full-fidelity, real runtime) is
  // an explicit opt-in toggle the user picks (or auto-selects via Diagnose). Root cause: the live URL
  // dies on sandbox idle-pause / recycle, so defaulting to it made the preview flaky.
  const [mode, setMode] = useState<'live' | 'inbrowser'>('inbrowser');
  const [html, setHtml] = useState<string>('');
  const [kind, setKind] = useState<string>('');
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
  const [sandbox, setSandbox] = useState<{ livePreviewAvailable: boolean; actuator: string; previewDomainWarning: string | null } | null>(null);
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
  useEffect(() => { setFoundUrl(''); setDiagResult(null); }, [workspaceId]); // a new workspace never inherits a stale diagnosis

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
  // reboot as the Diagnose button. Decision logic is pure + tested (shouldAutoRebootPreview); gated
  // once per workspace, idle-only, and never on a failed probe.
  const autoRebootedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!autoResume || mode !== 'live' || !workspaceId || diagnosing) return;
    const hasUrl = !!(url || foundUrl);
    if (!hasUrl || sandbox?.livePreviewAvailable !== true || autoRebootedFor.current === workspaceId) return;
    let cancelled = false;
    void (async () => {
      let status: string | null = null;
      try {
        const res = await fetch('/api/agentv3/preview-health', {
          method: 'POST',
          headers: await authJsonHeaders(),
          body: JSON.stringify({ workspaceId, userId, email, framework }),
        });
        const health = await res.json().catch(() => null) as { status?: unknown } | null;
        if (res.ok && health && typeof health.status === 'string') status = health.status;
      } catch { /* probe failed → status stays null → never reboot on a guess */ }
      if (cancelled) return;
      const decide = shouldAutoRebootPreview({
        autoResume: !!autoResume, liveTabShown: mode === 'live', hasUrl,
        liveBackend: sandbox?.livePreviewAvailable === true, diagnosing,
        alreadyRebooted: autoRebootedFor.current === workspaceId, healthStatus: status,
      });
      if (decide) {
        autoRebootedFor.current = workspaceId; // once per workspace — never a boot loop
        void runDiagnose();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoResume, mode, workspaceId, url, foundUrl, diagnosing, sandbox]);

  // Guards a compile from overlapping itself (a debounced auto-refresh must not fire a second fetch
  // while the first is still in flight — the slower response could otherwise clobber the newer one).
  const inFlight = useRef(false);
  const loadInBrowser = useCallback(async () => {
    if (!workspaceId) { setErr('Build something first — there are no files to preview yet.'); return; }
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setErr('');
    try {
      const res = await fetch('/api/agentv3/inbrowser-preview', {
        method: 'POST',
        headers: await authJsonHeaders(),
        // Send our own origin so the server loads the self-hosted preview compiler via an absolute
        // same-origin URL (a root-relative path doesn't resolve inside the sandboxed iframe srcDoc).
        body: JSON.stringify({ workspaceId, userId, email, origin: window.location.origin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `server returned ${res.status}`);
      setHtml(typeof data.html === 'string' ? data.html : '');
      setKind(typeof data.kind === 'string' ? data.kind : '');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setHtml('');
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [workspaceId, userId, email]);

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
    if (mode !== 'inbrowser' || !workspaceId || html || loading || err) { emptyRetries.current = 0; return; }
    if (emptyRetries.current >= 3) return;
    const t = setTimeout(() => { emptyRetries.current += 1; void loadInBrowser(); }, 1_200);
    return () => clearTimeout(t);
  }, [mode, workspaceId, html, loading, err, loadInBrowser]);

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

  // Capture in-browser preview failures (postMessage'd up from the sandboxed srcdoc iframe) into the
  // build's diagnostics report, so a build that "succeeded" but doesn't render shows the REAL preview
  // error in the downloadable report — no separate screenshot needed. Best-effort, fire-and-forget.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { __nbaiPreviewError?: boolean; source?: string; message?: string } | null;
      if (!d || d.__nbaiPreviewError !== true || !workspaceId || typeof d.message !== 'string') return;
      fetch('/api/agentv3/preview-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, userId, email, source: d.source === 'live' ? 'live' : 'in-browser', message: d.message.slice(0, 4000) }),
        keepalive: true,
      }).catch(() => { /* best-effort — capturing the error must never disrupt the preview */ });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [workspaceId, userId, email]);

  // VISUAL EDITOR (v1, in-browser mode only — see ReactPreview.ts's injected inspector script).
  // Clicking an element in edit mode reports back {file, line, column, newText}; this applies it via
  // the REAL AST-based endpoint (never a guess), then reloads the in-browser preview from the freshly
  // saved source so the edit is confirmed against what actually compiled, and notifies the parent
  // (onFileEdited) so Files/Code Studio/Git pick up the change immediately too — same as any other
  // v3.0 file write.
  const inBrowserIframeRef = useRef<HTMLIFrameElement | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');
  const setIframeEditMode = useCallback((on: boolean) => {
    try { inBrowserIframeRef.current?.contentWindow?.postMessage({ __nbaiSetEditMode: on }, '*'); } catch { /* best-effort */ }
  }, []);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { __nbaiVisualEditCommit?: boolean; file?: string; line?: number; column?: number; newText?: string } | null;
      if (!d || d.__nbaiVisualEditCommit !== true || !workspaceId || typeof d.file !== 'string') return;
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
  }, [workspaceId, userId, email, onFileEdited]);
  // Turn edit mode off whenever we leave in-browser mode or the preview reloads with fresh content —
  // the iframe itself is a NEW document after a reload, so any prior postMessage toggle is gone anyway;
  // this just keeps the button's own displayed state honest.
  useEffect(() => { if (mode !== 'inbrowser') setEditMode(false); }, [mode]);
  useEffect(() => { setEditMode(false); }, [html]);

  // In-browser first (the default). "Live server" shows a ● when a live URL is available so the
  // full-fidelity view is discoverable even though we no longer auto-switch to it.
  const switcher = (
    <div className="flex items-center gap-1">
      <button onClick={() => setMode('inbrowser')} className={`px-2 py-0.5 rounded text-[11px] border ${mode === 'inbrowser' ? 'bg-zinc-800 text-white border-zinc-600' : 'text-zinc-400 border-zinc-700 hover:text-zinc-200'}`} title="Instant, always-available preview rendered in your browser — no server needed (default)">In-browser</button>
      <button onClick={() => setMode('live')} className={`px-2 py-0.5 rounded text-[11px] border ${mode === 'live' ? 'bg-zinc-800 text-white border-zinc-600' : 'text-zinc-400 border-zinc-700 hover:text-zinc-200'}`} title="The running app in the cloud sandbox (full fidelity — real npm/runtime)">{effectiveUrl ? '● ' : ''}Live server</button>
    </div>
  );

  if (mode === 'live' && effectiveUrl) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 text-xs text-zinc-400">
          {switcher}
          <span className="truncate flex-1">{effectiveUrl}</span>
          <button onClick={() => setLiveReloadKey((k) => k + 1)} className="flex items-center gap-1 hover:text-zinc-200" title="Reload the live preview (reconnect to the sandbox)"><RotateCcw className="w-3.5 h-3.5" /></button>
          <a href={effectiveUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-zinc-200" title="Open in new tab"><ExternalLink className="w-3.5 h-3.5" /></a>
        </div>
        {liveLoading && (
          <div className="h-0.5 bg-zinc-800 overflow-hidden">
            <div className="h-full w-1/3 bg-indigo-500 animate-pulse" />
          </div>
        )}
        <iframe key={liveReloadKey} title="Live preview" src={effectiveUrl} onLoad={() => setLiveLoading(false)} className="flex-1 w-full bg-white" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
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
                      {diagnosing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Stethoscope className="w-3.5 h-3.5" />}
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
        <span className="flex-1 truncate">{kind ? `In-browser preview (${kind})` : 'In-browser preview'}</span>
        {savingEdit && <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />}
        {!!html && !err && (
          <button
            onClick={() => { const next = !editMode; setEditMode(next); setIframeEditMode(next); }}
            disabled={savingEdit}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] border disabled:opacity-40 ${editMode ? 'bg-emerald-600 text-white border-emerald-500' : 'text-zinc-400 border-zinc-700 hover:text-zinc-200'}`}
            title={editMode ? 'Exit visual editing — click a text element to edit it directly' : 'Visual Editor — click text in the preview to edit it directly (v1: simple text content)'}
          >
            {editMode ? <Eye className="w-3.5 h-3.5" /> : <Pen className="w-3.5 h-3.5" />}
            {editMode ? 'Editing…' : 'Edit'}
          </button>
        )}
        <button onClick={loadInBrowser} disabled={loading || !workspaceId} className="flex items-center gap-1 hover:text-zinc-200 disabled:opacity-40" title="Rebuild the in-browser preview from the current files">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
        </button>
      </div>
      {editError && (
        <div className="px-3 py-1.5 text-[11px] text-amber-300 bg-amber-950/40 border-b border-amber-900">{editError}</div>
      )}
      {loading ? (
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
            // P-UX.3 — One-click AI fix: hand the exact preview error to the agent so it can diagnose
            // and repair the build. Prepopulates the chat (the user reviews + sends) rather than
            // firing silently, so a destructive auto-fix never runs without the user's go-ahead.
            <button
              onClick={() => onFixError(err)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
              title="Send this error to the AI to fix"
            >
              <Wand2 className="w-3.5 h-3.5" /> Fix with AI
            </button>
          )}
        </div>
      ) : html ? (
        // NOTE: allow-same-origin is REQUIRED here — without it the srcDoc has an opaque origin and a
        // dynamic ES-module import() (how the preview loads React from the CDN) is blocked, so React
        // never loads → "Missing dependency react". The live-server iframe above already sets it.
        <iframe
          ref={inBrowserIframeRef}
          title="In-browser preview"
          srcDoc={html}
          className="flex-1 w-full bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
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
