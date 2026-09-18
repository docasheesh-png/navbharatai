/**
 * BUILD COSTS — what a build really cost the platform vs what it billed, by tier × app size.
 *
 * ADMIN 2026-09-14: asked what a simple / mid / full-stack app costs the user versus the platform on
 * each tier, the honest answer was an estimate — and the admin said "han banao": measure it. This card
 * renders `/api/admin/build-costs`, which is computed from persisted build reports only.
 *
 * 🔒 THE RULE THIS CARD LIVES BY: a cost we could not establish is shown as "not measured", never as
 * ₹0 and never as a guess. Every average carries its own sample size, because "₹12 avg over 1 build"
 * and "₹12 avg over 20 builds" are different facts and the admin decides prices from this screen.
 *
 * ADMIN-ONLY. Real cost and margin never reach a user-facing surface (White-Label Law).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { IndianRupee, RefreshCw, AlertTriangle, TrendingDown, TrendingUp, Minus } from 'lucide-react';

export interface CostCell {
  tier: string;
  tierName: string;
  size: string;
  n: number;
  nMeasured: number;
  nBilled: number;
  failed: number;
  avgRealInr: number | null;
  avgBilledInr: number | null;
  avgMarginInr: number | null;
  nMargin: number;
  avgHeals: number | null;
  avgMinutes: number | null;
}

export interface CostRow {
  workspaceId: string;
  startedAt: number;
  tierName: string;
  size: string;
  files: number;
  ok: boolean | null;
  minutes: number | null;
  heals: number;
  billedInr: number | null;
  zeroBillReason: string | null;
  realInr: number | null;
  sandboxInr: number | null;
  measured: boolean;
  source: 'settled' | 'call-log' | 'call-log-capped' | 'none';
  marginInr: number | null;
}

export interface TrendMetric {
  recent: number | null;
  older: number | null;
  delta: number | null;
  nRecent: number;
  nOlder: number;
}

export interface CostTrend {
  nRecent: number;
  nOlder: number;
  splitAt: number | null;
  realInr: TrendMetric;
  billedInr: TrendMetric;
  minutes: TrendMetric;
  heals: TrendMetric;
  successRate: TrendMetric;
  comparable: boolean;
}

export interface BuildCostsResponse {
  rows: CostRow[];
  summary: CostCell[];
  usdInr: number;
  window: number;
  reportsRead: number;
  sizeRule: string;
  note: string;
  /** All four optional: an older server that has not deployed this change still renders. */
  trend?: CostTrend;
  /** 'history' = one row per BUILD. 'latest-per-workspace' = the honest fallback. */
  source?: 'history' | 'latest-per-workspace';
  workspacesScanned?: number;
  readAt?: number;
}

/** ₹ with two decimals; an absent figure is a dash, never a zero. */
export const inr = (v: number | null | undefined): string =>
  typeof v === 'number' && Number.isFinite(v) ? `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

/** "₹12.40 (n=3)" — an average is never shown without the sample it was taken over. */
export const avgWithSample = (v: number | null, n: number): string => (v === null || n === 0 ? 'not measured' : `${inr(v)} · n=${n}`);

/** The real-cost cell for one build, honest about where the number came from. */
export function realCostLabel(row: Pick<CostRow, 'realInr' | 'measured' | 'source'>): string {
  if (row.realInr === null || row.source === 'none') return 'not measured';
  if (row.source === 'call-log-capped') return `≥ ${inr(row.realInr)} (call log capped)`;
  if (!row.measured) return `≈ ${inr(row.realInr)} (some calls unpriced)`;
  return inr(row.realInr);
}

/** The bill cell: ₹0 with its reason is a fact; "never settled" is a different one. */
export function billLabel(row: Pick<CostRow, 'billedInr' | 'zeroBillReason'>): string {
  if (row.billedInr === null) return 'not recorded';
  if (row.billedInr === 0 && row.zeroBillReason) return `₹0 — ${row.zeroBillReason}`;
  return inr(row.billedInr);
}

/** One line the admin can read without the table. Never claims a measurement that was not made. */
export function costHeadline(data: BuildCostsResponse | null, error: string): string {
  if (error) return 'Build costs could not be read — nothing on this card is current.';
  if (!data) return 'Reading the last builds…';
  if (data.rows.length === 0) return 'No builds recorded yet.';
  const measured = data.rows.filter((r) => r.measured && r.realInr !== null).length;
  const unmeasured = data.rows.length - measured;
  const base = `${data.rows.length} builds read; real cost measured on ${measured}`;
  const tail = unmeasured > 0 ? `${base}, ${unmeasured} not measurable (older reports or a capped call log).` : `${base}.`;
  // ADMIN 2026-09-18: the window used to be one report per WORKSPACE while calling itself "builds",
  // which is why repeated builds in one workspace never moved the number. When the per-build history
  // is unreadable we still fall back to that view — and then the card must say so, not imply builds.
  return data.source === 'latest-per-workspace'
    ? `${tail} ⚠️ Per-build history could not be read, so this is each workspace's LATEST build only — repeated builds in one workspace are not shown.`
    : tail;
}

