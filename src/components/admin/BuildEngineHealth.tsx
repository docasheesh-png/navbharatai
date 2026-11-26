/**
 * The AI Engines page's live engine view (owner 2026-11-17: "jo ai/provider use ho rahe hai, wahi dikhen chahiye,
 * aur yeh live rahe, kon se provider fail ho raha kyu fail ho raha likh kar aye, admin ko saf dikhe").
 *
 * `EngineChain` draws the WHOLE chain a build of one tier tries, in order, including the engines in front of the
 * tier ladder (Surplus, Router One, BluesMinds, Moyi), each coloured by its last-24-hour health.
 * `EngineHealthList` says, per engine, how many build turns it delivered, how many calls failed, and why, in plain
 * words. Both render only what the server measured: an unread value is shown as unread, never as "healthy".
 */
import React from 'react';
import type { EngineDayRow, EngineDays } from '../../lib/engineDays';

export type EngineHealthStatus = 'working' | 'degraded' | 'failing' | 'idle';
export interface EngineHealthRow {
  engine: string;
  delivered: number;
  failures: number;
  builds: number;
  reasons: Array<{ code: string; count: number; text: string }>;
  lastFailureAt: number | null;
  status: EngineHealthStatus;
}
export interface EngineHealthData { windowHours: number; buildsRead: number; engines: EngineHealthRow[] }

