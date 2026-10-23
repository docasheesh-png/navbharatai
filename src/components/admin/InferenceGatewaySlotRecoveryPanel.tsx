import React, { useEffect, useRef, useState } from 'react';
import { adminHeaders } from '../../lib/adminFetch';
import { isGatewaySlotRecoveryPreview, type GatewaySlotRecoveryPreview, type GatewaySlotRecoverySubmission } from '../../lib/inferenceGatewaySetup';

const PREVIEW = '/api/v1/admin/inference-gateway/setup/preview';
const REVIEW = '/api/v1/admin/inference-gateway/setup/review';
const input = 'min-h-11 w-full rounded border border-line bg-well p-2 text-ink';
const button = 'min-h-11 rounded border border-line px-4 py-2 text-sm disabled:opacity-40';
const REVIEW_AGE_MS = 900_000;
class RecoveryUiError extends Error {}
const message = (error: unknown) => error instanceof RecoveryUiError ? error.message : 'The operation could not be confirmed. Refresh saved occupancy before continuing; do not assume the slot was released.';

/** An independent provider completion record is required. This is not a timeout/reset control. */
export function InferenceGatewaySlotRecoveryPanel({ adminToken, onRecovered }: { adminToken: string; onRecovered?: () => void }): React.ReactElement {
  const [preview, setPreview] = useState<GatewaySlotRecoveryPreview | null>(null);
  const [submission, setSubmission] = useState<GatewaySlotRecoverySubmission | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now);
  const form = useRef<HTMLFormElement | null>(null); const lock = useRef(false); const mounted = useRef(false);
  const epoch = useRef(0); const request = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true; epoch.current++; lock.current = false;
    setPreview(null); setSubmission(null); setError(''); setNotice(''); setBusy(false);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { mounted.current = false; epoch.current++; request.current?.abort(); clearInterval(timer); };
  }, [adminToken]);
  const post = async (url: string, body: unknown): Promise<unknown> => {
    const controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, { method: 'POST', headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) throw new RecoveryUiError(response.status === 401 || response.status === 403 ? 'Admin sign-in is required.'
        : response.status === 409 ? 'The exact attempt or occupancy changed. Refresh saved occupancy and review the provider record again.'
          : response.status === 400 ? 'The completion evidence is incomplete or invalid. Nothing was confirmed.'
            : 'The recovery outcome is unconfirmed. Refresh saved occupancy before continuing.');
      return await response.json();
    } finally { clearTimeout(timeout); }
  };
  const clear = () => { if (lock.current) return; setPreview(null); setSubmission(null); setNotice(''); setError(''); };
  const review = async (event: React.FormEvent) => {
    event.preventDefault(); if (lock.current || !form.current) return;
    const fields = new FormData(form.current); const text = (key: string) => String(fields.get(key) ?? '').trim();
    if (!['providerRecordVerified', 'exactAttemptMatched', 'upstreamFinished'].every(k => fields.get(k) === 'on')) {
      setError('All three independent provider-record checks are required. Elapsed time or local logs are not completion evidence.'); return;
    }
    // Re-preview after an uncertain save reuses the exact operation, never a fresh mutation ID.
    const candidate: GatewaySlotRecoverySubmission = submission ?? {
      kind: 'model-slot-recovery', operationId: crypto.randomUUID(), canonicalAccountId: text('canonicalAccountId'),
      modelId: text('modelId') as GatewaySlotRecoverySubmission['modelId'], physicalAttemptId: text('physicalAttemptId'),
      providerRequestId: text('providerRequestId'), evidenceRef: text('evidenceRef'), providerCompletedAtMs: new Date(text('providerCompletedAt')).getTime(),
      reviewedAtMs: Date.now(), providerRecordVerified: true, exactAttemptMatched: true, upstreamFinished: true, reason: text('reason'),
    };
    if (!Number.isSafeInteger(candidate.providerCompletedAtMs) || candidate.providerCompletedAtMs > Date.now()) { setError('Enter the actual provider completion time, not a future time.'); return; }
    lock.current = true; setBusy(true); setError(''); setNotice(''); setPreview(null); setSubmission(candidate); const version = epoch.current;
    try {
      const result = await post(PREVIEW, candidate);
      if (!isGatewaySlotRecoveryPreview(result) || result.physicalAttemptId !== candidate.physicalAttemptId || result.canonicalAccountId !== candidate.canonicalAccountId || result.modelId !== candidate.modelId) {
        throw new RecoveryUiError('The exact recovery preview is incomplete or mismatched. No release was submitted.');
      }
      if (mounted.current && version === epoch.current) { setPreview(result); setNow(Date.now()); setNotice('Preview only. No slot, budget or quota has been changed.'); }
    } catch (e) { if (mounted.current && version === epoch.current) setError(message(e)); }
    finally { if (version === epoch.current) { lock.current = false; if (mounted.current) setBusy(false); } }
  };
  const stale = !!submission && (now < submission.reviewedAtMs || now - submission.reviewedAtMs >= REVIEW_AGE_MS);
  const save = async () => {
    if (lock.current || !preview || !submission || Date.now() < submission.reviewedAtMs || Date.now() - submission.reviewedAtMs >= REVIEW_AGE_MS) return;
    lock.current = true; setBusy(true); setError(''); const version = epoch.current;
    try {
      const value = await post(REVIEW, { submission, previewBinding: preview.previewBinding });
      const result = value as { ok?: unknown; operationId?: unknown; catalogRevision?: unknown; recovery?: unknown } | null;
      if (!result || result.ok !== true || result.recovery !== true || result.operationId !== submission.operationId || typeof result.catalogRevision !== 'string' || !result.catalogRevision) {
        throw new RecoveryUiError('The recovery response was incomplete. Refresh saved occupancy before another submission.');
      }
      if (mounted.current && version === epoch.current) {
        setNotice('The exact attempt slot release was confirmed. Financial holds, quotas, health and billing quarantine were not cleared. Refresh saved review status to inspect current occupancy.');
        setPreview(null); setSubmission(null);
        // A status-refresh failure cannot turn a confirmed recovery into an uncertain mutation.
        try { onRecovered?.(); } catch { /* The confirmed result remains visible; manual refresh is available. */ }
      }
    } catch (e) { if (mounted.current && version === epoch.current) { setError(message(e)); setPreview(null); setNotice('No automatic retry was sent. Keep this operation and refresh saved occupancy before revalidating the same evidence.'); } }
    finally { if (version === epoch.current) { lock.current = false; if (mounted.current) setBusy(false); } }
  };
  const field = (name: string, label: string, type = 'text') => <label className="block text-sm">{label}<input name={name} type={type} required maxLength={type === 'text' ? 120 : undefined} className={input} autoComplete="off" /></label>;
  return <section className="mt-6 space-y-3 rounded-xl border border-line p-4" aria-label="Exact attempt slot recovery">
    <h3 className="text-lg font-semibold">Recover a provider-confirmed finished attempt</h3>
    <p className="text-sm">Use only an independently reviewed provider completion record for this exact account, model and attempt. A timeout, disconnect, elapsed time or local log is not proof that the upstream job stopped. Without that evidence, leave the slot occupied.</p>
    <p className="text-sm">This releases only one Gateway-owned concurrency slot. It does not refund money, replenish quota, clear health or billing quarantine, enable routing, or affect other products sharing the provider account.</p>
    {error && <p role="alert" className="text-danger">{error}</p>}{notice && <p role="status">{notice}</p>}
    <form ref={form} onSubmit={review} onChange={clear}>
      <fieldset disabled={busy} className="space-y-3">
        {field('canonicalAccountId', 'Canonical provider account ID')}
        <label className="block text-sm">Exact model<select name="modelId" required className={input} defaultValue=""><option value="" disabled>Select the reviewed model</option>{['glm-4.7-flash', 'glm-4.5-flash', 'glm-4.6v-flash'].map(id => <option key={id}>{id}</option>)}</select></label>
        {field('physicalAttemptId', 'Exact occupied physical attempt ID')}{field('providerRequestId', 'Provider completion record request ID')}
        {field('evidenceRef', 'Independent review reference (review:ticket-id)')}{field('providerCompletedAt', 'Provider-confirmed completion time (your local time)', 'datetime-local')}
        <label className="block text-sm">Audit reason (10–500 characters, no secrets)<textarea name="reason" required minLength={10} maxLength={500} className={input} /></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" name="providerRecordVerified" required />I independently verified the provider completion record, not merely local application logs.</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" name="exactAttemptMatched" required />The provider record matches this exact account, model and physical attempt.</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" name="upstreamFinished" required />The provider record confirms the upstream job has finished.</label>
        <p className="text-sm">Do not paste credentials, prompts, personal data or raw provider records. Reference the separately reviewed evidence only.</p>
        <button type="submit" className={button} disabled={busy}>Preview exact slot recovery</button>
        <button type="button" className={button} disabled={busy} onClick={clear}>Cancel recovery review</button>
      </fieldset>
    </form>
    {preview && submission && <div className="space-y-2 rounded border border-line p-3" aria-label="Exact slot recovery preview">
      <p>Account {preview.canonicalAccountId}; model {preview.modelId}; attempt {preview.physicalAttemptId}.</p>
      <p>Currently occupied Gateway slots: {preview.occupied}. Only this exact attempt is eligible for release.</p>
      <p>Provider record {submission.providerRequestId}; independent evidence {submission.evidenceRef}; completed {new Date(submission.providerCompletedAtMs).toISOString()}.</p>
      <p>Evidence basis: administrator-reviewed provider record, not automatic provider verification. Financial writes: none.</p>
      {stale && <p role="alert">This review expired. Refresh saved occupancy and recheck the independent evidence.</p>}
      <button type="button" className={button} disabled={busy || stale} onClick={() => void save()}>Confirm exact slot release</button>
    </div>}
  </section>;
}
