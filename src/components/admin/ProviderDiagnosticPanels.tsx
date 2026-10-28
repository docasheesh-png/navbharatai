import { useRef, useState } from 'react';
import { adminHeaders } from '../../lib/adminFetch';
import { newRequestIdentity } from '../../lib/requestIdentity';
import { DIAGNOSTIC_LIMITS, type DiagnosticProvider, type DiagnosticResult } from '../../shared/providerDiagnostics';

const API = '/api/v1/admin/provider-diagnostics';
const button = 'min-h-11 rounded-lg border border-line px-3 py-2 text-sm text-ink disabled:opacity-40';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const storageKey = (provider: DiagnosticProvider) => `admin-diagnostic-pending:${provider}`;
const unknown = (n: number | null | undefined) => n == null ? 'Unknown / not measured' : String(n);
type RunView = DiagnosticResult & { replayed?: boolean };

export function ProviderDiagnosticResult({ result: r }: { result: RunView }) {
  return <div className="space-y-2" aria-live="polite">
    <p>{r.replayed ? 'Historical run — no new call' : 'Run response'} · {r.accounting}</p>
    <p>Latest diagnostic: {r.timeline.at(-1)?.stage ?? 'Not available'} · {r.timeline.at(-1)?.reason ?? 'No fresh diagnostic recorded'}</p>
    {r.reconciliationRequired && <p role="alert">Receipt exceeded reservation. The global spending stop remains held pending reconciliation.</p>}
    {r.missingEvidence?.length ? <p>Missing evidence: {r.missingEvidence.join(', ')}</p> : null}
    <p>Request ID: {r.runId}</p><p>Provider: {r.provider} · Model: {r.model ?? 'Unknown'}</p>
    <p>Supplier actual cost: {r.supplierCost.status === 'reported' ? `${r.supplierCost.amount} ${r.supplierCost.currency} (provider reported)` : 'Actual cost unavailable'}</p>
    <p>User wallet: {r.walletCharge.status === 'not_charged' ? 'Not charged by this test' : 'Unknown'}</p>
    <p>Started: {r.startedAt} · Total latency: {r.replayed ? 'Not available for recovered run' : `${r.elapsedMs} ms (includes accounting)`}</p>
    <p>First byte: {unknown(r.firstByteMs)} · First token: {unknown(r.firstTokenMs)} · Output tokens/second: {unknown(r.outputTokensPerSecond)}</p>
    <p>Input / output / cached tokens: {unknown(r.usage.inputTokens)} / {unknown(r.usage.outputTokens)} / {unknown(r.usage.cachedTokens)}</p>
    <p>Diagnostic-client retries: {r.retryCount}; provider-internal retries are unknown. Whole-request latency is not model generation speed.</p>
    <pre className="whitespace-pre-wrap break-words">{r.text ?? 'No response text available. Recovery does not persist or recreate response text.'}</pre>
    <details><summary>Sanitized diagnostic timeline</summary><ul>{r.timeline.map((e, i) => <li key={i}>{e.elapsedMs} ms · {e.stage} · {e.reason}{e.httpStatus === undefined ? '' : ` · HTTP ${e.httpStatus}`}</li>)}</ul></details>
    <p>Provider success alone does not prove the app builder works.</p>
  </div>;
}

