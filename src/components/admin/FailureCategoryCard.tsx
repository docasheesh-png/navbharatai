import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { adminGet, adminFailed } from '../../lib/adminFetch';

/**
 * FAILURE CATEGORY (admin 2026-09-16, verbatim: "jitne bhi build reports admin penal me hai, wah ek
 * alag analysis laga do. jisme sabhi failed build ko catagorise kiya jaye. kis type ki apps nahi ban
 * pa rahi hai. kya koi specific prkar hai, ya rendom.").
 *
 * Renders `/api/admin/failure-categories`: every workspace's latest build, grouped by APP TYPE (the
 * same domain classifier a build prompt is already analysed with) and by FAILURE REASON (matched
 * against the engine's own real message text). Answers the admin's actual question directly — is one
 * kind of app breaking more than others, or is it spread thin across everything?
 *
 * 🔒 THE SAMPLE SIZE AND CAP ARE ALWAYS SHOWN, never a bare percentage. A rate with no stated sample
 * is the exact thing `ReferralCostCard`'s "lower bound" banner and `BuildCostCard`'s `measured` flag
 * already exist to prevent — this card follows the same rule.
 */
interface ReasonExample { workspaceId: string; rootCause: string }
interface ReasonRow { key: string; label: string; count: number; sharePct: number; examples: ReasonExample[] }
interface DomainRow {
  domain: string; total: number; failed: number; succeeded: number;
  failureRatePct: number | null; topReasons: ReasonRow[];
}
interface VerdictSplit {
  engineFailed: number;
  builtButJudgedFailed: number;
  succeeded: number;
  unjudged: number;
  /** Absent on a server that predates the split of user-stopped builds. */
  userStopped?: number;
  evidenceUnknown: number;
  appDeliveredPct: number | null;
  reportedOkPct: number | null;
}

interface ReportData {
  totalBuilds: number;
  verdictSplit?: VerdictSplit;
  unjudged: number;
  failed: number;
  overallFailureRatePct: number | null;
  byDomain: DomainRow[];
  byReason: ReasonRow[];
  window: number;
  reportsRead: number;
  capped: boolean;
  sampleNote: string;
}

const DOMAIN_LABEL: Record<string, string> = {
  general: 'General / no specific domain',
};

function labelDomain(key: string): string {
  return DOMAIN_LABEL[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, ' ');
}

function rateColor(pct: number | null): string {
  if (pct == null) return 'text-muted';
  if (pct >= 50) return 'text-danger';
  if (pct >= 20) return 'text-warn';
  return 'text-success';
}

