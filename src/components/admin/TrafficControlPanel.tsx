import { useCallback, useEffect, useState } from 'react';
import { adminFailed, adminGet, adminHeaders } from '../../lib/adminFetch';
import {
  editableBody, isSloView, isTrafficControlView, saveProblem, sloText, type SloView,
  type ControlBodyView, type RouteState, type SurfaceMode, type TrafficControlView,
} from '../../lib/trafficControlView';

/**
 * Admin → AI Engines → Traffic control (Traffic Manager V2, P2, owner-approved 2026-11-17). Every control here can
 * only NARROW what the deployment already does: send the gateway (or one surface) back to its legacy path, or stop
 * new requests reaching a provider or model. Requests already running finish on the path they started. Every save is
 * a new audited revision and needs a reason plus a fresh authenticator code.
 */
export function TrafficControlPanel({ adminToken }: { adminToken: string }) {
  const [data, setData] = useState<TrafficControlView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ControlBodyView | null>(null);
  const [reason, setReason] = useState('');
  const [totp, setTotp] = useState('');
  const [rollbackTo, setRollbackTo] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await adminGet<unknown>('/api/admin/traffic-control', { token: adminToken });
    if (adminFailed(r)) { setError(r.message); return; }
    if (!isTrafficControlView(r.data)) { setError('The server answered in a shape this screen does not know. Nothing is confirmed on or off.'); return; }
    setError(null); setData(r.data); setDraft(editableBody(r.data));
  }, [adminToken]);
  useEffect(() => { void load(); }, [load]);
  const [slo, setSlo] = useState<SloView | null>(null);
  const [sloError, setSloError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const r = await adminGet<unknown>('/api/admin/traffic-control/slo', { token: adminToken });
      if (adminFailed(r)) { setSloError(r.message); return; }
      if (!isSloView(r.data)) { setSloError('The reliability numbers came back in a shape this screen does not know.'); return; }
      setSlo(r.data);
    })();
  }, [adminToken]);

  const send = async (path: string, payload: Record<string, unknown>, success: string) => {
    if (!data) return;
    const problem = saveProblem(reason, totp);
    if (problem) { setSaveError(problem); return; }
    setSaving(true); setSaveError(null);
    try {
      const res = await fetch(path, { method: 'POST', headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, expectedRevision: data.current?.revision ?? 0, reason: reason.trim(), totp: totp.trim() }) });
      const b = await res.json().catch(() => null) as { error?: unknown; revision?: unknown } | null;
      if (!res.ok) { setSaveError(typeof b?.error === 'string' ? b.error : `Could not save (HTTP ${res.status}).`); return; }
      if (!b || !Number.isInteger(b.revision)) { setSaveError('The server answered in a shape this screen does not know. Reload to see what was saved.'); return; }
      setDone(`${success} Saved as revision ${b.revision}. Other servers apply it within about a minute.`);
      setReason(''); setTotp(''); setRollbackTo(null);
      await load();
    } catch { setSaveError('Could not reach the server. Nothing was changed.'); }
    finally { setSaving(false); }
  };

  return (
    <>
    <TrafficControlBody data={data} error={error} draft={draft} reason={reason} totp={totp} rollbackTo={rollbackTo}
      saving={saving} saveError={saveError} done={done}
      onDraft={(d) => { setDraft(d); setDone(null); }} onReason={setReason} onTotp={setTotp}
      onRollbackPick={(r) => { setRollbackTo(r); setSaveError(null); setDone(null); }}
      onSave={() => { if (draft) void send('/api/admin/traffic-control', { body: draft }, 'Controls updated.'); }}
      onRollback={() => { if (rollbackTo) void send('/api/admin/traffic-control/rollback', { targetRevision: rollbackTo }, `Rolled back to revision ${rollbackTo}.`); }}
      onReset={() => { if (data) setDraft(editableBody(data)); setSaveError(null); }} />
    <ReliabilityBody slo={slo} error={sloError} />
    </>
  );
}

