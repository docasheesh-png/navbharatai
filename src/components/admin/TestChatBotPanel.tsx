import React, { useCallback, useEffect, useRef, useState } from 'react';
import { adminHeaders } from '../../lib/adminFetch';
import { newRequestIdentity } from '../../lib/requestIdentity';
import { formatTestChatDiagnostic, isTestChatDiagnostic, isTestChatReply, isTestChatStatus, readTestChatAction, TEST_CHAT_FAILURE, TEST_CHAT_MAX_CONTEXT_CHARS,
  TEST_CHAT_MAX_MESSAGE_CHARS, isAllowedTestChatModel, type TestChatDiagnostic, type TestChatMessage, type TestChatProviderId, type TestChatReply, type TestChatStatus } from '../../lib/testChatBot';

const API = '/api/v1/admin/test-chat-bot';
const button = 'min-h-11 rounded-lg border border-line px-3 py-2 text-sm text-ink disabled:opacity-40';
const labelOf = (provider: TestChatProviderId, status: TestChatStatus | null): string =>
  status?.providers.find(p => p.id === provider)?.label ?? (provider === 'qubax' ? 'Qubax' : provider);
const failureFromCode = (code: unknown, name: string, diagnostic?: TestChatDiagnostic | null): string => {
  if (diagnostic?.httpStatus === 504 || diagnostic?.providerCode === 'MITRIFY_HTTP_504') {
    return "The selected provider's gateway timed out (HTTP 504). That is a provider-side gateway time-out, not a missing key. No other NavBharatAI provider was tried.";
  }
  if (code === 'budget') return 'The shared daily or monthly budget cannot reserve this try. No provider was called.';
  if (code === 'no-model') return 'No eligible priced model is available for the selected provider. No provider was called.';
  if (code === 'tries-exhausted') return 'The selected provider tried its allowed models and did not return a valid answer. No other NavBharatAI provider was tried.';
  if (code === 'capacity') return 'The selected provider is already handling its maximum number of calls. No provider was called.';
  if (code === 'capability') return 'This test is outside the supported text conversation. No provider was called.';
  if (code === 'disabled' || code === 'configuration') return `${name} is disabled or not configured on the server. No provider was called.`;
  if (code === 'storage') return 'Approval and budget storage is unavailable. No provider was called.';
  if (code === 'invalid') return 'The conversation is invalid or too long. Start a new test chat or shorten the message. No provider was called.';
  if (code === 'approval-or-budget') return 'This exact conversation needs an operator-reviewed approval or a verified spending ceiling, plus available shared budget. No provider was called.';
  return TEST_CHAT_FAILURE;
};

