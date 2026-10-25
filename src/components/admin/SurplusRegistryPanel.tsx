import React, { useCallback, useEffect, useRef, useState } from 'react';
import { adminHeaders } from '../../lib/adminFetch';
import type { Observation, Rates, SurplusManagerModel, SurplusManagerView, SurplusConnectionTestStatus } from '../../server/AI/SurplusRegistry/types';

const ROOT = '/api/v1/admin/surplus-registry';
const button = 'min-h-11 rounded-lg border border-line px-3 py-2 text-sm text-ink disabled:opacity-40';
const input = 'min-h-11 rounded-lg border border-line bg-well px-3 py-2 text-sm text-ink';
const dimensions = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'] as const;
class ManagerUiError extends Error {}
type Control = { modelId: string; action: 'disable' | 'enable'; snapshotVersion: string; expectedRevision: number };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(value);
const time = (value: unknown): value is number | null => value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0;
const strings = (value: unknown, max: number): value is string[] => Array.isArray(value) && value.length <= max && value.every(s => typeof s === 'string' && s.length <= 1000);
const rates = (value: unknown): value is Rates => record(value) && Object.entries(value).every(([key, val]) => dimensions.includes(key as typeof dimensions[number]) && typeof val === 'string' && /^\d{1,15}(?:\.\d{1,6})?$/.test(val));
function observation(value: unknown): value is Observation {
  return record(value) && id(value.model) && id(value.offerId) && id(value.providerId)
    && ['available', 'healthy', 'trusted', 'providerTrustConfirmed'].every(key => typeof value[key] === 'boolean')
    && ['trustObservedAt', 'upstreamGeneratedAt', 'sourceDate', 'sourceAgeSeconds', 'cacheMaxAgeSeconds'].every(key => time(value[key]))
    && typeof value.observedAt === 'number' && time(value.observedAt)
    && (value.discountPct === null || typeof value.discountPct === 'number' && Number.isFinite(value.discountPct) && value.discountPct >= 0 && value.discountPct <= 100)
    && value.unit === 'unverified' && rates(value.rates) && rates(value.referenceRates) && typeof value.sourceUrl === 'string' && value.sourceUrl.length <= 1000;
}
/** Reject malformed HTTP bodies before they become status, controls or price claims. */
export function isSurplusManagerView(value: unknown): value is SurplusManagerView {
  if (!record(value) || !['disabled', 'invalid_configuration', 'unavailable', 'empty', 'observed', 'stale'].includes(String(value.status))
    || typeof value.enabled !== 'boolean' || value.canDispatch !== false
    || !strings(value.configuredUniverse, 15) || !value.configuredUniverse.every(id) || new Set(value.configuredUniverse).size !== value.configuredUniverse.length
    || !Number.isSafeInteger(value.intervalMs) || (value.intervalMs as number) < 300_000 || (value.intervalMs as number) > 600_000
    || !Number.isSafeInteger(value.freshnessMs) || (value.freshnessMs as number) <= 0 || (value.freshnessMs as number) > 600_000
    || value.maxModels !== 15 || !(value.version === null || typeof value.version === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.version))
    || !(value.controlRevision === null || Number.isSafeInteger(value.controlRevision) && (value.controlRevision as number) >= 0)
    || !['fetchedAt', 'expiresAt', 'lastAttemptAt', 'lastSuccessAt', 'nextAllowedAt'].every(key => time(value[key]))
    || !(value.lastError === null || typeof value.lastError === 'string' && value.lastError.length <= 1000)
    || !strings(value.limitations, 30) || !record(value.workload)
    || !dimensions.every(key => Number.isSafeInteger((value.workload as Record<string, unknown>)[key]) && ((value.workload as Record<string, unknown>)[key] as number) >= 0)
    || !Array.isArray(value.observedCandidates) || value.observedCandidates.length > 960 || !value.observedCandidates.every(observation)
    || !Array.isArray(value.models) || value.models.length > 15) return false;
  if ((value.status === 'observed' || value.status === 'stale') && (!value.enabled || value.version === null || value.controlRevision === null
    || value.fetchedAt === null || value.expiresAt === null || (value.expiresAt as number) < (value.fetchedAt as number))) return false;
  const universe = value.configuredUniverse;
  return new Set(value.models.map(m => record(m) ? m.modelId : null)).size === value.models.length && value.models.every(m => {
    if (!record(m) || !id(m.modelId) || !universe.includes(m.modelId) || typeof m.disabled !== 'boolean'
      || !['reviewed', 'expired', 'unreviewed'].includes(String(m.qualityReviewStatus)) || !strings(m.blockedReasons, 30)
      || !Array.isArray(m.observations) || m.observations.length > 64 || !m.observations.every(o => observation(o) && o.model === m.modelId)) return false;
    const candidate = m.estimatedCandidate;
    return candidate === null || record(candidate) && candidate.model === m.modelId && id(candidate.providerId) && id(candidate.offerId)
      && typeof candidate.estimatedMicroUsd === 'string' && /^\d{1,30}(?:\.\d{1,6})?$/.test(candidate.estimatedMicroUsd)
      && typeof candidate.qualityArtifact === 'string' && /^[a-f0-9]{64}$/.test(candidate.qualityArtifact);
  });
}
const timestamp = (value: number | null): string => value === null ? 'Unknown / not recorded' : new Date(value).toLocaleString();
const age = (value: number | null, now: number): string => value === null ? 'Unknown' : value > now ? 'Clock mismatch; unconfirmed' : `${Math.floor((now - value) / 1000)} seconds`;
function sourceLink(source: string): string | null {
  try {
    const url = new URL(source);
    return url.origin === 'https://api.surplusintelligence.ai' && /^\/api\/markets\/[^/]+$/.test(url.pathname) && !url.search && !url.hash && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Independently protected PAID manager. Reading this screen cannot sync, approve or dispatch inference. */
export function SurplusRegistryPanel({ adminToken }: { adminToken: string }): React.ReactElement {
  const [view, setView] = useState<SurplusManagerView | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [pending, setPending] = useState<Control | null>(null);
  const [reason, setReason] = useState('');
  const mounted = useRef(false), mutationLock = useRef(false);
  const session = useRef(0), readSequence = useRef(0);
  const readRequest = useRef<AbortController | null>(null), writeRequest = useRef<AbortController | null>(null);

  const load = useCallback(async (afterWrite = false) => {
    if (mutationLock.current && !afterWrite) return;
    const currentSession = session.current, sequence = ++readSequence.current;
    readRequest.current?.abort();
    const controller = new AbortController(); readRequest.current = controller;
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
    setLoading(true);
    try {
      const response = await fetch(ROOT, { headers: adminHeaders(adminToken), signal: controller.signal });
      if (!response.ok) throw new ManagerUiError(response.status === 401 || response.status === 403 ? 'Admin sign-in or authorization required.' : `Manager status read failed (HTTP ${response.status}).`);
      const body: unknown = await response.json();
      if (!isSurplusManagerView(body)) throw new ManagerUiError('Manager response is incomplete or unreadable. Eligibility is unconfirmed.');
      if (!mounted.current || currentSession !== session.current || sequence !== readSequence.current) return;
      setView(body); setError(''); setNow(Date.now());
    } catch (failure) {
      if (mounted.current && currentSession === session.current && sequence === readSequence.current && (!controller.signal.aborted || timedOut)) {
        setError(timedOut ? 'Manager status read timed out. Eligibility is unconfirmed.' : failure instanceof ManagerUiError ? failure.message : 'Manager status is unavailable.');
      }
    } finally {
      clearTimeout(deadline);
      if (mounted.current && currentSession === session.current && sequence === readSequence.current) setLoading(false);
    }
  }, [adminToken]);

  useEffect(() => {
    mounted.current = true; mutationLock.current = false;
    setView(null); setPending(null); setError(''); setNotice(''); setBusy(false);
    void load();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const refresh = setInterval(() => { void load(); }, 30_000);
    return () => { mounted.current = false; session.current++; readSequence.current++; readRequest.current?.abort(); writeRequest.current?.abort(); clearInterval(clock); clearInterval(refresh); };
  }, [load]);

  const stale = !!view && (view.status === 'stale' || view.version !== null && (view.fetchedAt === null || view.expiresAt === null || view.fetchedAt > now || view.expiresAt <= now));
  const readable = !!view && !error && !loading;
  const controlsAvailable = readable && view.enabled && (view.status === 'observed' || view.status === 'stale') && !!view.version && view.controlRevision !== null && !busy;
  const sameReview = !!pending && pending.snapshotVersion === view?.version && pending.expectedRevision === view?.controlRevision;
  const validAction = controlsAvailable && sameReview && reason.trim().length >= 10 && reason.length <= 500;
  const openControl = (model: SurplusManagerModel) => {
    if (!controlsAvailable || mutationLock.current) return;
    setPending({ modelId: model.modelId, action: model.disabled ? 'enable' : 'disable', snapshotVersion: view.version!, expectedRevision: view.controlRevision! });
    setReason(''); setNotice('');
  };
  const control = async () => {
    if (!validAction || !pending || mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setNotice('');
    const currentSession = session.current;
    readSequence.current++; readRequest.current?.abort(); setLoading(false);
    const controller = new AbortController(); writeRequest.current = controller;
    const deadline = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${ROOT}/models/action`, { method: 'POST', headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' }, body: JSON.stringify({ ...pending, reason: reason.trim() }), signal: controller.signal });
      if (!mounted.current || currentSession !== session.current) return;
      if (!response.ok) {
        if (response.status === 409) { setPending(null); throw new ManagerUiError('Snapshot or controls changed. Refresh and review the model again.'); }
        throw new ManagerUiError(response.status === 401 || response.status === 403 ? 'Admin sign-in or authorization required.' : `Control was not confirmed (HTTP ${response.status}).`);
      }
      const body: unknown = await response.json();
      if (!mounted.current || currentSession !== session.current) return;
      if (!record(body) || body.ok !== true || body.canDispatch !== false) throw new ManagerUiError('Control response was unreadable.');
      setPending(null);
      setNotice('Manual block control recorded. This does not approve quality, verify a price, activate paid dispatch or change budgets.');
      await load(true);
    } catch (failure) {
      if (mounted.current && currentSession === session.current) setError(`${failure instanceof ManagerUiError ? failure.message : 'Control outcome is uncertain.'} Refresh the stored state before retrying; a lost response does not prove failure.`);
    } finally {
      clearTimeout(deadline);
      if (mounted.current && currentSession === session.current) { mutationLock.current = false; setBusy(false); }
    }
  };

  const controlForm = pending && <form aria-label="Review paid candidate control" onSubmit={event => { event.preventDefault(); void control(); }} className="rounded-lg border border-line bg-well p-4 space-y-3">
      <h3 className="font-bold text-ink">{pending.action === 'disable' ? 'Block paid candidate' : 'Remove manual candidate block'}</h3>
      <p className="text-sm text-body break-all">{pending.modelId}</p>
      <p className="text-sm text-muted">{pending.action === 'disable' ? 'Exclude this model from new candidate selections. Already-running requests are not cancelled.' : 'Remove only the manual block. Unreviewed, unavailable, stale or otherwise ineligible candidates remain blocked. This does not activate paid inference.'}</p>
      {!sameReview && <p role="status" className="text-sm text-warn">The snapshot or controls changed during review. Cancel and reopen using current status.</p>}
      <label className="block text-sm text-body">Audit reason (10–500 characters; no secrets)<textarea required minLength={10} maxLength={500} rows={3} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} className={`${input} block w-full mt-1`} /></label>
      <div className="flex flex-wrap gap-2"><button type="submit" className={button} disabled={!validAction}>{busy ? 'Recording candidate control…' : 'Confirm candidate control'}</button><button type="button" className={button} disabled={busy} onClick={() => setPending(null)}>Cancel paid control</button></div>
    </form>;

  return <section aria-label="Discounted PAID Builder Manager" className="rounded-xl border-2 border-line bg-card p-4 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-bold text-ink">Discounted PAID Builder Manager</h2><p className="text-sm text-muted">Separate from OpenRouter STRICT_FREE. Discounted offers are paid, never free. Manager controls change candidate blocks only. Live Surplus needs SURPLUS_API_KEY + AGENTV3_SURPLUS_BUILDER (and SURPLUS_REGISTRY_ENABLED for metadata); the connection check is optional and never activates production.</p></div>
      <button type="button" className={button} disabled={busy || loading} onClick={() => void load()}>{loading ? 'Reading manager…' : 'Refresh paid status'}</button>
    </div>
    <p className="text-sm text-body">Status is read every 30 seconds while open. Provider metadata is synchronized by the server, not continuously streamed. Status reads never make paid calls. The separate connection test below requires an explicit action and its own server-side safeguards.</p>
    {error && <p role="alert" className="text-sm text-danger">{error}{view ? ' The last received snapshot is unconfirmed; controls are blocked until refresh succeeds.' : ''}</p>}
    {notice && <p role="status" className="text-sm text-body">{notice}</p>}
    {!view && <p role="status" className="text-sm text-muted">{error ? 'Manager unavailable. No candidate status has been verified.' : 'Reading discounted builder status…'}</p>}
    {view && <>
      <dl className="grid sm:grid-cols-2 gap-3 text-sm text-body">
        <div><dt className="font-bold">Observation service</dt><dd>{view.status.replaceAll('_', ' ')} · {view.enabled ? 'Configured on' : 'Disabled by server configuration'}</dd></div>
        <div><dt className="font-bold">Configured candidate universe</dt><dd>{view.configuredUniverse.length} of at most {view.maxModels}; not a benchmark ranking or quality approval</dd></div>
        <div><dt className="font-bold">Paid dispatch authority</dt><dd>Not granted by this manager. Independent builder safeguards still apply.</dd></div>
        <div><dt className="font-bold">Discount and spending safeguards</dt><dd>90% minimum discount retained. No budget increase or production activation control.</dd></div>
        <div><dt className="font-bold">Metadata sync target / freshness limit</dt><dd>{view.intervalMs / 1000} / {view.freshnessMs / 1000} seconds; not an instantaneous quote</dd></div>
        <div><dt className="font-bold">Last successful sync</dt><dd>{timestamp(view.lastSuccessAt)}</dd></div>
        <div><dt className="font-bold">Last sync attempt / next allowed attempt</dt><dd>{timestamp(view.lastAttemptAt)} / {timestamp(view.nextAllowedAt)}</dd></div>
        <div><dt className="font-bold">Snapshot age / expiry</dt><dd>{age(view.fetchedAt, now)} / {timestamp(view.expiresAt)}</dd></div>
        <div><dt className="font-bold">Snapshot version / controls revision</dt><dd className="break-all">{view.version ?? 'Not published'} / {view.controlRevision ?? 'Unknown'}</dd></div>
        <div><dt className="font-bold">Estimate workload (tokens)</dt><dd>{dimensions.map(d => `${d}: ${view.workload[d]}`).join(' · ')}. Actual request costs can differ.</dd></div>
      </dl>
      {stale && <p role="status" className="text-sm text-warn">Stale observations or unconfirmed clock. Availability and candidate eligibility are unconfirmed until a fresh snapshot is published.</p>}
      {view.lastError && <p className="text-sm text-warn">Last sync state: {view.lastError.replaceAll('_', ' ')}. No successful refresh is implied.</p>}
      <details><summary className="cursor-pointer font-bold text-sm text-ink">Verification limitations</summary><ul className="list-disc pl-5 text-sm text-muted">{view.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></details>
      {view.models.length === 0 && <p className="text-sm text-muted">No verified candidate details are available in this manager view.</p>}
      {view.models.map(model => <div key={model.modelId} className="space-y-2"><SurplusModelCard model={model} now={now} fresh={readable && !stale && view.status === 'observed'} controlsAvailable={controlsAvailable} onControl={() => openControl(model)} />{pending?.modelId === model.modelId && controlForm}</div>)}
    </>}
    <SurplusConnectionTestPanel adminToken={adminToken} />
  </section>;
}

export function SurplusModelCard({ model, now, fresh, controlsAvailable, onControl }: { model: SurplusManagerModel; now: number; fresh: boolean; controlsAvailable: boolean; onControl: () => void }): React.ReactElement {
  const available = model.observations.some(offer => offer.available);
  const candidate = fresh && !model.disabled && model.qualityReviewStatus === 'reviewed' && model.blockedReasons.every(reason => reason === 'dispatch_authority_not_evaluated') ? model.estimatedCandidate : null;
  return <article className="rounded-lg border border-line p-4 space-y-2">
    <h3 className="font-bold text-ink break-all">{model.modelId}</h3>
    <dl className="grid sm:grid-cols-2 gap-2 text-sm text-body">
      <div><dt className="font-bold">Configured candidate</dt><dd>Yes; {model.disabled ? 'manual block recorded' : fresh ? 'no manual block recorded at last read' : 'manual block state unconfirmed'}</dd></div>
      <div><dt className="font-bold">Independent quality approval</dt><dd>{!fresh ? 'Unconfirmed from current status' : model.qualityReviewStatus === 'reviewed' ? 'Independent review recorded at last status read; dispatch checks remain' : model.qualityReviewStatus === 'expired' ? 'Review expired' : 'Not independently approved'}</dd></div>
      <div><dt className="font-bold">Provider-reported availability</dt><dd>{!fresh ? 'Unconfirmed / stale' : model.observations.length === 0 ? 'Unknown; no qualifying observation' : available ? 'Reported available; not a reservation or dispatch guarantee' : 'Reported unavailable'}</dd></div>
      <div><dt className="font-bold">Candidate eligibility</dt><dd>{candidate ? `Estimate only: ${candidate.estimatedMicroUsd} micro-USD for the displayed workload. Not dispatch permission.` : 'Not confirmed eligible; paid dispatch is not authorized here'}</dd></div>
    </dl>
    {model.blockedReasons.length > 0 && <p className="text-sm text-warn">Blocking reasons: {model.blockedReasons.map(reason => reason.replaceAll('_', ' ')).join('; ')}</p>}
    <details><summary className="cursor-pointer font-bold text-sm text-ink">Observed prices and sources ({model.observations.length})</summary>
      <p className="text-sm text-muted">Raw source rate units are unverified. Do not interpret them as USD, free prices or a guaranteed invoice. Missing cache and reasoning prices remain unknown.</p>
      {model.observations.map(offer => {
        const source = sourceLink(offer.sourceUrl);
        return <div key={`${offer.providerId}:${offer.offerId}`} className="border-t border-line pt-3 mt-3 space-y-1 text-sm text-body">
          <p className="break-all">Provider: {offer.providerId} · Offer: {offer.offerId}</p>
          <p>Reported discount: {offer.discountPct === null ? 'Unknown' : `${offer.discountPct}%`} · Health: {offer.healthy ? 'Reported healthy' : 'Not reported healthy'} · Provider trust: {offer.providerTrustConfirmed ? 'Listed trusted in provider catalog; not a quality benchmark' : 'Not independently confirmed'}</p>
          <p>Observation: {timestamp(offer.observedAt)} · Age: {age(offer.observedAt, now)} · Origin generation time: {timestamp(offer.upstreamGeneratedAt)}</p>
          <p>Source HTTP date: {timestamp(offer.sourceDate)} · Source cache age: {offer.sourceAgeSeconds === null ? 'Unknown' : `${offer.sourceAgeSeconds} seconds`} · Cache max age: {offer.cacheMaxAgeSeconds === null ? 'Unknown' : `${offer.cacheMaxAgeSeconds} seconds`}</p>
          <dl className="grid sm:grid-cols-2 gap-1">{dimensions.map(d => <div key={d}><dt>{d} rate / reference (raw units)</dt><dd>{offer.rates[d] ?? 'Unknown'} / {offer.referenceRates[d] ?? 'Unknown'}</dd></div>)}</dl>
          {source ? <a className="underline text-accent-text" href={source} target="_blank" rel="noopener noreferrer">Official offer metadata source</a> : <p className="text-muted">Official source link unavailable.</p>}
        </div>;
      })}
    </details>
    <button type="button" className={button} disabled={!controlsAvailable} onClick={onControl}>{model.disabled ? 'Remove manual block' : 'Block candidate'}</button>
  </article>;
}

const connectionLabels: Record<SurplusConnectionTestStatus['status'], string> = {
  ready: 'Ready for one connection test',
  blocked_configuration: 'Blocked: server configuration is not ready',
  blocked_budget_review: 'Blocked: independently reviewed spending or automatic-funding protection is missing or invalid',
  unavailable: 'Saved status unavailable; do not run or repeat the test',
  unknown_liability_hold: 'Pending or uncertain outcome; possible charge held for review. Do not repeat.',
  passed: 'Connection test passed',
  failed: 'Connection test failed; no retry is permitted here',
  budget_exceeded: 'Reported test cost exceeded the reviewed spending limit; no retry is permitted',
};
/** Only fixed, bounded server fields may become connection or price claims. */
export function isSurplusConnectionTestStatus(value: unknown): value is SurplusConnectionTestStatus {
  if (!record(value) || Object.keys(value).length !== 6
    || !Object.keys(value).every(key => ['status', 'environmentConfigured', 'productionFlagsOff', 'latencyMs', 'actualCostUsd', 'expectedResponse'].includes(key))
    || typeof value.status !== 'string' || !Object.hasOwn(connectionLabels, value.status)
    || typeof value.environmentConfigured !== 'boolean' || typeof value.productionFlagsOff !== 'boolean'
    || !(value.latencyMs === null || Number.isSafeInteger(value.latencyMs) && (value.latencyMs as number) >= 0)
    || !(value.actualCostUsd === null || typeof value.actualCostUsd === 'string' && /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(value.actualCostUsd))
    || !['not_checked', 'matched', 'mismatched'].includes(String(value.expectedResponse))) return false;
  if (value.status === 'ready' && (!value.environmentConfigured || !value.productionFlagsOff || value.latencyMs !== null || value.actualCostUsd !== null || value.expectedResponse !== 'not_checked')) return false;
  if (value.status === 'passed' && (value.expectedResponse !== 'matched' || value.actualCostUsd === null || Number(value.actualCostUsd) > 1 || value.latencyMs === null)) return false;
  return true;
}

/** A cached GET never dispatches. Only this section's explicit POST can request the one-shot test. */
export function SurplusConnectionTestPanel({ adminToken }: { adminToken: string }): React.ReactElement {
  const [status, setStatus] = useState<SurplusConnectionTestStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [credentialResult, setCredentialResult] = useState<'accepted' | 'rejected' | 'unavailable' | null>(null);
  const [checkingCredential, setCheckingCredential] = useState(false);
  const credentialLock = useRef(false), credentialRequest = useRef<AbortController | null>(null);
  const mounted = useRef(false), attemptLock = useRef(false), mutationLock = useRef(false);
  const session = useRef(0), readSequence = useRef(0);
  const readRequest = useRef<AbortController | null>(null), writeRequest = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (mutationLock.current) return;
    const currentSession = session.current, sequence = ++readSequence.current;
    readRequest.current?.abort();
    const controller = new AbortController(); readRequest.current = controller;
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
    setLoading(true);
    try {
      const response = await fetch(`${ROOT}/connection-test`, { headers: adminHeaders(adminToken), signal: controller.signal });
      if (!response.ok) throw new ManagerUiError(response.status === 401 || response.status === 403 ? 'Admin sign-in or authorization required.' : 'Connection test status is unavailable.');
      const body: unknown = await response.json();
      if (!isSurplusConnectionTestStatus(body)) throw new ManagerUiError('Connection test status is incomplete or unreadable.');
      if (!mounted.current || currentSession !== session.current || sequence !== readSequence.current) return;
      setStatus(body); setError('');
    } catch (failure) {
      if (mounted.current && currentSession === session.current && sequence === readSequence.current && (!controller.signal.aborted || timedOut)) {
        setError(timedOut ? 'Connection test status read timed out.' : failure instanceof ManagerUiError ? failure.message : 'Connection test status is unavailable.');
      }
    } finally {
      clearTimeout(deadline);
      if (mounted.current && currentSession === session.current && sequence === readSequence.current) setLoading(false);
    }
  }, [adminToken]);
  useEffect(() => {
    mounted.current = true; attemptLock.current = false; mutationLock.current = false;
    setStatus(null); setError(''); setLoading(false); setTesting(false); setAttempted(false);
    setCredentialResult(null); setCheckingCredential(false); credentialLock.current = false;
    void load();
    const refresh = setInterval(() => { void load(); }, 30_000);
    return () => { mounted.current = false; session.current++; readSequence.current++; readRequest.current?.abort(); writeRequest.current?.abort(); credentialRequest.current?.abort(); clearInterval(refresh); };
  }, [load]);
  const canTest = status?.status === 'ready' && status.environmentConfigured && status.productionFlagsOff && !error && !loading && !testing && !checkingCredential && !attempted;
  const testConnection = async () => {
    if (!canTest || attemptLock.current || mutationLock.current || credentialLock.current) return;
    // A lost HTTP response is not proof that no charge occurred. Never re-arm from a later ready read.
    attemptLock.current = true; mutationLock.current = true; setAttempted(true); setTesting(true); setError('');
    const currentSession = session.current;
    readSequence.current++; readRequest.current?.abort(); setLoading(false);
    const controller = new AbortController(); writeRequest.current = controller;
    const deadline = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(`${ROOT}/connection-test`, { method: 'POST', headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal });
      if (!mounted.current || currentSession !== session.current) return;
      if (!response.ok) throw new ManagerUiError(response.status === 401 || response.status === 403 ? 'Admin sign-in or authorization required.' : 'Connection test outcome was not confirmed.');
      const body: unknown = await response.json();
      if (!mounted.current || currentSession !== session.current) return;
      if (!isSurplusConnectionTestStatus(body)) throw new ManagerUiError('Connection test response was unreadable.');
      setStatus(body);
    } catch (failure) {
      if (mounted.current && currentSession === session.current) setError(`${failure instanceof ManagerUiError ? failure.message : 'Connection test outcome is uncertain.'} A possible charge cannot be ruled out. Read saved status; do not repeat the test.`);
    } finally {
      clearTimeout(deadline);
      if (mounted.current && currentSession === session.current) { mutationLock.current = false; setTesting(false); }
    }
  };
  const checkCredential = async () => {
    if (!status?.environmentConfigured || !status.productionFlagsOff || error || loading || testing || mutationLock.current || credentialLock.current) return;
    credentialLock.current = true; setCheckingCredential(true); setCredentialResult(null);
    const currentSession = session.current;
    const controller = new AbortController(); credentialRequest.current = controller;
    const deadline = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${ROOT}/credential-check`, { method: 'POST', headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal });
      if (!response.ok) throw new Error('unavailable');
      const body: unknown = await response.json();
      if (!record(body) || Object.keys(body).length !== 1 || !['accepted', 'rejected', 'unavailable'].includes(String(body.status))) throw new Error('unavailable');
      if (mounted.current && currentSession === session.current) setCredentialResult(body.status as 'accepted' | 'rejected' | 'unavailable');
    } catch {
      if (mounted.current && currentSession === session.current) setCredentialResult('unavailable');
    } finally {
      clearTimeout(deadline);
      if (mounted.current && currentSession === session.current) { credentialLock.current = false; setCheckingCredential(false); }
    }
  };
  const confirmed = !!status && !error;
  return <section aria-label="One-shot connection test" className="rounded-lg border border-line bg-well p-4 space-y-3">
    <h3 className="font-bold text-ink">Connection test</h3>
    <p className="text-sm text-muted">Independent of whether the observation manager is enabled. Uses only the saved server credential, which is never shown or entered here. Optional while Surplus is live (key + AGENTV3_SURPLUS_BUILDER).</p>
    <p className="text-sm text-muted">One fixed, short request expects “OK”. This checks connection only, not coding quality, model quality or a benchmark. The approved ceiling is $1 USD. Optional diagnostic only under the live key+flag architecture (no Firestore budget-review seed required). A token estimate is not a spending guarantee. This button cannot change production flags or budgets.</p>
    <div className="rounded-lg border border-line p-3 space-y-2">
      <p className="text-sm text-body">Saved credential check: a separate, non-inference account authentication request. It does not spend the paid test allowance or approve output quality.</p>
      <button type="button" className={button} disabled={!status?.environmentConfigured || !status.productionFlagsOff || !!error || loading || testing || checkingCredential} onClick={() => void checkCredential()}>{checkingCredential ? 'Checking saved credential…' : 'Check saved credential'}</button>
      {credentialResult && <p role="status" className="text-sm text-body">{credentialResult === 'accepted' ? 'Saved credential accepted for account authentication only. Paid output and coding quality remain unverified.' : credentialResult === 'rejected' ? 'Saved credential was rejected. No key value or account data is shown.' : 'Saved credential check permission-limited or temporarily unavailable. Acceptance is not confirmed; this does not establish an invalid key.'}</p>}
    </div>
    {error && <p role="alert" className="text-sm text-danger">{error} Last received status is unconfirmed; testing is blocked.</p>}
    <dl className="grid sm:grid-cols-2 gap-3 text-sm text-body">
      <div><dt className="font-bold">Server credential configuration</dt><dd>{!confirmed ? 'Unknown / not confirmed' : status.environmentConfigured ? 'Configured on the server; not yet proof of a working connection' : 'Not configured or not valid for this server test'}</dd></div>
      <div><dt className="font-bold">Production flags</dt><dd>{!confirmed ? 'Unknown / not confirmed' : status.productionFlagsOff ? 'Builder off · Discovery off' : 'Both flags are not verified off; testing is blocked'}</dd></div>
      <div><dt className="font-bold">Saved connection test status</dt><dd role="status">{testing ? 'Test requested; outcome pending. Do not repeat.' : !confirmed ? 'Unknown / not confirmed' : connectionLabels[status.status]}</dd></div>
      <div><dt className="font-bold">Latency</dt><dd>{confirmed && status.latencyMs !== null ? `${status.latencyMs} ms` : 'Unknown / not recorded'}</dd></div>
      <div><dt className="font-bold">Provider-reported actual test cost (USD)</dt><dd>{confirmed && status.actualCostUsd !== null ? `$${status.actualCostUsd} USD (reported; not an estimate)` : 'Unknown; no zero-cost claim'}</dd></div>
      <div><dt className="font-bold">Expected short response</dt><dd>{!confirmed || status.expectedResponse === 'not_checked' ? 'Not verified' : status.expectedResponse === 'matched' ? 'Matched OK' : 'Did not match OK'}</dd></div>
    </dl>
    {attempted && !testing && <p className="text-sm text-warn">A test was already requested in this session. No repeat or automatic retry is available. Refresh reads saved status only.{(!confirmed || status.status === 'ready' || status.status === 'unavailable' || status.status === 'unknown_liability_hold') && ' A possible charge cannot be ruled out until the saved result is confirmed.'}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={!canTest} onClick={() => void testConnection()}>{testing ? 'Testing connection…' : 'Test connection'}</button>
      <button type="button" className={button} disabled={loading || testing} onClick={() => void load()}>{loading ? 'Reading connection status…' : 'Refresh connection status'}</button>
    </div>
    <p className="text-sm text-muted">Saved status is read every 30 seconds while open. Reads never send a provider request. Pending, uncertain, blocked and completed tests cannot be repeated here.</p>
  </section>;
}
