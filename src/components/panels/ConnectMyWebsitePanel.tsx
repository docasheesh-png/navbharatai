// ConnectMyWebsitePanel — the ONE real "Connect my website" entry point, reachable from both
// Sidebar → More menu → "Connect my website" AND Home → Other AI → Publish & Deploy → "Custom
// Domain" (root-cause fix, admin report 2026-07-27: two separate domain-connect screens existed
// and neither one fully worked — `ide/CustomDomain.tsx` was a client-only DNS-instructions wizard
// with no backend, and the Cloudflare-for-SaaS `ConnectDomainPanel` provisioned a hostname but
// never actually routed a domain to any specific app, per its own code comment in
// firebaseCustomDomain.ts: "the serving layer... is missing"). The REAL, complete flow already
// existed — `NbaiDomainConnect`, used inside the AgentV3 build panel's Hosting chooser — it
// attaches a domain directly to a workspace's own dedicated Firebase Hosting site with honest
// pending/active status. It just needed a workspaceId, which a global sidebar entry doesn't have.
//
// This panel supplies that: list the user's NavBharatAI Pro v5.0 apps (reusing the same
// /api/app-debug/sources endpoint the Full-App Debugger uses), auto-pick when there's exactly one,
// otherwise let the user choose which app this domain should point to — then hand off to the real
// NbaiDomainConnect flow. Honest end-to-end: an app-less account sees a clear "build an app first"
// state instead of a domain form that can never actually connect anything.

import { useEffect, useState, useCallback } from 'react';
import { Globe, ChevronLeft, ChevronRight, FileCode2 } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { authJsonHeaders } from '../../lib/authHeaders';
import { getAgentV3WorkspaceId } from '../../lib/agentv3Workspace';
import { NbaiDomainConnect } from '../agentv3/NbaiDomainConnect';
import { usePublishState } from '../../hooks/usePublishState';
import { auth } from '../../lib/firebase';

interface ProApp {
  workspaceId: string;
  label: string;
  fileCount: number;
  savedAt: number;
}

export interface ConnectMyWebsitePanelProps {
  onBack: () => void;
  /** Optional signed-in uid — used only to highlight the currently-active app as the default pick. */
  uid?: string | null;
}

