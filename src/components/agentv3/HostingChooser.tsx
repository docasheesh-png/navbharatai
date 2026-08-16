// HostingChooser — the "Publish" surface for NavBharatAI Pro v5.0 (Hosting Phase 1).
//
// One screen, three paths, kept 100% in sync where it matters (all three publish/store the SAME
// workspace files):
//   1. Host on NavBharatAI  — our own hosting (the platform-paid Firebase static host, id 'firebase').
//                             One-click, no account, Free. Full app (backend + DB) is a later phase, so
//                             for a full-stack app this hosts the frontend and says so honestly.
//   2. Host somewhere else  — WE deploy to the user's own provider account (Vercel / Netlify /
//                             Cloudflare / GitHub Pages) using a token they've connected. Free from us;
//                             they pay their own provider.
//   3. I host it myself     — WE NEVER TOUCH HOSTING. NavBharatAI only writes code + opens a PR into
//                             the user's own GitHub repo (own-repo git storage — GitStorageTarget /
//                             UserGitHubClient / GitHubPrFlow), merging only when CI is green. The
//                             user's own host (already connected to that exact repo on ITS OWN
//                             dashboard) picks up the merge and deploys it — zero NavBharatAI
//                             involvement in the deploy itself (admin request 2026-07-27).
//
// It reuses the panel's existing, working deploy pipeline (`onDeploy(providerId)` → deployLive) and the
// already-fetched provider list — no new backend for paths 1-2. Only CONFIGURED providers are offered,
// so a deploy can never target a host that isn't set up. Pricing here is intentionally simple + honest
// (static = Free); it is the single place to change when the admin sets real numbers.

import { useEffect, useState } from 'react';
import { Rocket, X, Globe, Server, Link2, GitBranch, ExternalLink, AlertCircle, Database, Smartphone, Store } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { NbaiDomainConnect } from './NbaiDomainConnect';

export interface HostingProvider {
  id: string;
  name: string;
  configured: boolean;
  requirement: string;
}

export interface OwnRepoInfo { owner: string; repo: string; workBranch: string; baseBranch: string; }

export interface HostingChooserProps {
  providers: HostingProvider[];
  /**
   * Publish the current app to a provider id (drives the real build+deploy pipeline).
   *
   * Returns an HONEST reason string when the publish could NOT start (no app built yet, a build
   * already running, …) and null/void when it genuinely started. The chooser shows that reason inline
   * and stays open — it must never close on a publish that did not happen (admin 2026-08-02: the modal
   * closed and nothing happened, so every button felt fake).
   */
  onDeploy: (providerId: string) => string | null | void;
  onClose: () => void;
  /** A build/deploy is already running — disable the actions. */
  busy: boolean;
  /**
   * Live status of the direct publish ("Building your app…", the live URL, or the server's own error).
   * Shown verbatim: a generic failure message is what made this surface feel fake, and a build error
   * carries the compiler's real output the user needs.
   */
  publishStatus?: string;
  /** The current workspace — required to connect a per-app custom domain. */
  workspaceId?: string;
  /** Whether the Firebase-native "connect your own domain" surface is live (server flag). */
  customDomainsEnabled?: boolean;
  /** Set once this workspace is storing its code in the user's OWN GitHub repo (git-native storage). */
  ownRepo?: OwnRepoInfo | null;
  /** Whether a GitHub account is already connected (token present) — governs the "I host it myself" CTA. */
  githubConnected?: boolean;
  /** Start the GitHub connect flow (reuses the panel's existing OAuth redirect). */
  onConnectGitHub?: () => void;
  /** Authenticated fetch, so the data gate can ask the server about THIS user's workspace. */
  authedFetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Open Settings → App Settings → Database, for the "connect my own" answer. */
  onOpenDatabaseSettings?: () => void;
  /** Open the APK Builder (Other AI → APK Builder), pre-targeted to this app, to make an Android app. */
  onOpenApkBuilder?: () => void;
}

