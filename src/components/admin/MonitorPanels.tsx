/**
 * MONITOR — the admin panel's observability home.
 *
 * This is the "Grafana screen" for NavBharatAI, built inside the product rather than bolted on: a
 * live, time-ranged view of what the platform is actually doing right now, drawn from the real
 * telemetry the engine records (see metricsTimeline.ts).
 *
 * WHY NOT ACTUAL GRAFANA. Grafana draws data somebody else stored; it does not collect anything. Our
 * data already lives in Firestore behind an admin-authenticated API, and Cloud Run's own metrics
 * already go to Google Cloud Monitoring for free. Standing up a Grafana instance would have added a
 * VM and a monthly bill to render numbers we already hold — the same VM cost the admin deliberately
 * cut in August. So the collection half is what we built, and this renders it.
 *
 * THE RULE THIS SCREEN IS BUILT AROUND: a dashboard whose feed is down looks exactly like a
 * dashboard reporting a quiet night — both are flat and green. So when the telemetry cannot be read
 * the charts are SUPPRESSED and the screen says so, instead of drawing a reassuring zero line. The
 * decision lives in feedState() in monitorFormat.ts and is unit-tested.
 *
 * Provider names appear here. That is deliberate and allowed: this is an admin-only diagnostic
 * surface (White-Label Law §3). None of it may ever be rendered on a user-facing screen.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, RefreshCw, Cpu, IndianRupee, CheckCircle2, Clock, Server, Eye } from 'lucide-react';
import { stackedBarLayout, linePoints, donutSegments, axisTickIndices } from '../ui/charts/chartGeometry';
import {
  RANGE_OPTIONS, timeLabel, humanDuration, percent, compactNumber, microUsdToInr, formatInr,
  extractSeries, totalsFor, feedState, feedMessage, providerRows, rateTone,
  type MonitorPoint, type RangeHours,
} from './monitorFormat';

interface MonitorResponse {
  generatedAt: number;
  windowHours: number;
  usdInr: number;
  snapshot: any;
  instanceUptimeSeconds: number;
  /** Sandboxes running right now (durable, cross-instance). null = the store could not be read. */
  liveSandboxes: number | null;
  alerts: any[];
  health: { score: any; inputs: any } | null;
  healthError: string | null;
  finops: any;
  insights: any[];
  providers: Record<string, any>;
  providersError: string | null;
  timeline: {
    available: boolean;
    hasData: boolean;
    bucketMs: number;
    from: number;
    to: number;
    points: MonitorPoint[];
    summary: { sandboxUsd?: number | null; sandboxRateConfigured?: boolean } | null;
    providers: Record<string, any>;
  };
}

interface LogEntry {
  ts?: number;
  level?: string;
  event?: string;
  message?: string;
  workspaceId?: string;
}

const REFRESH_MS = 30_000;

const PANEL = 'bg-[#161b22] border border-white/10 rounded-[1.5rem] p-5';
const PANEL_TITLE = 'text-[11px] font-black text-white uppercase tracking-widest';
const PANEL_SUB = 'text-[9px] text-[#8b949e] font-bold uppercase tracking-widest mt-0.5';

const PROVIDER_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#ec4899', '#84cc16'];

function toneClass(tone: 'good' | 'warn' | 'bad' | 'unknown'): string {
  return tone === 'good' ? 'text-emerald-400'
    : tone === 'warn' ? 'text-amber-400'
    : tone === 'bad' ? 'text-red-400'
    : 'text-[#8b949e]';
}

function Tile({ label, value, sub, tone = 'text-white', Icon }: {
  label: string; value: string; sub: string; tone?: string; Icon: React.ComponentType<any>;
}) {
  return (
    <div className="bg-[#161b22] border border-white/10 rounded-[1.25rem] p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[9px] text-[#8b949e] font-black uppercase tracking-widest">{label}</p>
        <Icon className="w-3.5 h-3.5 text-[#484f58] shrink-0" />
      </div>
      <h3 className={`text-2xl font-black tracking-tight mt-1.5 font-mono ${tone}`}>{value}</h3>
      <p className="text-[9px] text-[#8b949e] font-bold uppercase tracking-wider mt-1.5">{sub}</p>
    </div>
  );
}