export function ConnectMyWebsitePanel({ onBack, uid }: ConnectMyWebsitePanelProps) {
  const [loading, setLoading] = useState(true);
  const [apps, setApps] = useState<ProApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // workspaceId → connected domain(s), so each app can show whether it's already on a domain
  // (admin 2026-08-19: "list me connected likh kar aana chahiye — pata hi nahi lagta kaun si connected hai").
  const [connected, setConnected] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/app-debug/sources', { headers: await authJsonHeaders() });
        if (cancelled) return;
        if (res.status === 401) {
          setError('Please sign in to connect a domain to your app.');
          setApps([]);
          return;
        }
        if (!res.ok) {
          setError('Could not load your apps — please try again.');
          setApps([]);
          return;
        }
        const data = await res.json().catch(() => ({}));
        const list: ProApp[] = Array.isArray(data?.proV5Apps) ? data.proV5Apps : [];
        setApps(list);
        if (list.length === 1) setSelected(list[0].workspaceId);
      } catch {
        if (!cancelled) { setError('Network error — please try again.'); setApps([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    // Which apps already have a connected domain — best-effort, only decorates the list.
    (async () => {
      try {
        const res = await fetch('/api/domains/nbai/links', { headers: await authJsonHeaders() });
        if (cancelled || !res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (data?.byWorkspace && typeof data.byWorkspace === 'object') setConnected(data.byWorkspace);
      } catch { /* the badge is optional — a failure just hides it */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const currentWorkspaceId = uid ? getAgentV3WorkspaceId(uid) : null;

  const pickApp = useCallback((workspaceId: string) => setSelected(workspaceId), []);

  /**
   * PUBLISH FROM HERE TOO (2026-08-21).
   *
   * This panel is the OTHER documented way into the same domain flow (Sidebar → Connect my website,
   * and Other AI → Publish & Deploy → Custom Domain) — the file header calls it "one real flow, not
   * three different screens". When the Publish button and its red dot were added to the domain screen,
   * this entry point would have silently been the one without them: the same screen, missing the step
   * it now tells people to take. That is the exact divergence this panel was created to end.
   *
   * It drives the SAME server publish the build panel uses (`POST /api/agentv3/publish`) for the app
   * the user selected here, so it is a second caller of one pipeline, never a second pipeline.
   */
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState('');
  const publishState = usePublishState(selected, publishing);

  const publishSelected = (): string | null => {
    if (!selected) return 'Choose an app first.';
    if (publishing) return 'Your app is already being published — one moment.';
    setPublishing(true);
    setPublishMsg('Building your app…');
    void (async () => {
      try {
        const res = await fetch('/api/agentv3/publish', {
          method: 'POST',
          headers: await authJsonHeaders(),
          // The identity gate reads these from the BODY (the ownership check separately verifies the
          // real token, so this is not a trust boundary). Omitting them would 404 for every account on
          // an allowlisted deployment — a button that is dead for exactly the people who use it.
          body: JSON.stringify({
            workspaceId: selected,
            userId: uid ?? auth.currentUser?.uid ?? undefined,
            email: auth.currentUser?.email ?? undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        // The server's own words, verbatim — a generic "publish failed" is what makes a button feel
        // dead, and a build error carries the compiler output the user actually needs.
        if (!res.ok) { setPublishMsg(data?.detail ? `${data.error}\n\n${data.detail}` : (data?.error || 'Could not publish your app.')); return; }
        setPublishMsg(typeof data?.url === 'string' && data.url ? `Your app is live at ${data.url}` : (data?.message || 'Published.'));
      } catch {
        setPublishMsg('Could not reach NavBharatAI. Check your connection and try again.');
      } finally {
        setPublishing(false);
      }
    })();
    return null;
  };

  return (
    <div className="h-full overflow-y-auto custom-scrollbar bg-[#0d1117] text-white">
      <div className="max-w-2xl mx-auto px-3 sm:px-5 py-5 sm:py-6">
        {selected ? (
          <div className="flex flex-col gap-2">
            <NbaiDomainConnect
              workspaceId={selected}
              onBack={() => setSelected(null)}
              onPublish={publishSelected}
              publishBusy={publishing}
              /* The publish RESULT, verbatim. It used to be rendered BELOW this component, by this
                 panel — which worked, and was also the reason the other host of the same screen could
                 quietly not render it at all. It is an input of the screen now, so the button and the
                 answer to pressing it can never again live on different surfaces. */
              publishResult={publishMsg}
              publishFreshness={publishState?.freshness}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <button onClick={onBack} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-colors" title="Back">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div>
                <h3 className="text-sm font-bold text-white">Connect my website</h3>
                <p className="text-[11px] text-zinc-400">Point your own domain at an app you built on NavBharatAI.</p>
              </div>
            </div>

            {loading && (
              <div className="flex items-center gap-2 px-3 py-4 justify-center text-zinc-400 text-sm">
                <TirangaLoader className="w-4 h-4" /> Loading your apps…
              </div>
            )}

            {!loading && error && (
              <div className="px-3 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-[12px] text-red-200/90">
                {error}
              </div>
            )}

            {!loading && !error && apps && apps.length === 0 && (
              <div className="px-3 py-4 rounded-lg bg-zinc-900 border border-zinc-800 text-center flex flex-col items-center gap-2">
                <Globe className="w-6 h-6 text-zinc-500" />
                <p className="text-[12px] text-zinc-300">You don't have a built app yet.</p>
                <p className="text-[11px] text-zinc-500">Build something with NavBharatAI Pro v5.0 first, then come back here to connect your own domain to it.</p>
              </div>
            )}

            {!loading && !error && apps && apps.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Which app should this domain point to?</span>
                {apps.map((a) => (
                  <button
                    key={a.workspaceId}
                    onClick={() => pickApp(a.workspaceId)}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-emerald-500/50 hover:bg-zinc-800/80 text-left transition-colors"
                  >
                    <FileCode2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-white truncate">{a.label}</div>
                      {connected[a.workspaceId]?.length ? (
                        <div className="text-[10px] text-green-400 flex items-center gap-1 truncate">
                          <Globe className="w-3 h-3 shrink-0" />
                          <span className="truncate">Connected: {connected[a.workspaceId].join(', ')}</span>
                        </div>
                      ) : a.workspaceId === currentWorkspaceId ? (
                        <div className="text-[10px] text-emerald-400">Currently open</div>
                      ) : null}
                    </div>
                    {connected[a.workspaceId]?.length ? (
                      <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-green-500/15 text-green-300 shrink-0">Connected</span>
                    ) : null}
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ConnectMyWebsitePanel;
