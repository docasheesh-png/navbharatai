// Shared v3.0 preview surface — the "Live server" + "In-browser" preview the v3.0 build produces.
//
// Extracted from AgentV3Panel so BOTH the v3.0 panel AND the main slide-out "Preview" menu render the
// SAME, working v3.0 preview (driven by the live sandbox URL or the in-browser build of the saved
// files). Previously the main-menu Preview rendered the retired v2.0 `generatedCode`, which a v3.0
// build never writes — so the preview looked permanently "disconnected" from the v3.0 engine.

import { useCallback, useEffect, useState } from 'react';
import { RotateCcw, ExternalLink, Loader2 } from 'lucide-react';
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
export function PreviewSurface({ url, workspaceId, userId, email }: { url?: string; workspaceId?: string; userId?: string; email?: string }) {
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
    if (mode === 'inbrowser' && !html && !loading && !err && workspaceId) { void loadInBrowser(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, workspaceId]);

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
        <div className="flex-1 flex items-center justify-center p-6"><Empty>Couldn't build the in-browser preview: {err}</Empty></div>
      ) : html ? (
        <iframe title="In-browser preview" srcDoc={html} className="flex-1 w-full bg-white" sandbox="allow-scripts allow-forms allow-popups" />
      ) : (
        <div className="flex-1 flex items-center justify-center p-6"><Empty>{workspaceId ? 'No preview yet — build something first.' : 'No live preview yet — it appears the moment the agent starts the app.'}</Empty></div>
      )}
    </div>
  );
}
