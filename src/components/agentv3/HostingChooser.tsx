// HostingChooser — the "Publish" surface for NavBharatAI Pro v5.0 (Hosting Phase 1).
//
// One screen, two paths, kept 100% in sync (both publish the SAME workspace files):
//   1. Host on NavBharatAI  — our own hosting (the platform-paid Firebase static host, id 'firebase').
//                             One-click, no account, Free. Full app (backend + DB) is a later phase, so
//                             for a full-stack app this hosts the frontend and says so honestly.
//   2. Host somewhere else  — the user's own provider (Vercel / Netlify / Cloudflare / GitHub Pages).
//                             Free from us; they pay their own provider.
//
// It reuses the panel's existing, working deploy pipeline (`onDeploy(providerId)` → deployLive) and the
// already-fetched provider list — no new backend. Only CONFIGURED providers are offered, so a deploy can
// never target a host that isn't set up. Pricing here is intentionally simple + honest (static = Free);
// it is the single place to change when the admin sets real numbers.

import { Rocket, X, Globe, Server } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';

export interface HostingProvider {
  id: string;
  name: string;
  configured: boolean;
  requirement: string;
}

export interface HostingChooserProps {
  providers: HostingProvider[];
  /** Publish the current app to a provider id (drives the real build+deploy pipeline). */
  onDeploy: (providerId: string) => void;
  onClose: () => void;
  /** A build/deploy is already running — disable the actions. */
  busy: boolean;
}

const NBAI_HOST_ID = 'firebase'; // our platform-paid static host = "NavBharatAI hosting"

export function HostingChooser({ providers, onDeploy, onClose, busy }: HostingChooserProps) {
  const hasOurHosting = providers.some((p) => p.id === NBAI_HOST_ID && p.configured);
  const byo = providers.filter((p) => p.configured && p.id !== NBAI_HOST_ID);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-label="Publish your app"
    >
      <div className="w-full max-w-lg bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Rocket className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Publish your app</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-zinc-800 rounded-lg" title="Close">
            <X className="w-4 h-4 text-zinc-400" />
          </button>
        </div>

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
              onClick={() => onDeploy(NBAI_HOST_ID)}
              disabled={busy || !hasOurHosting}
              className="mt-auto w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors"
            >
              {busy ? <TirangaLoader className="w-4 h-4" /> : <Rocket className="w-3.5 h-3.5" />}
              Publish on NavBharatAI
            </button>
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
                    onClick={() => onDeploy(p.id)}
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
      </div>
    </div>
  );
}

export default HostingChooser;
