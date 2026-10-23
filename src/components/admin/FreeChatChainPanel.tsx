import React, { useCallback, useEffect, useRef, useState } from 'react';
import { adminHeaders } from '../../lib/adminFetch';
import {
  freeChainBudgetFingerprint, freeChainControlFingerprint, freeChainControls, freeChainPercent, freeChainProviderLabel, freeChainProviderTier, freeChainTimestamp, freeChainUsd,
  FREE_CHAIN_METRICS_SCAN_LIMIT, FREE_CHAIN_MAX_PAID_CAP_USD, isFreeChainBudgetResponse, validFreeChainBudgetUsd, isFreeChainAdminMetrics, isFreeChainAdminView, validFreeChainReason, type FreeChainAdminMetrics, type FreeChainAdminView, type FreeChainControlAction,
} from '../../lib/freeChatChainView';

const ROOT = '/api/v1/admin/free-chat-chain';
const button = 'min-h-11 rounded-lg border border-line px-3 py-2 text-sm text-ink disabled:opacity-40';
const input = 'min-h-11 rounded-lg border border-line bg-well px-3 py-2 text-sm text-ink';
type Change = Pick<FreeChainControlAction, 'enabled' | 'rolloutPercent' | 'disabledProviders'>;
type Pending = { title: string; description: string; fingerprint: string } & ({ kind: 'control'; change: Change; expectedControls: FreeChainControlAction['expectedControls'] } | { kind: 'budget'; capUsd: number; expectedRevision: number });
const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

