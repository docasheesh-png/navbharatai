import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminHeaders } from '../../lib/adminFetch';
import type { AdminRegistryView } from '../../server/AI/LiveRegistry/types';
import { EMPTY_REGISTRY_FILTERS, REGISTRY_STATUSES, effectiveRegistryStatus, filterRegistryModels, isRegistryView, registryActionReason, registryTimestamp, safeRegistrySource, type RegistryFilters, type RegistryModelView } from '../../lib/liveModelRegistryView';

const ROOT = '/api/v1/admin/live-model-registry';
type Action = 'disable' | 'enable' | 'approve-terms';
const button = 'min-h-11 rounded-lg border border-line px-3 py-2 text-sm text-ink disabled:opacity-40';
const input = 'min-h-11 rounded-lg border border-line bg-well px-3 py-2 text-sm text-ink';

/** Admin-only catalog visibility. This screen cannot override pricing, credentials, or paid-tier policy. */
export function LiveModelRegistryPanel({ adminToken }: { adminToken: string }): React.ReactElement {
  const [view, setView] = useState<AdminRegistryView | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [filters, setFilters] = useState<RegistryFilters>(EMPTY_REGISTRY_FILTERS);
  const [limit, setLimit] = useState(25);
  const [pending, setPending] = useState<{ model: RegistryModelView; action: Action; version: string } | null>(null);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const epoch = useRef(0);
  const mounted = useRef(false);
  const mutationLock = useRef(false);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const generation = ++epoch.current;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
    setLoading(true);
    try {
      const response = await fetch(ROOT, { headers: adminHeaders(adminToken), signal: controller.signal });
      const body: unknown = await response.json();
      if (!mounted.current || generation !== epoch.current) return;
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Admin sign-in or authorization required.' : `Registry read failed (HTTP ${response.status}).`);
      if (!isRegistryView(body)) throw new Error('Registry response is incomplete or unreadable. No eligibility can be confirmed.');
      setView(body); setError(''); setNow(Date.now());
    } catch (e) {
      if (mounted.current && generation === epoch.current && (!controller.signal.aborted || timedOut)) {
        setError(timedOut ? 'Registry status read timed out. Eligibility is unconfirmed until refresh succeeds.' : e instanceof Error ? e.message : 'Could not read registry.');
      }
    } finally { clearTimeout(deadline); if (mounted.current && generation === epoch.current) setLoading(false); }
  }, [adminToken]);

  useEffect(() => {
    mounted.current = true; setView(null); setPending(null); setError(''); setNotice('');
    void load();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    // Read saved server state only. This never triggers catalog sync or inference.
    const refreshTimer = setInterval(() => { if (!mutationLock.current) void load(); }, 30_000);
    return () => { mounted.current = false; epoch.current++; request.current?.abort(); clearInterval(timer); clearInterval(refreshTimer); };
  }, [load]);

  const mutate = async (path: `${typeof ROOT}/sync` | `${typeof ROOT}/models/action`, body?: Record<string, unknown>) => {
    if (mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setNotice(''); setError('');
    const generation = ++epoch.current;
    request.current?.abort(); setLoading(false);
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(path, { method: 'POST', headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}), signal: controller.signal });
      const result: unknown = await response.json();
      if (!mounted.current || generation !== epoch.current) return;
      if (!response.ok) {
        if (response.status === 409) { setPending(null); throw new Error('Registry changed since this review. Refresh and review the model again.'); }
        throw new Error(response.status === 401 || response.status === 403 ? 'Admin sign-in or authorization required.' : `Action was not confirmed (HTTP ${response.status}). Refresh to check its state before retrying.`);
      }
      if (path === `${ROOT}/sync`) {
        const status = result && typeof result === 'object' && 'status' in result ? result.status : null;
        if (!['synced', 'held', 'disabled'].includes(String(status))) throw new Error('Sync response was unreadable. Refresh to check status before retrying.');
        setNotice(status === 'synced' ? 'Catalog sync completed. No inference test was run.' : status === 'held' ? 'Another sync owns the lease. This request did not publish a new catalog.' : 'Synchronization is disabled by server configuration.');
      } else {
        if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true) throw new Error('Action response was unreadable. Refresh before retrying.');
        setPending(null); setNotice('Control recorded. Eligibility is still determined by verified prices, account access, terms and health.');
      }
      await load();
    } catch (e) {
      if (mounted.current && generation === epoch.current) setError(`${e instanceof Error ? e.message : 'Action outcome is uncertain.'} Refresh status before retrying; a lost response does not prove the action failed.`);
    } finally {
      clearTimeout(deadline);
      mutationLock.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const rows = useMemo(() => filterRegistryModels(view?.models ?? [], filters, now), [view, filters, now]);
  const providers = useMemo(() => [...new Set(view?.models.map(m => m.provider) ?? [])], [view]);
  const change = <K extends keyof RegistryFilters>(key: K, value: RegistryFilters[K]) => { setFilters(f => ({ ...f, [key]: value })); setLimit(25); };
  const openAction = (model: RegistryModelView, action: Action) => {
    if (!view?.manifest || busy || loading || error) return;
    setPending({ model, action, version: view.manifest.version }); setReason(''); setConfirmed(false);
  };
  const validAction = !!pending && registryActionReason(reason) && (pending.action !== 'approve-terms' || confirmed) && !busy && !loading && !error && pending.version === view?.manifest?.version;

  return <section aria-label="Live Model Registry" className="space-y-4">
    <div className="rounded-xl border border-line bg-card p-4 space-y-3">
      <div className="flex flex-wrap justify-between gap-3">
        <div><h2 className="text-lg font-bold text-ink">Live Model Registry</h2><p className="text-sm text-muted">Admin-only discovery and strict-free eligibility. Catalog metadata is not proof of unlimited quota or a zero hosting bill. Status refreshes every 30 seconds while this page is open.</p></div>
        <div className="flex gap-2"><button type="button" className={button} disabled={busy || loading} onClick={() => void load()}>{loading ? 'Reading…' : 'Refresh status'}</button>
          <button type="button" className={button} disabled={!view?.enabled || busy || loading || !!error} onClick={() => void mutate(`${ROOT}/sync`)}>{busy ? 'Working…' : 'Sync catalog now'}</button></div>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}{view ? ' Showing the last received snapshot only; controls are blocked until a successful refresh.' : ''}</p>}
      {notice && <p role="status" className="text-sm text-body">{notice}</p>}
      {!view && <p role="status" className="text-sm text-muted">{error ? 'Registry unavailable. No model status has been verified here.' : 'Reading registry status…'}</p>}
      {view && <>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-body">
          <div><dt className="font-bold">Catalog service</dt><dd>{view.enabled ? 'Enabled' : 'Disabled by server configuration'}</dd></div>
          <div><dt className="font-bold">Account configuration</dt><dd>{view.configured ? 'Configured; per-model access still required' : 'Not configured'}</dd></div>
          <div><dt className="font-bold">Free + professional modules flag</dt><dd>{view.strictFreeModulesEnabled ? 'Enabled; unverified capabilities fail closed' : 'Not enabled; existing routing is unchanged'}</dd></div>
          <div><dt className="font-bold">Pro App Builder</dt><dd>Outside this rollout; all tiers retain their original routing</dd></div>
          <div><dt className="font-bold">Pro Normal / Strong</dt><dd>Not changed by these strict-free flags</dd></div>
          <div><dt className="font-bold">Sync interval target</dt><dd>{view.syncIntervalMs / 1000} seconds; not instantaneous</dd></div>
          <div><dt className="font-bold">Last successful catalog</dt><dd>{registryTimestamp(view.manifest?.fetchedAt ?? null)}</dd></div>
          <div><dt className="font-bold">Last sync attempt</dt><dd>{registryTimestamp(view.lastSyncAttemptAt)}</dd></div>
          <div><dt className="font-bold">Snapshot age / expiry</dt><dd>{view.manifest ? `${Math.max(0, Math.floor((now - view.manifest.fetchedAt) / 1000))} seconds / ${registryTimestamp(view.manifest.expiresAt)}` : 'No successful snapshot'}</dd></div>
          <div><dt className="font-bold">Registry version</dt><dd className="break-all">{view.manifest?.version ?? 'Not published'}</dd></div>
        </dl>
        {view.manifest && view.manifest.expiresAt <= now && <p role="status" className="text-warn text-sm">Snapshot is stale. It must not authorize new strict-free calls.</p>}
        {view.lastSyncError && <p className="text-danger text-sm">Last sync error: {view.lastSyncError}</p>}
        <details><summary className="cursor-pointer font-bold text-sm text-ink">Verification limitations</summary><ul className="list-disc pl-5 text-sm text-muted space-y-1">{view.limitations.map((s, i) => <li key={i}>{s}</li>)}</ul></details>
        <details><summary className="cursor-pointer font-bold text-sm text-ink">Image discovery and funded allowance</summary>
          <p className="text-sm text-body">Existing owner-funded daily image generation keeps its current quota and providers. Discovery does not activate an unverified image endpoint.</p>
          {view.imageDiscovery?.snapshot ? <>
            <p className="text-sm text-body">Image catalog: {view.imageDiscovery.snapshot.models.length} models. Last scan: {registryTimestamp(view.imageDiscovery.snapshot.fetchedAt)}. {view.imageDiscovery.snapshot.expiresAt <= now ? 'Snapshot stale.' : 'Metadata snapshot current; inference eligibility remains separate.'}</p>
            <p className="text-sm text-muted">{view.imageDiscovery.snapshot.models.filter(m => m.eligibilityStatus === 'PAID').length} paid; {view.imageDiscovery.snapshot.models.filter(m => m.eligibilityStatus === 'UNKNOWN').length} unknown. Automatic free-image generation is not enabled by this discovery service.</p>
          </> : <p className="text-sm text-muted">No successful image catalog scan recorded.</p>}
          {view.imageDiscovery?.lastError && <p className="text-sm text-warn">{view.imageDiscovery.lastError}</p>}
        </details>
        <details><summary className="cursor-pointer font-bold text-sm text-ink">Recent sync history</summary>
          <p className="text-xs text-muted">Latest 30 retained summaries, not a permanent audit archive.</p>
          {(view.history ?? []).map(h => <p className="text-xs text-body break-all" key={h.version}>{registryTimestamp(h.fetchedAt)} · {h.version} · {Object.entries(h.transitions).map(([key, value]) => `${key}: ${value}`).join(', ')}</p>)}
        </details>
        <details><summary className="cursor-pointer font-bold text-sm text-ink">Recent routing decisions</summary>
          <p className="text-xs text-muted">Latest retained samples only; full structured events follow deployment log retention. Estimated zero is not an invoice reconciliation.</p>
          {(view.recentRouting ?? []).map((r, index) => <p className="text-xs text-body break-all" key={`${r.requestId}-${index}`}>{registryTimestamp(r.at)} · {r.modelId} · {r.outcome} · {r.reason} · reported cost: {r.reportedCost ?? 'not reported'}</p>)}
        </details>
        <details><summary className="cursor-pointer font-bold text-sm text-ink">Latest catalog transitions</summary>
          <p className="text-xs text-muted">This is the latest sync summary, not an exhaustive price-history or billing ledger.</p>
          {view.manifest ? <dl className="text-sm text-body">{Object.entries(view.manifest.transitions).map(([key, count]) => <div key={key}>{key}: {count}</div>)}</dl> : <p className="text-sm text-muted">No successful sync recorded.</p>}
        </details>
      </>}
    </div>
    {pending && <form aria-label="Review model control" onSubmit={e => { e.preventDefault(); if (validAction) void mutate(`${ROOT}/models/action`, { modelId: pending.model.exactModelId, action: pending.action, registryVersion: pending.version, reason: reason.trim() }); }} className="rounded-xl border border-line bg-card p-4 space-y-3">
      <h3 className="font-bold text-ink">{pending.action === 'approve-terms' ? 'Record intended-use terms review' : pending.action === 'disable' ? 'Disable model' : 'Re-enable model checks'}</h3>
      <p className="break-all text-sm text-body">{pending.model.exactModelId}</p>
      {pending.version !== view?.manifest?.version && <p role="status" className="text-sm text-warn">The catalog changed during this review. Cancel and reopen the model control using the new snapshot.</p>}
      <p className="text-sm text-muted">{pending.action === 'approve-terms' ? 'Record only after reviewing the actual model and provider terms for your intended use. This records a time-limited review; it does not accept an external contract, verify account access, or change a price.' : pending.action === 'disable' ? 'Prevent this model from new registry-routed requests. In-flight requests and other legacy routing paths are not changed by this control.' : 'Remove the manual block only. Stale, unknown, paid or otherwise ineligible models remain blocked.'}</p>
      {pending.action === 'approve-terms' && <label className="flex gap-2 text-sm text-body"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} />I reviewed the applicable model/provider terms for this deployment and intended use.</label>}
      <label className="block text-sm text-body">Audit reason (10–500 characters)<textarea rows={3} minLength={10} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} disabled={busy} className={`${input} block w-full mt-1`} required /></label>
      <div className="flex gap-2"><button type="submit" className={button} disabled={!validAction}>{busy ? 'Recording…' : 'Confirm control'}</button><button type="button" className={button} disabled={busy} onClick={() => setPending(null)}>Cancel</button></div>
    </form>}
    {view && <div className="rounded-xl border border-line bg-card p-4 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <label className="text-sm text-body">Model search<input className={`${input} block w-full`} value={filters.query} onChange={e => change('query', e.target.value)} /></label>
        <label className="text-sm text-body">Eligibility<select className={`${input} block w-full`} value={filters.status} onChange={e => change('status', e.target.value)}><option value="">All statuses</option>{REGISTRY_STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
        <label className="text-sm text-body">Provider<select className={`${input} block w-full`} value={filters.provider} onChange={e => change('provider', e.target.value)}><option value="">All providers</option>{providers.map(p => <option key={p}>{p}</option>)}</select></label>
        <label className="text-sm text-body">Capabilities<select className={`${input} block w-full`} value={filters.capability} onChange={e => change('capability', e.target.value)}><option value="">All capabilities</option><option value="text-only">Text-only</option><option value="tools">Tool calling advertised</option></select></label>
        <label className="text-sm text-body">Minimum context tokens<input type="number" min={0} className={`${input} block w-full`} value={filters.minContext} onChange={e => change('minContext', Math.max(0, Number(e.target.value) || 0))} /></label>
        <label className="text-sm text-body">Maximum measured latency (ms, 0 = any)<input type="number" min={0} className={`${input} block w-full`} value={filters.maxLatency} onChange={e => change('maxLatency', Math.max(0, Number(e.target.value) || 0))} /></label>
        <label className="text-sm text-body">Minimum measured success % (0 = any)<input type="number" min={0} max={100} className={`${input} block w-full`} value={filters.minSuccess} onChange={e => change('minSuccess', Math.min(100, Math.max(0, Number(e.target.value) || 0)))} /></label>
      </div>
      <p className="text-sm text-muted">Showing {Math.min(limit, rows.length)} of {rows.length} matching models ({view.models.length} in this snapshot). Advertised capability alone does not authorize a call.</p>
      {rows.length === 0 && <p className="text-sm text-body">{view.manifest ? 'No models match these filters in the last received snapshot.' : 'No successful catalog snapshot is available yet.'}</p>}
      {rows.slice(0, limit).map(model => <RegistryModelCard key={model.exactModelId} model={model} now={now} snapshotTrusted={!error && !loading} disabled={busy || loading || !!error || !view.manifest} termsUntil={view.controls[model.exactModelId]?.termsReviewedUntil ?? 0} manuallyDisabled={view.controls[model.exactModelId]?.disabled === true} onAction={action => openAction(model, action)} />)}
      {rows.length > limit && <button type="button" className={button} onClick={() => setLimit(n => n + 25)}>Show 25 more models</button>}
    </div>}
  </section>;
}

