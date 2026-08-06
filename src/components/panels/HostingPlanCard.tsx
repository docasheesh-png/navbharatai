/**
 * Plans card in the wallet (admin 2026-08-06: "wallet me sara hisab hona chahiye — hosting plan,
 * db plan, coding pay and use"). ONE card, three honest lines:
 *   • Hosting — the ₹99/30d Custom Domain plan (removes the "Made with NavBharatAI" badge +
 *     unlocks connecting your own domain). Bought from the SAME wallet balance; renewal too.
 *   • Database — Free, always (runs on the user's own account — the standing rule).
 *   • Coding — pay-per-use from the wallet (already live; shown here so the full account story
 *     reads in one place).
 *
 * Self-contained on purpose: it talks to the ownership-checked wallet routes directly instead of
 * threading five more props through App.tsx. Every state shown is the server's real answer —
 * nothing here invents an "active" it did not read back.
 */
import { useState, useEffect, useCallback } from 'react';
import { Globe, Database, Cpu, BadgeCheck, RefreshCw } from 'lucide-react';
import { authHeaders } from '../../lib/authedFetch';

interface PlanStatus {
  enabled: boolean;
  active: boolean;
  plan: { id: string; purchasedAt: string; expiresAt: string; autoRenew: boolean } | null;
  priceInr: number;
  days: number;
}

export function HostingPlanCard({ userId, onWalletChanged, onToast }: {
  userId: string;
  /** Purchase debits the wallet — the parent refreshes its balance display through this. */
  onWalletChanged: () => void;
  onToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}) {
  const [status, setStatus] = useState<PlanStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/wallet/${userId}/hosting-plan`, { headers: await authHeaders() });
      if (res.ok) setStatus(await res.json());
    } catch { /* card simply stays in its loading state; the wallet screen itself is unaffected */ }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const purchase = async () => {
    if (busy || !status) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/wallet/${userId}/hosting-plan/purchase`, { method: 'POST', headers: await authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onToast(data?.error || 'Could not complete the purchase.', res.status === 402 ? 'warning' : 'error');
        return;
      }
      onToast(`Custom Domain plan is active until ${new Date(data.plan.expiresAt).toLocaleDateString()}.`, 'success');
      await load();
      onWalletChanged();
    } catch {
      onToast('Network error — nothing was charged.', 'error');
    } finally {
      setBusy(false);
    }
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

  return (
    <div className="bg-[#161b22] border border-white/5 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black text-white uppercase tracking-widest">Plans — your whole account in one place</h3>
      </div>

      {/* Hosting */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-3">
        <div className="flex items-start gap-3 min-w-0">
          <Globe className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-[12px] font-bold text-white">Hosting — Custom Domain plan</p>
            {active ? (
              <p className="text-[11px] text-emerald-300/90 flex items-center gap-1 mt-0.5">
                <BadgeCheck className="w-3.5 h-3.5" /> Active until {new Date(status.plan!.expiresAt).toLocaleDateString()} — badge-free publishing + your own domain.
              </p>
            ) : (
              <p className="text-[11px] text-[#8b949e] mt-0.5">
                ₹{status.priceInr}/{status.days} days from your wallet — removes the "Made with NavBharatAI" badge and unlocks connecting your own domain. If the plan ever ends, your domain pauses (we remind you 5 days ahead) but your app stays live on its free NavBharatAI link — renewing reconnects the domain automatically.
              </p>
            )}
          </div>
        </div>
        {active ? (
          <button
            onClick={toggleAutoRenew}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-white/10 text-[#c9d1d9] hover:bg-white/5 disabled:opacity-50 flex items-center gap-1.5"
          >
            <RefreshCw className="w-3 h-3" />
            Auto-renew: {status.plan!.autoRenew !== false ? 'On' : 'Off'}
          </button>
        ) : (
          <button
            onClick={purchase}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
          >
            {busy ? 'Processing…' : `Activate — ₹${status.priceInr}`}
          </button>
        )}
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
