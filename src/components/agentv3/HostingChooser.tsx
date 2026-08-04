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

import { useState } from 'react';
import { Rocket, X, Globe, Server, Link2, GitBranch, ExternalLink, AlertCircle } from 'lucide-react';
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
}

const NBAI_HOST_ID = 'firebase'; // our platform-paid static host = "NavBharatAI hosting"

export function HostingChooser({
  providers, onDeploy, onClose, busy, workspaceId, customDomainsEnabled,
  ownRepo, githubConnected, onConnectGitHub,
}: HostingChooserProps) {
  const [view, setView] = useState<'choose' | 'domain' | 'selfhost'>('choose');
  // The honest reason the LAST publish attempt didn't start. Shown inline; cleared on the next try.
  // A publish that cannot run must SAY SO here — never a button that silently does nothing.
  const [blocked, setBlocked] = useState<string | null>(null);
  const publish = (providerId: string) => {
    setBlocked(null);
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
        <div className="p-4 grid gap-3 sm:grid-cols-3">
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

          {/* Path 2 — Host elsewhere (BYO) */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold text-white">Host somewhere else</span>
              <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded-full">Your account</span>
            </div>
            <p className="text-[11.5px] text-zinc-400 leading-relaxed">
              Publish to your own provider. Your cloud, your bill — free from us.
            </p>
            {byo.length > 0 ? (
              <div className="flex flex-col gap-1.5 mt-0.5">
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
              <p className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">
                No other providers connected yet. Connect Vercel, Netlify, Cloudflare, or GitHub Pages to publish
                to your own account.
              </p>
            )}
          </div>

          {/* Path 3 — I host it myself: NavBharatAI never touches deployment, only your own GitHub repo */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold text-white">I host it myself</span>
              <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded-full">Your repo</span>
            </div>
            <p className="text-[11.5px] text-zinc-400 leading-relaxed">
              We only write code and open a pull request into your own GitHub repo — CI-gated. Your existing
              host&apos;s own auto-deploy takes it from there. We never touch your hosting.
            </p>
            <button
              onClick={() => setView('selfhost')}
              className="mt-auto w-full py-2 rounded-lg border border-zinc-700 bg-zinc-900 hover:border-zinc-500 hover:text-white text-zinc-300 text-[11.5px] font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <GitBranch className="w-3.5 h-3.5" />
              {ownRepo ? `Connected: ${ownRepo.owner}/${ownRepo.repo}` : 'Set up'}
            </button>
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