/** What the server knows about this app's data needs — see GET /api/agentv3/database-readiness. */
interface DatabaseReadiness {
  needsDatabase: boolean;
  signals: string[];
  connected: boolean;
  provider: string | null;
  canProvision: boolean;
}

const NBAI_HOST_ID = 'firebase'; // our platform-paid static host = "NavBharatAI hosting"

export function HostingChooser({
  providers, onDeploy, onClose, busy, publishStatus, workspaceId, customDomainsEnabled,
  ownRepo, githubConnected, onConnectGitHub, authedFetch, onOpenDatabaseSettings, onOpenApkBuilder,
}: HostingChooserProps) {
  const [view, setView] = useState<'choose' | 'domain' | 'selfhost'>('choose');
  // ── Nav App Store one-click publish (Kadam 1, admin: "1 click release/publish … v5 ke publish ke
  // 'Make an Android app' me kahi adjust kar dena"). The button lives HERE because this modal IS the
  // publish surface — the store is a fourth destination for the same app, beside hosting and APK.
  const [storeName, setStoreName] = useState('');
  const [storeBusy, setStoreBusy] = useState(false);
  const [storeResult, setStoreResult] = useState<{ ok: boolean; message: string; shareUrl?: string } | null>(null);

  const publishToStore = async () => {
    if (storeBusy) return;
    // The chooser's own standing rule (and its test): NO DEAD BUTTONS. A publish that cannot start
    // says WHY inline instead of sitting disabled with no explanation.
    if (!workspaceId || !authedFetch) {
      setStoreResult({ ok: false, message: 'Build an app first — there is nothing to publish yet.' });
      return;
    }
    const name = storeName.trim();
    if (!name) { setStoreResult({ ok: false, message: 'Give your app a name first.' }); return; }
    setStoreBusy(true);
    setStoreResult(null);
    try {
      const res = await authedFetch('/api/nav-store/web/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, name, visibility: 'public' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        // The gate's refusals are REAL and specific (a hardcoded key with its file:line, "needs a
        // server", a size cap) — show them verbatim; a generic failure line would hide the one
        // sentence the user needs.
        setStoreResult({ ok: false, message: data?.error || 'Publishing failed — nothing was published.' });
        return;
      }
      const shareUrl = `${window.location.origin}${data.shareUrl}`;
      try { await navigator.clipboard?.writeText(shareUrl); } catch { /* the link is shown anyway */ }
      setStoreResult({ ok: true, shareUrl, message: data.status === 'listed'
        ? 'Published! Your app is live on the store.'
        : 'Published! Your link works right now (copied) — the store listing goes live after a quick human review.' });
    } catch {
      setStoreResult({ ok: false, message: 'Could not reach the server — nothing was published.' });
    } finally {
      setStoreBusy(false);
    }
  };
  // The honest reason the LAST publish attempt didn't start. Shown inline; cleared on the next try.
  // A publish that cannot run must SAY SO here — never a button that silently does nothing.
  const [blocked, setBlocked] = useState<string | null>(null);

  // THE ONE DATABASE QUESTION, ASKED AT THE ONE MOMENT IT MATTERS (admin 2026-08-06).
  //
  // Never at preview — a preview database is a throwaway and asking then is friction with nothing
  // behind it. Here it is different: the sandbox does not come along, so publishing an app that saves
  // data with no database produces a LIVE site where every signup, order and booking fails. So we ask
  // once, we say WHY (the server returns the real signals from their own files), and we let them
  // proceed anyway with their eyes open — a wall the user cannot pass is not a question.
  const [dataGate, setDataGate] = useState<DatabaseReadiness | null>(null);
  const [dbBusy, setDbBusy] = useState(false);
  const [dbNote, setDbNote] = useState<string | null>(null);
  const [proceedAnyway, setProceedAnyway] = useState(false);

  useEffect(() => {
    if (!authedFetch || !workspaceId) return;
    let live = true;
    authedFetch(`/api/agentv3/database-readiness?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d && typeof d.needsDatabase === 'boolean') setDataGate(d as DatabaseReadiness); })
      // A readiness check that cannot run must never BLOCK a publish — it is an advisory, and a user
      // whose app is fine would otherwise be stuck behind our own outage.
      .catch(() => { /* stays null → no gate */ });
    return () => { live = false; };
  }, [authedFetch, workspaceId]);

  const needsAnswer = !!dataGate?.needsDatabase && !dataGate.connected && !proceedAnyway;

  const createDatabase = async () => {
    if (!authedFetch) return;
    setDbBusy(true); setDbNote(null);
    try {
      const res = await authedFetch('/api/integrations/supabase/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspaceId ?? '' }),
      });
      const data = await res.json().catch(() => null);
      // The server words these to tell the user what to do next (plan full, still starting up,
      // reconnect); passing them through unchanged is more useful than any generic line here.
      if (!res.ok) { setDbNote(data?.error || 'Your database could not be created just now.'); return; }
      setDataGate((g) => (g ? { ...g, connected: true, provider: 'Supabase' } : g));
      setDbNote(data?.schemaApplied === false
        ? 'Database created and connected — its tables could not be set up yet, so ask me to run your migrations after publishing.'
        : 'Database created in your own account and connected. You can publish now.');
    } catch {
      setDbNote('Could not reach NavBharatAI. Check your connection and try again.');
    } finally {
      setDbBusy(false);
    }
  };

  const publish = (providerId: string) => {
    setBlocked(null);
    if (needsAnswer) {
      setBlocked('Your app saves data but has no database yet — choose one below, or publish without it.');
      return;
    }
    const reason = onDeploy(providerId);
    if (typeof reason === 'string' && reason) setBlocked(reason); // stays open, explains itself
  };
  const hasOurHosting = providers.some((p) => p.id === NBAI_HOST_ID && p.configured);
  const byo = providers.filter((p) => p.configured && p.id !== NBAI_HOST_ID);
  // "Connect your own domain" is offered only when the server feature is on AND we have a workspace
  // to attach it to AND our hosting is available (a Firebase custom domain lives on our site).
  const canConnectDomain = !!customDomainsEnabled && !!workspaceId && hasOurHosting;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-label="Publish your app"
    >
      {/* SCROLL FIX (admin 2026-08-02, phone): the card was `overflow-hidden` with NO height cap, so on a
          phone the three publish paths were taller than the screen and everything below the fold —
          including the "Set up" button and the full-stack note — was CLIPPED with no way to reach it
          ("niche scroll nahi ho raha"). Cap the card at the viewport and scroll the BODY (the header
          stays put); `overscroll-contain` keeps the swipe inside the sheet instead of scrolling the page. */}
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Rocket className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Publish your app</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-zinc-800 rounded-lg" title="Close">
            <X className="w-4 h-4 text-zinc-400" />
          </button>
        </div>

        {/* Body — the ONE scroll container for every view (choose / domain / self-host). */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {view === 'domain' && workspaceId ? (
          <div className="p-4">
            <NbaiDomainConnect workspaceId={workspaceId} onBack={() => setView('choose')} />
          </div>
        ) : view === 'selfhost' ? (
          <div className="p-4 flex flex-col gap-3">
            <button onClick={() => setView('choose')} className="text-[11px] text-zinc-400 hover:text-white self-start">← Back</button>
            {ownRepo ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-emerald-400" />
                  <span className="text-[13px] font-bold text-white">Connected — {ownRepo.owner}/{ownRepo.repo}</span>
                </div>
                <p className="text-[11.5px] text-zinc-400 leading-relaxed">
                  NavBharatAI writes your code to the <code className="text-zinc-300">{ownRepo.workBranch}</code> branch
                  and opens a pull request. It only merges into <code className="text-zinc-300">{ownRepo.baseBranch}</code> once
                  your checks are green — we never push straight to your live branch.
                </p>
                <p className="text-[11.5px] text-zinc-400 leading-relaxed">
                  Connect this exact repo in your own hosting dashboard — Vercel, Netlify, Render, or Cloudflare
                  Pages all have an &quot;Import Git Repository&quot; option. Once connected there, every merge into
                  <code className="text-zinc-300"> {ownRepo.baseBranch}</code> deploys automatically through YOUR
                  account. NavBharatAI never touches your hosting or sees your deploy credentials.
                </p>
                <a
                  href={`https://github.com/${ownRepo.owner}/${ownRepo.repo}`}
                  target="_blank" rel="noopener noreferrer"
                  className="w-full py-2 rounded-lg border border-zinc-700 bg-zinc-900 hover:border-zinc-500 hover:text-white text-zinc-300 text-[11.5px] font-semibold flex items-center justify-center gap-2 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View repo on GitHub
                </a>
              </div>
            ) : !githubConnected ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-zinc-400" />
                  <span className="text-[13px] font-bold text-white">Connect GitHub first</span>
                </div>
                <p className="text-[11.5px] text-zinc-400 leading-relaxed">
                  To use your own hosting, NavBharatAI needs to write code into a GitHub repo you own — nothing
                  else. Connect your GitHub account to get started.
                </p>
                <button
                  onClick={() => onConnectGitHub?.()}
                  className="w-full py-2.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-900 text-xs font-bold flex items-center justify-center gap-2 transition-colors"
                >
                  <GitBranch className="w-3.5 h-3.5" />
                  Connect GitHub
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-emerald-400" />
                  <span className="text-[13px] font-bold text-white">GitHub connected ✓</span>
                </div>
                <p className="text-[11.5px] text-zinc-400 leading-relaxed">
                  This app isn't linked to one of your own repos yet. Import your existing repo (paste its URL
                  when you start a build, or ask NavBharatAI to import it) and this app's changes will go there
                  as pull requests instead — ready for your own host's auto-deploy to pick up.
                </p>
              </div>
            )}
          </div>
        ) : (
        <>
        {/* The publish did not start — say WHY, right where the user is looking. Never a silent no-op. */}
        {blocked && (
          <div className="mx-4 mt-4 flex items-start gap-2 rounded-lg border border-rose-900/50 bg-rose-950/30 px-3 py-2 text-[11.5px] text-rose-200">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{blocked}</span>
          </div>
        )}

        {/* The publish IS running, or has finished. The surface stays open and reports it — the whole
            point of moving publishing off the chat stream is that the user can watch it here. A build
            failure arrives with the compiler's real output, so `whitespace-pre-wrap` is deliberate. */}
        {publishStatus && (
          <div className="mx-4 mt-4 rounded-lg border border-sky-900/50 bg-sky-950/30 px-3 py-2 text-[11.5px] text-sky-100">
            <div className="flex items-start gap-2">
              {busy ? <TirangaLoader className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <Rocket className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
              <span className="whitespace-pre-wrap break-words max-h-48 overflow-auto">{publishStatus}</span>
            </div>
          </div>
        )}

        {/* The data gate. Shown only when the app REALLY stores data and REALLY has nowhere to put it. */}
        {dataGate?.needsDatabase && !dataGate.connected && (
          <div className="mx-4 mt-4 rounded-xl border border-amber-800/50 bg-amber-950/20 p-3.5 flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-amber-300" />
              <span className="text-[13px] font-bold text-white">Your app needs a database</span>
            </div>
            <p className="text-[11.5px] text-zinc-300 leading-relaxed">
              It uses {dataGate.signals.join(', ')}, so it saves data — but no database is connected yet.
              Publish without one and the live site will load, while anything that saves (signups, orders,
              bookings) will fail for real users.
            </p>
            {dbNote && <p className="text-[11.5px] text-amber-200 leading-relaxed">{dbNote}</p>}
            <div className="flex flex-col sm:flex-row gap-2">
              {dataGate.canProvision && (
                <button
                  onClick={() => void createDatabase()}
                  disabled={dbBusy}
                  className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-[11.5px] font-bold flex items-center justify-center gap-2 transition-colors"
                >
                  {dbBusy ? <TirangaLoader size={14} /> : <Database className="w-3.5 h-3.5" />}
                  {dbBusy ? 'Creating…' : 'Create one free in my account'}
                </button>
              )}
              <button
                onClick={() => onOpenDatabaseSettings?.()}
                className="flex-1 py-2 rounded-lg border border-zinc-700 bg-zinc-900 hover:border-zinc-500 text-zinc-200 text-[11.5px] font-semibold transition-colors"
              >
                Connect my own database
              </button>
            </div>
            {/* A question the user cannot answer "no" to is not a question. */}
            {!proceedAnyway && (
              <button
                onClick={() => { setProceedAnyway(true); setBlocked(null); }}
                className="text-[11px] text-zinc-500 hover:text-zinc-300 self-start underline underline-offset-2"
              >
                Publish without a database — I know data won&apos;t be saved
              </button>
            )}
          </div>
        )}
        <div className="p-4 grid gap-3 sm:grid-cols-2">
          {/* Path 1 — Host on NavBharatAI */}
          <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-4 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold text-white">Host on NavBharatAI</span>
              <span className="text-[9px] font-black uppercase tracking-widest text-emerald-300 bg-emerald-900/50 px-2 py-0.5 rounded-full">Free</span>
            </div>
            <p className="text-[11.5px] text-zinc-400 leading-relaxed">
              One click, no account. We host it and keep it online at a permanent link.
            </p>
            <ul className="text-[11px] text-zinc-300 flex flex-col gap-1 mt-0.5">
              <li>• Instant publish — nothing to set up</li>
              <li>• Frontend now · full app (backend + DB) coming soon</li>
              <li>• Fair-use limits apply (per-publish size + safety scan)</li>
            </ul>
            <button
              onClick={() => publish(NBAI_HOST_ID)}
              disabled={busy || !hasOurHosting}
              className="mt-auto w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors"
            >
              {busy ? <TirangaLoader className="w-4 h-4" /> : <Rocket className="w-3.5 h-3.5" />}
              Publish on NavBharatAI
            </button>
            {/* A disabled button with no explanation is its own dead end — say why it's greyed out. */}
            {!hasOurHosting && (
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                NavBharatAI hosting isn&apos;t available right now — you can still publish to your own
                provider or your own repo below.
              </p>
            )}
            {canConnectDomain && (
              <button
                onClick={() => setView('domain')}
                className="w-full py-1.5 rounded-lg border border-emerald-800/60 hover:border-emerald-600 text-emerald-300 hover:text-emerald-200 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                <Link2 className="w-3.5 h-3.5" />
                Connect your own domain
              </button>
            )}
          </div>

          {/* Path 2 — Host somewhere else: EITHER we deploy to the user's provider, OR they host it
              themselves (we only open a PR into their repo). Both are "off NavBharatAI", so they live in
              one card as two clear sub-choices (admin 2026-08-13). */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold text-white">Host somewhere else</span>
              <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded-full">Your account</span>
            </div>
            <p className="text-[11.5px] text-zinc-400 leading-relaxed">
              Keep it off NavBharatAI — your cloud, your bill, free from us.
            </p>

            {/* Sub-choice A — we deploy to the user's connected provider */}
            <div className="mt-0.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1.5">We deploy to your provider</p>
              {byo.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {byo.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => publish(p.id)}
                      disabled={busy}
                      title={p.requirement}
                      className="w-full py-2 rounded-lg border border-zinc-700 bg-zinc-900 hover:border-zinc-500 hover:text-white disabled:opacity-40 text-zinc-300 text-[11.5px] font-semibold flex items-center justify-center gap-2 transition-colors"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      Publish to {p.name}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  No provider connected yet. Connect Vercel, Netlify, Cloudflare, or GitHub Pages to publish
                  to your own account.
                </p>
              )}
            </div>

            {/* Sub-choice B — the user hosts it themselves; we only open a PR into their own GitHub repo */}
            <div className="mt-1.5 pt-2.5 border-t border-zinc-800">
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1.5">I host it myself</p>
              <p className="text-[11px] text-zinc-500 leading-relaxed mb-2">
                We only write code and open a pull request into your own GitHub repo — CI-gated. Your own
                host&apos;s auto-deploy takes it from there. We never touch your hosting.
              </p>
              <button
                onClick={() => setView('selfhost')}
                className="w-full py-2 rounded-lg border border-zinc-700 bg-zinc-900 hover:border-zinc-500 hover:text-white text-zinc-300 text-[11.5px] font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <GitBranch className="w-3.5 h-3.5" />
                {ownRepo ? `Connected: ${ownRepo.owner}/${ownRepo.repo}` : 'Set up'}
              </button>
            </div>
          </div>

          {/* Path 3 — Make an Android app (APK) via the APK Builder, pre-targeted to THIS app (admin 2026-08-13). */}
          <div className="rounded-xl border border-sky-800/50 bg-sky-950/20 p-4 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold text-white">Make an Android app</span>
              <span className="text-[9px] font-black uppercase tracking-widest text-sky-300 bg-sky-900/50 px-2 py-0.5 rounded-full">APK</span>
            </div>
            <p className="text-[11.5px] text-zinc-400 leading-relaxed">
              Turn this app into a real installable Android app (.apk) — share it or upload it to the Play Store.
            </p>
            <ul className="text-[11px] text-zinc-300 flex flex-col gap-1 mt-0.5">
              <li>• Built on your own GitHub account</li>
              <li>• Your app icon, name &amp; package</li>
              <li>• Signed .apk / .aab — ready to install</li>
            </ul>
            <button
              onClick={() => onOpenApkBuilder?.()}
              disabled={!onOpenApkBuilder}
              className="mt-auto w-full py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors"
            >
              <Smartphone className="w-3.5 h-3.5" />
              Open APK Builder
            </button>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Needs GitHub connected · paid step — the builder shows the price before you build.
            </p>
          </div>

          {/* Path 4 — Nav App Store (instant web app). One click; runs in every viewer's browser. */}
          <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-4 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold text-white">Put it on App Mart</span>
              <span className="text-[9px] font-black uppercase tracking-widest text-emerald-300 bg-emerald-900/50 px-2 py-0.5 rounded-full">Instant</span>
            </div>
            <p className="text-[11.5px] text-zinc-400 leading-relaxed">
              One click — others run your app instantly in their browser. No APK, no hosting, no install.
            </p>
            <ul className="text-[11px] text-zinc-300 flex flex-col gap-1 mt-0.5">
              <li>• Share link works immediately</li>
              <li>• Free — for you and for them</li>
              <li>• Your keys &amp; source stay private</li>
            </ul>
            <input
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder="App name on the store"
              maxLength={60}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-emerald-600"
            />
            <button
              onClick={() => void publishToStore()}
              disabled={storeBusy || busy}
              className="mt-auto w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors"
            >
              <Store className="w-3.5 h-3.5" />
              {storeBusy ? 'Publishing…' : 'Publish to the store'}
            </button>
            {storeResult && (
              <div className={`text-[11px] leading-relaxed rounded-lg px-2.5 py-2 ${storeResult.ok ? 'text-emerald-300 bg-emerald-950/40' : 'text-amber-300 bg-amber-950/30'}`}>
                {storeResult.message}
                {storeResult.shareUrl && (
                  <a href={storeResult.shareUrl} target="_blank" rel="noreferrer" className="block mt-1 underline break-all text-emerald-200">{storeResult.shareUrl}</a>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Full-stack note + sync law */}
        <div className="px-4 pb-4 flex flex-col gap-2">
          <div className="flex items-start gap-2 text-[11px] text-amber-300/90 bg-amber-950/20 border border-amber-900/40 rounded-lg px-3 py-2">
            <Server className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span><b className="font-semibold">Full-stack hosting (running backend + database) on NavBharatAI is coming soon.</b> For now, apps with a backend keep it on your own database (Settings → Database) or your own provider.</span>
          </div>
          <div className="flex items-center justify-center gap-2 text-[11px] text-emerald-300/80">
            <span aria-hidden="true">↔</span>
            <span>Publish anywhere — it&apos;s always the same app you built.</span>
          </div>
        </div>
        </>
        )}
        </div>
      </div>
    </div>
  );
}

export default HostingChooser;