/** ₹/min/heal deltas: DOWN is better. Success rate is the one exception and is handled on its own. */
export function deltaLabel(m: TrendMetric | undefined, unit: 'inr' | 'plain', higherIsBetter = false): string {
  if (!m || m.delta === null || m.recent === null || m.older === null) {
    return `not enough builds yet (${m?.nRecent ?? 0} vs ${m?.nOlder ?? 0})`;
  }
  const fmt = (v: number): string => (unit === 'inr' ? inr(v) : String(Math.round(v * 10) / 10));
  const better = higherIsBetter ? m.delta > 0 : m.delta < 0;
  const arrow = m.delta === 0 ? 'no change' : `${m.delta > 0 ? '+' : '−'}${fmt(Math.abs(m.delta))}`;
  const verdict = m.delta === 0 ? '' : better ? ' better' : ' worse';
  return `${fmt(m.recent)} vs ${fmt(m.older)} · ${arrow}${verdict}`;
}

/** The one line that answers "are we making progress?" without reading the table. */
export function trendHeadline(trend: CostTrend | undefined): string {
  if (!trend) return 'Trend not available from this server yet.';
  if (!trend.comparable) {
    return `Not enough builds to compare yet — ${trend.nRecent} newer vs ${trend.nOlder} older, and a half needs at least 3 before a difference means anything.`;
  }
  const cost = trend.realInr.delta;
  const mins = trend.minutes.delta;
  const heals = trend.heals.delta;
  const parts: string[] = [];
  if (cost !== null) parts.push(`real cost ${cost < 0 ? 'down' : cost > 0 ? 'up' : 'flat'}`);
  if (mins !== null) parts.push(`build time ${mins < 0 ? 'down' : mins > 0 ? 'up' : 'flat'}`);
  if (heals !== null) parts.push(`heals ${heals < 0 ? 'down' : heals > 0 ? 'up' : 'flat'}`);
  return `Newest ${trend.nRecent} builds vs the ${trend.nOlder} before them: ${parts.join(', ')}.`;
}

const SIZE_LABEL: Record<string, string> = { simple: 'Simple', mid: 'Mid', 'full-stack': 'Full-stack', unknown: 'Unknown size' };