/** A chart area with a time axis. Children draw inside a 0..W × 0..H viewBox. */
function ChartFrame({ points, windowHours, height = 120, children }: {
  points: MonitorPoint[]; windowHours: number; height?: number; children: (dims: { w: number; h: number }) => React.ReactNode;
}) {
  const w = 600;
  const ticks = axisTickIndices(points.length, 6);
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label="Time series">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={w} y1={height * f} y2={height * f} stroke="#ffffff" strokeOpacity={0.06} strokeWidth={1} />
        ))}
        {children({ w, h: height })}
      </svg>
      <div className="flex justify-between mt-1.5">
        {ticks.map((i) => (
          <span key={i} className="text-[8px] text-[#484f58] font-mono">
            {timeLabel(points[i]?.t ?? 0, windowHours)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The one place the screen refuses to draw. Shown instead of a chart when the feed is not live. */
function FeedNotice({ state, windowLabel }: { state: 'loading' | 'unavailable' | 'idle'; windowLabel: string }) {
  const tone = state === 'unavailable'
    ? 'bg-amber-500/5 border-amber-500/30 text-amber-200'
    : 'bg-black/20 border-white/10 text-[#8b949e]';
  return (
    <div className={`rounded-xl border px-4 py-6 text-center ${tone}`}>
      <p className="text-[11px] leading-relaxed">{feedMessage(state, windowLabel)}</p>
    </div>
  );
}

export function MonitorPanels({ adminToken }: { adminToken: string }) {
  const [hours, setHours] = useState<RangeHours>(6);
  const [data, setData] = useState<MonitorResponse | null>(null);
  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  // A refresh that lands after the component is gone (or after the admin changed range) must not
  // write stale numbers over fresh ones.
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    const headers = { 'x-admin-token': adminToken, 'Content-Type': 'application/json' };
    try {
      const [monitorRes, logRes] = await Promise.allSettled([
        fetch(`/api/admin/monitor?hours=${hours}`, { headers }),
        fetch('/api/admin/logs?limit=40', { headers }),
      ]);
      if (seq !== requestSeq.current) return;

      if (monitorRes.status === 'fulfilled' && monitorRes.value.ok) {
        setData(await monitorRes.value.json());
        setError(null);
      } else {
        const reason = monitorRes.status === 'rejected'
          ? String(monitorRes.reason?.message || monitorRes.reason)
          : `HTTP ${monitorRes.value.status}`;
        setError(reason);
      }

      // The log panel is independent: losing it must never blank the charts.
      if (logRes.status === 'fulfilled' && logRes.value.ok) {
        const body = await logRes.value.json();
        setLogs(Array.isArray(body?.entries) ? body.entries : []);
      } else {
        setLogs(null);
      }
      setLastLoadedAt(Date.now());
    } catch (e: any) {
      if (seq === requestSeq.current) setError(e?.message || 'Could not read live telemetry.');
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [adminToken, hours]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => { void load(); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  const windowLabel = RANGE_OPTIONS.find((r) => r.hours === hours)?.label ?? `Last ${hours}h`;
  const points = data?.timeline?.points ?? [];
  const state = feedState({ loading: loading && !data, error, available: data?.timeline?.available, hasData: data?.timeline?.hasData });
  const chartsLive = state === 'live';
  const totals = useMemo(() => totalsFor(points), [points]);
  const providers = useMemo(() => providerRows(data?.timeline?.providers), [data?.timeline?.providers]);
  const usdInr = data?.usdInr ?? null;

  const buildSeries = useMemo(() => ({
    ok: points.map((p) => p.buildsOk || 0),
    failed: points.map((p) => p.buildsFailed || 0),
  }), [points]);

  const costSeries = useMemo(() => extractSeries(points, 'cost'), [points]);
  const tokenSeries = useMemo(() => extractSeries(points, 'tokens'), [points]);
  const latencySeries = useMemo(() => extractSeries(points, 'latency'), [points]);

  // The SERVER prices VM time, and only when a real rate is configured — it holds E2B_USD_PER_HOUR,
  // and pricing it again here would be the same sum in two places, free to drift. A null means "not
  // priced", which the tile says out loud instead of showing ₹0.
  const sandboxRateConfigured = data?.timeline?.summary?.sandboxRateConfigured;
  const sandboxWindowUsd = data?.timeline?.summary?.sandboxUsd ?? null;

  const health = data?.health?.score ?? null;
  const alerts = Array.isArray(data?.alerts) ? data!.alerts : [];
  const insights = Array.isArray(data?.insights) ? data!.insights : [];
  const finopsFindings: any[] = Array.isArray(data?.finops?.findings) ? data!.finops.findings : [];

  return (
    <div className="space-y-5">
      {/* ── Control bar: the time range and the refresh state, like any monitoring console ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#161b22] border border-white/10 rounded-[1.25rem] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Activity className="w-4 h-4 text-indigo-400" />
          <div>
            <h2 className="text-xs font-black text-white uppercase tracking-widest">Live Monitor</h2>
            <p className="text-[9px] text-[#8b949e] font-bold uppercase tracking-widest">
              {lastLoadedAt ? `Updated ${new Date(lastLoadedAt).toLocaleTimeString('en-IN')}` : 'Loading…'}
              {data?.instanceUptimeSeconds != null && ` · server up ${humanDuration(data.instanceUptimeSeconds * 1000)}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-black/40 border border-white/10 p-0.5">
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r.hours}
                onClick={() => setHours(r.hours)}
                className={`px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-wider transition-colors ${
                  hours === r.hours ? 'bg-indigo-600 text-white' : 'text-[#8b949e] hover:text-white'}`}
              >
                {r.hours >= 168 ? '7d' : r.hours >= 24 ? '24h' : `${r.hours}h`}
              </button>
            ))}
          </div>
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={`px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider border transition-colors ${
              autoRefresh ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-white/5 border-white/10 text-[#8b949e]'}`}
            title="Refresh every 30 seconds"
          >
            {autoRefresh ? 'Auto 30s' : 'Auto off'}
          </button>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-[#8b949e] hover:text-white disabled:opacity-40"
            aria-label="Refresh now"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── Live stat row over the selected window ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile
          label="Builds"
          value={chartsLive ? String(totals.builds) : '—'}
          sub={windowLabel}
          Icon={Server}
        />
        <Tile
          label="Success rate"
          value={chartsLive ? percent(totals.successRate) : '—'}
          sub={chartsLive && totals.builds > 0 ? `${totals.buildsOk} ok · ${totals.buildsFailed} failed` : 'No build in window'}
          tone={toneClass(rateTone(totals.successRate))}
          Icon={CheckCircle2}
        />
        <Tile
          label="Preview rendered"
          value={chartsLive ? percent(totals.previewRate) : '—'}
          sub="Platform saw the app render"
          tone={toneClass(rateTone(totals.previewRate))}
          Icon={Eye}
        />
        <Tile
          label="Avg build time"
          value={chartsLive ? humanDuration(totals.avgBuildMs) : '—'}
          sub="Start to settle"
          Icon={Clock}
        />
        <Tile
          label="AI cost"
          value={chartsLive ? formatInr(microUsdToInr(totals.costMicroUsd, usdInr)) : '—'}
          sub={chartsLive ? `${compactNumber(totals.tokens)} tokens` : 'Awaiting telemetry'}
          Icon={IndianRupee}
        />
      </div>

      {/* ── OUR infrastructure cost, and what is running right now. ────────────────────────────
          The E2B VM bill is the largest single line in the platform's costs and had no live surface
          at all: it could double overnight and nothing in the product would have said a word. These
          are ADMIN cost figures, never a user charge. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile
          label="Live sandboxes"
          value={data?.liveSandboxes == null ? '—' : String(data.liveSandboxes)}
          sub={data?.liveSandboxes == null ? 'Store unreadable' : 'Running now — billed by the minute'}
          tone={(data?.liveSandboxes ?? 0) > 0 ? 'text-sky-400' : 'text-white'}
          Icon={Server}
        />
        <Tile
          label="VM time"
          value={chartsLive ? humanDuration(totals.sandboxSeconds * 1000) : '—'}
          sub={windowLabel}
          Icon={Clock}
        />
        <Tile
          label="VM cost"
          value={chartsLive && sandboxWindowUsd != null ? formatInr(microUsdToInr(sandboxWindowUsd * 1_000_000, usdInr)) : '—'}
          sub={sandboxRateConfigured === false ? 'Set E2B_USD_PER_HOUR to price it' : 'Our infrastructure, not a user charge'}
          tone={sandboxRateConfigured === false ? 'text-[#8b949e]' : 'text-orange-400'}
          Icon={IndianRupee}
        />
        <Tile
          label="Total spend"
          value={chartsLive ? formatInr(microUsdToInr(totals.costMicroUsd + (sandboxWindowUsd ?? 0) * 1_000_000, usdInr)) : '—'}
          sub={sandboxRateConfigured === false ? 'AI only — VM not priced' : 'AI + VM, this window'}
          Icon={Cpu}
        />
      </div>

      {/* ── Alerts, when the platform's own thresholds fire ── */}
      {alerts.length > 0 && (
        <div className="bg-red-500/5 border border-red-500/30 rounded-[1.25rem] p-4 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
            <h3 className={PANEL_TITLE}>Active alerts</h3>
          </div>
          {alerts.map((a: any, i: number) => (
            <p key={a?.id ?? i} className="text-[11px] text-red-200 leading-relaxed">
              {a?.message || a?.headline || JSON.stringify(a)}
            </p>
          ))}
        </div>
      )}

      {/* ── Build activity + AI spend, the two charts the admin actually acts on ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={PANEL}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className={PANEL_TITLE}>Build activity</h3>
              <p className={PANEL_SUB}>Succeeded vs failed, per {Math.round((data?.timeline?.bucketMs ?? 300_000) / 60_000)} min</p>
            </div>
            <div className="flex items-center gap-2.5 text-[8px] font-black uppercase tracking-wider">
              <span className="flex items-center gap-1 text-emerald-400"><span className="w-2 h-2 rounded-sm bg-emerald-500" />OK</span>
              <span className="flex items-center gap-1 text-red-400"><span className="w-2 h-2 rounded-sm bg-red-500" />Failed</span>
            </div>
          </div>
          {chartsLive ? (
            <ChartFrame points={points} windowHours={hours}>
              {({ w, h }) => stackedBarLayout([buildSeries.ok, buildSeries.failed], { width: w, height: h, gapRatio: 0.25 })
                .map((r, i) => (
                  <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} rx={1}
                    fill={r.seriesIndex === 0 ? '#22c55e' : '#ef4444'} />
                ))}
            </ChartFrame>
          ) : <FeedNotice state={state as any} windowLabel={windowLabel} />}
        </div>

        <div className={PANEL}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className={PANEL_TITLE}>AI spend</h3>
              <p className={PANEL_SUB}>Real provider cost per bucket</p>
            </div>
            <span className="text-[9px] font-mono text-amber-400">
              {chartsLive ? formatInr(microUsdToInr(totals.costMicroUsd, usdInr)) : '—'}
            </span>
          </div>
          {chartsLive ? (
            <ChartFrame points={points} windowHours={hours}>
              {({ w, h }) => {
                const pts = linePoints(costSeries, { width: w, height: h });
                if (!pts) return null;
                return (
                  <>
                    <polygon points={`0,${h} ${pts} ${w},${h}`} fill="#f59e0b" fillOpacity={0.14} />
                    <polyline points={pts} fill="none" stroke="#f59e0b" strokeWidth={2} strokeLinejoin="round" />
                  </>
                );
              }}
            </ChartFrame>
          ) : <FeedNotice state={state as any} windowLabel={windowLabel} />}
        </div>

        <div className={PANEL}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className={PANEL_TITLE}>Token throughput</h3>
              <p className={PANEL_SUB}>Input + output tokens per bucket</p>
            </div>
            <span className="text-[9px] font-mono text-sky-400">{chartsLive ? compactNumber(totals.tokens) : '—'}</span>
          </div>
          {chartsLive ? (
            <ChartFrame points={points} windowHours={hours} height={100}>
              {({ w, h }) => {
                const pts = linePoints(tokenSeries, { width: w, height: h });
                if (!pts) return null;
                return (
                  <>
                    <polygon points={`0,${h} ${pts} ${w},${h}`} fill="#38bdf8" fillOpacity={0.14} />
                    <polyline points={pts} fill="none" stroke="#38bdf8" strokeWidth={2} strokeLinejoin="round" />
                  </>
                );
              }}
            </ChartFrame>
          ) : <FeedNotice state={state as any} windowLabel={windowLabel} />}
        </div>

        <div className={PANEL}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className={PANEL_TITLE}>Build duration</h3>
              <p className={PANEL_SUB}>Average time a user waited</p>
            </div>
            <span className="text-[9px] font-mono text-violet-400">{chartsLive ? humanDuration(totals.avgBuildMs) : '—'}</span>
          </div>
          {chartsLive ? (
            <ChartFrame points={points} windowHours={hours} height={100}>
              {({ w, h }) => {
                const pts = linePoints(latencySeries, { width: w, height: h });
                if (!pts) return null;
                return <polyline points={pts} fill="none" stroke="#a78bfa" strokeWidth={2} strokeLinejoin="round" />;
              }}
            </ChartFrame>
          ) : <FeedNotice state={state as any} windowLabel={windowLabel} />}
        </div>
      </div>

      {/* ── Where the money went, by engine. ADMIN-ONLY surface (White-Label Law §3). ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={PANEL}>
          <div className="mb-3">
            <h3 className={PANEL_TITLE}>Engine cost split</h3>
            <p className={PANEL_SUB}>Admin-only — never shown to a user</p>
          </div>
          {providers.length === 0 ? (
            <p className="text-[10px] text-[#8b949e] font-bold uppercase py-6 text-center">
              {chartsLive ? 'No engine activity in this window' : 'Awaiting telemetry'}
            </p>
          ) : (
            <div className="flex items-center gap-5">
              <svg viewBox="0 0 42 42" className="w-28 h-28 shrink-0" role="img" aria-label="Cost split by engine">
                <circle cx="21" cy="21" r="15.9155" fill="transparent" stroke="#ffffff" strokeOpacity={0.06} strokeWidth="5" />
                {donutSegments(providers.map((p) => p.share)).map((seg, i) => (
                  <circle
                    key={providers[i].name}
                    cx="21" cy="21" r="15.9155" fill="transparent"
                    stroke={PROVIDER_COLORS[i % PROVIDER_COLORS.length]}
                    strokeWidth="5"
                    strokeDasharray={`${seg.length} ${100 - seg.length}`}
                    strokeDashoffset={seg.offset + 25}
                  />
                ))}
              </svg>
              <div className="flex-1 space-y-1.5 min-w-0">
                {providers.map((p, i) => (
                  <div key={p.name} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PROVIDER_COLORS[i % PROVIDER_COLORS.length] }} />
                      <span className="text-[10px] font-mono text-white/80 uppercase truncate">{p.name}</span>
                    </span>
                    <span className="text-[10px] font-mono text-[#8b949e] shrink-0">
                      {formatInr(microUsdToInr(p.costUsd * 1_000_000, usdInr))} · {compactNumber(p.tokens)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Composite health, from the same inputs as /api/admin/health-score ── */}
        <div className={PANEL}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className={PANEL_TITLE}>Platform health</h3>
              <p className={PANEL_SUB}>Build success · engine errors · latency · uptime</p>
            </div>
            {health?.grade && (
              <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full border ${
                health.grade === 'excellent' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : health.grade === 'good' ? 'bg-sky-500/10 border-sky-500/30 text-sky-400'
                : health.grade === 'fair' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                : health.grade === 'unknown' ? 'bg-white/5 border-white/10 text-[#8b949e]'
                : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                {health.grade}
              </span>
            )}
          </div>
          {health ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                {([
                  { label: 'Health', value: health.health, good: (v: number) => v >= 75 },
                  { label: 'Reliability', value: health.reliability, good: (v: number) => v >= 75 },
                  { label: 'Risk', value: health.risk, good: (v: number) => v <= 25 },
                ] as const).map((m) => (
                  <div key={m.label} className="bg-black/30 rounded-xl p-3 text-center">
                    <div className="text-[8px] text-[#8b949e] uppercase font-black tracking-widest">{m.label}</div>
                    <div className={`text-xl font-black font-mono mt-1 ${
                      m.value == null ? 'text-[#8b949e]' : m.good(m.value) ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {m.value == null ? '—' : m.value}
                    </div>
                  </div>
                ))}
              </div>
              {Array.isArray(health.missing) && health.missing.length > 0 && (
                <p className="text-[8px] text-[#484f58] font-bold uppercase tracking-widest mt-2.5">
                  No data yet for: {health.missing.join(', ')} — excluded from the score, not faked.
                </p>
              )}
            </>
          ) : (
            <p className="text-[10px] text-[#8b949e] font-bold uppercase py-6 text-center">
              {data?.healthError ? `Unavailable — ${data.healthError}` : 'Awaiting telemetry'}
            </p>
          )}
        </div>
      </div>

      {/* ── What is worth acting on: waste findings and derived insights ── */}
      {(finopsFindings.length > 0 || insights.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {finopsFindings.length > 0 && (
            <div className={PANEL}>
              <div className="mb-3">
                <h3 className={PANEL_TITLE}>Where money is being wasted</h3>
                <p className={PANEL_SUB}>Observed waste only — no projections</p>
              </div>
              <div className="space-y-2">
                {finopsFindings.slice(0, 6).map((f: any, i: number) => (
                  <div key={f?.id ?? i} className="bg-black/30 rounded-xl p-3">
                    <div className="text-[11px] font-bold text-white">{f?.title || f?.headline || 'Finding'}</div>
                    {f?.detail && <div className="text-[10px] text-[#8b949e] mt-0.5 leading-relaxed">{f.detail}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {insights.length > 0 && (
            <div className={PANEL}>
              <div className="mb-3">
                <h3 className={PANEL_TITLE}>Insights</h3>
                <p className={PANEL_SUB}>Derived from live metrics — not predicted</p>
              </div>
              <div className="space-y-2">
                {insights.slice(0, 6).map((i: any, idx: number) => (
                  <div key={i?.id ?? idx} className="flex items-start gap-2.5 bg-black/30 rounded-xl p-3">
                    <span className={`mt-0.5 text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full border shrink-0 ${
                      i?.severity === 'critical' ? 'bg-red-500/10 border-red-500/30 text-red-400'
                      : i?.severity === 'warning' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                      : i?.severity === 'good' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-white/5 border-white/10 text-[#8b949e]'}`}>
                      {i?.severity ?? 'info'}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold text-white">{i?.headline}</div>
                      <div className="text-[10px] text-[#8b949e] mt-0.5 leading-relaxed">{i?.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Live server logs, the panel that turns "something is wrong" into a line to read ── */}
      <div className={PANEL}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className={PANEL_TITLE}>Server logs</h3>
            <p className={PANEL_SUB}>Newest first · admin-only</p>
          </div>
          <Cpu className="w-3.5 h-3.5 text-[#484f58]" />
        </div>
        {logs === null ? (
          <p className="text-[10px] text-[#8b949e] font-bold uppercase py-6 text-center">
            Log stream unavailable right now — this says nothing about platform health.
          </p>
        ) : logs.length === 0 ? (
          <p className="text-[10px] text-[#8b949e] font-bold uppercase py-6 text-center">No log entries recorded</p>
        ) : (
          <div className="max-h-64 overflow-y-auto font-mono text-[10px] space-y-1 pr-1">
            {logs.map((l, i) => (
              <div key={i} className="flex gap-2.5 items-start hover:bg-white/5 rounded px-1.5 py-0.5">
                <span className="text-[#484f58] shrink-0">
                  {l.ts ? new Date(l.ts).toLocaleTimeString('en-IN', { hour12: false }) : '--:--:--'}
                </span>
                <span className={`shrink-0 font-black uppercase ${
                  l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-400' : 'text-sky-400'}`}>
                  {(l.level || 'info').toUpperCase()}
                </span>
                <span className="text-[#c9d1d9] break-all">{l.event ? `${l.event} — ` : ''}{l.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Cumulative counters, labelled honestly: they reset on every deploy ── */}
      {data?.snapshot && (
        <div className={PANEL}>
          <div className="mb-3">
            <h3 className={PANEL_TITLE}>Since this server started</h3>
            <p className={PANEL_SUB}>
              Resets on every deploy — a drop here is a restart, not an outage
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-black/30 rounded-xl p-3">
              <div className="text-[8px] text-[#8b949e] uppercase font-black tracking-widest">Builds</div>
              <div className="text-lg font-black font-mono text-white mt-0.5">{data.snapshot.builds?.total ?? 0}</div>
            </div>
            <div className="bg-black/30 rounded-xl p-3">
              <div className="text-[8px] text-[#8b949e] uppercase font-black tracking-widest">Success</div>
              <div className={`text-lg font-black font-mono mt-0.5 ${toneClass(rateTone(data.snapshot.builds?.total ? data.snapshot.builds.successRate : null))}`}>
                {data.snapshot.builds?.total ? percent(data.snapshot.builds.successRate) : '—'}
              </div>
            </div>
            <div className="bg-black/30 rounded-xl p-3">
              <div className="text-[8px] text-[#8b949e] uppercase font-black tracking-widest">Avg build</div>
              <div className="text-lg font-black font-mono text-white mt-0.5">
                {data.snapshot.builds?.total ? humanDuration(data.snapshot.builds.avgMs) : '—'}
              </div>
            </div>
            <div className="bg-black/30 rounded-xl p-3">
              <div className="text-[8px] text-[#8b949e] uppercase font-black tracking-widest">Engine cost</div>
              <div className="text-lg font-black font-mono text-amber-400 mt-0.5">
                {formatInr(microUsdToInr((data.snapshot.totalCostUsd || 0) * 1_000_000, usdInr))}
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p className="text-[10px] text-amber-300/80 font-bold uppercase tracking-wider text-center">
          Live telemetry error: {error}
        </p>
      )}
    </div>
  );
}

export default MonitorPanels;
