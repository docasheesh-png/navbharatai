// "MAINE JO APK BANAYI THI, WOH KAHAN GAYI?" — the list that survives a back button.
//
// ADMIN 2026-08-17: "user ne apk banayi, ban gayi. usne download nahi ki, galti se back ho gaya. ab
// wapas woh dikh hi nahi rahi hai."
//
// The file was never lost — it is in the user's own GitHub repository for 14 days. What was lost was the
// way back: reading a build needs `owner` and `repo`, and those lived only in the build screen's state.
// The server now remembers them (AppBuildStore); this is the screen that reads them back.
//
// ── TWO RULES THIS SCREEN IS BUILT AROUND ───────────────────────────────────────────────────────────
//
// 1. IT COSTS NOTHING TO LOOK. The ₹1 is charged when a build SUCCEEDS. Status here comes from the runs
//    endpoint, which takes no money; the artifacts endpoint (which is where the charge lives) is called
//    only when the user OPENS one app, so opening a list of five old builds can never produce a
//    five-rupee surprise. A screen that debited somebody for scrolling is exactly what the billing law
//    exists to prevent.
//
// 2. IT NEVER OFFERS A FILE THAT IS NOT THERE. GitHub deletes an artifact after 14 days — our own build
//    screen says so. A list that showed a Download button for an expired build would be a NEW lie in
//    the middle of fixing an old one, so every row's state is read live from GitHub rather than cached,
//    and a build whose file has gone says so and offers a rebuild instead.

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Package, RefreshCw, Trash2, AlertTriangle, Clock, CheckCircle2, X } from 'lucide-react';
import { PublishToNavStore } from './PublishToNavStore';

export interface MyBuiltApp {
  id: string;
  owner: string;
  repo: string;
  workflow: string;
  runId: string | null;
  appName: string;
  createdAt: number;
}

/** What GitHub says about this app's newest build, right now. */
type AppState =
  | { kind: 'checking' }
  /** A run is queued or in progress. */
  | { kind: 'building' }
  /** Finished with a real file we can hand over. */
  | { kind: 'ready'; artifacts: Array<{ id: string | number; name: string; sizeBytes?: number }> }
  /** Finished, but GitHub has deleted the artifact (14 days) — honest, and offers a rebuild. */
  | { kind: 'expired' }
  /** The run itself failed. */
  | { kind: 'failed' }
  /** We could not ask. NOT a verdict on the build — see the message. */
  | { kind: 'unknown'; why: string };

