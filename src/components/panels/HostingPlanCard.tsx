/**
 * Plans card in the wallet (admin 2026-08-06: "wallet me sara hisab hona chahiye — hosting plan,
 * db plan, coding pay and use"). ONE card, three honest lines:
 *   • Hosting — TWO tiers since 2026-09-10 ("do tier banao"): Starter ₹149 and Growth ₹499, each
 *     removing the "Made with NavBharatAI" badge and unlocking the user's own domain. Bought from
 *     the SAME wallet balance; renewal too.
 *   • Database — Free, always (runs on the user's own account — the standing rule).
 *   • Coding — pay-per-use from the wallet (already live; shown here so the full account story
 *     reads in one place).
 *
 * 🔒 THE AGREEMENT TICK IS A REAL GATE, not a formality (admin: "yeh bat clear likhi ho jab user
 * 149₹ ka purchage kare, agreement type aa jaye, 'ok' tick karne ko aye"). The terms are rendered
 * from the SAME catalogue the server bills from, so the screen cannot quote a limit the meter does
 * not enforce — and the server refuses a purchase without the tick anyway, so a disabled button is
 * the courtesy, never the enforcement.
 *
 * Self-contained on purpose: it talks to the ownership-checked wallet routes directly instead of
 * threading five more props through App.tsx. Every state shown is the server's real answer —
 * nothing here invents an "active" it did not read back. The catalogue it renders comes from the
 * STATUS RESPONSE, not from an import, so a price change on the server reaches the screen without
 * a new frontend build.
 */
import { useState, useEffect, useCallback } from 'react';
import { Globe, Database, Cpu, BadgeCheck, RefreshCw, Check } from 'lucide-react';
import { authHeaders } from '../../lib/authedFetch';
import { HOSTING_TIERS, hostingAgreementTerms, type HostingTier } from '../../lib/hostingTiers';

interface PlanStatus {
  enabled: boolean;
  active: boolean;
  plan: { id: string; purchasedAt: string; expiresAt: string; autoRenew: boolean } | null;
  priceInr: number;
  days: number;
  tiers?: HostingTier[];
  tier?: HostingTier | null;
  renewalPriceInr?: number;
  overageInrPerGb?: number;
}

