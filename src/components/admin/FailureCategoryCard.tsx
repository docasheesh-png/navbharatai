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
interface ReportData {
  totalBuilds: number;
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
  if (pct == null) return 'text-[#8b949e]';
  if (pct >= 50) return 'text-rose-400';
  if (pct >= 20) return 'text-amber-400';
  return 'text-emerald-400';
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
    <div className="rounded-2xl border border-white/5 bg-[#161b22] p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-4">
        <div>
          <h3 className="text-sm font-black uppercase tracking-tight text-white">Failure category</h3>
          <p className="mt-1 text-[10px] font-semibold text-[#8b949e]">
            Which kind of app fails most, and why — read straight from every workspace&rsquo;s own durable build record.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-[#8b949e] transition-colors hover:text-white disabled:opacity-40"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {failReason ? (
        <p className="mt-4 text-[11px] font-semibold text-amber-400">
          Could not read the build records: {failReason}
        </p>
      ) : !data ? (
        <p className="mt-4 text-[11px] font-semibold text-[#8b949e]">Loading…</p>
      ) : total === 0 ? (
        <p className="mt-4 text-[11px] font-semibold text-[#8b949e]">No build records found yet.</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['Builds examined', String(total), `${data.unjudged ?? 0} still in progress / excluded`],
              ['Failed', String(failed), ''],
              ['Overall failure rate', rate == null ? '—' : `${rate}%`, `of ${total - (data.unjudged ?? 0)} settled builds`],
              ['App types seen', String(byDomain.length), 'grouped by likely domain'],
            ].map(([label, value, note]) => (
              <div key={label} className="rounded-xl border border-white/5 bg-black/20 p-4">
                <p className="text-[9px] font-black uppercase tracking-widest text-[#484f58]">{label}</p>
                <p className={`mt-1 text-xl font-black ${label === 'Overall failure rate' ? rateColor(rate) : 'text-white'}`}>{value}</p>
                {note && <p className="mt-0.5 text-[9px] font-semibold text-[#8b949e]">{note}</p>}
              </div>
            ))}
          </div>

          {data.capped && (
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] font-semibold text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              More builds exist than this panel read ({data.reportsRead} of the newest {data.window}) — every figure below is a lower bound. Narrow the date range to look further back.
            </p>
          )}

          <div className="mt-5">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-[#8b949e]">
              By app type — which kind of app is failing most
            </h4>
            {byDomain.length === 0 ? (
              <p className="mt-2 text-[11px] font-semibold text-[#8b949e]">No settled builds yet.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left font-mono text-[11px]">
                  <thead>
                    <tr className="border-b border-white/5 text-[9px] font-black uppercase tracking-widest text-[#8b949e]">
                      <th className="py-2 pr-4">App type</th>
                      <th className="py-2 pr-4">Built</th>
                      <th className="py-2 pr-4">Failed</th>
                      <th className="py-2 pr-4">Failure rate</th>
                      <th className="py-2">Top reason there</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {byDomain.map((d) => (
                      <tr key={d.domain}>
                        <td className="py-2 pr-4 font-sans font-bold text-white">{labelDomain(d.domain)}</td>
                        <td className="py-2 pr-4">{d.total}</td>
                        <td className="py-2 pr-4">{d.failed}</td>
                        <td className={`py-2 pr-4 font-black ${rateColor(d.failureRatePct)}`}>
                          {d.failureRatePct == null ? '—' : `${d.failureRatePct}%`}
                        </td>
                        <td className="py-2 font-sans text-[#8b949e]">
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
            <h4 className="text-[10px] font-black uppercase tracking-widest text-[#8b949e]">
              By failure reason — across every app type
            </h4>
            {byReason.length === 0 ? (
              <p className="mt-2 text-[11px] font-semibold text-[#8b949e]">No failed builds in this window.</p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {byReason.map((r) => (
                  <div key={r.key} className="rounded-xl border border-white/5 bg-black/20">
                    <button
                      onClick={() => setExpandedReason(expandedReason === r.key ? null : r.key)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
                    >
                      <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-white">{r.label}</span>
                      <span className="shrink-0 font-mono text-[11px] text-amber-400">
                        {r.count} <span className="text-[#8b949e]">({r.sharePct}% of failures)</span>
                      </span>
                    </button>
                    {expandedReason === r.key && r.examples.length > 0 && (
                      <div className="space-y-1.5 border-t border-white/5 px-4 py-3">
                        <p className="text-[9px] font-black uppercase tracking-widest text-[#484f58]">
                          Examples — the raw text this was matched from
                        </p>
                        {r.examples.map((ex, i) => (
                          <p key={i} className="truncate font-mono text-[10px] text-[#8b949e]" title={ex.rootCause}>
                            <span className="text-[#484f58]">{ex.workspaceId}:</span> {ex.rootCause}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3 text-[10px] font-semibold leading-relaxed text-[#8b949e]">
              &ldquo;Other&rdquo; means the build&rsquo;s recorded root cause did not match any of the engine&rsquo;s
              known failure wordings — tap it to read the real text and judge for yourself. Tap any reason to see the
              exact examples it was matched from.
            </p>
          </div>

          {data.sampleNote && (
            <p className="mt-4 border-t border-white/5 pt-3 text-[10px] font-semibold leading-relaxed text-[#8b949e]">
              {data.sampleNote}
            </p>
          )}
        </>
      )}
    </div>
  );
}
