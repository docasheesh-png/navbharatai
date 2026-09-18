import React, { useCallback, useEffect, useState } from 'react';

/**
 * WHAT REFERRALS COST, AND WHO LOOKS LIKE A FARM.
 *
 * The ₹1,500 lifetime cap bounds what one referrer can take; it does not tell anyone what the scheme
 * is costing, and a bound nobody can see is a bound nobody can tune. This card is that number.
 *
 * 🔒 IT SHOWS A QUESTION, NEVER A VERDICT. "Worth a look" means one referrer has several friends and
 * none of them verified a mobile — the shape a factory-reset farm leaves. Each of those facts is
 * individually innocent, so there is no block button here and no automatic action anywhere behind
 * it: the cost of being wrong about an enthusiastic real user is taking money they earned, and the
 * cost of being slow about a farm is bounded at ₹1,500 by the cap. Those are not the same size.
 *
 * 🔒 AND IT NEVER ROUNDS A CAPPED SCAN INTO A TOTAL. The route reads a bounded number of rows; past
 * that ceiling every figure here is labelled a lower bound, because a cost panel that is quietly
 * wrong is worse than none — it gets acted on.
 */
interface Summary {
  ok: boolean;
  enabled?: boolean;
  reason?: string;
  participants?: number;
  referred?: number;
  selfTokens?: number;
  referrerTokens?: number;
  totalTokens?: number;
  capTokens?: number;
  capped?: boolean;
  topReferrers?: Array<{
    referrerUserId: string; friends: number; friendsWithMobile: number;
    earnedTokens: number; worthALook: boolean;
  }>;
}

const rupees = (tokens: number | undefined): string =>
  `₹${((Number(tokens) || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export function ReferralCostCard({ adminToken }: { adminToken: string }): React.ReactElement {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/referral/summary', { headers: { 'x-admin-token': adminToken } });
      setData(await r.json());
    } catch (e) {
      // An unreachable panel says so rather than rendering zeros, which would read as "it costs
      // nothing" — the most expensive possible way for this card to be wrong.
      setData({ ok: false, reason: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  useEffect(() => { void load(); }, [load]);

  const watch = (data?.topReferrers ?? []).filter((r) => r.worthALook);

  return (
    <div className="rounded-2xl border border-line bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div>
          <h3 className="text-sm font-black uppercase tracking-tight text-ink">Referral cost</h3>
          <p className="mt-1 text-[10px] font-semibold text-muted">
            What the four-step welcome gift has paid out, and who is worth a look.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg bg-raised px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-muted transition-colors hover:text-ink disabled:opacity-40"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {!data ? (
        <p className="mt-4 text-[11px] font-semibold text-muted">Loading…</p>
      ) : !data.ok ? (
        <p className="mt-4 text-[11px] font-semibold text-warn">
          Could not read the referral records{data.reason ? `: ${data.reason}` : ''}.
        </p>
      ) : (
        <>
          {!data.enabled && (
            <p className="mt-4 rounded-xl border border-line bg-well p-3 text-[11px] font-semibold text-muted">
              REFERRAL_REWARDS is not set, so nothing is being paid. Any figures below are historic.
            </p>
          )}
          {data.capped && (
            <p className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] font-semibold text-warn">
              More referral records exist than this panel reads, so every figure below is a LOWER BOUND.
            </p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['Paid to new users', rupees(data.selfTokens), 'at today’s per-step rate'],
              ['Paid to referrers', rupees(data.referrerTokens), 'recorded, exact'],
              ['Total paid out', rupees(data.totalTokens), ''],
              ['Accounts referred', String(data.referred ?? 0), `${data.participants ?? 0} earned something`],
            ].map(([label, value, note]) => (
              <div key={label} className="rounded-xl border border-line bg-well p-4">
                <p className="text-[9px] font-black uppercase tracking-widest text-faint">{label}</p>
                <p className="mt-1 text-xl font-black text-ink">{value}</p>
                {note && <p className="mt-0.5 text-[9px] font-semibold text-muted">{note}</p>}
              </div>
            ))}
          </div>

          <div className="mt-5">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-muted">
              Busiest referrers {watch.length > 0 && <span className="text-warn">— {watch.length} worth a look</span>}
            </h4>
            {(data.topReferrers ?? []).length === 0 ? (
              <p className="mt-2 text-[11px] font-semibold text-muted">No referrals yet.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left font-mono text-[11px]">
                  <thead>
                    <tr className="border-b border-line text-[9px] font-black uppercase tracking-widest text-muted">
                      <th className="py-2 pr-4">Referrer</th>
                      <th className="py-2 pr-4">Friends</th>
                      <th className="py-2 pr-4">With mobile</th>
                      <th className="py-2 pr-4">Earned</th>
                      <th className="py-2">&nbsp;</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {(data.topReferrers ?? []).map((r) => (
                      <tr key={r.referrerUserId} className={r.worthALook ? 'bg-amber-500/5' : ''}>
                        <td className="py-2 pr-4 max-w-[14rem] truncate text-ink">{r.referrerUserId}</td>
                        <td className="py-2 pr-4">{r.friends}</td>
                        <td className="py-2 pr-4">{r.friendsWithMobile}</td>
                        <td className="py-2 pr-4 text-success">{rupees(r.earnedTokens)}</td>
                        <td className="py-2">
                          {r.worthALook && (
                            <span className="rounded border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-warn">
                              Worth a look
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-[10px] font-semibold leading-relaxed text-muted">
              &ldquo;Worth a look&rdquo; means several friends and none of them verified a mobile — the shape a
              factory-reset farm leaves. It is a question, not a verdict: each fact alone is innocent, and
              nothing acts on it. Any one referrer is capped at {rupees(data.capTokens)} for life.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