export function ProviderDiagnosticBot({ provider, adminToken, ready, oneShot = false }: { provider: DiagnosticProvider; adminToken: string; ready: boolean; oneShot?: boolean }) {
  const pendingStorageKey = oneShot ? `admin-diagnostic-pair-20261028:${provider}` : storageKey(provider);
  const [prompt, setPrompt] = useState(oneShot ? 'Reply with exactly: OK' : '');
  const [key, setKey] = useState(() => { try { const saved = sessionStorage.getItem(pendingStorageKey); return saved && uuid.test(saved) ? saved : ''; } catch { return ''; } });
  const [result, setResult] = useState<RunView | null>(null);
  const [recoveredSettled, setRecoveredSettled] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const pending = useRef(key);
  const validPrompt = prompt.trim().length > 0 && new TextEncoder().encode(prompt).length <= DIAGNOSTIC_LIMITS.promptBytes;
  async function action(recover: boolean, sameKey = false) {
    if (lock.current || !adminToken || (!recover && (!ready || (pending.current && !sameKey) || !validPrompt))) return;
    const id = recover || sameKey ? pending.current : newRequestIdentity();
    if (!id) { setMessage('A secure request identity is unavailable. No test was sent.'); return; }
    if (!recover) {
      try { sessionStorage.setItem(pendingStorageKey, id); } catch { setMessage('Recovery storage is unavailable. No test was sent.'); return; }
      pending.current = id; setKey(id);
    }
    lock.current = true; setBusy(true); setMessage(''); setResult(null); setRecoveredSettled(false);
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(recover ? `${API}/runs/${id}` : `${API}/${provider}/runs`, {
        method: recover ? 'GET' : 'POST', cache: 'no-store', signal: controller.signal,
        headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' },
        ...(recover ? {} : { body: JSON.stringify({ idempotencyKey: id, prompt }) }),
      });
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      if (recover) {
        const run = data?.run;
        if (!run || run.provider !== provider || !uuid.test(run.runId) || !['reserved', 'unknown_liability', 'settled'].includes(run.state)) throw new Error('invalid');
        const overrun = Number.isSafeInteger(run.actualCostNanoUsd) && run.actualCostNanoUsd > run.reservedNanoUsd;
        setRecoveredSettled(run.state === 'settled' && Number.isSafeInteger(run.actualCostNanoUsd) && Number.isSafeInteger(run.reservedNanoUsd) && !overrun);
        setMessage(`${overrun ? 'Receipt exceeded reservation; reconciliation required. ' : ''}Historical request ${run.runId}: ${run.state}. Supplier actual cost: ${Number.isSafeInteger(run.actualCostNanoUsd) && run.actualCostNanoUsd >= 0 ? `${run.actualCostNanoUsd} nano-USD (recorded receipt)` : 'Actual cost unavailable'}. Response text and timing are not persisted. No new call was made.`);
      } else {
        if (!data || data.provider !== provider || !uuid.test(data.runId) || !Array.isArray(data.timeline) || !data.usage || !data.supplierCost || !data.walletCharge) throw new Error('invalid');
        setResult(data as RunView);
      }
    } catch { setMessage('Outcome unavailable. Keep this request key and use Recover original run. Do not start a replacement test.'); }
    finally { clearTimeout(timeout); lock.current = false; setBusy(false); }
  }
  function next() {
    if (oneShot && result?.accounting !== 'not_dispatched') return;
    if (lock.current || !(recoveredSettled || result && !result.reconciliationRequired && ['settled', 'not_dispatched'].includes(result.accounting))) return;
    try { sessionStorage.removeItem(pendingStorageKey); } catch { setMessage('Could not clear recovery key.'); return; }
    pending.current = ''; setKey(''); setResult(null); setRecoveredSettled(false); setMessage('');
  }
  if (!adminToken) return null;
  return <section className="rounded-xl border border-line p-4 space-y-3" aria-label={`${provider} diagnostic bot`}>
    <h3>{provider === 'surplus' ? 'Surplus-only testing bot' : 'CheaperInference-only testing bot'}</h3>
    <p>One explicit request. This diagnostic client performs no fallback or automatic retry. Provider-internal retries and routing are not controlled here. Maximum 2048 prompt bytes, 256 output tokens, 30-second client deadline. Supplier execution and billing may continue after a timeout.</p>
    <label>Test prompt<textarea className="block w-full rounded border border-line bg-transparent p-2 text-ink" value={prompt} readOnly={oneShot} disabled={busy || !!key} onChange={e => setPrompt(e.target.value)} /></label>
    <button className={button} disabled={!ready || busy || !!key || !validPrompt} onClick={() => void action(false)}>Run {provider} test</button>
    {oneShot && <button className={button} disabled={busy || !key || !!result || !ready} onClick={() => void action(false, true)}>Retry original admission with same key</button>}
    <button className={button} disabled={busy || !key} onClick={() => void action(true)}>Recover original run</button>
    <button className={button} disabled={busy || (oneShot && result?.accounting !== 'not_dispatched') || !(recoveredSettled || result && !result.reconciliationRequired && ['settled', 'not_dispatched'].includes(result.accounting))} onClick={next}>{oneShot ? 'Clear blocked attempt' : 'Prepare another test'}</button>
    {key && <p>Recovery key: {key}</p>}{message && <p role="status">{message}</p>}
    {result && <ProviderDiagnosticResult result={result} />}
  </section>;
}

export function ProviderDiagnosticPanels({ adminToken }: { adminToken: string }) {
  const [status, setStatus] = useState<{ dispatchReady: boolean; providers?: Record<DiagnosticProvider, { dispatchReady: boolean; reason: string | null; missingFields: string[] }> } | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const lock = useRef(false);
  async function check() {
    if (lock.current || !adminToken) return; lock.current = true; setBusy(true); setError(''); setStatus(null);
    try {
      const r = await fetch(`${API}/status`, { headers: adminHeaders(adminToken), cache: 'no-store' });
      const data = await r.json(); if (!r.ok || typeof data?.dispatchReady !== 'boolean') throw new Error('unavailable');
      setStatus({ dispatchReady: data.dispatchReady, providers: data.providers });
    } catch { setError('Admin verification or diagnostic status is unavailable. Testing controls are hidden.'); }
    finally { lock.current = false; setBusy(false); }
  }
  if (!adminToken) return null;
  return <section className="space-y-4 text-ink"><h2>Provider testing bots</h2>
    <p>Manual tests only. Opening or refreshing this panel makes no request and spends nothing.</p>
    <button className={button} disabled={busy} onClick={() => void check()}>Verify admin and read test status</button>
    {error && <p role="alert">{error}</p>}
    {status && <><p>Separate allowance: ₹100 total, one call per provider. Reservations use full-context pricing and an exchange-rate buffer. They are estimates, not provider-enforced monetary caps. Unknown supplier charges retain their holds.</p><p role="status">{status.dispatchReady ? 'Preflight passed. One manual call per provider; each still requires budget admission.' : 'Dispatch blocked. See the specific provider or shared-budget issue below. This separate ₹100 allowance covers only one call per provider; historical benchmark holds remain unchanged.'}</p>
      {status.providers && <ul>{(['surplus', 'cheaperinference'] as const).map(p => <li key={p}>{p}: {status.providers![p]?.reason ?? 'Ready for admission'} · Preflight: {status.providers![p]?.missingFields?.join(', ') || 'None reported'}</li>)}</ul>}
      <ProviderDiagnosticBot provider="surplus" oneShot adminToken={adminToken} ready={status.providers?.surplus.dispatchReady ?? status.dispatchReady} />
      <ProviderDiagnosticBot provider="cheaperinference" oneShot adminToken={adminToken} ready={status.providers?.cheaperinference.dispatchReady ?? status.dispatchReady} /></>}
  </section>;
}
