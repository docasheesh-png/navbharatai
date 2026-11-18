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
}): React.ReactElement {
  const byFamily = new Map((props.health?.engines ?? []).map((e) => [e.engine, e]));
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="engine-chain">
      {props.chain.map((rung, i) => {
        const h = byFamily.get(engineFamily(rung.name));
        const status: EngineHealthStatus = h?.status ?? 'idle';
        return (
          <React.Fragment key={`${rung.name}-${rung.model ?? ''}-${i}`}>
            {i > 0 && <span className="text-faint text-xs">→</span>}
            <span
              data-testid={`engine-chip-${engineFamily(rung.name)}`}
              title={h ? `${STATUS_LABEL[status]} in the last ${props.health?.windowHours ?? 24} hours` : 'No build used or failed on this engine in the window'}
              className="px-2.5 py-1.5 rounded-lg border border-line bg-well font-mono text-[10px] font-black text-ink"
            >
              {displayName(rung.name, props.names)}
              {rung.model && <span className="text-muted font-normal"> · {rung.model}</span>}
              {h && h.failures > 0 && <span className={`ml-1.5 ${STATUS_TEXT[status]}`}>{h.failures} failed</span>}
              {h && h.failures === 0 && h.delivered > 0 && <span className="ml-1.5 text-success">OK</span>}
            </span>
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