/** Saved server observations only. Opening or refreshing this screen never calls a model. */
export function FreeChatChainPanel({ adminToken }: { adminToken: string }): React.ReactElement {
  const [view, setView] = useState<FreeChainAdminView | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const [rollout, setRollout] = useState('');
  const [budget, setBudget] = useState('');
  const [now, setNow] = useState(Date.now);
  const [metrics, setMetrics] = useState<FreeChainAdminMetrics | null>(null);
  const [metricsError, setMetricsError] = useState('');
  const [metricsLoading, setMetricsLoading] = useState(false);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const mutationLock = useRef(false);
  const readRequest = useRef<AbortController | null>(null);
  const writeRequest = useRef<AbortController | null>(null);
  const metricsRequest = useRef<AbortController | null>(null);
  const metricsEpoch = useRef(0);
  const metricsLock = useRef(false);

  const load = useCallback(async () => {
    if (!visible()) return;
    const generation = ++epoch.current;
    readRequest.current?.abort();
    const controller = new AbortController(); readRequest.current = controller;
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
    setLoading(true);
    try {
      const response = await fetch(ROOT, { headers: adminHeaders(adminToken), signal: controller.signal });
      const body: unknown = await response.json();
      if (!mounted.current || generation !== epoch.current) return;
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Admin sign-in or authorization required.' : `Chain status read failed (HTTP ${response.status}).`);
      if (!isFreeChainAdminView(body)) throw new Error('Chain status is incomplete or unreadable. No usage or routing health can be confirmed.');
      setView(body); setError(''); setNow(Date.now());
    } catch (e) {
      if (mounted.current && generation === epoch.current && (!controller.signal.aborted || timedOut)) {
        setError(timedOut ? 'Chain status read timed out. Refresh to verify its current state.' : e instanceof Error ? e.message : 'Could not read chain status.');
      }
    } finally {
      clearTimeout(deadline);
      if (mounted.current && generation === epoch.current) setLoading(false);
    }
  }, [adminToken]);

  // Deliberate button action only: never called by mount, polling, focus or controls.
  const loadMetrics = useCallback(async () => {
    if (metricsLock.current || !visible()) return;
    metricsLock.current = true;
    const generation = ++metricsEpoch.current;
    const controller = new AbortController(); metricsRequest.current = controller;
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
    setMetricsLoading(true); setMetricsError('');
    try {
      const response = await fetch(`${ROOT}/metrics`, { headers: adminHeaders(adminToken), signal: controller.signal });
      const body: unknown = await response.json();
      if (!mounted.current || generation !== metricsEpoch.current) return;
      if (controller.signal.aborted) throw new Error('Sampled metrics request was aborted.');
      if (!response.ok) throw new Error(response.status === 429 ? 'Refresh limit reached. Wait one minute before requesting another scan.' : response.status === 401 || response.status === 403 ? 'Admin sign-in or authorization required.' : `Sampled metrics read failed (HTTP ${response.status}).`);
      if (!isFreeChainAdminMetrics(body)) throw new Error('Sampled metrics are incomplete or unreadable.');
      setMetrics(body); setNow(Date.now());
    } catch (e) {
      if (mounted.current && generation === metricsEpoch.current && (!controller.signal.aborted || timedOut)) {
        setMetricsError(timedOut ? 'Sampled metrics read timed out. No automatic retry was made.' : e instanceof Error ? e.message : 'Could not read sampled metrics.');
      }
    } finally {
      clearTimeout(deadline);
      if (generation === metricsEpoch.current) {
        metricsLock.current = false;
        if (mounted.current) setMetricsLoading(false);
      }
    }
  }, [adminToken]);

  useEffect(() => {
    mounted.current = true; setView(null); setPending(null); setError(''); setNotice(''); setRollout(''); setBudget('');
    setMetrics(null); setMetricsError(''); setMetricsLoading(false); metricsLock.current = false;
    void load();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const refresh = setInterval(() => { if (visible() && !mutationLock.current) void load(); }, 30_000);
    const visibilityChanged = () => {
      if (!visible() && !mutationLock.current) { epoch.current++; readRequest.current?.abort(); setLoading(false); }
      else if (visible() && !mutationLock.current) void load();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      mounted.current = false; epoch.current++; metricsEpoch.current++;
      readRequest.current?.abort(); writeRequest.current?.abort(); metricsRequest.current?.abort(); clearInterval(tick); clearInterval(refresh);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [load]);

  const staleReview = !!view && !!pending && pending.fingerprint !== (pending.kind === 'budget' ? freeChainBudgetFingerprint(view) : freeChainControlFingerprint(view));
  const controlsBlocked = busy || loading || !!error || !view;
  const validAction = !!pending && validFreeChainReason(reason) && !controlsBlocked && !staleReview;
  const review = (title: string, description: string, change: Change) => {
    if (controlsBlocked || !view) return;
    setPending({ kind: 'control', title, description, change, fingerprint: freeChainControlFingerprint(view), expectedControls: freeChainControls(view) });
    setReason(''); setNotice('');
  };
  const mutate = async () => {
    if (!validAction || !pending || mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setError(''); setNotice('');
    const generation = ++epoch.current;
    readRequest.current?.abort(); setLoading(false);
    const controller = new AbortController(); writeRequest.current = controller;
    const deadline = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(pending.kind === 'budget' ? `${ROOT}/budget` : `${ROOT}/control`, {
        method: 'POST', headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' },
        body: JSON.stringify(pending.kind === 'budget' ? { capUsd: pending.capUsd, expectedRevision: pending.expectedRevision, reason: reason.trim() } : { ...pending.change, reason: reason.trim(), expectedControls: pending.expectedControls }), signal: controller.signal,
      });
      const body: unknown = await response.json();
      if (!mounted.current || generation !== epoch.current) return;
      if (controller.signal.aborted) throw new Error('Control timed out; its outcome is uncertain.');
      if (!response.ok) {
        if (response.status === 409) { setPending(null); throw new Error('Chain controls changed during review. Refresh and review the current settings.'); }
        throw new Error(response.status === 401 || response.status === 403 ? 'Admin sign-in or authorization required.' : `Control was not confirmed (HTTP ${response.status}).`);
      }
      if (pending.kind === 'budget' && (!isFreeChainBudgetResponse(body) || body.capUsd !== pending.capUsd || body.policyRevision <= pending.expectedRevision)) throw new Error('The budget response was unreadable.');
      if (!body || typeof body !== 'object' || !('ok' in body) || body.ok !== true) throw new Error('The control response was unreadable.');
      setPending(null); setRollout(''); setBudget(''); setNotice(pending.kind === 'budget' ? 'Budget control recorded. Existing holds remain; this does not refund or cancel already-dispatched work. A stricter deployment revision may lower the cap again.' : 'Control recorded. The environment gate, quota checks and paid budget still apply; in-flight requests are not cancelled.');
      await load();
    } catch (e) {
      if (mounted.current && generation === epoch.current) {
        if (pending.kind === 'budget') setPending(null);
        setError(`${e instanceof Error ? e.message : 'The control outcome is uncertain.'} Refresh before retrying; a lost response does not prove the control failed.`);
      }
    } finally {
      clearTimeout(deadline);
      mutationLock.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const orderedProviders = view ? [...view.order.map(id => view.providers.find(p => p.id === id)!), ...view.providers.filter(p => !view.order.includes(p.id))] : [];
  const nextRollout = rollout.trim() === '' ? null : Number(rollout);
  const rolloutValid = nextRollout !== null && Number.isInteger(nextRollout) && nextRollout >= 0 && nextRollout <= 100 && nextRollout !== view?.rolloutPercent;
  const nextBudget = budget.trim() === '' ? null : Number(budget);
  const budgetRevision = view?.paid.policyState === 'uninitialized' ? 0 : view?.paid.policyRevision ?? null;
  const budgetValid = validFreeChainBudgetUsd(nextBudget) && !!view && budgetRevision !== null && view.paid.configuredCapUsd !== null && nextBudget <= view.paid.configuredCapUsd && nextBudget !== view.paid.capUsd;
  return <section aria-label="Free Chat Chain" className="space-y-4">
    <div className="rounded-xl border border-line bg-card p-4 space-y-3">
      <div className="flex flex-wrap justify-between gap-3">
        <div><h2 className="text-lg font-bold text-ink">Free Chat Chain</h2><p className="text-sm text-muted">Admin-only provider order, shared quota observations and bounded paid fallback. Status refreshes every 30 seconds while this page is visible, without scanning event history. Status still uses bounded database reads. Refresh never runs inference.</p></div>
        <button type="button" className={button} disabled={busy || loading} onClick={() => void load()}>{loading ? 'Reading…' : 'Refresh status'}</button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}{view ? ' Showing the last received snapshot only. Controls are blocked until a successful refresh.' : ''}</p>}
      {notice && <p role="status" className="text-sm text-body">{notice}</p>}
      {!view && <p role="status" className="text-sm text-muted">{error ? 'Chain status unavailable. No quota, budget or routing health has been verified here.' : 'Reading chain status…'}</p>}
      {view && <>
        <p className={`font-bold text-sm ${error ? 'text-warn' : 'text-ink'}`}>{error || loading ? 'Unconfirmed snapshot' : !view.enabled ? 'Disabled by server configuration' : !view.runtimeEnabled ? 'Stopped by admin control' : view.rolloutPercent === 0 && !view.allowListConfigured ? 'No rollout audience selected' : 'Routing enabled for selected eligible requests'}</p>
        <dl className="grid sm:grid-cols-2 gap-3 text-sm text-body">
          <div><dt className="font-bold">Environment gate</dt><dd>{view.enabled ? 'Enabled' : 'Off; admin controls cannot override this'}</dd></div>
          <div><dt className="font-bold">Saved admin control</dt><dd>{view.runtimeEnabled ? 'Enabled' : 'Stopped'}</dd></div>
          <div><dt className="font-bold">Rollout percentage</dt><dd>{view.rolloutPercent}% of the percentage-selected audience</dd></div>
          <div><dt className="font-bold">Canary allowlist</dt><dd>{view.allowListConfigured ? 'Configured; named users are not displayed' : 'Not configured'}</dd></div>
        </dl>
        <p className="text-sm text-muted">An environment-level OFF always wins. Strict-free policy and request eligibility still apply. A configured credential is not proof of free quota or provider availability.</p>
        <div className="flex flex-wrap items-end gap-3">
          <button type="button" className={button} disabled={controlsBlocked || (!view.runtimeEnabled && !view.enabled)} onClick={() => review(view.runtimeEnabled ? 'Stop Free Chat Chain' : 'Enable Free Chat Chain checks', view.runtimeEnabled ? 'Stop new requests from entering this chain. Other routing policy remains in force. Requests already in flight are not cancelled.' : 'Allow eligible requests into the configured rollout. This does not override the environment gate or authorize unbounded paid calls.', { enabled: !view.runtimeEnabled })}>{view.runtimeEnabled ? 'Stop chain' : 'Enable chain checks'}</button>
          <label className="text-sm text-body">New rollout percentage (whole number, 0–100)<input type="number" min={0} max={100} step={1} value={rollout} disabled={controlsBlocked} onChange={e => setRollout(e.target.value)} className={`${input} block w-full`} /></label>
          <button type="button" className={button} disabled={controlsBlocked || !rolloutValid} onClick={() => { if (rolloutValid && nextRollout !== null) review('Change rollout percentage', `Change the percentage-selected audience from ${view.rolloutPercent}% to ${nextRollout}%. A configured canary allowlist remains separate; 0% alone is not a global stop.`, { rolloutPercent: nextRollout }); }}>Review rollout change</button>
        </div>
      </>}
    </div>
    {pending && <form aria-label="Review chain control" onSubmit={e => { e.preventDefault(); void mutate(); }} className="rounded-xl border border-line bg-card p-4 space-y-3">
      <h3 className="font-bold text-ink">{pending.title}</h3>
      <p className="text-sm text-body">{pending.description}</p>
      {staleReview && <p role="status" className="text-sm text-warn">Settings changed after this review opened. Cancel and review the current settings.</p>}
      <p className="text-sm text-muted">Do not enter credentials or conversation content in the audit reason.</p>
      <label className="block text-sm text-body">Audit reason (10–500 characters)<textarea rows={3} minLength={10} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} disabled={busy} required className={`${input} block w-full mt-1`} /></label>
      <div className="flex gap-2"><button type="submit" disabled={!validAction} className={button}>{busy ? 'Recording…' : 'Confirm control'}</button><button type="button" disabled={busy} className={button} onClick={() => setPending(null)}>Cancel</button></div>
    </form>}
    {view && <>
      <div className="rounded-xl border border-line bg-card p-4 space-y-3">
        <h3 className="font-bold text-ink">Provider chain, in routing order</h3>
        <p className="text-sm text-muted">Quota counters are this service’s recorded reservations, not a provider account balance. Usage by other applications and undocumented quota changes are not measured here.</p>
        {orderedProviders.map(provider => <FreeChainProviderCard key={provider.id} provider={provider} position={view.order.includes(provider.id) ? view.order.indexOf(provider.id) + 1 : null} now={now} trusted={!error && !loading} controlsBlocked={controlsBlocked} onToggle={() => {
          const disabledProviders = view.providers.filter(p => p.id === provider.id ? !p.disabled : p.disabled).map(p => p.id);
          review(`${provider.disabled ? 'Re-enable' : 'Disable'} ${freeChainProviderLabel(provider.id)}`, provider.disabled ? 'Remove this rung’s manual block. Credentials, free quota, circuit state and the paid budget are still checked before any request.' : 'Skip this rung for new chain dispatches. Other rungs can still run; in-flight requests are not cancelled.', { disabledProviders });
        }} />)}
      </div>
      <div className="rounded-xl border border-line bg-card p-4 space-y-3">
        <h3 className="font-bold text-ink">Paid safety net, today (India / IST)</h3>
        <dl className="grid sm:grid-cols-3 gap-3 text-sm text-body">
          <div><dt className="font-bold">Effective shared daily cap</dt><dd>{freeChainUsd(view.paid.capUsd)}</dd></div>
          <div><dt className="font-bold">This deployment’s configured limit</dt><dd>{freeChainUsd(view.paid.configuredCapUsd)}</dd></div>
          <div><dt className="font-bold">Shared policy revision</dt><dd>{view.paid.policyState === 'uninitialized' ? 'Not initialized; verified absent' : view.paid.policyRevision}</dd></div>
          <div><dt className="font-bold">Reserved upper-bound cost</dt><dd>{freeChainUsd(view.paid.reservedUsd)}</dd></div>
          <div><dt className="font-bold">Booked liability (not invoice spend)</dt><dd>{freeChainUsd(view.paid.reportedUsd)}</dd></div>
        </dl>
        <p className="text-sm text-muted">Reservations are conservative cost protection, not invoices. Booked liability includes authenticated actual records and conservative ceilings calculated from complete usage and reviewed maximum prices. It is not provider invoice reconciliation. Missing or incomplete usage keeps the full reservation held. Missing measurements are unavailable, never zero. The cap is total across this chain’s paid fallback providers, not per provider, and is separate from the existing funded builder wallet. Payment settings cannot be changed here.</p>
        <p className="text-sm text-muted">Lowering the cap does not refund or cancel already-dispatched work, clear existing holds, or erase settled usage. Held and settled amounts may exceed a newly lowered cap. Raising requires an explicit audited review; retire inconsistent deployment revisions first because a stale stricter revision can lower the shared cap again.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-body">New total daily cap (USD, 0–10, cents)<input aria-label="New total daily cap" type="number" min={0} max={Math.min(FREE_CHAIN_MAX_PAID_CAP_USD, view.paid.configuredCapUsd ?? 0)} step="0.01" value={budget} disabled={controlsBlocked || budgetRevision === null || view.paid.configuredCapUsd === null} onChange={e => setBudget(e.target.value)} className={`${input} block w-full`} /></label>
          <button type="button" className={button} disabled={controlsBlocked || !budgetValid} onClick={() => {
            if (controlsBlocked || !budgetValid || nextBudget === null || budgetRevision === null) return;
            setPending({ kind: 'budget', title: view.paid.policyState === 'uninitialized' ? 'Initialize shared paid fallback budget' : 'Change total paid fallback cap', description: `${view.paid.policyState === 'uninitialized' ? 'Initialize the verified absent shared cap' : `Change the shared cap from ${freeChainUsd(view.paid.capUsd)}`} to ${freeChainUsd(nextBudget)} per India / IST day across all paid fallback providers, using policy revision ${budgetRevision}. This is an intentional budget change, not a payment or wallet edit. Existing holds and already-dispatched work remain unchanged. A stale stricter deployment can reapply a lower limit.`, capUsd: nextBudget, expectedRevision: budgetRevision, fingerprint: freeChainBudgetFingerprint(view) });
            setReason(''); setNotice('');
          }}>{view.paid.policyState === 'uninitialized' ? 'Review budget initialization' : 'Review budget change'}</button>
        </div>
        <p className="text-sm text-muted">No edit can exceed $10 USD or this deployment’s configured limit. A verified absent policy can be initialized only through this explicit review. Failed or malformed reads block all edits; they never count as an uninitialized policy.</p>
      </div>
      <div className="rounded-xl border border-line bg-card p-4 space-y-3">
        <h3 className="font-bold text-ink">Last 24 hours: 1-in-64 routing samples</h3>
        <p className="text-sm text-muted">History is loaded only on request, never by status polling. Each refresh scans at most {FREE_CHAIN_METRICS_SCAN_LIMIT.toLocaleString()} event documents and can incur database read costs. Limit: two refresh requests per minute per server/IP.</p>
        <button type="button" className={button} disabled={metricsLoading || busy} onClick={() => void loadMetrics()}>{metricsLoading ? 'Reading samples…' : 'Refresh sampled metrics'}</button>
        {metricsError && <p role="alert" className="text-sm text-danger">{metricsError} {metrics ? 'Previous metrics are stale; the last successful snapshot is shown below.' : 'No sampled metrics have been verified.'}</p>}
        {!metrics && <p role="status" className="text-sm text-muted">Sampled metrics unavailable until an explicit refresh. No traffic count or latency has been measured here.</p>}
        {metrics && <>
        <p className="text-sm text-body">Metrics snapshot as of <time dateTime={new Date(metrics.observedAt).toISOString()}>{freeChainTimestamp(metrics.observedAt)}</time>. Status updates do not refresh this timestamp.</p>
        <p className="text-sm text-muted">{metrics.sampleCount.toLocaleString()} retained samples from uniformly sampled 1-in-64 recent requests. Partial retained sample; these figures are not whole-window totals. Rates and latency describe only this sample, not exact production rates or p95. No sample is not proof of zero traffic. Scan limit: {metrics.scanLimit.toLocaleString()} event documents.</p>
        <dl className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm text-body">
          <div><dt className="font-bold">Sample fallback rate</dt><dd>{freeChainPercent(metrics.fallbackRate)}</dd></div>
          <div><dt className="font-bold">Sample median / p95 latency</dt><dd>{metrics.p50Ms === null ? 'Not measured' : `${Math.round(metrics.p50Ms)} ms`} / {metrics.p95Ms === null ? 'Not measured' : `${Math.round(metrics.p95Ms)} ms`}</dd></div>
          <div><dt className="font-bold">Sample cache-hit rate</dt><dd>{freeChainPercent(metrics.cacheHitRate)}</dd></div>
          <div><dt className="font-bold">Sample provider share</dt><dd>{view.providers.map(p => <div key={p.id}>{freeChainProviderLabel(p.id)}: {freeChainPercent(metrics.shareByProvider[p.id])}</div>)}</dd></div>
        </dl>
        </>}
      </div>
      <div className="rounded-xl border border-line bg-card p-4 space-y-2"><h3 className="font-bold text-ink">Measurement and routing limitations</h3><ul className="list-disc pl-5 text-sm text-muted space-y-1">{view.limitations.map((line, i) => <li key={i}>{line}</li>)}</ul></div>
    </>}
  </section>;
}

export function FreeChainProviderCard({ provider: p, position, now, trusted, controlsBlocked, onToggle }: {
  provider: FreeChainAdminView['providers'][number]; position: number | null; now: number; trusted: boolean; controlsBlocked: boolean; onToggle: () => void;
}): React.ReactElement {
  const keys = [...new Set([...Object.keys(p.usage ?? {}), ...Object.keys(p.limits ?? {})])];
  const quotaLabels: Record<string, string> = { rpm: 'Requests / minute', rpd: 'Requests / day', tpm: 'Tokens / minute', tpd: 'Tokens / day', neuronsPerDay: 'Neurons / day' };
  const resetSeconds = p.nextResetAt == null ? null : Math.max(0, Math.ceil((p.nextResetAt - now) / 1000));
  return <article className="rounded-lg border border-line p-4 space-y-2">
    <h4 className="font-bold text-ink">{position === null ? 'Outside configured chain' : `${position}.`} {freeChainProviderLabel(p.id)}</h4>
    <p className="text-xs text-muted">Tier {freeChainProviderTier(p.id)} · {freeChainProviderTier(p.id) === 3 ? 'paid, shared daily budget' : freeChainProviderTier(p.id) === 2 ? 'limited free gateway' : 'true free'}</p>
    <p className="text-xs font-mono text-muted break-all">{p.model || 'Model not configured'}</p>
    {(p.reason === 'terms-non-production' || p.reason === 'terms-unverified') && <p className="text-sm text-muted">Blocked by provider terms (non-production / unverified). Needs written commercial permission; see docs/FREE_CHAT_CHAIN.md.</p>}
    {(p.id === 'glm47' || p.id === 'glm45') && <p className="text-sm text-muted">Shared account quota and auth/rate/quota cooldown with the other Flash rung; not a second allowance. Model circuits remain separate.</p>}
    <p className="text-sm text-body">{!trusted ? 'Unconfirmed snapshot' : position === null ? 'Not in configured routing order' : p.disabled ? 'Disabled by admin' : !p.configured ? 'Not configured' : 'Configured; eligibility checked at dispatch'}</p>
    {p.reason && <p className="text-sm text-muted">{p.reason}</p>}
    <dl className="grid sm:grid-cols-2 gap-3 text-sm text-body">
      <div><dt className="font-bold">Recorded usage / configured limits</dt><dd>{keys.length ? keys.map(key => <div key={key}>{quotaLabels[key] ?? key}: {p.usage?.[key]?.toLocaleString() ?? 'Unavailable'} / {p.limits?.[key]?.toLocaleString() ?? 'Not configured'}</div>) : 'Unavailable'}</dd></div>
      <div><dt className="font-bold">Next recorded reset</dt><dd>{freeChainTimestamp(p.nextResetAt)}{resetSeconds !== null && (resetSeconds > 0 ? ` (${resetSeconds.toLocaleString()} seconds)` : ' (reset time reached; refresh to verify quota)')}</dd></div>
      <div><dt className="font-bold">Circuit observation</dt><dd>{p.circuit ? `${p.circuit.state}${p.circuit.openedUntil > now ? ` until ${freeChainTimestamp(p.circuit.openedUntil)}` : ''}` : 'Unavailable'}</dd></div>
    </dl>
    <button type="button" className={button} disabled={controlsBlocked} onClick={onToggle}>{p.disabled ? 'Re-enable rung checks' : 'Disable rung'}</button>
  </article>;
}