/** Reliability over 7 days, from complete counters: rate, 95% interval, denominator, target. Pure props. */
export function ReliabilityBody({ slo, error }: { slo: SloView | null; error: string | null }) {
  return (
    <section className="mt-3 space-y-2 rounded-md border border-line bg-surface p-4" aria-labelledby="reliability-title" data-testid="traffic-reliability">
      <h3 id="reliability-title" className="text-base font-semibold text-ink">Reliability (last 7 days)</h3>
      <p className="text-xs text-muted">Counted from every request on every server, not from a sample. Eligible = answered or failed; refusals for policy and requests the person cancelled are not counted either way.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {slo && slo.slo.length === 0 && <p className="text-sm text-muted">No requests counted yet. Numbers appear within a minute of the first chat.</p>}
      {slo && slo.slo.map((r) => (
        <p key={r.surface} className="text-sm text-ink">
          <strong>{r.surface}</strong>: {sloText(r)}
          {r.target !== null && r.rate !== null && r.eligible > 0 && (
            <span className={r.rate >= r.target ? 'text-success' : 'text-danger'}> · target {(r.target * 100).toFixed(1)}% {r.rate >= r.target ? 'met' : 'not met'}</span>
          )}
        </p>
      ))}
      {slo && slo.recentFailures.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-ink">Recent failures ({slo.recentFailures.length})</summary>
          <ul className="mt-1 space-y-1">
            {slo.recentFailures.map((f, i) => (
              <li key={i} className="text-xs text-muted">{new Date(f.atMs).toLocaleString()} · {f.surface} via {f.path} · {f.outcome}{f.failure ? ` (${f.failure})` : ''} · {f.provider}/{f.model} · {f.attempts} attempt(s)</li>
            ))}
          </ul>
        </details>
      )}
      {slo && slo.sink.dropped > 0 && <p className="text-xs text-danger">{slo.sink.dropped} decision record(s) were dropped on this server because the write buffer was full. Counts are unaffected.</p>}
    </section>
  );
}

const STATES: Array<RouteState | 'default'> = ['default', 'enabled', 'draining', 'disabled'];
const PATH_LABELS: Record<string, string> = { 'free-chain': 'Free Chat chain', 'chat-router': 'Chat router', builder: 'Pro builder', vision: 'Image and PDF reading', image: 'Image generation' };
const fmt = (t: number | null | undefined) => (t ? new Date(t).toLocaleString() : 'never');

