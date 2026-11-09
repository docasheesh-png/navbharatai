import React, { useCallback, useEffect, useRef, useState } from 'react';
import { adminHeaders } from '../../lib/adminFetch';
import { newRequestIdentity } from '../../lib/requestIdentity';
import { isTestChatApprovalReceipt, isTestChatBalance, isTestChatReadiness, isTestChatReply, isTestChatStatus, readTestChatAction,
  readTestChatApprovalImport, TEST_CHAT_DIAGNOSTIC_CODES, TEST_CHAT_FAILURE, TEST_CHAT_FAILURE_CODES, TEST_CHAT_REVIEW_ERROR_CODES, TEST_CHAT_MAX_CONTEXT_CHARS, TEST_CHAT_MAX_MESSAGE_CHARS,
  TEST_CHAT_READINESS_GATES, TEST_CHAT_SYNTHETIC_PROMPT, type TestChatAction, type TestChatBalance, type TestChatMessage,
  type TestChatProviderId, type TestChatReadiness, type TestChatReadinessGateId, type TestChatReply, type TestChatStatus } from '../../lib/testChatBot';

const API = '/api/v1/admin/test-chat-bot';
const button = 'min-h-11 rounded-lg border border-line px-3 py-2 text-sm text-ink disabled:opacity-40';
const input = 'mt-1 block w-full rounded-lg border border-line bg-well p-3 text-ink';
const gateLabels: Record<TestChatReadinessGateId, string> = {
  configured: 'Provider configured', enabled: 'Provider enabled', catalog: 'Reviewed catalog', quality: 'Quality review',
  supplierCeiling: 'Supplier ceiling verification', payloadApproval: 'Exact-payload approval', budget: 'Shared budget availability',
  reviewerTrust: 'Independent reviewer trust', dispatchPolicy: 'Dispatch policy',
};
function safeCode<T extends readonly string[]>(data: unknown, field: 'code' | 'diagnostic', allowed: T): T[number] | null {
  const value = data && typeof data === 'object' ? (data as Record<string, unknown>)[field] : null;
  return typeof value === 'string' && allowed.includes(value) ? value as T[number] : null;
}
const failureMessages: Record<typeof TEST_CHAT_FAILURE_CODES[number], string> = {
  disabled: 'Qubax is disabled on the server. No provider was called.',
  configuration: 'Qubax is not configured on the server. No provider was called.',
  storage: 'Approval and budget storage is unavailable. No provider was called.',
  'approval-or-budget': 'The exact review or shared budget is no longer available. Check Qubax Readiness for the current blocker. No provider was called.',
  invalid: 'The conversation is invalid or too long. Start a new test chat or shorten the message. No provider was called.',
  catalog: 'No eligible independently reviewed catalog selection is available. Check Qubax Readiness for pricing, quality and supplier-ceiling requirements. No provider was called.',
  approval: 'The exact-payload approval is missing, expired, used, revoked or no longer matches. Check Qubax Readiness and obtain the required independent review. No provider was called.',
  budget: 'The existing shared daily, monthly or per-user budget cannot admit this request. Check Qubax Readiness. No provider was called.',
  capacity: 'Qubax local request capacity is full. Wait, then run the read-only readiness check. No provider was called.',
  selection: 'The reviewed model selection changed. Check Qubax Readiness and obtain a matching independent approval. No provider was called.',
  capability: 'This payload is outside the supported text-only test capability. Check the message limits. No provider was called.',
  unconfirmed: TEST_CHAT_FAILURE,
};
const diagnosticActions: Partial<Record<typeof TEST_CHAT_DIAGNOSTIC_CODES[number], string>> = {
  'qubax-auth-401': 'Have the authorized operator verify the current server credential.',
  'qubax-auth-403': 'Have the authorized operator verify account and API permissions.',
  'qubax-payment-402': 'Check the provider billing status through its authorized billing interface.',
  'qubax-rate-429': 'The provider reported a rate limit. Reconcile this request before any separately approved attempt.',
  'qubax-upstream-5xx': 'The provider reported an upstream error. Reconcile this request before any separately approved attempt.',
  QUBAX_CANCELLED: 'Cancellation does not prove the request was free.',
  QUBAX_INVALID_RESPONSE: 'The response failed validation and cannot be displayed as a successful answer.',
  QUBAX_INCOMPLETE_STREAM: 'The provider response was incomplete; a partial answer is not confirmed success.',
  QUBAX_POLICY_BLOCKED: 'The provider refused the request. Do not retry a policy refusal.',
  QUBAX_APPROVAL_REVOKED: 'The approval was revoked while this request was being processed. Its cost is not confirmed.',
};
const failure = (data: unknown): string => {
  const code = safeCode(data, 'code', TEST_CHAT_FAILURE_CODES), diagnostic = safeCode(data, 'diagnostic', TEST_CHAT_DIAGNOSTIC_CODES);
  return `${failureMessages[code ?? 'unconfirmed']}${diagnostic ? ` Safe diagnostic: ${diagnostic}. ${diagnosticActions[diagnostic] ?? ''}` : ''}`;
};
const knownUndispatched = (data: unknown): boolean => {
  const code = safeCode(data, 'code', TEST_CHAT_FAILURE_CODES);
  return code !== null && code !== 'unconfirmed';
};
const reviewMessages: Record<typeof TEST_CHAT_REVIEW_ERROR_CODES[number], string> = {
  invalid: 'The signed review request is malformed. Obtain the complete signed envelope.',
  'trust-unavailable': 'An independent public review key with the required purpose is not configured. Ask the security operator to provision it separately.',
  'catalog-unavailable': 'A current independently reviewed eligible catalog and supplier-enforced ceiling are required before importing a payload approval.',
  'review-invalid': 'The independent signature, exact binding, evidence, data review or expiry could not be verified. Obtain a matching independent review.',
  'approval-conflict': 'An approval already exists for this exact binding. It cannot be overwritten or replayed, even after expiry.',
  'catalog-conflict': 'The catalog changed or this signed package is a replay. Obtain a new independent package bound to the current catalog digest.',
  'storage-unavailable': 'The import outcome is uncertain. Check readiness before another submission; do not resubmit automatically.',
  capacity: 'The safety checker is at capacity. Run the read-only readiness check later before another submission.',
};
const importFailure = (data: unknown): string => {
  const code = safeCode(data, 'code', TEST_CHAT_REVIEW_ERROR_CODES);
  return code ? `${reviewMessages[code]} Review diagnostic: ${code}. No inference was requested.`
    : 'Approval import was not confirmed. The independent signature, exact payload, evidence and expiry must all match. Check Qubax Readiness before trying another import. No provider was called.';
};
const formatTime = (value: number): string => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : 'Unavailable';
};
const fresh = (value: TestChatReadiness | null, now: number): boolean => !!value && value.ready
  && value.expiresAtMs !== null && value.expiresAtMs > now && value.checkedAtMs <= now && now - value.checkedAtMs < 300_000
  && TEST_CHAT_READINESS_GATES.every(id => value.gates[id].state === 'pass');