export function TestChatBotPanel({ adminToken }: { adminToken: string }): React.ReactElement {
  const [status, setStatus] = useState<TestChatStatus | null>(null);
  const [provider, setProvider] = useState<TestChatProviderId>('qubax');
  const [messages, setMessages] = useState<TestChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [modelDraft, setModelDraft] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [diagnostic, setDiagnostic] = useState<TestChatDiagnostic | null>(null);
  const [balance, setBalance] = useState('');
  const [lastReply, setLastReply] = useState<TestChatReply | null>(null);
  const epoch = useRef(0), lock = useRef(false);
  const readAbort = useRef<AbortController | null>(null), sendAbort = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    const current = epoch.current;
    readAbort.current?.abort();
    const controller = new AbortController(); readAbort.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    setLoading(true); setStatus(null);
    try {
      const response = await fetch(`${API}/providers`, { cache: 'no-store', headers: adminHeaders(adminToken), signal: controller.signal });
      const data: unknown = await response.json();
      if (current !== epoch.current || readAbort.current !== controller) return;
      if (!response.ok || !isTestChatStatus(data)) throw new Error('unavailable');
      setStatus(data);
    } catch {
      if (current === epoch.current && readAbort.current === controller) setError('Provider status could not be read. Check your admin session and refresh. No test was sent.');
    } finally {
      clearTimeout(timeout);
      if (current === epoch.current && readAbort.current === controller) setLoading(false);
    }
  }, [adminToken]);
  useEffect(() => {
    epoch.current++; lock.current = false;
    setMessages([]); setDraft(''); setModelDraft(''); setAccepted(false); setBusy(false); setError(''); setDiagnostic(null); setBalance(''); setLastReply(null);
    void load();
    return () => { epoch.current++; readAbort.current?.abort(); sendAbort.current?.abort(); };
  }, [load]);
  const selected = status?.providers.find(p => p.id === provider);
  const displayName = selected?.label ?? labelOf(provider, status);
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0) + draft.length;
  const ready = !!selected?.enabled && selected.configured && !loading && !busy;
  const approvalRequired = selected?.approvalRequired ?? true;
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready || !accepted || !draft.trim() || lock.current) return;
    const requestId = newRequestIdentity();
    if (!requestId) { setError('A secure request ID is unavailable in this browser. No test was sent.'); return; }
    const typedModel = modelDraft.trim();
    if (typedModel && !isAllowedTestChatModel(typedModel)) { setError('The optional model id uses only letters, numbers, and . / : -. No test was sent.'); return; }
    const action = readTestChatAction({
      provider, requestId, messages: [...messages, { role: 'user', content: draft }], confirmGatewayDisclosure: true,
      ...(typedModel ? { model: typedModel } : {}),
    });
    if (!action) { setError('This conversation is too long. Start a new test chat or shorten the message. No test was sent.'); return; }
    lock.current = true; setBusy(true); setAccepted(false); setError(''); setDiagnostic(null);
    const current = epoch.current, controller = new AbortController(); sendAbort.current = controller;
    const timeout = setTimeout(() => controller.abort(), 100_000);
    try {
      const response = await fetch(`${API}/chat`, { method: 'POST', cache: 'no-store',
        headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify(action) });
      const data: unknown = await response.json();
      if (current !== epoch.current) return;
      if (!response.ok) {
        const payload = data && typeof data === 'object' ? data as { code?: unknown; diagnostic?: unknown } : {};
        const detail = isTestChatDiagnostic(payload.diagnostic) ? payload.diagnostic : null;
        if (detail) setDiagnostic(detail);
        setError(failureFromCode(payload.code, displayName, detail));
        return;
      }
      if (!isTestChatReply(data) || data.requestId !== requestId || data.provider !== provider) { setError(TEST_CHAT_FAILURE); return; }
      setMessages([...action.messages, { role: 'assistant', content: data.content }]);
      setDraft(''); setLastReply(data);
    } catch { if (current === epoch.current) setError(TEST_CHAT_FAILURE); }
    finally { clearTimeout(timeout); if (current === epoch.current) { lock.current = false; setBusy(false); } }
  };
  const clear = () => { setMessages([]); setDraft(''); setModelDraft(''); setAccepted(false); setError(''); setDiagnostic(null); setBalance(''); setLastReply(null); };
  const copyError = () => {
    if (!diagnostic || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(formatTestChatDiagnostic(diagnostic));
  };
  const checkBalance = async () => {
    setBalance('Checking the Qubax account balance. This does not send a chat.');
    try {
      const response = await fetch(`${API}/balance`, { method: 'POST', cache: 'no-store', headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' }, body: '{}' });
      const data: unknown = await response.json();
      const row = data && typeof data === 'object' ? data as { status?: unknown; balanceMicros?: unknown; code?: unknown } : {};
      setBalance(row.status === 'available' && typeof row.balanceMicros === 'string' ? `Qubax balance: ${row.balanceMicros} micro-USD. This is account metadata, not a chat charge.` : `Balance check: ${typeof row.code === 'string' ? row.code : 'unavailable'}. No chat call was made.`);
    } catch { setBalance('Balance check failed. No chat call was made.'); }
  };
  const waiting = provider === 'qubax'
    ? 'Waiting for Qubax… It may try up to three market-selected models. No other NavBharatAI provider is tried.'
    : 'Waiting for the selected provider… No other provider is tried.';
  const qubaxMarket = provider === 'qubax' && selected && !approvalRequired
    ? `Qubax auto-selected ${selected.model ?? 'no model yet'}${selected.selection === 'backup' ? ' (backup)' : ''}. Live Qubax price ${selected.inputUsdPerMillion ?? '—'} in / ${selected.outputUsdPerMillion ?? '—'} out USD per million tokens${selected.discountBps != null ? ` (${(selected.discountBps / 100).toFixed(1)}% below the official price)` : ''}. Each try reserves at most $${selected.ceilingUsd ?? '0.02'}. It may try up to three market-selected models; a later model is used only after a failed try is released.`
    : null;
  const statusLine = busy ? waiting : loading ? 'Reading server configuration…' : !selected ? 'Provider status unavailable.'
    : !selected.configured ? `${displayName} is not configured on the server.`
    : !selected.enabled ? (selected.unavailableReason ?? `${displayName} is disabled on the server.`)
    : qubaxMarket ? qubaxMarket
    : !approvalRequired ? `${displayName} is enabled${selected.model ? ` for ${selected.model}` : ''}. Each send reserves any verified spending cap, then makes one call.`
    : `${displayName} is configured. Each exact conversation still requires reviewed data and spending approval.`;
  return <section aria-label="Test Chat Bot" className="rounded-2xl border border-line bg-card p-4 space-y-4 text-body">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold text-ink">Test Chat Bot</h2>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || loading} onClick={() => void load()}>Refresh provider status</button><button type="button" className={button} disabled={busy} onClick={() => void checkBalance()}>Check Qubax balance</button><button type="button" className={button} disabled={busy} onClick={clear}>New test chat</button></div>
    </div>
    <p className="text-sm text-muted">A separate admin test chat. Only the selected provider is called; there is no NavBharatAI provider fallback.{selected?.internalRouting || provider === 'qubax' ? ' This gateway may route to upstream sellers and retry among them. A gateway response does not independently verify the underlying model.' : ''}{provider === 'qubax' ? ' Qubax may try up to three of its own market-selected models on this page.' : ''}</p>
    <label className="block text-sm">Test provider<select className="mt-1 block w-full rounded-lg border border-line bg-well p-3 text-ink" value={provider} disabled={busy} onChange={event => {
      const next = status?.providers.find(p => p.id === event.target.value);
      if (next && next.id !== provider) { setProvider(next.id); clear(); }
    }}>{(status?.providers ?? [{ id: 'qubax' as const, label: 'Qubax', configured: false, enabled: false, model: null }]).map(p => {
      const suffix = !p.configured ? ' — not configured' : !p.enabled ? ` — ${p.unavailableReason ?? 'unavailable'}` : p.model ? ` (${p.model})` : '';
      return <option key={p.id} value={p.id} disabled={status ? !p.enabled || !p.configured : false}>{p.label}{suffix}</option>;
    })}</select></label>
    <p role="status" className="text-sm">{statusLine}</p>
    {selected?.note && <p className="text-sm text-muted">{selected.note}</p>}
    <label className="block text-sm">Model (optional)<input value={modelDraft} disabled={busy} onChange={event => { setModelDraft(event.target.value); setAccepted(false); }} placeholder="Leave blank to use the same cheapest-model selection as main chat" className="mt-1 block w-full rounded-lg border border-line bg-well p-3 text-ink" autoComplete="off" spellCheck={false} /></label>
    {status?.feed && <p className="text-sm text-muted">Price feed {status.feed.fresh ? `fresh ${new Date(status.feed.observedAtMs ?? 0).toISOString()}` : 'not fresh'}. {status.feed.pricedRows} priced Qubax rows, {status.feed.officialMatches} at a 90%+ Qubax discount, {status.feed.discountEligible} within the try cap, {status.feed.probePassing} probe-ready.</p>}
    <p className="text-sm text-muted">Use synthetic test text. Do not paste secrets, personal records or customer data. The visible conversation is sent on each turn. This page does not save transcripts; leaving it clears the chat. {displayName}{selected?.internalRouting || provider === 'qubax' ? ' and any upstream processors' : ''} may retain submitted content. {selected?.privacyUrl || provider === 'qubax' ? <a href={selected?.privacyUrl ?? 'https://qubax.ai/legal/privacy'} target="_blank" rel="noreferrer" className="underline">{displayName} privacy policy</a> : 'Review that provider’s published privacy policy before sending anything other than synthetic test text.'}</p>
    <p className="text-sm text-muted">No paid inference runs just by opening this page. {status && selected && !approvalRequired ? 'Sending uses the server credential for the selected provider and any existing shared budget or per-request cap. This checkbox confirms the destination; it does not raise the cap.' : 'Sending needs an independent review of the exact payload, downstream processors and a supplier-enforced spending ceiling, plus the existing shared budget. This checkbox does not create those approvals.'}</p>
    {balance && <p role="status" className="text-sm text-muted">{balance}</p>}
    {error && <p role="alert" className="text-danger">{error}</p>}
    {diagnostic && <div className="space-y-2 rounded-xl border border-line bg-well p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Provider error details</h3>
        <button type="button" className={button} onClick={copyError}>Copy error details</button>
      </div>
      <pre className="whitespace-pre-wrap break-words text-xs text-ink">{formatTestChatDiagnostic(diagnostic)}</pre>
    </div>}
    <div role="log" aria-label="Test conversation" aria-live="polite" className="max-h-[50vh] supports-[height:100dvh]:max-h-[50dvh] min-h-0 overflow-y-auto space-y-3 rounded-xl border border-line p-3">
      {!messages.length && <p className="text-sm text-muted">Type your own test message below. Existing app conversations are not loaded here.</p>}
      {messages.map((message, index) => <article key={index} className="rounded-lg bg-well p-3"><h3 className="mb-1 text-sm font-semibold text-ink">{message.role === 'user' ? 'You' : `${displayName} response`}</h3><p className="whitespace-pre-wrap break-words text-sm">{message.content}</p></article>)}
    </div>
    {lastReply && <p className="text-xs text-muted">Gateway: {lastReply.provider} · Selected model: {lastReply.model} · {lastReply.latencyMs} ms{lastReply.usage ? ` · ${lastReply.usage.inputTokens} input / ${lastReply.usage.outputTokens} output tokens` : ' · Usage not reported'} · Invoice cost not verified.</p>}
    <form onSubmit={event => void send(event)} className="space-y-3">
      <label className="block text-sm">Test message<textarea rows={4} maxLength={TEST_CHAT_MAX_MESSAGE_CHARS} value={draft} disabled={busy} onChange={event => { setDraft(event.target.value); setAccepted(false); }} placeholder={`Write a synthetic question to test ${displayName}…`} className="mt-1 block w-full resize-y rounded-lg border border-line bg-well p-3 text-ink" /></label>
      <p className="text-xs text-muted">{totalChars.toLocaleString()} / {TEST_CHAT_MAX_CONTEXT_CHARS.toLocaleString()} context characters. Start a new test chat when this context is full.</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} />Send this visible conversation to {displayName}{selected?.internalRouting || provider === 'qubax' ? ' and its upstream sellers' : ''} for this test, subject to the separate server-side review.</label>
      <div className="flex gap-2"><button type="submit" className={button} disabled={!ready || !accepted || !draft.trim() || totalChars > TEST_CHAT_MAX_CONTEXT_CHARS}>Send to {displayName} only</button>{busy && <button type="button" className={button} onClick={() => sendAbort.current?.abort()}>Stop waiting</button>}</div>
    </form>
  </section>;
}