export function HostingPlanCard({ userId, onWalletChanged, onToast }: {
  userId: string;
  /** Purchase debits the wallet — the parent refreshes its balance display through this. */
  onWalletChanged: () => void;
  onToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}) {
  const [status, setStatus] = useState<PlanStatus | null>(null);
  const [busy, setBusy] = useState(false);
  /** The tier whose terms are open for review. null = no purchase in progress. */
  const [reviewing, setReviewing] = useState<HostingTier | null>(null);
  const [agreed, setAgreed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/wallet/${userId}/hosting-plan`, { headers: await authHeaders() });
      if (res.ok) setStatus(await res.json());
    } catch { /* card simply stays in its loading state; the wallet screen itself is unaffected */ }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const purchase = async (tier: HostingTier) => {
    if (busy || !status || !agreed) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/wallet/${userId}/hosting-plan/purchase`, {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ tierId: tier.id, agreedToTerms: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onToast(data?.error || 'Could not complete the purchase.', res.status === 402 ? 'warning' : 'error');
        return;
      }
      // Every real part of the outcome is named — the credit returned for unused days and the
      // bundled credit are money that moved, and money that moved is money the user is told about.
      const extras = [
        data.creditedInr > 0 ? `₹${data.creditedInr.toFixed(2)} of unused days returned to your wallet` : '',
        data.bundledCreditInr > 0 ? `₹${data.bundledCreditInr} of build credit added` : '',
      ].filter(Boolean);
      onToast(
        `${tier.name} is active until ${new Date(data.plan.expiresAt).toLocaleDateString()}${extras.length ? ` — ${extras.join(', ')}.` : '.'}`,
        'success',
      );
      setReviewing(null);
      setAgreed(false);
      await load();
      onWalletChanged();
    } catch {
      onToast('Network error — nothing was charged.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const openTerms = (tier: HostingTier) => {
    setReviewing((cur) => (cur?.id === tier.id ? null : tier));
    setAgreed(false); // re-opening always starts unticked — consent is per purchase, not sticky
  };

  const toggleAutoRenew = async () => {
    if (busy || !status?.plan) return;
    setBusy(true);
    try {
      const next = !(status.plan.autoRenew !== false);
      const res = await fetch(`/api/wallet/${userId}/hosting-plan/auto-renew`, {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoRenew: next }),
      });
      if (res.ok) { await load(); onToast(next ? 'Auto-renewal is on.' : 'Auto-renewal is off — the plan will simply end on its expiry date.', 'info'); }
    } catch { /* toggle stays as the server last confirmed it */ } finally { setBusy(false); }
  };

  if (!status?.enabled) return null; // plans off server-side ⇒ the card honestly does not exist

  const active = status.active && status.plan;
  // The catalogue comes from the server when it sends one, so a price or limit change reaches this
  // screen without a frontend deploy; the bundled import is the fallback for an older response.
  const tiers: HostingTier[] = Array.isArray(status.tiers) && status.tiers.length ? status.tiers : [...HOSTING_TIERS];

  return (
    <div className="bg-[#161b22] border border-white/5 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black text-white uppercase tracking-widest">Plans — your whole account in one place</h3>
      </div>

      {/* Hosting — the active plan, or the tier picker */}
      <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-3 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <Globe className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[12px] font-bold text-white">
                Hosting{active && status.tier ? ` — ${status.tier.name}` : ''}
              </p>
              {active ? (
                <p className="text-[11px] text-emerald-300/90 flex items-start gap-1 mt-0.5">
                  <BadgeCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    Active until {new Date(status.plan!.expiresAt).toLocaleDateString()} — badge-free publishing,
                    {' '}{status.tier ? `${status.tier.domains} domain${status.tier.domains === 1 ? '' : 's'}` : 'your own domain'} and
                    {' '}{status.tier ? `${status.tier.includedTransferGb} GB` : 'included'} of traffic each month.
                    {typeof status.renewalPriceInr === 'number' ? ` Renews at ₹${status.renewalPriceInr}.` : ''}
                  </span>
                </p>
              ) : (
                <p className="text-[11px] text-[#8b949e] mt-0.5">
                  Paid from your wallet — removes the "Made with NavBharatAI" badge and unlocks connecting your own domain. If a plan ever ends, your domain pauses (we remind you 5 days ahead) but your app stays live on its free NavBharatAI link — renewing reconnects the domain automatically.
                </p>
              )}
            </div>
          </div>
          {active && (
            <button
              onClick={toggleAutoRenew}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-white/10 text-[#c9d1d9] hover:bg-white/5 disabled:opacity-50 flex items-center gap-1.5 shrink-0"
            >
              <RefreshCw className="w-3 h-3" />
              Auto-renew: {status.plan!.autoRenew !== false ? 'On' : 'Off'}
            </button>
          )}
        </div>

        {/* The tiers. Shown when there is no plan, and also while one is active so an upgrade is
            one tap away — the server refuses a downgrade mid-period and says why. */}
        <div className="grid gap-3 sm:grid-cols-2">
          {tiers.map((tier) => {
            const held = active && status.plan?.id === tier.id;
            const open = reviewing?.id === tier.id;
            return (
              <div
                key={tier.id}
                className={`rounded-xl border px-3 py-3 space-y-2 ${held ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/10 bg-black/20'}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[12px] font-black text-white">{tier.name}</p>
                  <p className="text-[12px] font-black text-indigo-300 font-mono">₹{tier.priceInr}<span className="text-[9px] text-[#8b949e] font-bold">/{tier.days}d</span></p>
                </div>
                <p className="text-[10px] text-[#8b949e] font-semibold">{tier.tagline}</p>
                <ul className="space-y-1">
                  {tier.includes.map((line) => (
                    <li key={line} className="text-[10px] text-[#c9d1d9] flex items-start gap-1.5">
                      <Check className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>

                {held ? (
                  <p className="text-[10px] font-black uppercase tracking-wider text-emerald-400">Your current plan</p>
                ) : (
                  <button
                    onClick={() => openTerms(tier)}
                    disabled={busy}
                    className="w-full px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
                  >
                    {open ? 'Close terms' : (active ? `Switch to ${tier.name} — ₹${tier.priceInr}` : `Choose ${tier.name} — ₹${tier.priceInr}`)}
                  </button>
                )}

                {/* THE AGREEMENT. Generated from the tier, so it can never quote a limit the meter
                    does not enforce. Buying is impossible until it is ticked — here for courtesy,
                    and on the server for real. */}
                {open && (
                  <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-wider text-amber-300">Before you buy — please read</p>
                    <ul className="space-y-1.5">
                      {hostingAgreementTerms(tier).map((term) => (
                        <li key={term} className="text-[10px] text-[#c9d1d9] leading-relaxed">• {term}</li>
                      ))}
                    </ul>
                    <label className="flex items-start gap-2 cursor-pointer select-none pt-1">
                      <input
                        type="checkbox"
                        checked={agreed}
                        onChange={(e) => setAgreed(e.target.checked)}
                        className="mt-0.5 accent-emerald-500 w-3.5 h-3.5"
                      />
                      <span className="text-[10px] font-bold text-white">OK — I have read and accept these terms.</span>
                    </label>
                    <button
                      onClick={() => purchase(tier)}
                      disabled={busy || !agreed}
                      className="w-full px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {busy ? 'Processing…' : `Pay ₹${tier.priceInr} from my wallet`}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-[10px] text-[#8b949e] leading-relaxed">
          Need more than this — many sites, heavy traffic, or a dedicated setup? Write to us and we
          will build the plan around what you actually need, instead of selling you a bigger box.
        </p>
      </div>

      {/* Database */}
      <div className="flex items-start gap-3 rounded-xl border border-white/5 px-4 py-3">
        <Database className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-[12px] font-bold text-white">Database — Free</p>
          <p className="text-[11px] text-[#8b949e] mt-0.5">Your apps' databases run on your own account, so there is nothing to charge. Always ₹0.</p>
        </div>
      </div>

      {/* Coding */}
      <div className="flex items-start gap-3 rounded-xl border border-white/5 px-4 py-3">
        <Cpu className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-[12px] font-bold text-white">Coding — pay as you use</p>
          <p className="text-[11px] text-[#8b949e] mt-0.5">Builds and AI assistants charge this same wallet by real usage — every charge shows in the ledger below. No subscription needed.</p>
        </div>
      </div>
    </div>
  );
}
