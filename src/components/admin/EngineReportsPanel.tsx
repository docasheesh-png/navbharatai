// THE REPORTS THAT WERE BEING WRITTEN AND NEVER SHOWN.
//
// ADMIN 2026-09-21: *"13 endpoints par asli diagnostic data ban raha hai jo kisi screen par dikhta hi
// nahi. pahle yahi banao!"*
//
// The audit of the admin panel found 65 report-shaped GET endpoints and THIRTEEN with no client at
// all — routes that compute a real answer on every call and hand it to nobody. This panel is those
// thirteen, and the ordering is deliberate: the first group is what decides whether the ENGINE is
// getting better, which is the one question `builderMetrics.ts` was written to answer and which its
// own header says nothing could answer — *"we ship fix after fix without being able to say whether
// the engine is getting better."*
//
// 🔒 NULL IS "NOT MEASURED", AND IT IS NEVER DRAWN AS ZERO. Every module behind these numbers states
// that rule in its own words (`builderMetrics.ts`: *"No data ⇒ null, never 0. '0%' and 'no builds
// yet' are different facts, and reporting the first when the second is true is the kind of lie that
// survives for months"*). A renderer that prints `0%` for a missing rate would re-introduce that lie
// at the last step, so `num()` and `pct()` return an em dash and the sample size travels with every
// rate.
//
// 🔒 EVERY CARD CARRIES ITS OWN COPY/DOWNLOAD. What is rendered here is a summary; the export is the
// whole server response. That is the point of the panel — these reports exist so they can be read by
// somebody who can act on them, and a number on a screen that cannot leave it is only half of that.
//
// ⚠️ ADMIN-ONLY, SO PROVIDER NAMES ARE ALLOWED HERE. The White-Label Law forbids a vendor name on a
// USER-facing surface; this panel is behind the admin token and is exactly the forensic surface that
// law carves out. Nothing here may ever be rendered into a user's screen.

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle, Activity, IndianRupee, Wrench, Server, Shield } from 'lucide-react';
import { ReportExportButtons } from './ReportExportButtons';

/** One report: where it comes from, what it is called, and what the server last said. */
interface ReportState {
  data: unknown;
  error: string | null;
  loading: boolean;
}

const EMPTY: ReportState = { data: null, error: null, loading: false };

/** An em dash, never a zero — "we did not measure this" is not "this is zero". */
const DASH = '—';

function num(v: unknown, digits = 0): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : DASH;
}

function pct(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : DASH;
}

function mins(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${(v / 60000).toFixed(1)} min` : DASH;
}

function usd(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? `$${v.toFixed(4)}` : DASH;
}

/** How many rows an object/array actually carries, for the ops cards. */
function countOf(v: unknown): string {
  if (Array.isArray(v)) return String(v.length);
  if (v && typeof v === 'object') return String(Object.keys(v as object).length);
  return DASH;
}

const CARD = 'bg-card border border-line rounded-[1.25rem] p-4 space-y-3';
const H = 'text-sm font-black text-ink tracking-tight';
const LABEL = 'text-[10px] font-black uppercase tracking-wider text-muted';
const VALUE = 'text-lg font-black text-ink tabular-nums';
const NOTE = 'text-[11px] text-muted leading-relaxed';

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-well rounded-xl px-3 py-2">
      <div className={LABEL}>{label}</div>
      <div className={`${VALUE} ${tone ?? ''}`}>{value}</div>
    </div>
  );
}

/**
 * A card that fetches ONE endpoint. The children render whatever that endpoint's shape is; the
 * export button always carries the raw response, so a shape this file does not understand is still
 * fully readable once copied.
 */
function ReportCard(props: {
  title: string;
  source: string;
  note: string;
  state: ReportState;
  onRefresh: () => void;
  icon: React.ComponentType<{ className?: string }>;
  window?: string;
  children: (data: any) => React.ReactNode;
  onStatus?: (m: string) => void;
}) {
  const { title, source, note, state, onRefresh, icon: Icon, window: win, children, onStatus } = props;
  return (
    <div className={CARD}>
      <div className="flex items-center gap-2 flex-wrap">
        <Icon className="w-4 h-4 text-accent-text" />
        <h4 className={H}>{title}</h4>
        <span className="ml-auto flex items-center gap-1">
          <ReportExportButtons
            label={title} data={state.data} tab="Diagnostics" source={source}
            window={win} onStatus={onStatus}
          />
          <button
            type="button" onClick={onRefresh} disabled={state.loading}
            title={`Reload ${title}`}
            className="p-1 rounded-lg border border-line text-muted hover:text-ink disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${state.loading ? 'animate-spin' : ''}`} />
          </button>
        </span>
      </div>
      <p className={NOTE}>{note}</p>
      {state.error ? (
        <p className="text-[12px] text-danger font-bold flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {state.error}
        </p>
      ) : state.loading && state.data === null ? (
        <p className={NOTE}>Reading…</p>
      ) : state.data === null ? (
        <p className={NOTE}>Not loaded yet.</p>
      ) : (
        children(state.data)
      )}
    </div>
  );
}