type Operation = 'status' | 'readiness' | 'approval' | 'balance' | 'send' | null;
type RequestState = 'not-sent' | 'waiting' | 'confirmed' | 'blocked' | 'uncertain';

/** Readiness and imported signatures never infer. Only an explicit Send submits the prepared action. */
export function TestChatBotPanel({ adminToken }: { adminToken: string }): React.ReactElement {
  const [status, setStatus] = useState<TestChatStatus | null>(null);
  const [provider, setProvider] = useState<TestChatProviderId>('qubax');
  const [messages, setMessages] = useState<TestChatMessage[]>([]);
  const [draft, setDraft] = useState(TEST_CHAT_SYNTHETIC_PROMPT);
  const [accepted, setAccepted] = useState(false);
  const [operation, setOperation] = useState<Operation>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [balance, setBalance] = useState<TestChatBalance | null>(null);
  const [readiness, setReadiness] = useState<TestChatReadiness | null>(null);
  const [reviewEnvelope, setReviewEnvelope] = useState(''), [catalogEnvelope, setCatalogEnvelope] = useState('');
  const [lastReply, setLastReply] = useState<TestChatReply | null>(null);
  const [requestState, setRequestState] = useState<RequestState>('not-sent');
  const [now, setNow] = useState(Date.now);
  const epoch = useRef(0), lock = useRef(false), revision = useRef(0);
  const prepared = useRef<TestChatAction | null>(null), checked = useRef<TestChatReadiness | null>(null);
  const consent = useRef(false), uncertain = useRef(false);
  const request = useRef<AbortController | null>(null);

  const invalidateReadiness = useCallback(() => {
    checked.current = null; consent.current = false;
    setReadiness(null); setAccepted(false); setNotice(''); setReviewEnvelope(''); setCatalogEnvelope('');
  }, []);
  const load = useCallback(async () => {
    if (lock.current) return;
    lock.current = true; const current = epoch.current;
    const controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    setOperation('status'); setStatus(null); setBalance(null); setError(''); invalidateReadiness();
    try {
      const response = await fetch(`${API}/providers`, { cache: 'no-store', headers: adminHeaders(adminToken), signal: controller.signal });
      const data: unknown = await response.json();
      if (current !== epoch.current) return;
      if (controller.signal.aborted) throw new Error('aborted');
      if (!response.ok || !isTestChatStatus(data)) throw new Error('unavailable');
      setStatus(data);
    } catch {
      if (current === epoch.current) setError('Provider status could not be read. Check your admin session and refresh. No test was sent.');
    } finally {
      clearTimeout(timeout);
      if (current === epoch.current) { lock.current = false; setOperation(null); }
    }
  }, [adminToken, invalidateReadiness]);
  useEffect(() => {
    epoch.current++; revision.current++; lock.current = false; prepared.current = null; uncertain.current = false;
    setMessages([]); setBalance(null); setDraft(TEST_CHAT_SYNTHETIC_PROMPT); setError(''); setLastReply(null); setRequestState('not-sent');
    void load();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { epoch.current++; request.current?.abort(); clearInterval(tick); };
  }, [load]);

  const selected = status?.providers.find(p => p.id === provider);
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0) + draft.length;
  const busy = operation !== null;
  const validDraft = !!draft.trim() && totalChars <= TEST_CHAT_MAX_CONTEXT_CHARS;
  const ready = !!selected?.enabled && selected.configured && !busy && !uncertain.current && fresh(readiness, now);
  const prepare = (): TestChatAction | null => {
    if (prepared.current) return prepared.current;
    const requestId = newRequestIdentity();
    if (!requestId) { setError('A secure request ID is unavailable in this browser. No test was sent.'); return null; }
    const action = readTestChatAction({ provider, requestId, messages: [...messages, { role: 'user', content: draft }], confirmGatewayDisclosure: true });
    if (!action) { setError('This conversation is invalid or too long. Start a new test chat or shorten the message. No test was sent.'); return null; }
    prepared.current = action;
    return action;
  };
  const checkReadiness = async () => {
    if (lock.current || !validDraft) return;
    const action = prepare(); if (!action) return;
    lock.current = true; setOperation('readiness'); setError(''); invalidateReadiness();
    const current = epoch.current, version = revision.current;
    const controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`${API}/readiness`, { method: 'POST', cache: 'no-store', headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify(action) });
      const data: unknown = await response.json();
      if (current !== epoch.current || version !== revision.current || prepared.current !== action) return;
      if (controller.signal.aborted) throw new Error('aborted');
      if (!response.ok || !isTestChatReadiness(data) || data.requestId !== action.requestId || data.provider !== action.provider
        || (data.reviewRequest && (data.reviewRequest.requestId !== action.requestId || JSON.stringify(data.reviewRequest.body.messages) !== JSON.stringify(action.messages)))) throw new Error('unavailable');
      checked.current = data; setReadiness(data); setNow(Date.now());
    } catch {
      if (current === epoch.current && version === revision.current) setError('Readiness could not be verified. Check your admin session and try the read-only check again. No provider was called and no budget was reserved.');
    } finally { clearTimeout(timeout); if (current === epoch.current) { lock.current = false; setOperation(null); } }
  };
  // Validate the decoded payload on import. Textarea clipping can corrupt a valid signed JSON envelope after escaping.
  const importApproval = async (kind: 'approval' | 'catalog') => {
    const action = prepared.current, review = checked.current?.reviewRequest;
    if (lock.current || !action || !checked.current || uncertain.current
      || kind === 'approval' && (!review || review.expiresAtMs <= Date.now())) return;
    let candidate;
    try { candidate = readTestChatApprovalImport({ action, attestation: JSON.parse(kind === 'catalog' ? catalogEnvelope : reviewEnvelope) }, kind === 'catalog' ? 128_000 : 16_000); } catch { /* Never expose pasted content in errors. */ }
    if (!candidate) { setError('Paste the signed reviewer envelope with keyId, payload and signature. Do not paste a signing key or provider credential.'); return; }
    lock.current = true; setOperation('approval'); setError(''); invalidateReadiness();
    const current = epoch.current, version = revision.current;
    const controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const endpoint = kind === 'catalog' ? `${API}/catalog` : `${API}/approval`;
      const response = await fetch(endpoint, { method: 'POST', cache: 'no-store', headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify(candidate) });
      const data: unknown = await response.json();
      if (current !== epoch.current || version !== revision.current || prepared.current !== action) return;
      if (!response.ok || controller.signal.aborted || !isTestChatApprovalReceipt(data) || data.requestId !== action.requestId || data.expiresAtMs <= Date.now()) {
        setError(importFailure(data)); return;
      }
      setNotice(`${kind === 'catalog' ? 'Independently reviewed catalog' : 'Independent payload approval'} recorded. Run Check Qubax Readiness again before explicitly sending. Importing did not call the provider or reserve budget.`);
    } catch {
      if (current === epoch.current && version === revision.current) setError('Approval import outcome is uncertain. Run the read-only readiness check before another import. No inference was requested.');
    } finally { clearTimeout(timeout); if (current === epoch.current) { lock.current = false; setOperation(null); } }
  };
  const checkBalance = async () => {
    if (lock.current) return;
    lock.current = true; setOperation('balance'); setBalance(null); setError('');
    const current = epoch.current, controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`${API}/balance`, { method: 'POST', cache: 'no-store', headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' }, signal: controller.signal, body: '{}' });
      const data: unknown = await response.json();
      if (current !== epoch.current) return;
      if (!response.ok || controller.signal.aborted || !isTestChatBalance(data)) throw new Error('unavailable');
      setBalance(data);
    } catch { if (current === epoch.current) setError('Provider balance could not be verified. Check the admin session and authorized Qubax billing-read access. No inference was requested.'); }
    finally { clearTimeout(timeout); if (current === epoch.current) { lock.current = false; setOperation(null); } }
  };
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const action = prepared.current, review = checked.current;
    if (!ready || !consent.current || !action || !review || review !== readiness || review.requestId !== action.requestId
      || !fresh(review, Date.now()) || lock.current || uncertain.current) return;
    lock.current = true; uncertain.current = true; setOperation('send'); setRequestState('waiting'); setError(''); invalidateReadiness();
    const current = epoch.current, controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 100_000);
    try {
      const response = await fetch(`${API}/chat`, { method: 'POST', cache: 'no-store',
        headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify(action) });
      const data: unknown = await response.json();
      if (current !== epoch.current) return;
      if (controller.signal.aborted) { setError(TEST_CHAT_FAILURE); setRequestState('uncertain'); return; }
      if (!response.ok) {
        const blocked = knownUndispatched(data); uncertain.current = !blocked;
        setError(failure(data)); setRequestState(blocked ? 'blocked' : 'uncertain'); return;
      }
      if (!isTestChatReply(data) || data.requestId !== action.requestId || data.provider !== action.provider) { setError(TEST_CHAT_FAILURE); setRequestState('uncertain'); return; }
      setMessages([...action.messages, { role: 'assistant', content: data.content }]);
      setDraft(''); setLastReply(data); setRequestState('confirmed'); prepared.current = null; uncertain.current = false; revision.current++;
    } catch { if (current === epoch.current) { setError(TEST_CHAT_FAILURE); setRequestState('uncertain'); } }
    finally { clearTimeout(timeout); if (current === epoch.current) { lock.current = false; setOperation(null); } }
  };
  const clear = () => {
    if (lock.current) return;
    revision.current++; prepared.current = null; uncertain.current = false;
    setMessages([]); setDraft(''); invalidateReadiness(); setError(''); setLastReply(null); setRequestState('not-sent');
  };
  const expiryPassed = !!readiness && (readiness.expiresAtMs !== null && readiness.expiresAtMs <= now || now - readiness.checkedAtMs >= 300_000);
  return <section aria-label="Test Chat Bot" className="rounded-2xl border border-line bg-card p-4 space-y-4 text-body">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold text-ink">Test Chat Bot</h2>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => void load()}>Refresh provider status</button><button type="button" className={button} disabled={busy} onClick={clear}>New test chat</button></div>
    </div>
    <p className="text-sm text-muted">A separate admin test chat. Only the selected provider is called; there is no NavBharatAI provider fallback. Qubax may route to upstream sellers and retry among them. A gateway response does not independently verify the underlying model.</p>
    <label className="block text-sm">Test provider<select className={input} value={provider} disabled={busy} onChange={event => {
      if (lock.current) return;
      const next = status?.providers.find(p => p.id === event.target.value);
      if (next && next.id !== provider) { clear(); setProvider(next.id); }
    }}>{(status?.providers ?? [{ id: 'qubax', label: 'Qubax' }]).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
    <p className="text-sm text-muted">Use synthetic test text. Do not paste secrets, personal records or customer data. The visible conversation is sent on each turn. This page does not save transcripts; leaving it clears the chat. Qubax and its upstream providers may retain submitted content. <a href="https://qubax.ai/legal/privacy" target="_blank" rel="noreferrer" className="underline">Qubax privacy policy</a></p>
    <p className="text-sm text-muted">No paid inference runs just by opening this page. The initial synthetic question expects 4. Review and send it once only when approved. Every later turn needs its own exact review.</p>
    <div role="status" aria-live="polite" className="text-sm space-y-1">
      <p>Request status: {operation === 'send' ? 'Waiting for the selected provider. No automatic retry.' : operation === 'readiness' ? 'Checking readiness without inference or a budget reservation.' : operation === 'approval' ? 'Verifying the independent approval signature. No inference requested.' : operation === 'status' ? 'Reading server configuration.' : operation === 'balance' ? 'Reading provider balance without inference.' : requestState === 'confirmed' ? 'Response confirmed.' : requestState === 'blocked' ? 'Blocked before dispatch.' : requestState === 'uncertain' ? 'Uncertain. A provider charge may exist. Do not retry this request.' : 'Not sent.'}</p>
      <p>Actual provider used: {requestState === 'uncertain' || requestState === 'waiting' ? 'Not confirmed for this request.' : requestState === 'confirmed' && lastReply ? 'Qubax gateway; underlying seller identity is not independently verified.' : 'None for this request.'}</p>
      <p>Last confirmed latency: {lastReply ? `${lastReply.latencyMs} ms` : 'Not available.'}</p>
    </div>
    {error && <p role="alert" className="text-danger">{error}</p>}
    {notice && <p role="status" className="text-info">{notice}</p>}
    {uncertain.current && !busy && <p className="text-sm text-warn">This request cannot be sent again here. Reconcile its provider billing and server request status before starting any separately approved test. A read-only check does not clear uncertain liability.</p>}
    <div role="log" aria-label="Test conversation" aria-live="polite" className="max-h-[50vh] supports-[height:100dvh]:max-h-[50dvh] min-h-0 overflow-y-auto space-y-3 rounded-xl border border-line p-3">
      {!messages.length && <p className="text-sm text-muted">Review the initial synthetic question or type your own test message below. Existing app conversations are not loaded here.</p>}
      {messages.map((message, index) => <article key={index} className="rounded-lg bg-well p-3"><h3 className="mb-1 text-sm font-semibold text-ink">{message.role === 'user' ? 'You' : 'Qubax response'}</h3><p className="whitespace-pre-wrap break-words text-sm">{message.content}</p></article>)}
    </div>
    {lastReply && <p className="text-xs text-muted">Last confirmed request: {lastReply.requestId} · Gateway: {lastReply.provider} · Selected model: {lastReply.model} · {lastReply.latencyMs} ms{lastReply.usage ? ` · ${lastReply.usage.inputTokens} input / ${lastReply.usage.outputTokens} output tokens` : ' · Usage not reported'} · Actual charge not verified.{messages.length === 2 && messages[0].content === TEST_CHAT_SYNTHETIC_PROMPT ? lastReply.content.trim() === '4' ? ' Synthetic answer matched 4.' : ' Synthetic answer did not match 4.' : ''}</p>}
    <form onSubmit={event => void send(event)} className="space-y-3">
      <label className="block text-sm">Test message<textarea rows={4} maxLength={TEST_CHAT_MAX_MESSAGE_CHARS} value={draft} disabled={busy || uncertain.current} onChange={event => {
        revision.current++; prepared.current = null; setDraft(event.target.value); invalidateReadiness(); setError(''); setRequestState('not-sent');
      }} placeholder="Write a synthetic question to test Qubax…" className={`${input} resize-y`} /></label>
      <p className="text-xs text-muted">{totalChars.toLocaleString()} / {TEST_CHAT_MAX_CONTEXT_CHARS.toLocaleString()} context characters. Start a new test chat when this context is full.</p>
      <button type="button" className={button} disabled={busy || !validDraft} onClick={() => void checkReadiness()}>Check Qubax Readiness</button>
      <p className="text-xs text-muted">Read-only server checks: no paid provider call, no approval consumption and no budget reservation. Readiness is not a live connection test. The server rechecks every gate at dispatch.</p>
      <section aria-label="Qubax readiness" className="rounded-xl border border-line p-3 space-y-3">
        <h3 className="font-semibold text-ink">Qubax readiness</h3>
        <dl className="space-y-3">{TEST_CHAT_READINESS_GATES.map(id => {
          const gate = readiness?.gates[id];
          const value = !gate ? id === 'configured' ? selected ? selected.configured ? 'Yes' : 'No' : 'Not checked' : id === 'enabled' ? selected ? selected.enabled ? 'Yes' : 'No' : 'Not checked' : 'Not checked' : gate.state === 'pass' ? id === 'configured' || id === 'enabled' ? 'Yes' : 'Passed at last check' : gate.state === 'blocked' ? id === 'configured' || id === 'enabled' ? 'No' : 'Blocked' : 'Not verified';
          return <div key={id}><dt className="text-sm font-semibold text-ink">{gateLabels[id]}: {value}</dt>{gate && <dd className="text-sm"><p>{gate.message}</p>{gate.action && <p className="text-muted">Required action: {gate.action}</p>}</dd>}</div>;
        })}</dl>
        <p className="text-sm">Last safe diagnostic: {error || readiness?.lastSafeDiagnostic || (readiness ? 'None reported by the readiness check.' : 'No readiness check completed.')}</p>
        <p className="text-sm">Provider account balance: {balance?.status === 'available' ? `USD ${balance.balanceMicros.padStart(7, '0').slice(0, -6)}.${balance.balanceMicros.padStart(7, '0').slice(-6)} (checked ${formatTime(balance.checkedAtMs)})` : balance?.status === 'unknown' ? `Not verified (${balance.code}).` : 'Not checked.'}</p>
        {balance?.status === 'unknown' && ['authentication', 'permission'].includes(balance.code) && <p className="text-sm text-warn">The server credential may need Qubax BILLING_READ access. Have the authorized account operator verify its billing permissions. Do not paste a credential here.</p>}
        <button type="button" className={button} disabled={busy} onClick={() => void checkBalance()}>Check provider balance</button>
        <p className="text-xs text-muted">This explicit read uses the current server credential, without inference. A returned balance does not verify the funded account identity, authorize spending, reserve money, prove a supplier ceiling or establish an actual charge.</p>
        {readiness && <p className="text-xs text-muted break-all">Prepared request: {readiness.requestId}. Checked: {formatTime(readiness.checkedAtMs)}. Selected model: {readiness.model ?? 'Not selected'}. Review expiry: {readiness.expiresAtMs === null ? 'Not available' : formatTime(readiness.expiresAtMs)}.</p>}
        {expiryPassed && <p role="alert" className="text-warn">This readiness snapshot has expired. Check Qubax Readiness again; expired evidence never enables Send.</p>}
      </section>
      <p className="text-sm text-muted">Sending needs an independent review of the exact payload, downstream processors and a supplier-enforced spending ceiling, plus the existing shared budget. This checkbox does not create those approvals.</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={accepted} disabled={busy || !ready} onChange={event => { consent.current = event.target.checked; setAccepted(event.target.checked); }} />Send this visible conversation to Qubax and its upstream sellers once, subject to the separate server-side review.</label>
      <div className="flex flex-wrap gap-2"><button type="submit" className={button} disabled={!ready || !accepted || !validDraft}>Send to Qubax only</button>{operation === 'send' && <button type="button" className={button} onClick={() => request.current?.abort()}>Stop waiting</button>}</div>
    </form>
    {readiness && <section aria-label="Independent catalog review" className="rounded-xl border border-line p-3 space-y-3">
      <h3 className="font-semibold text-ink">Independent catalog review</h3>
      <p className="text-xs text-muted break-all">Current catalog digest for reviewer concurrency binding: {readiness.catalogDigest ?? 'No catalog recorded'}.</p>
      <p className="text-sm">If the reviewed catalog is missing or expired, obtain a current catalog envelope from an independently trusted catalog reviewer. It must contain genuine comparable pricing, quality and supplier ceiling evidence. A signature does not turn a local estimate into a supplier guarantee.</p>
      <label className="block text-sm">Signed catalog envelope<textarea rows={4} value={catalogEnvelope} disabled={busy || uncertain.current} onChange={event => setCatalogEnvelope(event.target.value)} className={`${input} font-mono text-xs`} /></label>
      <button type="button" className={button} disabled={busy || uncertain.current || !catalogEnvelope.trim()} onClick={() => void importApproval('catalog')}>Verify and record reviewed catalog</button>
      <p className="text-xs text-muted">Only the signed envelope is accepted. Do not paste keys, credentials or source documents. Importing does not enable the provider, alter the shared budget or send a test.</p>
    </section>}
    {readiness?.reviewRequest && <section aria-label="Independent payload approval" className="rounded-xl border border-line p-3 space-y-3">
      <h3 className="font-semibold text-ink">Independent payload approval</h3>
      <p className="text-sm">Copy this exact review package through your approved independent review process. The reviewer must verify supplier terms, every possible downstream processor, data protections and the supplier-enforced per-request ceiling. A local estimate or account balance is not that guarantee.</p>
      <p className="text-sm">Maximum under reviewed supplier evidence: USD {(readiness.reviewRequest.maximumNanoUsd / 1_000_000_000).toFixed(9)}. This is a ceiling, not an actual charge.</p>
      <label className="block text-sm">Exact review package<textarea readOnly rows={6} value={JSON.stringify(readiness.reviewRequest, null, 2)} className={`${input} font-mono text-xs`} /></label>
      <p className="text-sm text-muted">Return only the signed envelope from an independently trusted reviewer. Do not paste private signing keys, API keys or source documents. Importing records an already-reviewed decision; admin access alone cannot approve it.</p>
      <label className="block text-sm">Signed reviewer envelope<textarea rows={4} value={reviewEnvelope} disabled={busy || uncertain.current} onChange={event => setReviewEnvelope(event.target.value)} className={`${input} font-mono text-xs`} /></label>
      <button type="button" className={button} disabled={busy || uncertain.current || !reviewEnvelope.trim() || readiness.reviewRequest.expiresAtMs <= now} onClick={() => void importApproval('approval')}>Verify and record independent approval</button>
    </section>}
  </section>;
}