export function BuildCostCard({ adminToken }: { adminToken: string }): React.ReactElement {
  const [data, setData] = useState<BuildCostsResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showRows, setShowRows] = useState(false);

  const fetchCosts = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/build-costs?limit=30', { headers: { 'x-admin-token': adminToken } });
      const d = await r.json();
      if (Array.isArray(d?.rows) && Array.isArray(d?.summary)) { setData(d); setError(''); }
      else setError(d?.error || 'Build costs could not be read.');
    } catch {
      setError('Build costs could not be read.');
    } finally { setLoading(false); }
  }, [adminToken]);

  useEffect(() => { void fetchCosts(); }, [fetchCosts]);

  const cells = data?.summary ?? [];
  const rows = data?.rows ?? [];

  return (
    <div className="bg-[#161b22] border border-indigo-500/20 rounded-[1.25rem] p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <IndianRupee className="w-4 h-4 text-indigo-400" />
          <h4 className="text-sm font-black text-white tracking-tight">Build costs — real cost vs bill, by tier and app size</h4>
          <span className="text-[10px] text-[#8b949e] font-bold">last {data?.window ?? 30} builds, newest first, measured from each build's own record — admin only</span>
        </div>
        <div className="flex items-center gap-3">
          {/* A card that never says WHEN it was read looks identical whether it is live or an hour
              stale — which is exactly how a frozen window went unnoticed. */}
          {data?.readAt ? (
            <span className="text-[9px] font-bold text-[#6e7681] whitespace-nowrap">read {new Date(data.readAt).toLocaleTimeString('en-IN')}</span>
          ) : null}
          <button
            type="button"
            onClick={() => void fetchCosts()}
            disabled={loading}
            className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-[#8b949e] hover:text-white disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <p className="text-[11px] text-[#8b949e] font-semibold">{costHeadline(data, error)}</p>

      {data && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
          <div className="flex items-center gap-2">
            {(() => {
              const d = data.trend?.realInr.delta;
              if (d === null || d === undefined) return <Minus className="w-3.5 h-3.5 text-[#6e7681]" />;
              return d < 0
                ? <TrendingDown className="w-3.5 h-3.5 text-emerald-400" />
                : d > 0 ? <TrendingUp className="w-3.5 h-3.5 text-red-400" /> : <Minus className="w-3.5 h-3.5 text-[#6e7681]" />;
            })()}
            <h5 className="text-[10px] font-black uppercase tracking-widest text-[#8b949e]">Are we making progress?</h5>
          </div>
          <p className="text-[11px] text-[#c9d1d9] font-semibold">{trendHeadline(data.trend)}</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {([
              ['Real cost (ours)', deltaLabel(data.trend?.realInr, 'inr'), data.trend?.realInr.delta, false],
              ['Bill (user)', deltaLabel(data.trend?.billedInr, 'inr'), null, false],
              ['Minutes', deltaLabel(data.trend?.minutes, 'plain'), data.trend?.minutes.delta, false],
              ['Heals', deltaLabel(data.trend?.heals, 'plain'), data.trend?.heals.delta, false],
              ['Success rate', deltaLabel(data.trend?.successRate, 'plain', true), data.trend?.successRate.delta, true],
            ] as [string, string, number | null | undefined, boolean][]).map(([label, text, delta, higherIsBetter]) => (
              <div key={label} className="rounded-lg bg-white/[0.04] px-2 py-1.5">
                <p className="text-[9px] font-black uppercase tracking-widest text-[#6e7681]">{label}</p>
                <p className={`text-[10px] font-bold ${
                  delta === null || delta === undefined || delta === 0 ? 'text-[#8b949e]'
                    : (higherIsBetter ? delta > 0 : delta < 0) ? 'text-emerald-400' : 'text-red-400'
                }`}>{text}</p>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-[#6e7681] leading-snug">
            Newest half against the half before it, within this window. A half needs at least 3 builds before a
            difference is reported — below that it says so instead of printing a number. Lower is better everywhere
            except success rate.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[10px] text-[#8b949e] font-semibold">{error}</p>
        </div>
      )}

      {cells.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] text-[#c9d1d9]">
            <thead>
              <tr className="text-[9px] font-black uppercase tracking-widest text-[#8b949e] border-b border-white/10">
                <th className="text-left py-2 pr-3">Tier</th>
                <th className="text-left py-2 pr-3">App size</th>
                <th className="text-right py-2 pr-3">Builds</th>
                <th className="text-right py-2 pr-3">Failed</th>
                <th className="text-right py-2 pr-3">Avg real cost (ours)</th>
                <th className="text-right py-2 pr-3">Avg bill (user)</th>
                <th className="text-right py-2 pr-3">Avg margin</th>
                <th className="text-right py-2 pr-3">Avg heals</th>
                <th className="text-right py-2">Avg minutes</th>
              </tr>
            </thead>
            <tbody>
              {cells.map((c) => (
                <tr key={`${c.tier}-${c.size}`} className="border-b border-white/5">
                  <td className="py-2 pr-3 font-bold text-white">{c.tierName}</td>
                  <td className="py-2 pr-3">{SIZE_LABEL[c.size] ?? c.size}</td>
                  <td className="py-2 pr-3 text-right">{c.n}</td>
                  <td className="py-2 pr-3 text-right">{c.failed}</td>
                  <td className="py-2 pr-3 text-right">{avgWithSample(c.avgRealInr, c.nMeasured)}</td>
                  <td className="py-2 pr-3 text-right">{avgWithSample(c.avgBilledInr, c.nBilled)}</td>
                  <td className={`py-2 pr-3 text-right ${c.avgMarginInr !== null && c.avgMarginInr < 0 ? 'text-red-400' : ''}`}>{avgWithSample(c.avgMarginInr, c.nMargin)}</td>
                  <td className="py-2 pr-3 text-right">{c.avgHeals === null ? '—' : c.avgHeals}</td>
                  <td className="py-2 text-right">{c.avgMinutes === null ? '—' : c.avgMinutes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="text-[10px] text-[#6e7681] leading-snug space-y-1">
          <p>{data.sizeRule}</p>
          <p>{data.note}</p>
          <p>Rate used: ₹{data.usdInr} per USD.</p>
        </div>
      )}

      {rows.length > 0 && (
        <details open={showRows} onToggle={(e) => setShowRows((e.currentTarget as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer text-[10px] font-black uppercase tracking-widest text-[#8b949e] hover:text-white">
            Every build in this window ({rows.length})
          </summary>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-[11px] text-[#c9d1d9]">
              <thead>
                <tr className="text-[9px] font-black uppercase tracking-widest text-[#8b949e] border-b border-white/10">
                  <th className="text-left py-2 pr-3">When</th>
                  <th className="text-left py-2 pr-3">Tier</th>
                  <th className="text-left py-2 pr-3">Size</th>
                  <th className="text-right py-2 pr-3">Files</th>
                  <th className="text-left py-2 pr-3">Result</th>
                  <th className="text-right py-2 pr-3">Real cost</th>
                  <th className="text-right py-2 pr-3">Sandbox</th>
                  <th className="text-right py-2 pr-3">Bill</th>
                  <th className="text-right py-2 pr-3">Margin</th>
                  <th className="text-right py-2 pr-3">Heals</th>
                  <th className="text-right py-2">Min</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.workspaceId}-${r.startedAt}`} className="border-b border-white/5">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{r.startedAt ? new Date(r.startedAt).toLocaleString('en-IN') : '—'}</td>
                    <td className="py-1.5 pr-3 font-bold text-white">{r.tierName}</td>
                    <td className="py-1.5 pr-3">{SIZE_LABEL[r.size] ?? r.size}</td>
                    <td className="py-1.5 pr-3 text-right">{r.files}</td>
                    <td className={`py-1.5 pr-3 ${r.ok === false ? 'text-red-400' : r.ok === true ? 'text-emerald-400' : 'text-[#8b949e]'}`}>{r.ok === null ? 'unsettled' : r.ok ? 'ok' : 'failed'}</td>
                    <td className="py-1.5 pr-3 text-right whitespace-nowrap">{realCostLabel(r)}</td>
                    <td className="py-1.5 pr-3 text-right">{r.sandboxInr === null ? '—' : inr(r.sandboxInr)}</td>
                    <td className="py-1.5 pr-3 text-right whitespace-nowrap">{billLabel(r)}</td>
                    <td className={`py-1.5 pr-3 text-right ${r.marginInr !== null && r.marginInr < 0 ? 'text-red-400' : ''}`}>{inr(r.marginInr)}</td>
                    <td className="py-1.5 pr-3 text-right">{r.heals}</td>
                    <td className="py-1.5 text-right">{r.minutes === null ? '—' : r.minutes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
