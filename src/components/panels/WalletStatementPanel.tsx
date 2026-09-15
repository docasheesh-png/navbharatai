import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ArrowDownRight, ArrowUpRight, CheckCircle2, HelpCircle, RefreshCw } from 'lucide-react';
import { authedHeaders } from '../../lib/authHeaders';

/**
 * YOUR STATEMENT — every credit, every debit, and whether it adds up.
 *
 * Admin, 2026-09-15: *"ek ek paise ka sahi sahi hisab hona chahiye … aur user ke current balance se
 * match hona chahiye."* So the central number on this screen is not the balance — the balance is
 * already shown elsewhere. It is the RECONCILIATION: does the history the user can read actually
 * account for the money they hold?
 *
 * 🔒 IT SHOWS THE ANSWER EVEN WHEN THE ANSWER IS BAD. A statement that could only ever say "balanced"
 * would be decoration, and decoration on a money screen is worse than nothing — it is the thing that
 * stops anybody looking. If the entries do not add up, this says so, in rupees, to the user.
 *
 * 🔒 AND "UNKNOWN" IS A THIRD, HONEST STATE. An older account whose oldest rows rolled off before
 * opening balances were recorded genuinely cannot be checked. Calling that a mismatch would frighten
 * people whose money is perfectly fine; calling it balanced would be a lie. It says what it is.
 */
interface StatementRow {
  timestamp: string;
  description: string;
  tokens: number;
  rupees: number;
  kind: 'credit' | 'debit' | 'nil';
  feature: string | null;
  runningRupees: number;
}

interface Statement {
  ok: boolean;
  exists?: boolean;
  openingRupees?: number;
  openingIsAssumed?: boolean;
  hiddenRows?: number;
  rows?: StatementRow[];
  creditTokens?: number;
  debitTokens?: number;
  differenceRupees?: number;
  verdict?: 'balanced' | 'off' | 'unknown';
  actualRupees?: number;
  actualTokens?: number;
  notes?: string[];
}

const inr = (n: number | undefined): string =>
  `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A date a person reads, not an ISO string. Falls back to the raw value rather than showing nothing. */
function when(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts || '—';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const WalletStatementPanel: React.FC<{ userId: string }> = ({ userId }) => {
  const [data, setData] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/wallet/${encodeURIComponent(userId)}/statement`, { headers: await authedHeaders() });
      setData(await res.json());
    } catch (e) {
      // An unreachable statement says so. Rendering an empty one would read as "you have no history",
      // which on a money screen is the most alarming possible way to be wrong.
      setData({ ok: false, notes: [e instanceof Error ? e.message : String(e)] });
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const rows = data?.rows ?? [];
  const verdict = data?.verdict;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-4">
        <div>
          <span className="rounded-xl border border-sky-500/20 bg-sky-500/10 px-3 py-1.5 font-mono text-[10px] font-black uppercase tracking-wider text-sky-400">
            Statement
          </span>
          <h3 className="mt-3 text-xl font-black uppercase tracking-tight text-white">Every credit and every charge</h3>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-[#8b949e] transition-colors hover:text-white disabled:opacity-40"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {!data ? (
        <p className="text-xs font-semibold text-[#8b949e]">Loading…</p>
      ) : !data.ok ? (
        <p className="text-xs font-semibold text-amber-400">Could not load your statement. Please try again.</p>
      ) : data.exists === false ? (
        <p className="text-xs font-semibold text-[#8b949e]">This account has no wallet activity yet.</p>
      ) : (
        <>
          {/* THE RECONCILIATION — the point of the screen. */}
          <div className={`rounded-2xl border p-5 ${
            verdict === 'balanced' ? 'border-emerald-500/20 bg-emerald-500/5'
              : verdict === 'off' ? 'border-red-500/20 bg-red-500/5'
              : 'border-amber-500/20 bg-amber-500/5'}`}>
            <div className="flex items-start gap-3">
              {verdict === 'balanced' ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                : verdict === 'off' ? <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                : <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />}
              <div className="min-w-0">
                <p className={`text-sm font-black ${
                  verdict === 'balanced' ? 'text-emerald-400' : verdict === 'off' ? 'text-red-400' : 'text-amber-400'}`}>
                  {verdict === 'balanced' ? 'Everything adds up'
                    : verdict === 'off' ? `These entries do not match your balance — a difference of ${inr(Math.abs(data.differenceRupees ?? 0))}`
                    : 'Part of this history is older than our records'}
                </p>
                <p className="mt-1 text-[11px] font-semibold leading-relaxed text-[#8b949e]">
                  {verdict === 'balanced'
                    ? `Opening ${inr(data.openingRupees)} + credits − charges = ${inr(data.actualRupees)}, which is exactly your balance.`
                    : verdict === 'off'
                      ? 'Please send us a report from this screen — we will look at it and put it right.'
                      : 'The entries below are correct; we simply cannot check them against your balance, because the oldest ones are no longer stored.'}
                </p>
                {(data.notes ?? []).map((n) => (
                  <p key={n} className="mt-1.5 text-[10px] font-semibold leading-relaxed text-[#8b949e]">{n}</p>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['Opening balance', inr(data.openingRupees)],
              ['Total credited', inr((data.creditTokens ?? 0) / 100)],
              ['Total charged', inr((data.debitTokens ?? 0) / 100)],
              ['Your balance now', inr(data.actualRupees)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-white/5 bg-black/20 p-4">
                <p className="text-[9px] font-black uppercase tracking-widest text-[#484f58]">{label}</p>
                <p className="mt-1 text-lg font-black text-white">{value}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-2xl border border-white/5 bg-black/10">
            <table className="w-full text-left font-mono text-[11px]">
              <thead>
                <tr className="border-b border-white/5 bg-black/30 text-[9px] font-black uppercase tracking-widest text-[#8b949e]">
                  <th className="px-4 py-2.5">When</th>
                  <th className="px-4 py-2.5">What</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5 text-right">Balance after</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-semibold">
                {rows.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-[#8b949e]">No entries yet.</td></tr>
                ) : (
                  // Newest first — the way anybody actually reads a statement — while the running
                  // balance was computed oldest-first, which is the only order it makes sense in.
                  [...rows].reverse().map((r, i) => (
                    <tr key={`${r.timestamp}-${i}`} className="transition-all hover:bg-white/5">
                      <td className="whitespace-nowrap px-4 py-3 text-[#8b949e]">{when(r.timestamp)}</td>
                      <td className="px-4 py-3 text-white">{r.description}</td>
                      <td className={`whitespace-nowrap px-4 py-3 text-right font-bold ${
                        r.kind === 'credit' ? 'text-emerald-400' : r.kind === 'debit' ? 'text-red-400' : 'text-[#8b949e]'}`}>
                        <span className="inline-flex items-center gap-1">
                          {r.kind === 'credit' ? <ArrowUpRight className="h-3 w-3" />
                            : r.kind === 'debit' ? <ArrowDownRight className="h-3 w-3" /> : null}
                          {r.kind === 'credit' ? '+' : ''}{inr(r.rupees)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-white">{inr(r.runningRupees)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="text-[10px] font-semibold leading-relaxed text-[#8b949e]">
            Charges smaller than ₹0.01 are carried to your next charge rather than rounded up, and a day&rsquo;s
            small assistant charges are grouped into one line so your purchase history stays readable.
            {(data.hiddenRows ?? 0) > 0 && ` ${data.hiddenRows} older entries are included in the opening balance above.`}
          </p>
        </>
      )}
    </div>
  );
};
