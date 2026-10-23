import React, { useCallback, useEffect, useRef, useState } from 'react';
import { adminHeaders } from '../../lib/adminFetch';
import { GATEWAY_ATTESTATIONS, GATEWAY_REVIEW_FIELDS, GATEWAY_SETUP_PROVIDERS, isGatewaySetupPreview, isGatewaySetupStatus,
  type GatewaySetupSubmission, type GatewaySetupStatus, type GatewaySetupPreview } from '../../lib/inferenceGatewaySetup';

const ENDPOINTS = {
  status: '/api/v1/admin/inference-gateway/setup',
  preview: '/api/v1/admin/inference-gateway/setup/preview',
  review: '/api/v1/admin/inference-gateway/setup/review',
} as const;
const input = 'min-h-11 w-full rounded border border-line bg-well p-2 text-ink';
const button = 'min-h-11 rounded border border-line px-4 py-2 text-sm disabled:opacity-40';
const labels: Record<typeof GATEWAY_ATTESTATIONS[number], string> = {
  accountOwnership: 'I verified this canonical provider account and the selected credential generation belong to the stated platform owner.',
  productionUse: 'The exact API product and model are permitted for this production service, not a coding subscription or evaluation-only entitlement.',
  terms: 'I reviewed the actual terms for the selected audience and regions.', privacy: 'I reviewed retention, processing regions and all selected data classes.',
  quality: 'The exact model revision passed the named quality gate for every selected scope.',
  exactPricing: 'I independently verified the exact model, endpoint and account billing boundary. A successful request is not pricing evidence.',
  noTraining: 'These selected private scopes are excluded from provider training.', noHumanReview: 'These selected private scopes are excluded from provider human review.',
  localQuotaOnly: 'This local cap is pressure control only; units are shown in the preview. The upstream remaining balance is unknown; rotating keys does not add capacity.',
};
/** Typed review form only; neither rendering nor refreshing performs inference. */
export function InferenceGatewaySetupPanel({ adminToken }: { adminToken: string }): React.ReactElement {
  const [status, setStatus] = useState<GatewaySetupStatus | null>(null);
  const [preview, setPreview] = useState<GatewaySetupPreview | null>(null);
  const [submission, setSubmission] = useState<GatewaySetupSubmission | null>(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState('text');
  const [provider, setProvider] = useState<string>('GLM'); const [billing, setBilling] = useState(''); const [now, setNow] = useState(Date.now);
  const mounted = useRef(false); const lock = useRef(false); const epoch = useRef(0); const request = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement | null>(null);
  const run = useCallback(async (path: string, body?: unknown): Promise<unknown> => {
    const controller = new AbortController(); request.current = controller;
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
        headers: { ...adminHeaders(adminToken), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal });
      const result: unknown = await response.json();
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Admin sign-in is required.'
        : response.status === 409 ? 'The review or credential association changed. Refresh and preview again.'
          : response.status === 400 ? 'Review is incomplete, contradictory, expired or outside supported Free capability scopes. No changes were saved.'
            : 'The operation could not be confirmed. Refresh saved status before another submission.');
      return result;
    } finally { clearTimeout(timer); }
  }, [adminToken]);
  const load = useCallback(async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setPreview(null); setSubmission(null); const version = epoch.current;
    try {
      const body = await run(ENDPOINTS.status); if (!isGatewaySetupStatus(body)) throw new Error('Saved review status is incomplete. Readiness cannot be confirmed.');
      if (mounted.current && version === epoch.current) { setStatus(body); setError(''); setNow(Date.now()); }
    } catch (e) { if (mounted.current && version === epoch.current) { setError(e instanceof Error && e.name !== 'AbortError' ? e.message : 'Status read timed out. Refresh to verify.'); setStatus(null); } }
    finally { if (version === epoch.current) { lock.current = false; if (mounted.current) setBusy(false); } }
  }, [run]);
  useEffect(() => {
    mounted.current = true; epoch.current++; lock.current = false; setStatus(null); setPreview(null); setSubmission(null); setError(''); setNotice('');
    void load(); const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { mounted.current = false; epoch.current++; request.current?.abort(); clearInterval(tick); };
  }, [load]);
  const clearPreview = () => { setPreview(null); setSubmission(null); setNotice(''); };
  const review = async (event: React.FormEvent) => {
    event.preventDefault(); if (lock.current || !status || !form.current) return;
    const fields = new FormData(form.current); const text = (key: string) => String(fields.get(key) ?? '').trim();
    const number = (key: string) => Number(text(key)); const at = Date.now();
    const candidate: GatewaySetupSubmission = {
      operationId: crypto.randomUUID(), expectedCatalogRevision: status.catalogRevision,
      ...(text('recoverHealth') === 'on' ? { recoverHealth: true } : {}),
      profileId: text('profileId'), provider: text('provider') as GatewaySetupSubmission['provider'], modelId: text('modelId'), modelRevision: text('modelRevision'), canonicalModelId: text('canonicalModelId'),
      canonicalAccountId: text('canonicalAccountId'), credentialEnv: text('credentialEnv'), platformOwnerId: text('platformOwnerId'),
      policyKeys: fields.getAll('policyKeys').map(String), termsPolicyId: text('termsPolicyId'), qualityGateId: text('qualityGateId'), qualityGateVersion: text('qualityGateVersion'), privacyPolicyId: text('privacyPolicyId'),
      processingRegions: text('processingRegions').split(',').map(s => s.trim()).filter(Boolean), retentionHours: number('retentionHours'), maxInputTokens: number('maxInputTokens'), maxOutputTokens: number('maxOutputTokens'),
      maxContextTokens: number('maxContextTokens'), localTokensPerMinute: number('localTokensPerMinute'), billing: text('billing') as GatewaySetupSubmission['billing'],
      ...(text('reviewedPriority') ? { reviewedPriority: number('reviewedPriority') } : {}),
      ...(billing === 'metered' && (operation === 'text' || operation === 'vision-pdf') ? { inputNanoUsdPerMillion: number('inputNanoUsdPerMillion'), outputNanoUsdPerMillion: number('outputNanoUsdPerMillion') } : {}),
      ...(operation === 'embedding' ? { operation: { kind: 'embedding' as const, project: text('project'), location: text('location'), credentialPrincipal: text('credentialPrincipal'),
        maxInputBytes: number('maxInputBytes'), maxNanoUsdPerCharacter: number('maxNanoUsdPerCharacter') } }
        : operation === 'grounding-search' ? { operation: { kind: 'grounding-search' as const, maxQueryBytes: number('maxQueryBytes'), maxResults: number('maxResults'), requestNanoUsd: number('requestNanoUsd') } }
        : operation === 'vision-pdf' ? { operation: { kind: 'vision-pdf' as const, maxImages: number('maxImages'), maxPdfPages: provider === 'GEMINI' && text('mediaRequestKind') !== 'image' ? 1000 as const : 0 as const,
          maxAttachmentBytes: number('maxAttachmentBytes'), maxImageDimension: number('maxImageDimension') } } : {}),
      ...(provider === 'OPENROUTER' ? { endpointTag: text('endpointTag'), registryVersion: text('registryVersion') } : {}),
      reviewedAtMs: at, expiresAtMs: new Date(text('expiresAt')).getTime(),
      evidence: Object.fromEntries(GATEWAY_REVIEW_FIELDS.map(k => [k, text(`evidence.${k}`)])) as GatewaySetupSubmission['evidence'],
      attestations: Object.fromEntries(GATEWAY_ATTESTATIONS.map(k => [k, fields.get(`attest.${k}`) === 'on'])) as GatewaySetupSubmission['attestations'], reason: text('reason'),
    };
    lock.current = true; setBusy(true); setError(''); setPreview(null); const version = epoch.current;
    try {
      const body = await run(ENDPOINTS.preview, candidate);
      if (!isGatewaySetupPreview(body)) throw new Error('The review preview is incomplete. Nothing has been saved.');
      if (mounted.current && version === epoch.current) { setPreview(body); setSubmission(candidate); setNotice('Review the exact scope below. Preview has not saved anything.'); }
    } catch (e) { if (mounted.current && version === epoch.current) setError(e instanceof Error && e.name !== 'AbortError' ? e.message : 'Preview timed out. Nothing was submitted for saving.'); }
    finally { if (version === epoch.current) { lock.current = false; if (mounted.current) setBusy(false); } }
  };
  const save = async () => {
    if (lock.current || !preview || !submission || !status || preview.expiresAtMs <= Date.now() || Date.now() - submission.reviewedAtMs > 300_000
      || status.catalogRevision !== submission.expectedCatalogRevision) return;
    lock.current = true; setBusy(true); setError(''); const version = epoch.current;
    try {
      const result = await run(ENDPOINTS.review, { submission, previewBinding: preview.previewBinding }) as { ok?: boolean; catalogRevision?: string; operationId?: string };
      if (result?.ok !== true || result.catalogRevision !== submission.operationId || result.operationId !== submission.operationId) throw new Error('Save response was incomplete. Refresh saved status before retrying.');
      if (mounted.current && version === epoch.current) {
        setNotice('Review saved atomically. Routing activation and the shared paid budget were not changed.'); setPreview(null); setSubmission(null);
        // A confirmed save still needs a fresh status observation; do not manufacture a ready state.
        setStatus(null);
      }
    } catch (e) { if (mounted.current && version === epoch.current) { setError(e instanceof Error && e.name !== 'AbortError' ? e.message : 'Save outcome is uncertain. Refresh saved status before retrying.'); setPreview(null); setSubmission(null); setStatus(null); } }
    finally { if (version === epoch.current) { lock.current = false; if (mounted.current) setBusy(false); } }
  };
  const field = (name: string, label: string, type = 'text') => <label key={name} className="block text-sm">{label}<input name={name} type={type} required maxLength={type === 'text' ? 120 : undefined} className={input} autoComplete="off" /></label>;
  const stale = !!preview && (preview.expiresAtMs <= now || !submission || now - submission.reviewedAtMs > 300_000);
  return <section className="mt-6 space-y-4 rounded-xl border border-line p-4" aria-label="Free capability gateway review setup">
    <h2 className="text-lg font-semibold">Free capability gateway review setup</h2>
    <p className="text-sm">Saved human reviews, not live provider verification. Upstream remaining capacity is unknown. Local counters do not prove a free allowance.</p>
    <p className="text-sm">Pro App Builder, paid Doctor/SDA, image generation, wallets and hosting are excluded. Gemini unpaid is not offered for these private scopes. No accounts or credentials are created here.</p>
    <button className={button} type="button" disabled={busy} onClick={() => void load()}>Refresh saved review status</button>
    {error && <p role="alert" className="text-danger">{error}</p>}{notice && <p role="status">{notice}</p>}
    {status && <div className="space-y-2 text-sm">
      <p>Deployment routing: {status.deploymentEnabled ? 'ON (not changed here)' : 'OFF'}. Saved review: {status.reviewState}. Revision: {status.catalogRevision ?? 'none'}.</p>
      <p>Catalog expiry: {status.expiresAtMs === null ? 'no review' : new Date(status.expiresAtMs).toISOString()}. Paid authority: {status.paidAuthority === 'missing' ? 'missing; no paid spending authorized' : `existing shared cap USD ${status.paidCapUsd?.toFixed(2)} per IST day`}.</p>
      {status.profiles.map(p => <p key={p.id}>{p.id}: {p.provider} / {p.modelId}, {p.operationKind ?? 'text'}, {p.expiresAtMs <= now ? 'expired' : p.reviewState}, {p.billing}; credential {p.credentialAssociated ? 'associated' : 'missing or changed'}. Expires {new Date(p.expiresAtMs).toISOString()}.</p>)}
    </div>}
    <form ref={form} onSubmit={review} onChange={clearPreview} className="space-y-4">
      <fieldset disabled={busy || !status} className="space-y-4">
        <legend>One exact model and capability review</legend>
        <label>Reviewed capability<select name="operation" className={input} value={operation} onChange={e => { setOperation(e.target.value); setProvider(e.target.value === 'embedding' ? 'VERTEX' : e.target.value === 'grounding-search' ? 'BRAVE' : 'GLM'); setBilling(''); }}>
          <option value="text">Text</option><option value="embedding">Existing Vertex memory embeddings</option><option value="grounding-search">Brave grounding search</option><option value="vision-pdf">Image understanding / reviewed PDF</option>
        </select></label>
        <p className="text-sm">Auxiliary scopes are derived from the selected authenticated Free parent scope. They share the same total paid cap, not a separate allowance.</p>
        <div className="grid gap-3 md:grid-cols-2">
          {field('profileId', 'Stable profile ID')}{field('canonicalModelId', 'Canonical underlying model ID')}{field('modelId', 'Exact provider model ID')}{field('modelRevision', 'Exact model revision')}
          <label>Provider<select name="provider" className={input} value={provider} onChange={e => { setProvider(e.target.value); setBilling(''); }}>{GATEWAY_SETUP_PROVIDERS.filter(p => operation === 'embedding' ? p === 'VERTEX' : operation === 'grounding-search' ? p === 'BRAVE' : operation === 'vision-pdf' ? ['GLM', 'GEMINI'].includes(p) : ['GLM', 'GROQ', 'CLOUDFLARE', 'OPENROUTER', 'DEEPSEEK'].includes(p)).map(p => <option key={p}>{p}</option>)}</select></label>
          {field('canonicalAccountId', 'Existing canonical provider account ID (never a key ID)')}{field('platformOwnerId', 'Platform owner ID')}
          <label>Optional reviewed priority (0–1000; lower preferred)<input name="reviewedPriority" type="number" min={0} max={1000} step={1} className={input} /></label>
          <label>Existing server credential environment<select name="credentialEnv" required className={input} defaultValue=""><option value="" disabled>Select an existing secret reference</option>{operation === 'embedding' && <option value="ADC">ADC: reviewed existing project and service account</option>}{status?.credentialEnvironments.map(k => <option key={k}>{k}</option>)}</select></label>
          <label>Explicit billing boundary<select name="billing" required className={input} value={billing} onChange={e => setBilling(e.target.value)}><option value="" disabled>Select reviewed evidence, never inferred</option>
            {(provider === 'GLM' || provider === 'OPENROUTER') && <option value="intrinsic-zero">Exact intrinsically zero-priced endpoint</option>}
            {(provider === 'GROQ' || provider === 'CLOUDFLARE') && <option value="provider-hard-stop">Proven provider hard-free stop, no paid overage</option>}
            {['DEEPSEEK', 'VERTEX', 'BRAVE', 'GEMINI'].includes(provider) && <option value="metered">Metered paid, existing shared authority only</option>}</select></label>
          {billing === 'metered' && (operation === 'text' || operation === 'vision-pdf') && <>{field('inputNanoUsdPerMillion', 'Input nano-USD per million tokens', 'number')}{field('outputNanoUsdPerMillion', 'Output nano-USD per million tokens', 'number')}</>}
          {operation === 'embedding' && <>{field('project', 'Existing Vertex project (must match configured project)')}{field('location', 'Reviewed Vertex region')}{field('credentialPrincipal', 'Existing service-account email (must match configured principal)')}{field('maxInputBytes', 'Maximum submitted UTF-8 bytes', 'number')}{field('maxNanoUsdPerCharacter', 'Reviewed maximum nano-USD per character (at least 25)', 'number')}</>}
          {operation === 'grounding-search' && <>{field('maxQueryBytes', 'Maximum query UTF-8 bytes (up to 4000)', 'number')}{field('maxResults', 'Maximum results (up to 20)', 'number')}{field('requestNanoUsd', 'Reviewed nano-USD per Search request (at least 5000000)', 'number')}</>}
          {operation === 'vision-pdf' && <>{field('maxImages', 'Maximum images (up to 8)', 'number')}{field('maxAttachmentBytes', 'Maximum image bytes (up to 5000000)', 'number')}{field('maxImageDimension', 'Maximum image width or height (up to 6000)', 'number')}</>}
          {provider === 'OPENROUTER' && <>{field('endpointTag', 'Exact reviewed endpoint tag')}{field('registryVersion', 'Existing live registry version')}</>}
        </div>
        <label className="block">Eligible authenticated Free parent scopes (select up to 8)
          <select name="policyKeys" className={input} required multiple size={6}>{status?.scopes.map(s => <option key={s.key} value={s.key}>{s.label}: {s.dataClass} / {s.qualityTier}</option>)}</select></label>
        <div className="grid gap-3 md:grid-cols-2">
          {field('termsPolicyId', 'Terms policy ID')}{field('qualityGateId', 'Quality gate ID')}{field('qualityGateVersion', 'Quality gate version')}{field('privacyPolicyId', 'Privacy policy ID')}
          {field('processingRegions', 'Reviewed processing regions, comma-separated')}{field('retentionHours', 'Maximum retention hours', 'number')}
          {field('maxInputTokens', 'Reviewed maximum input tokens', 'number')}{field('maxOutputTokens', 'Reviewed maximum output tokens (up to 8192)', 'number')}{field('maxContextTokens', 'Reviewed full context limit', 'number')}
          {field('localTokensPerMinute', operation === 'grounding-search' ? 'Local account request cap per fixed UTC minute' : 'Local account token cap per fixed UTC minute', 'number')}{field('expiresAt', 'Review expires (within 24 hours; your local time)', 'datetime-local')}
        </div>
        {operation === 'vision-pdf' && provider === 'GEMINI' && <label>Reviewed media policy<select name="mediaRequestKind" className={input} defaultValue="pdf"><option value="pdf">PDF-containing requests</option><option value="image">Image-only paid fallback</option></select><span className="text-sm">For images, enter the same reviewed request input and media limits as the free image policy. Gemini always reserves its full 1,048,576-token input maximum, plus bounded output, for money and account pressure; context and local token allowance must cover that full amount.</span></label>}
        {operation === 'embedding' && <p className="text-sm">Embedding identity is fixed to Vertex text-embedding-004, 768 dimensions and the existing default task. Enter input 2048, unused output sentinel 1 and context sentinel 2049. Monetary units are characters, conservatively bounded by UTF-8 bytes; token counters remain quota units. The ADC project and principal must already be configured.</p>}
        {operation === 'grounding-search' && <p className="text-sm">Search performs one query per physical attempt. Enter unused token sentinels input 1, output 1 and context 2. The local cap is requests/minute, and the paid maximum is per request; no monthly provider credit is assumed.</p>}
        {operation === 'vision-pdf' && <p className="text-sm">GLM permits bounded PNG/JPEG input only. Gemini Developer API is paid here and requires independently verified access by an existing active account, paid privacy terms, and an exact current model revision. Vertex 2.5 and retired Grok aliases are not offered. PDF input reserves the provider maximum of 1000 pages and full 1048576-token context, not a locally measured page count. For PDF-containing requests, enter full input 1048576; for image-only requests, use the common reviewed image input limit above. Gemini output must be 256–8192; Pro uses the highest long-context tariff. Image generation is excluded.</p>}
        <p className="text-sm">Evidence references must identify documented independent reviews using review:ticket-id. Do not paste credentials, personal records or document content.</p>
        <div className="grid gap-3 md:grid-cols-2">{GATEWAY_REVIEW_FIELDS.map(k => field(`evidence.${k}`, `${k} evidence reference`))}</div>
        {GATEWAY_ATTESTATIONS.map(k => <label key={k} className="flex gap-2 text-sm"><input type="checkbox" name={`attest.${k}`} required />{labels[k]}</label>)}
        <label className="block">Audit reason (10–500 characters, no secrets)<textarea name="reason" required minLength={10} maxLength={500} className={input} /></label>
        <label><input name="recoverHealth" type="checkbox" /> Explicitly recover this reviewed account/current credential health cooldown. Review the cause and provide the reason above. This does not clear billing quarantine, refund holds, replenish quotas or raise the paid cap.</label>
        <button className={button} type="submit" disabled={busy || !status}>Validate and preview review</button>
      </fieldset>
    </form>
    {preview && <div className="space-y-2 rounded border border-line p-3" aria-label="Exact review preview">
      <p>{preview.profileId} / account {preview.canonicalAccountId}: {preview.billing}. Reviewed priority {preview.reviewedPriority} (lower preferred). Local cap {preview.localTokensPerMinute} {preview.quotaMeter ?? 'tokens/minute'}. Capability {preview.operationKind ?? 'text'}. Expiry {new Date(preview.expiresAtMs).toISOString()}.</p>
      <p>Conservative maximum operation reservation: {preview.maximumOperationNanoUsd === undefined ? 'not supplied' : `USD ${(preview.maximumOperationNanoUsd / 1_000_000_000).toFixed(6)}`}. This is not an invoice or expected daily spend, and shares the existing total cap.</p>
      {preview.healthRecoveryRecords !== undefined && <p>Explicit health recovery: {preview.healthRecoveryRecords} account/credential records will be reset only if this exact preview remains current.</p>}
      <p>Scopes: {preview.policyKeys.join(', ')}. Credential generation associated. No live inference or upstream quota check performed.</p>
      <p>Saving changes reviewed gateway routing configuration only. Deployment ON/OFF and the existing total USD 10/day maximum are untouched. {preview.deploymentEnabled ? 'Routing is currently ON: saving can make this model eligible immediately.' : 'Routing is currently OFF.'}</p>
      {stale && <p role="alert">This preview expired. Validate the evidence again.</p>}
      <button className={button} type="button" onClick={() => void save()} disabled={busy || stale}>Save this reviewed configuration</button>
      <button className={button} type="button" disabled={busy} onClick={clearPreview}>Cancel review</button>
    </div>}
  </section>;
}