/** The panel's markup: pure props, so static render tests read exactly what the admin sees. */
export function TrafficControlBody(props: {
  data: TrafficControlView | null; error: string | null; draft: ControlBodyView | null; reason: string; totp: string;
  rollbackTo: number | null; saving: boolean; saveError: string | null; done: string | null;
  onDraft: (d: ControlBodyView) => void; onReason: (v: string) => void; onTotp: (v: string) => void;
  onRollbackPick: (r: number | null) => void; onSave: () => void; onRollback: () => void; onReset: () => void;
}) {
  const { data, error, draft } = props;
  const covered = (data?.paths ?? []).filter((p) => draft?.coverage?.[p] === true);
  const changed = !!data && !!draft && JSON.stringify(draft) !== JSON.stringify(editableBody(data));
  const setRoute = (kind: 'providers' | 'models', key: string, state: RouteState | 'default', cap?: number) => {
    if (!draft) return;
    const next = { ...draft[kind] };
    if (state === 'default') delete next[key];
    else next[key] = { ...(next[key] ?? {}), state, trafficCapPct: cap ?? next[key]?.trafficCapPct ?? 100 };
    props.onDraft({ ...draft, [kind]: next });
  };
  const confirm = (label: string, onGo: () => void) => (
    <form className="mt-2 space-y-2 rounded-md border border-line p-3" data-testid="traffic-control-confirm" onSubmit={(e) => { e.preventDefault(); onGo(); }}>
      <label className="block text-xs text-muted" htmlFor="traffic-reason">Reason (required, kept in the audit log)</label>
      <input id="traffic-reason" value={props.reason} maxLength={300} onChange={(e) => props.onReason(e.target.value)}
        className="w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink" placeholder="e.g. provider outage, drain before removal" />
      <label className="block text-xs text-muted" htmlFor="traffic-totp">Authenticator code</label>
      <input id="traffic-totp" value={props.totp} inputMode="numeric" autoComplete="one-time-code" maxLength={6} onChange={(e) => props.onTotp(e.target.value)}
        className="w-32 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink" placeholder="123456" />
      <button type="submit" disabled={props.saving} className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-on-accent disabled:opacity-50">
        {props.saving ? 'Saving…' : label}
      </button>
      {props.saveError && <p role="alert" className="text-xs text-danger" data-testid="traffic-control-error">{props.saveError}</p>}
    </form>
  );
  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-4" aria-labelledby="traffic-control-title">
      <div>
        <h3 id="traffic-control-title" className="text-base font-semibold text-ink">Traffic control</h3>
        <p className="text-sm text-muted">
          Emergency and routing switches for the AI gateway. They can only take traffic away: send the gateway, or one surface, back to its
          older path, or stop new requests reaching a provider or model. Requests already running finish where they started.
        </p>
        {covered.length === 0 ? (
          <p className="text-sm text-ink" data-testid="traffic-control-scope">
            <strong>Applies to gateway-managed requests only.</strong> The older routing paths (the Free Chat chain, the chat router and the
            Pro builder) do not read these switches unless you turn them on under Older routing paths below. To stop a provider everywhere, use AI provider switches above.
          </p>
        ) : (
          <p className="text-sm text-ink" data-testid="traffic-control-scope">
            <strong>Provider drain and disable apply to the gateway and to: {covered.map((p) => PATH_LABELS[p] ?? p).join(', ')}.</strong> Traffic caps and the
            Gateway Emergency OFF still apply to gateway-managed requests only.
          </p>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {props.done && <p role="status" className="text-sm font-medium text-success" data-testid="traffic-control-done">{props.done}</p>}
      {data && draft && (
        <>
          <p className="text-xs text-muted" data-testid="traffic-control-sync">
            Saved revision {data.current?.revision ?? 'none (nothing narrowed)'}. This server enforces revision {data.thisInstance.enforcingRevision || 'none'},
            last read {fmt(data.thisInstance.lastReadAtMs)}{data.thisInstance.lastReadOk ? '' : ' (the last read failed; the previous state is kept)'}.
          </p>
          <div className="flex items-center justify-between gap-3 rounded-md border border-line p-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">Gateway Emergency OFF</p>
              <p className="text-xs text-muted">{draft.global.gateway === 'on'
                ? 'Gateway on: surfaces follow the deployment settings.'
                : 'Gateway OFF: every gateway surface uses its older path. Older paths that never used the gateway are not changed.'}</p>
            </div>
            <button type="button" role="switch" aria-checked={draft.global.gateway === 'on'} aria-label={`Gateway Emergency OFF switch: gateway is ${draft.global.gateway}`}
              data-testid="traffic-control-global" onClick={() => props.onDraft({ ...draft, global: { gateway: draft.global.gateway === 'on' ? 'off' : 'on' } })}
              className={`relative h-6 w-11 shrink-0 rounded-full border border-line ${draft.global.gateway === 'on' ? 'bg-success' : 'bg-danger/40'}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface transition-all ${draft.global.gateway === 'on' ? 'left-5' : 'left-0.5'}`} />
            </button>
          </div>
          <fieldset className="space-y-1 rounded-md border border-line p-2">
            <legend className="text-sm font-medium text-ink">Surfaces</legend>
            {data.surfaces.map((s) => (
              <label key={s} className="flex items-center justify-between gap-2 text-sm text-ink">
                <span>{s}</span>
                <select value={draft.surfaces[s] ?? 'env'} data-testid={`traffic-surface-${s}`}
                  onChange={(e) => { const next = { ...draft.surfaces }; if (e.target.value === 'env') delete next[s]; else next[s] = e.target.value as SurfaceMode; props.onDraft({ ...draft, surfaces: next }); }}
                  className="rounded-md border border-line bg-surface px-1 text-sm text-ink">
                  <option value="env">Follow deployment</option>
                  <option value="legacy">Older path</option>
                </select>
              </label>
            ))}
          </fieldset>
          {(data.paths ?? []).length > 0 && (
            <fieldset className="space-y-1 rounded-md border border-line p-2" data-testid="traffic-control-paths">
              <legend className="text-sm font-medium text-ink">Older routing paths</legend>
              <p className="text-xs text-muted">When on, that path skips a provider you drained or disabled below and moves to its next rung. Nothing is added or reordered, and the Pro builder never leaves the selected tier. Turn it off again to roll back.</p>
              {(data.paths ?? []).map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={draft.coverage?.[p] === true} data-testid={`traffic-path-${p}`}
                    onChange={(e) => { const next = { ...(draft.coverage ?? {}) }; if (e.target.checked) next[p] = true; else delete next[p];
                      const { coverage: _old, ...rest } = draft; props.onDraft(Object.keys(next).length ? { ...rest, coverage: next } : rest); }} />
                  {PATH_LABELS[p] ?? p} obeys provider drain and disable
                </label>
              ))}
            </fieldset>
          )}
          <details>
            <summary className="cursor-pointer text-sm text-ink">Providers ({data.providers.length}) · {covered.length ? 'gateway and covered paths' : 'gateway-managed requests only'}</summary>
            <p className="mt-1 text-xs text-muted">Drain, disable and traffic caps here stop new gateway requests only. The older paths still call the provider until it is switched off under AI provider switches.</p>
            <ul className="mt-1 divide-y divide-line rounded-md border border-line">
              {data.providers.map((p) => {
                const c = draft.providers[p.id];
                return (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm text-ink" data-testid={`traffic-provider-${p.id}`}>
                    <span className="min-w-0">{p.name} <span className="text-xs text-muted">({p.kind})</span></span>
                    <span className="flex items-center gap-2">
                      <select aria-label={`${p.name} state`} value={c?.state ?? 'default'} onChange={(e) => setRoute('providers', p.id, e.target.value as RouteState | 'default')}
                        className="rounded-md border border-line bg-surface px-1 text-sm text-ink">
                        {STATES.map((s) => <option key={s} value={s}>{s === 'default' ? 'No change' : s}</option>)}
                      </select>
                      {c && <input aria-label={`${p.name} traffic cap percent`} type="number" min={0} max={100} value={c.trafficCapPct}
                        onChange={(e) => setRoute('providers', p.id, c.state, Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))))}
                        className="w-16 rounded-md border border-line bg-surface px-1 text-sm text-ink" />}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
          <details>
            <summary className="cursor-pointer text-sm text-ink">Models ({data.models.length}) · gateway-managed requests only</summary>
            <ul className="mt-1 divide-y divide-line rounded-md border border-line">
              {data.models.map((m) => {
                const c = draft.models[m.key];
                const adm = data.admission[m.key];
                return (
                  <li key={m.key} className="space-y-1 p-2 text-sm text-ink" data-testid={`traffic-model-${m.key}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 break-all">{m.key}</span>
                      <select aria-label={`${m.key} state`} value={c?.state ?? 'default'} onChange={(e) => setRoute('models', m.key, e.target.value as RouteState | 'default')}
                        className="rounded-md border border-line bg-surface px-1 text-sm text-ink">
                        {STATES.map((s) => <option key={s} value={s}>{s === 'default' ? 'No change' : s}</option>)}
                      </select>
                    </div>
                    <p className="text-xs text-muted">Shares outages with: {m.dependsOn.join(', ')}</p>
                    {adm && <p className="text-xs text-muted">Admission {adm.required ? 'required' : 'observed only'}: {adm.gaps.length ? `missing ${adm.gaps.join(', ')}` : 'complete'}</p>}
                  </li>
                );
              })}
            </ul>
          </details>
          {data.sharedHealth && (
            <details data-testid="traffic-shared-health">
              <summary className="cursor-pointer text-sm text-ink">Shared provider health ({data.sharedHealth.mode === 'on' ? 'acting on reports' : data.sharedHealth.mode === 'observe' ? 'observe only' : 'off'})</summary>
              <p className="mt-1 text-xs text-muted">
                {data.sharedHealth.mode === 'observe'
                  ? 'Servers share which providers they found down or out of balance. Shown here only: no server skips a provider because another one reported it.'
                  : data.sharedHealth.mode === 'on' ? 'Servers share which providers they found down, and skip a provider another server reported, until it recovers.'
                  : 'Sharing is off on this server.'}
                {' '}Last read {fmt(data.sharedHealth.lastPullAtMs)}{data.sharedHealth.lastPullOk ? '' : ' (the last read failed)'}.
              </p>
              {data.sharedHealth.families.map((f) => (
                <p key={f.domain} className="text-xs font-medium text-danger">Suspected shared outage: {f.domain} ({f.providers.join(', ')} are down). Shown only; nothing is suppressed.</p>
              ))}
              <ul className="mt-1 space-y-1">
                {data.sharedHealth.reported.map((r) => (
                  <li key={r.provider} className="text-xs text-muted">{r.provider}: {r.state} ({r.kind}), {fmt(r.atMs)}</li>
                ))}
                {data.sharedHealth.reported.length === 0 && <li className="text-xs text-muted">No other server has reported a problem in the last 15 minutes.</li>}
              </ul>
            </details>
          )}
          {changed && (
            <div className="space-y-1">
              <p className="text-sm text-ink">You have unsaved changes.</p>
              <button type="button" onClick={props.onReset} className="text-sm text-muted underline">Discard changes</button>
              {confirm('Save as a new revision', props.onSave)}
            </div>
          )}
          {data.history.revisions.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm text-ink">Revisions and audit log</summary>
              <ul className="mt-1 space-y-1">
                {data.history.revisions.map((r) => (
                  <li key={r.revision} className="text-xs text-muted">
                    r{r.revision} · {fmt(r.updatedAtMs)} · {r.actor}: {r.reason}
                    {data.current && r.revision < data.current.revision && (
                      <button type="button" className="ml-2 text-accent underline" onClick={() => props.onRollbackPick(r.revision)}>Roll back to this</button>
                    )}
                  </li>
                ))}
              </ul>
              {props.rollbackTo !== null && confirm(`Roll back to revision ${props.rollbackTo}`, props.onRollback)}
              <ul className="mt-2 space-y-1">
                {data.history.audit.map((a, i) => (
                  <li key={i} className="text-xs text-muted">{fmt(a.atMs)} · {a.actor} · r{a.fromRevision}→r{a.toRevision} ({a.kind}): {a.changes.join('; ')}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