const fmtDate = (ms: number) => {
  try {
    return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
};

export function MyBuiltApps({ ghHeaders }: { ghHeaders: (extra?: Record<string, string>) => Promise<Record<string, string>> }) {
  const [apps, setApps] = useState<MyBuiltApp[] | null>(null);
  const [listError, setListError] = useState('');
  const [state, setState] = useState<Record<string, AppState>>({});
  const [openId, setOpenId] = useState<string | null>(null);

  const loadApps = useCallback(async () => {
    setListError('');
    try {
      const res = await fetch('/api/mobile-ship/my-apps', { headers: await ghHeaders() });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setListError(data?.error || 'Could not load your apps.'); setApps([]); return; }
      setApps(Array.isArray(data?.apps) ? data.apps : []);
    } catch {
      setListError('Could not reach NavBharatAI. Check your connection.');
      setApps([]);
    }
  }, [ghHeaders]);

  useEffect(() => { void loadApps(); }, [loadApps]);

  /**
   * Read one app's live state.
   *
   * `runs` first, because it is free and answers building/failed on its own. `artifacts` is only
   * reached for a run that actually SUCCEEDED — that call is where the ₹1 lives, so it must never fire
   * for a build the user has not chosen to open.
   */
  const checkApp = useCallback(async (app: MyBuiltApp) => {
    setState((s) => ({ ...s, [app.id]: { kind: 'checking' } }));
    try {
      const headers = await ghHeaders();
      const q = new URLSearchParams({ owner: app.owner, repo: app.repo, workflow: app.workflow || 'android-apk.yml' });
      const runsRes = await fetch(`/api/mobile-ship/runs?${q}`, { headers });
      const runsData = await runsRes.json().catch(() => null);
      if (!runsRes.ok) {
        setState((s) => ({ ...s, [app.id]: { kind: 'unknown', why: runsData?.error || 'Could not read this build from GitHub.' } }));
        return;
      }
      const run = (runsData?.runs || [])[0];
      if (!run) { setState((s) => ({ ...s, [app.id]: { kind: 'unknown', why: 'No builds found for this app yet.' } })); return; }
      if (run.status !== 'completed') { setState((s) => ({ ...s, [app.id]: { kind: 'building' } })); return; }
      if (run.conclusion !== 'success') { setState((s) => ({ ...s, [app.id]: { kind: 'failed' } })); return; }

      const aRes = await fetch(`/api/mobile-ship/artifacts?owner=${encodeURIComponent(app.owner)}&repo=${encodeURIComponent(app.repo)}&runId=${encodeURIComponent(String(run.id))}`, { headers });
      const aData = await aRes.json().catch(() => null);
      if (!aRes.ok) {
        setState((s) => ({ ...s, [app.id]: { kind: 'unknown', why: aData?.error || 'Could not read the build files.' } }));
        return;
      }
      const artifacts = aData?.artifacts || [];
      // A successful run with no artifact left means GitHub has deleted it — the 14-day window. Saying
      // "ready" here and then failing the download is the lie this whole screen exists to avoid.
      setState((s) => ({ ...s, [app.id]: artifacts.length ? { kind: 'ready', artifacts } : { kind: 'expired' } }));
    } catch {
      setState((s) => ({ ...s, [app.id]: { kind: 'unknown', why: 'Could not reach GitHub just now.' } }));
    }
  }, [ghHeaders]);

  const open = useCallback((app: MyBuiltApp) => {
    const next = openId === app.id ? null : app.id;
    setOpenId(next);
    if (next && !state[app.id]) void checkApp(app);
  }, [openId, state, checkApp]);

  const forget = useCallback(async (app: MyBuiltApp) => {
    try {
      await fetch(`/api/mobile-ship/my-apps/${encodeURIComponent(app.id)}`, { method: 'DELETE', headers: await ghHeaders() });
    } catch { /* the row simply stays; nothing is lost */ }
    void loadApps();
  }, [ghHeaders, loadApps]);

  const download = useCallback(async (app: MyBuiltApp, artifactId: string | number, name: string) => {
    try {
      const res = await fetch(`/api/mobile-ship/download?owner=${encodeURIComponent(app.owner)}&repo=${encodeURIComponent(app.repo)}&artifactId=${encodeURIComponent(String(artifactId))}`, { headers: await ghHeaders() });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name.endsWith('.apk') || name.endsWith('.aab') ? name : `${name}.apk`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { /* the button simply does nothing rather than throwing at the user */ }
  }, [ghHeaders]);

  if (apps === null) {
    return <p className="text-xs text-white/45 flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Loading your apps…</p>;
  }

  if (apps.length === 0) {
    return (
      <p className="text-xs text-white/45 leading-relaxed">
        {listError || 'No apps yet. Build one and it will appear here — even if you close this screen.'}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-white flex items-center gap-1.5"><Package size={14} /> Your apps</h4>
        <button onClick={() => void loadApps()} className="text-white/40 hover:text-white p-1" aria-label="Refresh list">
          <RefreshCw size={13} />
        </button>
      </div>
      {/* Nothing here spends money — said out loud, because the build itself does. */}
      <p className="text-[11px] text-white/40 leading-snug">
        Every app you have built with NavBharatAI. Opening one is free — you already paid when it was built.
      </p>

      {apps.map((app) => {
        const st = state[app.id];
        return (
          <div key={app.id} className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
            <div className="flex items-center gap-2 p-3">
              <button onClick={() => open(app)} className="flex-1 text-left min-w-0">
                <span className="block text-sm font-semibold text-white truncate">{app.appName || app.repo}</span>
                <span className="block text-[11px] text-white/40 truncate">
                  {app.owner}/{app.repo}{app.createdAt ? ` · ${fmtDate(app.createdAt)}` : ''}
                </span>
              </button>
              <button onClick={() => void forget(app)} aria-label={`Remove ${app.appName || app.repo} from this list`}
                className="shrink-0 text-white/30 hover:text-red-400 p-1">
                <Trash2 size={14} />
              </button>
            </div>

            {openId === app.id && (
              <div className="px-3 pb-3 space-y-2 border-t border-white/5 pt-3">
                {(!st || st.kind === 'checking') && (
                  <p className="text-xs text-white/45 flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Checking this build…</p>
                )}
                {st?.kind === 'building' && (
                  <p className="text-xs text-indigo-300 flex items-center gap-2"><Clock size={13} /> Still building. Come back in a few minutes.</p>
                )}
                {st?.kind === 'failed' && (
                  <p className="text-xs text-amber-300 flex items-start gap-2">
                    <X size={13} className="shrink-0 mt-0.5" />
                    <span>This build did not finish. Build it again from the app builder — a failed build was never charged.</span>
                  </p>
                )}
                {st?.kind === 'expired' && (
                  <p className="text-xs text-amber-300 flex items-start gap-2">
                    <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                    <span>GitHub keeps a built file for 14 days, and this one has passed that. Build it again to get a fresh file.</span>
                  </p>
                )}
                {st?.kind === 'unknown' && (
                  // Never presented as "your build is broken" — we could not ask, which is a different fact.
                  <p className="text-xs text-white/50 flex items-start gap-2">
                    <AlertTriangle size={13} className="shrink-0 mt-0.5" /><span>{st.why}</span>
                  </p>
                )}
                {st?.kind === 'ready' && (
                  <>
                    <p className="text-xs text-emerald-300 flex items-center gap-2"><CheckCircle2 size={13} /> Ready</p>
                    {st.artifacts.map((a) => (
                      <button key={String(a.id)} onClick={() => void download(app, a.id, String(a.name))}
                        className="w-full text-left px-3 py-2 rounded-lg bg-indigo-600/90 hover:bg-indigo-500 text-white text-xs font-bold">
                        Download {String(a.name)}
                      </button>
                    ))}
                    {/* App Mart takes only the .apk — the store installs apps, and a .aab is a Play
                        Store bundle no phone can install. Same rule the build screen follows. */}
                    {st.artifacts.filter((a) => /apk/i.test(String(a.name))).map((a) => (
                      <PublishToNavStore
                        key={`pub-${a.id}`}
                        owner={app.owner}
                        repo={app.repo}
                        artifactId={a.id}
                        ghHeaders={ghHeaders}
                        defaultAppName={app.appName || app.repo}
                      />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
