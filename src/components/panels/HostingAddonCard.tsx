/**
 * Add-ons under the hosting plan (2026-10-09).
 *
 * One row per thing a user can add or remove. A row we cannot actually deliver has no button —
 * the server would refuse it anyway, and a button that only failed after taking money is the
 * failure this card exists to avoid. Prices and the "not for sale" lines come from the server's
 * menu, which is the same catalogue the debit uses.
 */
import { useCallback, useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { authHeaders } from '../../lib/authedFetch';
import { unlockHeaders } from '../../lib/appLock';
import { addonAgreementTerms, type HostingAddon, type HostingAddonRecord } from '../../lib/hostingAddons';

interface Menu {
  addons: HostingAddon[];
  active: HostingAddonRecord[];
}

export function HostingAddonCard({ userId, onWalletChanged, onToast }: {
  userId: string;
  onWalletChanged: () => void;
  onToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [busy, setBusy] = useState('');
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/wallet/${userId}/hosting-addons`, { headers: await authHeaders() });
      if (res.ok) setMenu(await res.json());
    } catch { /* the plan card above still works if this does not load */ }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const add = async (addon: HostingAddon) => {
    if (!agreed) return;
    const clientRef = `addon${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    setBusy(addon.id);
    try {
      const res = await fetch(`/api/wallet/${userId}/hosting-addons/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()), ...(await unlockHeaders()) },
        body: JSON.stringify({ addonId: addon.id, agreedToTerms: true, clientRef }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onToast(typeof data.error === 'string' ? data.error : 'Could not add that. Nothing was charged.', 'error');
        return;
      }
      onToast(data.charged === false ? 'That add-on is already on your account.' : `${addon.name} is on. ₹${addon.priceInr} was taken from your wallet.`, 'success');
      setReviewing(null);
      setAgreed(false);
      onWalletChanged();
      await load();
    } catch {
      onToast('Could not add that. If money left your wallet it will show in your statement — otherwise nothing was charged.', 'error');
    } finally { setBusy(''); }
  };

  const remove = async (row: HostingAddonRecord) => {
    setBusy(row.ref);
    try {
      const res = await fetch(`/api/wallet/${userId}/hosting-addons/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()), ...(await unlockHeaders()) },
        body: JSON.stringify({ ref: row.ref }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onToast(typeof data.error === 'string' ? data.error : 'Could not remove that. It is still active.', 'error');
        return;
      }
      const back = typeof data.creditedInr === 'number' ? data.creditedInr : 0;
      onToast(back > 0 ? `Removed. ₹${back.toFixed(2)} of unused days is back in your wallet.` : 'Removed. Nothing was left to refund.', 'success');
      onWalletChanged();
      await load();
    } catch {
      onToast('Could not remove that. It is still active and nothing was refunded.', 'error');
    } finally { setBusy(''); }
  };

  if (!menu) return null;
  const sellable = menu.addons.filter((a) => a.sellable);
  const heldBack = menu.addons.filter((a) => !a.sellable);

  return (
    <div className="bg-card border border-line rounded-2xl p-5 space-y-4">
      <div>
        <h3 className="text-xs font-black text-ink uppercase tracking-widest">Add-ons — add or remove one at a time</h3>
        <p className="text-[11px] text-muted mt-1">
          You are charged only when the add-on is actually added. Remove it whenever you want. If it is still in use, it stays until you unpublish the site or disconnect the domain.
        </p>
      </div>

      {sellable.map((addon) => {
        const mine = menu.active.filter((r) => r.addonId === addon.id);
        const open = reviewing === addon.id;
        return (
          <div key={addon.id} className="rounded-xl border border-line px-4 py-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] font-bold text-ink">{addon.name} · ₹{addon.priceInr} / {addon.days} days</p>
                <p className="text-[11px] text-muted mt-0.5">{addon.summary}</p>
                <p className="text-[11px] text-ink mt-1">{mine.length} active{addon.max ? ` · up to ${addon.max}` : ''}</p>
              </div>
              <button
                type="button"
                disabled={busy !== '' || mine.length >= addon.max}
                onClick={() => { setReviewing(open ? null : addon.id); setAgreed(false); }}
                className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-indigo-500/15 text-accent-text text-[11px] font-bold px-3 py-2 disabled:opacity-40"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
            {open && (
              <div className="space-y-2 pt-1">
                <ul className="text-[11px] text-muted space-y-1 list-disc pl-4">
                  {addonAgreementTerms(addon).map((line) => <li key={line}>{line}</li>)}
                </ul>
                <label className="flex items-start gap-2 text-[11px] text-ink">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
                  <span>OK — I have read this and I want to pay ₹{addon.priceInr} from my wallet.</span>
                </label>
                <button
                  type="button"
                  disabled={!agreed || busy !== ''}
                  onClick={() => void add(addon)}
                  className="rounded-lg bg-indigo-600 text-white text-[12px] font-bold px-3 py-2 disabled:opacity-40"
                >
                  {busy === addon.id ? 'Adding…' : `Pay ₹${addon.priceInr}`}
                </button>
              </div>
            )}
            {mine.length > 0 && (
              <ul className="space-y-1">
                {mine.map((row) => (
                  <li key={row.ref} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-muted">Until {new Date(row.expiresAt).toLocaleDateString()}</span>
                    <button
                      type="button"
                      disabled={busy !== ''}
                      onClick={() => void remove(row)}
                      className="inline-flex items-center gap-1 text-red-400 font-bold disabled:opacity-40"
                    >
                      <X className="w-3.5 h-3.5" /> {busy === row.ref ? 'Removing…' : 'Remove'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {heldBack.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-black text-faint uppercase tracking-widest">Not for sale yet — no button, no charge</p>
          {heldBack.map((addon) => (
            <div key={addon.id} className="rounded-xl border border-dashed border-line px-4 py-3">
              <p className="text-[12px] font-bold text-muted">{addon.name}</p>
              <p className="text-[11px] text-muted mt-0.5">{addon.unavailableReason}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