export function RegistryModelCard({ model: m, now, snapshotTrusted, disabled, termsUntil, manuallyDisabled, onAction }: { model: RegistryModelView; now: number; snapshotTrusted: boolean; disabled: boolean; termsUntil: number; manuallyDisabled: boolean; onAction: (action: Action) => void }): React.ReactElement {
  const status = effectiveRegistryStatus(m, now);
  const source = safeRegistrySource(m.pricingVerificationSource);
  const routable = snapshotTrusted && m.routable && status === 'VERIFIED_FREE' && !manuallyDisabled && termsUntil > now && m.cooldownUntil <= now;
  return <article className="rounded-lg border border-line p-4 space-y-2">
    <h3 className="font-bold text-ink break-all">{m.displayName}</h3>
    <p className="font-mono text-xs text-muted break-all">{m.provider} · {m.exactModelId}</p>
    <p className={`text-sm font-bold ${routable ? 'text-success' : 'text-warn'}`}>{snapshotTrusted ? status : 'UNCONFIRMED SNAPSHOT'} · {routable ? 'Eligible at last verification; rechecked before dispatch' : 'Not routable from this snapshot'}</p>
    <p className="text-sm text-body">{m.eligibilityReason}</p>
    <dl className="grid sm:grid-cols-2 gap-2 text-sm text-body">
      <div><dt>USD / million input tokens</dt><dd>{m.inputPricePerMillion ?? 'Unknown'}</dd></div><div><dt>USD / million output tokens</dt><dd>{m.outputPricePerMillion ?? 'Unknown'}</dd></div>
      <div><dt>Account availability</dt><dd>{m.accountAvailable ? 'Verified in account-filtered catalog' : 'Not verified'}</dd></div><div><dt>Context / maximum output</dt><dd>{m.contextWindow.toLocaleString()} / {m.maximumOutputTokens?.toLocaleString() ?? 'Not documented'}</dd></div>
      <div><dt>Price metadata checked</dt><dd>{registryTimestamp(m.pricingVerifiedAt)}</dd></div><div><dt>Metadata age</dt><dd>{Math.max(0, Math.floor((now - m.catalogFetchedAt) / 1000))} seconds</dd></div>
      <div><dt>Terms review expires</dt><dd>{registryTimestamp(termsUntil)}</dd></div><div><dt>Cooldown ends</dt><dd>{m.cooldownUntil > now ? registryTimestamp(m.cooldownUntil) : 'No active cooldown recorded'}</dd></div>
      <div><dt>Recent latency / success</dt><dd>{m.recentLatency === null ? 'Not measured' : `${m.recentLatency} ms`} / {m.recentSuccessRate === null ? 'Not measured' : `${(m.recentSuccessRate * 100).toFixed(1)}%`}</dd></div>
      <div><dt>Quota</dt><dd>{status === 'QUOTA_EXHAUSTED' ? 'Exhaustion reported' : 'Remaining quota not verified'}</dd></div>
    </dl>
    <details><summary className="cursor-pointer text-sm font-bold text-ink">Capabilities, price fields and verification</summary>
      <p className="text-sm text-body">Input: {m.supportedModalities.input.join(', ')}. Output: {m.supportedModalities.output.join(', ')}. Parameters: {m.supportedCapabilities.join(', ') || 'None documented'}.</p>
      <p className="text-xs text-muted">Original provider price fields below retain their source units. Token prices are USD/token; do not interpret request/tool prices as token prices. Missing fields are not automatically zero.</p>
      <dl className="text-sm text-body">{Object.entries(m.pricing).map(([key, value]) => <div className="break-all" key={key}>{key}: {value}</div>)}</dl>
      <p className="text-sm text-muted">Method: {m.pricingVerificationMethod}. Endpoint: {m.endpointTag ?? 'Not verified'}. Last error: {m.lastErrorCode ?? 'None recorded'}.</p>
      {source && <a className="text-sm underline" href={source} target="_blank" rel="noopener noreferrer">Official pricing source</a>}
    </details>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={disabled} onClick={() => onAction(manuallyDisabled ? 'enable' : 'disable')}>{manuallyDisabled ? 'Re-enable checks' : 'Disable model'}</button><button type="button" className={button} disabled={disabled} onClick={() => onAction('approve-terms')}>Record terms review</button></div>
  </article>;
}