export function FailureCategoryCard({ adminToken }: { adminToken: string }): React.ReactElement {
  const [data, setData] = useState<ReportData | null>(null);
  const [failReason, setFailReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedReason, setExpandedReason] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminGet<ReportData>('/api/admin/failure-categories', { token: adminToken });
      if (adminFailed(r)) {
        setFailReason(r.message);
        setData(null);
      } else {
        setFailReason(null);
        setData(r.data);
      }
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  useEffect(() => { void load(); }, [load]);

  const byDomain = data?.byDomain ?? [];
  const byReason = data?.byReason ?? [];
  const total = data?.totalBuilds ?? 0;
  const failed = data?.failed ?? 0;
  const rate = data?.overallFailureRatePct ?? null;

  return (
    <div className="rounded-2xl border border-line bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div>
          <h3 className="text-sm font-black uppercase tracking-tight text-ink">Failure category</h3>
          <p className="mt-1 text-[10px] font-semibold text-muted">
            Which kind of app fails most, and why — read straight from every workspace&rsquo;s own durable build record.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-raised px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-muted transition-colors hover:text-ink disabled:opacity-40"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {failReason ? (
        <p className="mt-4 text-[11px] font-semibold text-warn">
          Could not read the build records: {failReason}
        </p>
      ) : !data ? (
        <p className="mt-4 text-[11px] font-semibold text-muted">Loading…</p>
      ) : total === 0 ? (
        <p className="mt-4 text-[11px] font-semibold text-muted">No build records found yet.</p>
      ) : (
        <>
          {/* ── WHAT IS REALLY INSIDE THE HEADLINE RATE (admin 2026-09-17) ────────────────────
              A single "40.8% failed" cannot be worked on, because some of it is not broken builds.
              The row that matters is the middle one: builds we JUDGED failed while the app was seen
              rendering in a real browser. Those are wrong verdicts, and each is a person who was told
              their working app had failed. */}
          {data.verdictSplit && (
            <div className="mt-4 rounded-xl border border-line bg-well p-4">
              <p className="text-[9px] font-black uppercase tracking-widest text-faint">
                What the failures really are
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  {
                    label: 'Genuinely failed',
                    value: data.verdictSplit.engineFailed,
                    note: 'never seen running — the real target',
                    tone: 'text-danger',
                  },
                  {
                    label: 'Worked, called failed',
                    value: data.verdictSplit.builtButJudgedFailed,
                    note: 'rendered in a real browser — a wrong verdict, not a failure',
                    tone: 'text-warn',
                  },
                  {
                    label: 'Cannot tell',
                    value: data.verdictSplit.evidenceUnknown,
                    note: 'recorded before render evidence was kept',
                    tone: 'text-muted',
                  },
                  {
                    label: 'Succeeded',
                    value: data.verdictSplit.succeeded,
                    note: '',
                    tone: 'text-success',
                  },
                  ...(typeof data.verdictSplit.userStopped === 'number' ? [{
                    label: 'Stopped by the user',
                    value: data.verdictSplit.userStopped,
                    note: 'the person ended it — neither a failure nor a success, and in no other column',
                    tone: 'text-info',
                  }] : []),
                ].map((r) => (
                  <div key={r.label}>
                    <p className="text-[9px] font-black uppercase tracking-widest text-faint">{r.label}</p>
                    <p className={`mt-1 text-lg font-black ${r.tone}`}>{r.value}</p>
                    {r.note && <p className="mt-0.5 text-[9px] leading-snug text-faint">{r.note}</p>}
                  </div>
                ))}
              </div>
              {/* THE NUMBER THE 90% TARGET IS MEASURED AGAINST, and the honesty debt beside it. */}
              <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-line pt-3">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-faint">
                    User got a working app
                  </p>
                  <p className={`mt-1 text-2xl font-black ${
                    data.verdictSplit.appDeliveredPct == null ? 'text-muted'
                      : data.verdictSplit.appDeliveredPct >= 90 ? 'text-success'
                      : data.verdictSplit.appDeliveredPct >= 75 ? 'text-warn' : 'text-danger'}`}>
                    {data.verdictSplit.appDeliveredPct == null ? '—' : `${data.verdictSplit.appDeliveredPct}%`}
                    <span className="ml-2 text-[10px] font-bold text-faint">target 90%</span>
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-faint">
                    What we told them
                  </p>
                  <p className="mt-1 text-2xl font-black text-body">
                    {data.verdictSplit.reportedOkPct == null ? '—' : `${data.verdictSplit.reportedOkPct}%`}
                  </p>
                </div>
                {data.verdictSplit.appDeliveredPct != null && data.verdictSplit.reportedOkPct != null
                  && data.verdictSplit.appDeliveredPct > data.verdictSplit.reportedOkPct && (
                  <p className="text-[10px] leading-snug text-warn">
                    The gap is the honesty debt — apps that worked and were reported as failures.
                  </p>
                )}
              </div>
              <p className="mt-3 text-[9px] leading-relaxed text-faint">
                Builds nobody could judge either way are left out of both figures, so the target cannot be hit by
                counting unknowns. Builds the USER stopped are read off each build's own record (the abort funnel
                records it; older records carry the stop line the settle path wrote) — never guessed from duration
                or wording — and sit in their own column, outside both the failure rate and the reason table.
              </p>
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['Builds examined', String(total), `${data.unjudged ?? 0} still in progress / excluded`],
              ['Failed', String(failed), ''],
              ['Overall failure rate', rate == null ? '—' : `${rate}%`, `of ${total - (data.unjudged ?? 0)} settled builds`],
              ['App types seen', String(byDomain.length), 'grouped by likely domain'],
            ].map(([label, value, note]) => (
              <div key={label} className="rounded-xl border border-line bg-well p-4">
                <p className="text-[9px] font-black uppercase tracking-widest text-faint">{label}</p>
                <p className={`mt-1 text-xl font-black ${label === 'Overall failure rate' ? rateColor(rate) : 'text-ink'}`}>{value}</p>
                {note && <p className="mt-0.5 text-[9px] font-semibold text-muted">{note}</p>}
              </div>
            ))}
          </div>

          {data.capped && (
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] font-semibold text-warn">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              More builds exist than this panel read ({data.reportsRead} of the newest {data.window}) — every figure below is a lower bound. Narrow the date range to look further back.
            </p>
          )}

          <div className="mt-5">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-muted">
              By app type — which kind of app is failing most
            </h4>
            {byDomain.length === 0 ? (
              <p className="mt-2 text-[11px] font-semibold text-muted">No settled builds yet.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left font-mono text-[11px]">
                  <thead>
                    <tr className="border-b border-line text-[9px] font-black uppercase tracking-widest text-muted">
                      <th className="py-2 pr-4">App type</th>
                      <th className="py-2 pr-4">Built</th>
                      <th className="py-2 pr-4">Failed</th>
                      <th className="py-2 pr-4">Failure rate</th>
                      <th className="py-2">Top reason there</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {byDomain.map((d) => (
                      <tr key={d.domain}>
                        <td className="py-2 pr-4 font-sans font-bold text-ink">{labelDomain(d.domain)}</td>
                        <td className="py-2 pr-4">{d.total}</td>
                        <td className="py-2 pr-4">{d.failed}</td>
                        <td className={`py-2 pr-4 font-black ${rateColor(d.failureRatePct)}`}>
                          {d.failureRatePct == null ? '—' : `${d.failureRatePct}%`}
                        </td>
                        <td className="py-2 font-sans text-muted">
                          {d.topReasons[0] ? `${d.topReasons[0].label} (${d.topReasons[0].count})` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mt-5">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-muted">
              By failure reason — across every app type
            </h4>
            {byReason.length === 0 ? (
              <p className="mt-2 text-[11px] font-semibold text-muted">No failed builds in this window.</p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {byReason.map((r) => (
                  <div key={r.key} className="rounded-xl border border-line bg-well">
                    <button
                      onClick={() => setExpandedReason(expandedReason === r.key ? null : r.key)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
                    >
                      <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-ink">{r.label}</span>
                      <span className="shrink-0 font-mono text-[11px] text-warn">
                        {r.count} <span className="text-muted">({r.sharePct}% of failures)</span>
                      </span>
                    </button>
                    {expandedReason === r.key && r.examples.length > 0 && (
                      <div className="space-y-1.5 border-t border-line px-4 py-3">
                        <p className="text-[9px] font-black uppercase tracking-widest text-faint">
                          Examples — the raw text this was matched from
                        </p>
                        {r.examples.map((ex, i) => (
                          <p key={i} className="truncate font-mono text-[10px] text-muted" title={ex.rootCause}>
                            <span className="text-faint">{ex.workspaceId}:</span> {ex.rootCause}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3 text-[10px] font-semibold leading-relaxed text-muted">
              &ldquo;Other&rdquo; means the build&rsquo;s recorded root cause did not match any of the engine&rsquo;s
              known failure wordings — tap it to read the real text and judge for yourself. Tap any reason to see the
              exact examples it was matched from.
            </p>
          </div>

          {data.sampleNote && (
            <p className="mt-4 border-t border-line pt-3 text-[10px] font-semibold leading-relaxed text-muted">
              {data.sampleNote}
            </p>
          )}
        </>
      )}
    </div>
  );
}