/** Every endpoint this panel surfaces, with the days window each one accepts. */
const ENDPOINTS = {
  scorecard: '/api/admin/builder-scorecard?limit=200',
  losses: '/api/admin/agentv3/losses?days=30',
  usage: '/api/admin/agentv3/usage-report?days=30',
  metrics: '/api/admin/metrics/history?days=30',
  assistant: '/api/admin/assistant-spend?days=14',
  providers: '/api/admin/provider-status',
  gate: '/api/admin/release-gate',
  flags: '/api/admin/feature-flags',
  keyVersion: '/api/admin/key-version',
  events: '/api/admin/events?limit=100',
  deployments: '/api/admin/deployments?limit=100',
  takedowns: '/api/admin/takedowns?limit=200',
  announcements: '/api/admin/announcements',
} as const;

type ReportKey = keyof typeof ENDPOINTS;

export interface EngineReportsPanelProps {
  adminToken: string;
  onStatus?: (message: string) => void;
}

export function EngineReportsPanel({ adminToken, onStatus }: EngineReportsPanelProps): React.ReactElement {
  const [reports, setReports] = useState<Record<ReportKey, ReportState>>(() =>
    Object.fromEntries(Object.keys(ENDPOINTS).map((k) => [k, EMPTY])) as Record<ReportKey, ReportState>);

  const load = useCallback(async (key: ReportKey) => {
    setReports((r) => ({ ...r, [key]: { ...r[key], loading: true, error: null } }));
    try {
      const res = await fetch(ENDPOINTS[key], { headers: { 'x-admin-token': adminToken } });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        // The server's own message when it has one — a generic "failed" hides which of the thirteen
        // is actually broken, which is the whole reason this panel exists.
        const msg = (body && typeof body === 'object' && typeof (body as any).error === 'string')
          ? (body as any).error
          : `The server answered ${res.status}.`;
        setReports((r) => ({ ...r, [key]: { data: null, error: msg, loading: false } }));
        return;
      }
      setReports((r) => ({ ...r, [key]: { data: body, error: null, loading: false } }));
    } catch {
      setReports((r) => ({ ...r, [key]: { data: null, error: 'Could not reach the server.', loading: false } }));
    }
  }, [adminToken]);

  const loadAll = useCallback(() => {
    (Object.keys(ENDPOINTS) as ReportKey[]).forEach((k) => { void load(k); });
  }, [load]);

  // Loaded when the tab opens. Thirteen calls is a lot to fire on every admin page load, so nothing
  // here runs until the admin is actually looking at this panel.
  useEffect(() => { loadAll(); }, [loadAll]);

  const s = (k: ReportKey) => reports[k];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-xs font-black text-ink uppercase tracking-widest">Diagnostics</h2>
        <span className="text-[11px] text-muted font-bold">
          Reports the engine already writes — every one of these had no screen until now
        </span>
        <button
          type="button" onClick={loadAll}
          className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-line text-[10px] font-bold text-muted hover:text-ink"
        >
          <RefreshCw className="w-3 h-3" /> Reload all
        </button>
      </div>

      <h3 className={LABEL}>Is the engine getting better?</h3>

      <ReportCard
        title="Builder scorecard" source={ENDPOINTS.scorecard} icon={Wrench} window="last 200 workspaces"
        state={s('scorecard')} onRefresh={() => void load('scorecard')} onStatus={onStatus}
        note="Every workspace on the platform, not only the builds someone reported — the card names its own population. Heal pressure is the 50/50 law as a number: how often the builder had to repair its OWN output, and a heal is a red flag, not a credit. A workaround is counted separately, because it fixed nothing."
      >
        {(d) => (
          <div className="space-y-3">
            {typeof d.headline === 'string' && d.headline ? (
              <p className="text-[12px] text-accent-text font-bold leading-relaxed whitespace-pre-line">{d.headline}</p>
            ) : null}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Stat label="Build success" value={pct(d.success?.rate)} />
              <Stat label="Needed a heal" value={pct(d.heal?.rate)} tone="text-warn" />
              <Stat label="Heals per build" value={num(d.heal?.perBuild, 2)} />
              <Stat label="Worst build" value={num(d.heal?.worst)} />
              <Stat label="Edits survived" value={pct(d.survival?.rate)} />
              <Stat label="Stuck projects" value={num(d.survival?.currentlyBroken)} tone="text-danger" />
              <Stat label="Median build" value={mins(d.time?.median)} />
              <Stat label="Median cost" value={num(d.cost?.median, 2)} />
            </div>
            <p className={NOTE}>
              From {num(d.reportsRead)} stored reports · success measured on {num(d.success?.total)} finished
              builds ({num(d.success?.skipped)} in flight or without a verdict, excluded) ·
              heal pressure on {num(d.heal?.builds)} builds that carry the signal.
            </p>
          </div>
        )}
      </ReportCard>

      <ReportCard
        title="Absorbed losses" source={ENDPOINTS.losses} icon={IndianRupee} window="last 30 days"
        state={s('losses')} onRefresh={() => void load('losses')} onStatus={onStatus}
        note="What 'working app or free' actually costs: builds that were not charged and whose provider cost NavBharatAI paid."
      >
        {(d) => (
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Loss builds" value={num(d.totalLossBuilds)} tone="text-warn" />
            <Stat label="Real cost absorbed" value={usd(d.totalLossRealCostUsd)} tone="text-danger" />
          </div>
        )}
      </ReportCard>

      <ReportCard
        title="Engine usage and margin" source={ENDPOINTS.usage} icon={Activity} window="last 30 days"
        state={s('usage')} onRefresh={() => void load('usage')} onStatus={onStatus}
        note="What the engines really cost against what was billed, priced per model from the rate card."
      >
        {(d) => {
          // FIELD NAMES READ OUT OF `UsageReport` IN `AgentV3CostTelemetry.ts`, NOT GUESSED. The first
          // version of this card looked for `providers`/`rows` and `realCostUsd`; the route returns
          // `perProvider` and `baselineCostUsd`, so every row was missing and every cost was a dash —
          // a card that looked built and showed nothing, which the second absolute rule forbids.
          //
          // 🔴 AND THE SECOND VERSION SHOWED A NUMBER THAT WAS NOT WHAT IT SAID (admin report,
          // 2026-09-23). It led with `marginUsd`, labelled "Margin (at least)", painted RED below
          // zero — and `marginUsd` is `billed − SONNET-equivalent baseline`, i.e. every engine priced
          // at $3.00/$15.00 per MTok whatever it really charged. A 30-day window that charged 18% of
          // Sonnet's price therefore read as a **$1,257 loss**, and the admin sent the report to ask
          // about the loss. The statement was not false — real margin genuinely is ≥ that figure —
          // but a bound that loose carries no information: +$150 and −$1,200 both satisfy it, and
          // `text-danger` asserted a verdict the number could not support. **A vacuous bound must
          // never be displayed as a verdict.** The measured spend now leads; the baseline stays as
          // what it always was, a "vs Sonnet" comparison, and is labelled as one.
          const rows: any[] = Array.isArray(d?.perModel) ? d.perModel : [];
          const provRows: any[] = Array.isArray(d?.perProvider) ? d.perProvider : [];
          const depth: Record<string, unknown> = (d?.byLadderDepth && typeof d.byLadderDepth === 'object')
            ? d.byLadderDepth as Record<string, unknown> : {};
          const depthKeys = Object.keys(depth).sort((a, b) => (a === 'unknown' ? 1 : b === 'unknown' ? -1 : Number(a) - Number(b)));
          const measured = typeof d?.totalRealSpendUsd === 'number';
          const coverage = typeof d?.realCostCoverage === 'number' ? d.realCostCoverage : 0;
          return (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat label="Builds" value={num(d?.totalBuilds)} />
                <Stat label="Billed" value={usd(d?.totalBilledUsd)} />
                <Stat label="Real spend" value={usd(d?.totalRealSpendUsd)} />
                <Stat
                  label="Margin"
                  value={usd(d?.realMarginUsd)}
                  // Coloured ONLY on a measured figure. An unmeasured window shows a dash in the
                  // default ink rather than a reassuring green or an alarming red.
                  tone={typeof d?.realMarginUsd === 'number'
                    ? (d.realMarginUsd < 0 ? 'text-danger' : 'text-success')
                    : undefined}
                />
              </div>
              {!measured ? (
                <p className={NOTE}>
                  No build in this window recorded what it really cost, so spend and margin cannot be
                  shown. Builds have recorded it since 2026-09-23 — this fills in as those days enter
                  the window.
                </p>
              ) : coverage < 0.999 ? (
                <p className={NOTE}>
                  Measured on {num(d?.realCostBuilds)} of {num(d?.totalBuilds)} builds ({pct(coverage)}).
                  The rest are days recorded before the real cost was kept, so the spend above is a
                  PART of the window, not all of it.
                </p>
              ) : null}
              <p className={NOTE}>
                Reference: at the top engine's rate the same tokens would have cost{' '}
                {usd(d?.totalBaselineCostUsd)}, so this window was billed at {pct(d?.marginRatio)} of
                that price ({usd(d?.marginUsd)} against it). A comparison, never our cost.
              </p>
              {rows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-left text-muted">
                        <th className="py-1 pr-2 font-black">Engine</th>
                        <th className="py-1 pr-2 font-black">Model</th>
                        <th className="py-1 pr-2 font-black">Builds</th>
                        <th className="py-1 pr-2 font-black">In</th>
                        <th className="py-1 pr-2 font-black">Cached</th>
                        <th className="py-1 font-black">Out</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 20).map((row, i) => (
                        <tr key={`${row?.provider ?? i}-${row?.model ?? i}`} className="border-t border-line">
                          <td className="py-1 pr-2 text-body font-bold">{String(row?.provider ?? DASH)}</td>
                          <td className="py-1 pr-2 text-muted">{String(row?.model ?? DASH)}</td>
                          <td className="py-1 pr-2 text-muted tabular-nums">{num(row?.builds)}</td>
                          <td className="py-1 pr-2 text-muted tabular-nums">{num(row?.inputTokens)}</td>
                          <td className="py-1 pr-2 text-muted tabular-nums">{num(row?.cacheReadInputTokens)}</td>
                          <td className="py-1 text-muted tabular-nums">{num(row?.outputTokens)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={NOTE}>
                  No build in this window recorded which model answered. The engine column alone
                  cannot price a build — one engine holds rungs 20x apart.
                </p>
              )}
              {/*
                The per-ENGINE rollup, kept beside the per-model table rather than replaced by it.
                ⚠️ MEASURED, not assumed: `theReportsThatWereNeverShown` does NOT prove this section
                renders — it asserts the STRING `perProvider` appears in the file, so renaming the
                variable that holds it leaves the guard green with the table gone. Verified by
                reverting exactly that. The guard's real job is catching a server-side rename, which
                it does; do not cite it as proof that a card still shows something.
              */}
              {provRows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-left text-muted">
                        <th className="py-1 pr-2 font-black">Engine</th>
                        <th className="py-1 pr-2 font-black">Builds</th>
                        <th className="py-1 pr-2 font-black">In</th>
                        <th className="py-1 pr-2 font-black">Out</th>
                        <th className="py-1 font-black">vs top engine</th>
                      </tr>
                    </thead>
                    <tbody>
                      {provRows.slice(0, 20).map((row, i) => (
                        <tr key={`p-${row?.provider ?? i}`} className="border-t border-line">
                          <td className="py-1 pr-2 text-body font-bold">{String(row?.provider ?? DASH)}</td>
                          <td className="py-1 pr-2 text-muted tabular-nums">{num(row?.builds)}</td>
                          <td className="py-1 pr-2 text-muted tabular-nums">{num(row?.inputTokens)}</td>
                          <td className="py-1 pr-2 text-muted tabular-nums">{num(row?.outputTokens)}</td>
                          {/* The reference price, NOT what this engine charged — see the note above. */}
                          <td className="py-1 text-muted tabular-nums">{usd(row?.baselineCostUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {depthKeys.length > 0 ? (
                <p className={NOTE}>
                  Ladder: {depthKeys.map(k => `${k === 'unknown' ? 'unattributed' : `rung ${k}`} ${num(depth[k])}`).join(' · ')}.
                  Rung 1 is the cheapest opener; a build below it fell there or was routed there.
                </p>
              ) : null}
              <p className={NOTE}>
                {d?.fromDate && d?.toDate ? `${d.fromDate} to ${d.toDate} · ` : ''}
                {num(d?.lossBuilds)} build(s) went out free after spending tokens, costing{' '}
                {usd(d?.lossSpendUsd)}. Free-tier and admin builds are counted here too — they are
                free by design, not failures.
              </p>
            </div>
          );
        }}
      </ReportCard>

      <ReportCard
        title="Daily metrics history" source={ENDPOINTS.metrics} icon={Activity} window="last 30 days"
        state={s('metrics')} onRefresh={() => void load('metrics')} onStatus={onStatus}
        note="Persisted daily snapshots — the only record that survives a deploy, and therefore the only place a trend can be read."
      >
        {(d) => {
          const hist: any[] = Array.isArray(d?.history) ? d.history : [];
          const last = hist.length > 0 ? hist[hist.length - 1] : null;
          return (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Days recorded" value={String(hist.length)} />
                <Stat label="Latest day" value={last?.date ? String(last.date) : DASH} />
              </div>
              <p className={NOTE}>Copy for the full series — a trend needs every day, not the last one.</p>
            </div>
          );
        }}
      </ReportCard>

      <ReportCard
        title="Assistant spend" source={ENDPOINTS.assistant} icon={IndianRupee} window="last 14 days"
        state={s('assistant')} onRefresh={() => void load('assistant')} onStatus={onStatus}
        note="What the Professionals, Doctor AI and the other assistants cost — and the share a genuinely free model answered."
      >
        {(d) => {
          // `AssistantSpendSummary` from `AssistantSpendStore.ts`: days[] + a verdict for the newest
          // day that has data. The first version of this card read `totalInr`/`freeShare`/`calls` at
          // the top level — none of which exist — so it showed three dashes on every load.
          const days: any[] = Array.isArray(d?.days) ? d.days : [];
          const today = days[0] ?? null;
          const verdict = d?.today ?? null;
          return (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat label="Free share (today)" value={pct(verdict?.freeShare)} tone="text-success" />
                <Stat label="Turns (today)" value={num(today?.turns)} />
                <Stat label="Real cost (today)" value={usd(today?.realUsd)} />
                <Stat label="Unmeasured turns" value={num(today?.unmeasuredTurns)} tone="text-warn" />
              </div>
              {verdict?.message ? (
                <p className="text-[12px] text-accent-text font-bold leading-relaxed">{verdict.message}</p>
              ) : null}
              <p className={NOTE}>
                {days.length} day(s) recorded. An unmeasured turn is one the engine reported no usage
                for — counted separately, never as a zero.
              </p>
            </div>
          );
        }}
      </ReportCard>

      <h3 className={LABEL}>Platform state</h3>

      <ReportCard
        title="Provider status" source={ENDPOINTS.providers} icon={Server}
        state={s('providers')} onRefresh={() => void load('providers')} onStatus={onStatus}
        note="Per-provider requests, errors, latency and circuit state, since this server started. Admin-only: these are vendor names."
      >
        {(d) => {
          const entries = d && typeof d === 'object' ? Object.entries(d as Record<string, any>) : [];
          return entries.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="py-1 pr-2 font-black">Provider</th>
                    <th className="py-1 pr-2 font-black">Requests</th>
                    <th className="py-1 pr-2 font-black">Errors</th>
                    <th className="py-1 pr-2 font-black">Avg ms</th>
                    <th className="py-1 font-black">Circuit</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.slice(0, 20).map(([name, v]) => (
                    <tr key={name} className="border-t border-line">
                      <td className="py-1 pr-2 text-body font-bold">{name}</td>
                      <td className="py-1 pr-2 text-muted tabular-nums">{num(v?.requestCount)}</td>
                      <td className={`py-1 pr-2 tabular-nums ${Number(v?.errorCount) > 0 ? 'text-danger' : 'text-muted'}`}>
                        {num(v?.errorCount)}
                      </td>
                      <td className="py-1 pr-2 text-muted tabular-nums">{num(v?.avgLatencyMs)}</td>
                      {/* The circuit is the fact that decides whether an engine is being SKIPPED right
                          now — the requests column alone cannot say that. */}
                      <td className={`py-1 font-bold ${v?.circuitState && v.circuitState !== 'closed' ? 'text-danger' : 'text-muted'}`}>
                        {v?.circuitState ? String(v.circuitState) : DASH}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className={NOTE}>No provider has been called since this server started.</p>;
        }}
      </ReportCard>

      <ReportCard
        title="Release gate" source={ENDPOINTS.gate} icon={Shield}
        state={s('gate')} onRefresh={() => void load('gate')} onStatus={onStatus}
        note="Whether releases are frozen, why, and until when. A freeze nobody can see is a freeze nobody can lift."
      >
        {(d) => (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Stat
                label="Frozen" value={d?.config?.frozen ? 'YES' : 'no'}
                tone={d?.config?.frozen ? 'text-danger' : 'text-success'}
              />
              <Stat label="Approval required" value={d?.config?.approvalRequired ? 'YES' : 'no'} />
            </div>
            {d?.config?.freezeReason ? (
              <p className="text-[12px] text-warn font-bold">{String(d.config.freezeReason)}</p>
            ) : null}
          </div>
        )}
      </ReportCard>

      <ReportCard
        title="Persisted feature flags" source={ENDPOINTS.flags} icon={Shield}
        state={s('flags')} onRefresh={() => void load('flags')} onStatus={onStatus}
        note="The flag config that is actually stored, with its rollout percentages and per-user overrides. Cloud Run env keys are separate and are not shown here."
      >
        {(d) => (
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Flags" value={countOf(d?.flags)} />
            <Stat label="Rollouts" value={countOf(d?.rollout)} />
            <Stat label="Overrides" value={countOf(d?.overrides)} />
          </div>
        )}
      </ReportCard>

      <ReportCard
        title="Encryption key version" source={ENDPOINTS.keyVersion} icon={Shield}
        state={s('keyVersion')} onRefresh={() => void load('keyVersion')} onStatus={onStatus}
        note="Which key version the secret vault is writing with. It moves only when keys are rotated."
      >
        {(d) => <div className="grid grid-cols-1 gap-2"><Stat label="Latest key version" value={num(d?.latestKeyVersion)} /></div>}
      </ReportCard>

      <ReportCard
        title="Build event log" source={ENDPOINTS.events} icon={Activity} window="last 100 events"
        state={s('events')} onRefresh={() => void load('events')} onStatus={onStatus}
        note="The per-build agent event trail — what happened, in order. Copy carries every event; the count is only the header."
      >
        {(d) => <div className="grid grid-cols-1 gap-2"><Stat label="Events" value={countOf(d?.events)} /></div>}
      </ReportCard>

      <ReportCard
        title="Published app registry" source={ENDPOINTS.deployments} icon={Server} window="last 100"
        state={s('deployments')} onRefresh={() => void load('deployments')} onStatus={onStatus}
        note="Every published app and its moderation status — active, held or taken down."
      >
        {(d) => <div className="grid grid-cols-1 gap-2"><Stat label="Deployments" value={countOf(d?.deployments)} /></div>}
      </ReportCard>

      <ReportCard
        title="Removal record" source={ENDPOINTS.takedowns} icon={Shield} window="last 200"
        state={s('takedowns')} onRefresh={() => void load('takedowns')} onStatus={onStatus}
        note="What was removed, why, who published it and who decided. This is the record a complaint is answered from."
      >
        {(d) => (
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Rows" value={countOf(d?.rows)} />
            <Stat label="Retention days" value={num(d?.retentionDays)} />
          </div>
        )}
      </ReportCard>

      <ReportCard
        title="Recent announcements" source={ENDPOINTS.announcements} icon={Activity}
        state={s('announcements')} onRefresh={() => void load('announcements')} onStatus={onStatus}
        note="⚠️ Held in this server's memory only — every deploy clears it. The announcements users actually received are durable and separate."
      >
        {(d) => <div className="grid grid-cols-1 gap-2"><Stat label="In memory" value={countOf(d)} /></div>}
      </ReportCard>
    </div>
  );
}

export default EngineReportsPanel;
