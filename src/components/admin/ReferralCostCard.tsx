import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

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
  /** What was TRIED, not only what was paid — the server's shape (referralClaimOutcomes.ts). */
  claims?: {
    days: number;
    headline: string;
    bySurface: Array<{
      surface: 'android' | 'web';
      people: number;
      attempts: number;
      byOutcome: Record<string, number>;
      paidTokens: number;
      reasons: Array<{ key: string; count: number }>;
    }>;
  };
}

/** Plain words for each outcome — the admin reads these, not the keys. */
const OUTCOME_LABEL: Record<string, string> = {
  paid: 'Paid',
  'nothing-new': 'Nothing new to pay',
  'held-no-mobile': 'Waiting for a mobile number',
  'step-not-done': 'Step not done yet',
  'device-refused': 'Device check refused',
  'device-unavailable': 'Device check not working (our side)',
  'device-failed-on-phone': 'Device check failed on the phone',
  error: 'Server error',
};

/** One line of the setup check — the server's shape (referralPreflight.ts), rendered as is. */
interface SetupCheck {
  id: string;
  label: string;
  state: 'ok' | 'failed' | 'skipped' | 'unknown';
  detail: string;
  remedy: string;
}

interface SetupReport {
  verdict: 'ready' | 'blocked' | 'incomplete';
  checks: SetupCheck[];
  nextAction: string;
  manual: string[];
}

const rupees = (tokens: number | undefined): string =>
  `₹${((Number(tokens) || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export function ReferralCostCard({ adminToken }: { adminToken: string }): React.ReactElement {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [setup, setSetup] = useState<SetupReport | null>(null);
  const [checking, setChecking] = useState(false);

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

  /**
   * DELIBERATELY ON A BUTTON, like the hosting checks on the Monitor: it makes a real Google call,
   * and a panel that pings Google on every render would be a quiet bill and a noisy log.
   */
  const checkSetup = useCallback(async () => {
    setChecking(true);
    try {
      const r = await fetch('/api/admin/referral/preflight', { headers: { 'x-admin-token': adminToken } });
      const body = (await r.json()) as SetupReport;
      setSetup(Array.isArray(body?.checks) ? body : null);
    } catch (e) {
      setSetup({
        verdict: 'incomplete',
        checks: [{ id: 'fetch', label: 'Setup check', state: 'unknown', detail: e instanceof Error ? e.message : String(e), remedy: 'Re-run the check.' }],
        nextAction: 'Re-run the check.',
        manual: [],
      });
    } finally {
      setChecking(false);
    }
  }, [adminToken]);

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
        <div className="flex items-center gap-2">
          <button
            onClick={() => void checkSetup()}
            disabled={checking}
            className="rounded-lg bg-raised px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-muted transition-colors hover:text-ink disabled:opacity-40"
          >
            {checking ? 'Checking…' : 'Check referral setup'}
          </button>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg bg-raised px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-muted transition-colors hover:text-ink disabled:opacity-40"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {setup && (
        <div className="mt-4 rounded-xl border border-line bg-surface p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[9px] font-black uppercase tracking-widest text-muted">Setup check</span>
            <span className={`text-[9px] font-black uppercase ${setup.verdict === 'ready' ? 'text-success' : setup.verdict === 'blocked' ? 'text-warn' : 'text-muted'}`}>
              {setup.verdict === 'ready' ? 'Ready to pay' : setup.verdict === 'blocked' ? 'Not paying yet' : 'Not fully checked'}
            </span>
          </div>
          <ul className="space-y-1.5">
            {setup.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                {c.state === 'ok'
                  ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />}
                <div>
                  <p className="text-[10px] font-bold text-ink">{c.label}</p>
                  {c.detail && <p className="text-[10px] font-semibold text-muted">{c.detail}</p>}
                  {c.state !== 'ok' && c.remedy && (
                    <p className="text-[10px] font-semibold text-accent-text">{c.remedy}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {setup.nextAction && (
            <p className="mt-2.5 text-[10px] font-bold text-ink">Next: {setup.nextAction}</p>
          )}
          {setup.manual.length > 0 && (
            <div className="mt-3 border-t border-line pt-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted">Cannot be checked from here — by hand</p>
              <ul className="mt-1 space-y-1">
                {setup.manual.map((m) => (
                  <li key={m} className="text-[10px] font-semibold leading-relaxed text-muted">• {m}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

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
              REFERRAL_REWARDS is not set, so nothing is being paid — and since 2026-09-17 the flat welcome gift is
              retired too, so a new user receives ₹0 until this is on. Press &ldquo;Check referral setup&rdquo; to see
              which step is missing. Any figures below are historic.
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

          <ClaimTally claims={data.claims} />

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

/**
 * WHO TRIED, WHO WAS PAID, AND WHY THE REST WERE NOT. Without this a user who never tried and a user the
 * device check refused five times look identical: ₹0. Counts only — nothing here acts on anybody.
 */
function ClaimTally({ claims }: { claims: Summary['claims'] }): React.ReactElement {
  const rows = claims?.bySurface ?? [];
  return (
    <div className="mt-5">
      <h4 className="text-[10px] font-black uppercase tracking-widest text-muted">
        Claims — last {claims?.days || 14} days
      </h4>
      {claims?.headline && (
        <p className="mt-2 rounded-xl border border-line bg-well p-3 text-[11px] font-semibold text-ink">{claims.headline}</p>
      )}
      {rows.length > 0 && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {rows.map((t) => (
            <div key={t.surface} className="rounded-xl border border-line bg-surface p-4">
              <p className="text-[9px] font-black uppercase tracking-widest text-faint">
                {t.surface === 'android' ? 'Android app' : 'Website'}
              </p>
              <p className="mt-1 text-[11px] font-semibold text-muted">
                {t.people} person-day{t.people === 1 ? '' : 's'} · {t.attempts} claim{t.attempts === 1 ? '' : 's'} · {rupees(t.paidTokens)} paid
              </p>
              <ul className="mt-2 space-y-1">
                {Object.entries(t.byOutcome).filter(([, n]) => n > 0).map(([o, n]) => (
                  <li key={o} className="flex justify-between gap-3 text-[11px] font-semibold">
                    <span className={o === 'paid' ? 'text-success' : 'text-body'}>{OUTCOME_LABEL[o] ?? o}</span>
                    <span className="font-mono text-ink">{n}</span>
                  </li>
                ))}
              </ul>
              {t.reasons.length > 0 && (
                <div className="mt-2 border-t border-line pt-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-faint">Why</p>
                  <ul className="mt-1 space-y-0.5">
                    {t.reasons.slice(0, 8).map((r) => (
                      <li key={r.key} className="flex justify-between gap-3 font-mono text-[10px] text-muted">
                        <span className="truncate">{r.key}</span><span>{r.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[10px] font-semibold leading-relaxed text-muted">
        A person-day is one account on one day, so someone who tried on two days counts twice. Counting began
        on 2026-09-26; earlier claims are not in these numbers.
      </p>
    </div>
  );
}
