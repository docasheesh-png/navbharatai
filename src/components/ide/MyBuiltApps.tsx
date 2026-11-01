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

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Package, RefreshCw, Trash2, AlertTriangle, Clock, CheckCircle2, X } from 'lucide-react';
import { PublishToNavStore } from './PublishToNavStore';
import { deliverFile, deliveryMessage } from '../../lib/downloadFile';
import { fetchMobileBuildFile, fetchMobileBuildJson, usableMobileBuildArtifacts } from '../../lib/mobileBuildWatch';

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
  /** The run succeeded, but no app file is visible. It can be delayed, expired or removed. */
  | { kind: 'unavailable' }
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
  const [forgetError, setForgetError] = useState('');
  const [state, setState] = useState<Record<string, AppState>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);
  const live = useRef(true);
  const listRequest = useRef(0);
  const appRequests = useRef<Record<string, number>>({});
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  const loadApps = useCallback(async () => {
    const request = ++listRequest.current;
    setListError('');
    try {
      const { response: res, data } = await fetchMobileBuildJson('/api/mobile-ship/my-apps', { headers: await ghHeaders() });
      if (!live.current || request !== listRequest.current) return;
      if (!res.ok || !Array.isArray(data?.apps)) { setListError(data?.error || 'Could not load your apps.'); setApps((previous) => previous ?? []); return; }
      setApps(data.apps);
    } catch {
      if (!live.current || request !== listRequest.current) return;
      setListError('Could not reach NavBharatAI. Check your connection.');
      setApps((previous) => previous ?? []);
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
    const request = (appRequests.current[app.id] || 0) + 1;
    appRequests.current[app.id] = request;
    const update = (next: AppState) => {
      if (live.current && appRequests.current[app.id] === request) setState((s) => ({ ...s, [app.id]: next }));
    };
    update({ kind: 'checking' });
    try {
      const headers = await ghHeaders();
      const q = new URLSearchParams({ owner: app.owner, repo: app.repo, workflow: app.workflow || 'android-apk.yml' });
      const { response: runsRes, data: runsData } = await fetchMobileBuildJson(`/api/mobile-ship/runs?${q}`, { headers });
      if (!runsRes.ok) {
        update({ kind: 'unknown', why: runsData?.error || 'Could not read this build from GitHub.' });
        return;
      }
      const run = Array.isArray(runsData?.runs) ? runsData.runs[0] : undefined;
      if (!run) { update({ kind: 'unknown', why: 'No builds found for this app yet.' }); return; }
      if (run.status !== 'completed') { update({ kind: 'building' }); return; }
      if (run.conclusion !== 'success') { update({ kind: 'failed' }); return; }

      if (!live.current || appRequests.current[app.id] !== request) return;
      const { response: aRes, data: aData } = await fetchMobileBuildJson(`/api/mobile-ship/artifacts?owner=${encodeURIComponent(app.owner)}&repo=${encodeURIComponent(app.repo)}&runId=${encodeURIComponent(String(run.id))}`, { headers });
      if (!aRes.ok) {
        update({ kind: 'unknown', why: aData?.error || 'Could not read the build files.' });
        return;
      }
      const artifacts = usableMobileBuildArtifacts(aData?.artifacts);
      // Empty is not proof of expiry: a just-finished run can precede artifact publication.
      update(artifacts.length ? { kind: 'ready', artifacts } : { kind: 'unavailable' });
    } catch {
      update({ kind: 'unknown', why: 'Could not reach GitHub just now.' });
    }
  }, [ghHeaders]);

  const open = useCallback((app: MyBuiltApp) => {
    const next = openId === app.id ? null : app.id;
    setOpenId(next);
    if (next) void checkApp(app);
  }, [openId, checkApp]);

  const forget = useCallback(async (app: MyBuiltApp) => {
    setForgetError('');
    try {
      const { response: res, data } = await fetchMobileBuildJson(`/api/mobile-ship/my-apps/${encodeURIComponent(app.id)}`, { method: 'DELETE', headers: await ghHeaders() });
      if (!live.current) return;
      if (!res.ok) { setForgetError(data?.error || 'That app could not be removed from the list.'); return; }
      appRequests.current[app.id] = (appRequests.current[app.id] || 0) + 1;
    } catch { if (live.current) setForgetError('That app could not be removed from the list (no connection).'); }
    if (live.current) void loadApps();
  }, [ghHeaders, loadApps]);

  const download = useCallback(async (app: MyBuiltApp, artifactId: string | number, name: string) => {
    setDownloadError('');
    setDownloading(`${app.id}:${artifactId}`);
    try {
      const { blob, filename } = await fetchMobileBuildFile(`/api/mobile-ship/download?owner=${encodeURIComponent(app.owner)}&repo=${encodeURIComponent(app.repo)}&artifactId=${encodeURIComponent(String(artifactId))}`, { headers: await ghHeaders() }, name);
      if (!live.current) return;
      const delivered = await deliverFile(filename, blob);
      if (live.current && (delivered === 'failed' || delivered === 'cancelled')) setDownloadError(deliveryMessage(delivered, filename));
    } catch (error) {
      if (live.current) setDownloadError(error instanceof Error ? error.message : 'Could not download the app file. Please try again.');
    } finally {
      if (live.current) setDownloading(null);
    }
  }, [ghHeaders]);

  if (apps === null) {
    return <p className="text-xs text-muted flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Loading your apps…</p>;
  }

  if (apps.length === 0) {
    return (
      <p className="text-xs text-muted leading-relaxed">
        {listError || 'No apps yet. Build one and it will appear here — even if you close this screen.'}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {forgetError && <p role="alert" className="text-xs text-danger">{forgetError}</p>}
      {downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}
      {listError && <p role="alert" className="text-xs text-danger">{listError}</p>}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-ink flex items-center gap-1.5"><Package size={14} /> Your apps</h4>
        <button onClick={() => { void loadApps(); const app = apps.find((item) => item.id === openId); if (app) void checkApp(app); }} className="text-faint hover:text-ink p-1" aria-label="Refresh list">
          <RefreshCw size={13} />
        </button>
      </div>
      {/* Nothing here spends money — said out loud, because the build itself does. */}
      <p className="text-[11px] text-faint leading-snug">
        Every app you have built with NavBharatAI. Opening one is free — you already paid when it was built.
      </p>

      {apps.map((app) => {
        const st = state[app.id];
        return (
          <div key={app.id} className="rounded-xl border border-line bg-raised overflow-hidden">
            <div className="flex items-center gap-2 p-3">
              <button onClick={() => open(app)} className="flex-1 text-left min-w-0">
                <span className="block text-sm font-semibold text-ink truncate">{app.appName || app.repo}</span>
                <span className="block text-[11px] text-faint truncate">
                  {app.owner}/{app.repo}{app.createdAt ? ` · ${fmtDate(app.createdAt)}` : ''}
                </span>
              </button>
              <button onClick={() => void forget(app)} aria-label={`Remove ${app.appName || app.repo} from this list`}
                className="shrink-0 text-faint hover:text-danger p-1">
                <Trash2 size={14} />
              </button>
            </div>

            {openId === app.id && (
              <div className="px-3 pb-3 space-y-2 border-t border-line pt-3">
                {(!st || st.kind === 'checking') && (
                  <p className="text-xs text-muted flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Checking this build…</p>
                )}
                {st?.kind === 'building' && (
                  <p className="text-xs text-accent-text flex items-center gap-2"><Clock size={13} /> Still building. Come back in a few minutes.</p>
                )}
                {st?.kind === 'failed' && (
                  <p className="text-xs text-warn flex items-start gap-2">
                    <X size={13} className="shrink-0 mt-0.5" />
                    <span>This build did not finish. Build it again from the app builder — a failed build was never charged.</span>
                  </p>
                )}
                {st?.kind === 'unavailable' && (
                  <p className="text-xs text-warn flex items-start gap-2">
                    <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                    <span>The build finished, but its app file is not available yet. Check again; if it has expired or was removed, build a fresh file.</span>
                  </p>
                )}
                {st?.kind === 'unknown' && (
                  // Never presented as "your build is broken" — we could not ask, which is a different fact.
                  <p className="text-xs text-muted flex items-start gap-2">
                    <AlertTriangle size={13} className="shrink-0 mt-0.5" /><span>{st.why}</span>
                  </p>
                )}
                {st && st.kind !== 'checking' && (
                  <button onClick={() => void checkApp(app)} className="text-xs text-accent-text hover:underline">Check build again</button>
                )}
                {st?.kind === 'ready' && (
                  <>
                    <p className="text-xs text-success flex items-center gap-2"><CheckCircle2 size={13} /> Ready</p>
                    {st.artifacts.map((a) => (
                      <button key={String(a.id)} disabled={downloading !== null} onClick={() => void download(app, a.id, String(a.name))}
                        className="w-full text-left px-3 py-2 rounded-lg bg-indigo-600/90 hover:bg-indigo-500 text-on-accent text-xs font-bold">
                        {downloading === `${app.id}:${a.id}` ? 'Downloading…' : `Download ${String(a.name)}`}
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