/** `GLM#2` → `GLM`: the pool suffix is not a different engine. */
export function engineFamily(name: string): string {
  return String(name ?? '').trim().toUpperCase().replace(/#\d+$/, '');
}

const STATUS_LABEL: Record<EngineHealthStatus, string> = {
  working: 'Working', degraded: 'Some failures', failing: 'Failing', idle: 'No recent use',
};
const STATUS_TEXT: Record<EngineHealthStatus, string> = {
  working: 'text-success', degraded: 'text-warn', failing: 'text-danger', idle: 'text-muted',
};

function displayName(engine: string, names: Record<string, string> | undefined): string {
  const family = engineFamily(engine);
  return names?.[family] ?? family;
}

function ago(at: number | null, now: number): string {
  if (!at) return '';
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} h ago`;
}

export function EngineChain(props: {
  chain: Array<{ name: string; model: string | null }>;
  health: EngineHealthData | null | undefined;
  names: Record<string, string> | undefined;
  /** Today's per-engine stats (admin 2026-11-25: "per day fail"). When given, the chip counts TODAY, not 24 h. */
  days?: EngineDays;
  /** Tap an engine to see its per-day detail. */
  onPick?: (engine: string) => void;
  picked?: string | null;
}): React.ReactElement {
  const byFamily = new Map((props.health?.engines ?? []).map((e) => [e.engine, e]));
  const today = props.days?.days?.[0];
  const todayBy = new Map((today?.engines ?? []).map((e) => [e.engine, e]));
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="engine-chain">
      {props.chain.map((rung, i) => {
        const fam = engineFamily(rung.name);
        const h = byFamily.get(fam);
        const status: EngineHealthStatus = h?.status ?? 'idle';
        const d = todayBy.get(fam);
        const perDay = !!props.days?.days;
        const chipClass = `px-2.5 py-1.5 rounded-lg border bg-well font-mono text-[10px] font-black text-ink text-left ${props.picked === fam ? 'border-accent-text' : 'border-line'}`;
        const body = (
          <>
            {displayName(rung.name, props.names)}
            {rung.model && <span className="text-muted font-normal"> · {rung.model}</span>}
            {perDay ? (
              <>
                {d && d.failed > 0 && <span className="ml-1.5 text-danger">{d.failed} failed today</span>}
                {d && d.failed === 0 && d.answered > 0 && <span className="ml-1.5 text-success">OK today</span>}
              </>
            ) : (
              <>
                {h && h.failures > 0 && <span className={`ml-1.5 ${STATUS_TEXT[status]}`}>{h.failures} failed</span>}
                {h && h.failures === 0 && h.delivered > 0 && <span className="ml-1.5 text-success">OK</span>}
              </>
            )}
          </>
        );
        return (
          <React.Fragment key={`${rung.name}-${rung.model ?? ''}-${i}`}>
            {i > 0 && <span className="text-faint text-xs">→</span>}
            {props.onPick ? (
              <button type="button" data-testid={`engine-chip-${fam}`} aria-pressed={props.picked === fam}
                title={`Show ${displayName(rung.name, props.names)}: requests, answers, failures and average time, per day`}
                onClick={() => props.onPick?.(fam)} className={chipClass}>{body}</button>
            ) : (
              <span data-testid={`engine-chip-${fam}`}
                title={h ? `${STATUS_LABEL[status]} in the last ${props.health?.windowHours ?? 24} hours` : 'No build used or failed on this engine in the window'}
                className={chipClass}>{body}</span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function EngineHealthList(props: {
  health: EngineHealthData | null | undefined;
  names: Record<string, string> | undefined;
  now?: number;
}): React.ReactElement {
  const now = props.now ?? Date.now();
  if (props.health === undefined) return <></>;
  if (props.health === null) {
    return <p className="text-xs text-warn" data-testid="engine-health-unread">Engine health could not be read right now. This is not the same as “no failures”.</p>;
  }
  const { engines, windowHours, buildsRead } = props.health;
  return (
    <div className="space-y-2" data-testid="engine-health">
      <div>
        <h4 className="text-[11px] font-black uppercase tracking-widest text-ink">Engine health — last {windowHours} hours</h4>
        <p className="text-[10px] text-muted">
          From the latest build of {buildsRead} project{buildsRead === 1 ? '' : 's'} saved in that time, on every server. Updates every minute while this page is open.
        </p>
      </div>
      {engines.length === 0 ? (
        <p className="text-xs text-muted">No build recorded an engine turn or failure in this window.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {engines.map((e) => (
            <li key={e.engine} className="p-3 space-y-1" data-testid={`engine-health-${e.engine}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-bold text-ink">{displayName(e.engine, props.names)}</span>
                <span className={`text-[10px] font-black uppercase ${STATUS_TEXT[e.status]}`}>{STATUS_LABEL[e.status]}</span>
              </div>
              <p className="text-xs text-muted">
                {e.delivered} turn{e.delivered === 1 ? '' : 's'} delivered · {e.failures} failed call{e.failures === 1 ? '' : 's'} · in {e.builds} build{e.builds === 1 ? '' : 's'}
                {e.lastFailureAt ? ` · last failure ${ago(e.lastFailureAt, now)}` : ''}
              </p>
              {e.reasons.length > 0 && (
                <ul className="space-y-0.5">
                  {e.reasons.slice(0, 4).map((r) => (
                    <li key={r.code} className={`text-xs ${e.status === 'failing' ? 'text-danger' : 'text-warn'}`}>
                      {r.count}× {r.text}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function seconds(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`;
}

/**
 * One engine, per day (admin 2026-11-25: "kitne request gayi, kitne response aye, kitni der me aye (avg) aur kitne fail
 * huye … fallback system kam kyu nahi kiya woh bhi likh kar ana chahiye"). Only what builds recorded; a day the server
 * could not read says so.
 */
export function EngineDayDetail(props: {
  engine: string;
  days: EngineDays | undefined;
  names: Record<string, string> | undefined;
  onClose?: () => void;
}): React.ReactElement {
  const name = displayName(props.engine, props.names);
  const close = props.onClose && (
    <button type="button" onClick={props.onClose} className="text-[10px] font-black uppercase text-muted">Close</button>
  );
  if (!props.days || props.days.days === null) {
    return (
      <div className="rounded-xl border border-line p-3 space-y-1" data-testid="engine-day-detail">
        <div className="flex items-center justify-between"><span className="text-sm font-bold text-ink">{name}</span>{close}</div>
        <p className="text-xs text-warn">The per-day numbers could not be read right now. This is not the same as “nothing ran”.</p>
      </div>
    );
  }
  const rows = props.days.days.map((d) => ({ day: d.day, r: d.engines.find((e) => e.engine === props.engine) as EngineDayRow | undefined }));
  const reasons: Record<string, number> = {};
  const carried: Record<string, number> = {};
  for (const { r } of rows) {
    for (const [k, v] of Object.entries(r?.reasons ?? {})) reasons[k] = (reasons[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r?.carriedBy ?? {})) carried[k] = (carried[k] ?? 0) + v;
  }
  const failedTotal = rows.reduce((a, { r }) => a + (r?.failed ?? 0), 0);
  return (
    <div className="rounded-xl border border-line p-3 space-y-3" data-testid="engine-day-detail">
      <div className="flex items-center justify-between"><span className="text-sm font-bold text-ink">{name} — last {rows.length} days (UTC)</span>{close}</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted text-left">
            <th className="font-bold py-1">Day</th><th className="font-bold">Requests</th><th className="font-bold">Answered</th>
            <th className="font-bold">Failed</th><th className="font-bold">Avg answer time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ day, r }) => (
            <tr key={day} className="border-t border-line text-ink" data-testid={`engine-day-${day}`}>
              <td className="py-1 font-mono">{day}</td>
              <td>{r?.requests ?? 0}</td>
              <td className={r && r.answered > 0 ? 'text-success' : ''}>{r?.answered ?? 0}</td>
              <td className={r && r.failed > 0 ? 'text-danger' : ''}>{r?.failed ?? 0}</td>
              <td>{r ? seconds(r.avgAnswerMs) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-1">
        <p className="text-[11px] font-black uppercase tracking-widest text-ink">Why it failed</p>
        {failedTotal === 0 ? <p className="text-xs text-muted">No failure recorded in these days.</p> : (
          <ul className="space-y-0.5" data-testid="engine-day-reasons">
            {Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([code, count]) => (
              <li key={code} className="text-xs text-warn">{count}× {props.days?.reasonText[code] ?? code} <span className="text-faint font-mono">({code})</span></li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-1">
        <p className="text-[11px] font-black uppercase tracking-widest text-ink">What happened when it failed</p>
        {Object.keys(carried).length === 0 ? (
          <p className="text-xs text-muted">{failedTotal === 0 ? 'Nothing needed to take over.' : 'No other engine is recorded as answering those turns — the turn was retried on this engine, or the build stopped first.'}</p>
        ) : (
          <ul className="space-y-0.5" data-testid="engine-day-carried">
            {Object.entries(carried).sort((a, b) => b[1] - a[1]).map(([to, count]) => (
              <li key={to} className="text-xs text-ink">{displayName(to, props.names)} answered {count} turn{count === 1 ? '' : 's'} instead.</li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[10px] text-faint">Counted at the end of every build. A build whose server was lost before it finished is not counted. Requests = answered turns + failed attempts.</p>
    </div>
  );
}
