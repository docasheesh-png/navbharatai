// Shared v3.0 preview surface — the "Live server" + "In-browser" preview the v3.0 build produces.
//
// Extracted from AgentV3Panel so BOTH the v3.0 panel AND the main slide-out "Preview" menu render the
// SAME, working v3.0 preview (driven by the live sandbox URL or the in-browser build of the saved
// files). Previously the main-menu Preview rendered the retired v2.0 `generatedCode`, which a v3.0
// build never writes — so the preview looked permanently "disconnected" from the v3.0 engine.

import { useCallback, useEffect, useState } from 'react';
import { RotateCcw, ExternalLink, Loader2, Wand2 } from 'lucide-react';
import { auth } from '../../App';

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
export function PreviewSurface({ url, workspaceId, userId, email, onFixError }: { url?: string; workspaceId?: string; userId?: string; email?: string; onFixError?: (errorText: string) => void }) {
  const [mode, setMode] = useState<'live' | 'inbrowser'>(url ? 'live' : 'inbrowser');
  const [html, setHtml] = useState<string>('');
  const [kind, setKind] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>('');
  const [sandbox, setSandbox] = useState<{ livePreviewAvailable: boolean; actuator: string; previewDomainWarning: string | null } | null>(null);
  const [liveReloadKey, setLiveReloadKey] = useState(0);

  useEffect(() => { if (url) setMode('live'); }, [url]);

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

  const loadInBrowser = useCallback(async () => {
    if (!workspaceId) { setErr('Build something first — there are no files to preview yet.'); return; }
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

  const switcher = (
    <div className="flex items-center gap-1">
      <button onClick={() => setMode('live')} className={`px-2 py-0.5 rounded text-[11px] border ${mode === 'live' ? 'bg-zinc-800 text-white border-zinc-600' : 'text-zinc-400 border-zinc-700 hover:text-zinc-200'}`} title="The running app in the cloud sandbox (full fidelity)">Live server</button>
      <button onClick={() => setMode('inbrowser')} className={`px-2 py-0.5 rounded text-[11px] border ${mode === 'inbrowser' ? 'bg-zinc-800 text-white border-zinc-600' : 'text-zinc-400 border-zinc-700 hover:text-zinc-200'}`} title="A self-contained preview rendered in your browser — no server needed">In-browser</button>
    </div>
  );

  if (mode === 'live' && url) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 text-xs text-zinc-400">
          {switcher}
          <span className="truncate flex-1">{url}</span>
          <button onClick={() => setLiveReloadKey((k) => k + 1)} className="flex items-center gap-1 hover:text-zinc-200" title="Reload the live preview (reconnect to the sandbox)"><RotateCcw className="w-3.5 h-3.5" /></button>
          <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-zinc-200" title="Open in new tab"><ExternalLink className="w-3.5 h-3.5" /></a>
        </div>
        <iframe key={liveReloadKey} title="Live preview" src={url} className="flex-1 w-full bg-white" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
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
        <button onClick={loadInBrowser} disabled={loading || !workspaceId} className="flex items-center gap-1 hover:text-zinc-200 disabled:opacity-40" title="Rebuild the in-browser preview from the current files">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
        </button>
      </div>
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Building preview…</div>
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
        <iframe title="In-browser preview" srcDoc={html} className="flex-1 w-full bg-white" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
      ) : (
        <div className="flex-1 flex items-center justify-center p-6"><Empty>{workspaceId ? 'No preview yet — build something first.' : 'No live preview yet — it appears the moment the agent starts the app.'}</Empty></div>
      )}
    </div>
  );
}
