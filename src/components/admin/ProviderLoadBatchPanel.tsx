import { useEffect, useRef, useState } from 'react';
import { adminHeaders } from '../../lib/adminFetch';
import { newRequestIdentity } from '../../lib/requestIdentity';
import type { LoadBatch } from '../../shared/providerLoadBatch';
class BatchRequestError extends Error {}
const API = '/api/v1/admin/provider-load-batch';
const button = 'min-h-11 rounded-lg border border-line px-3 py-2 text-sm text-ink disabled:opacity-40';
const money = (nano: number) => `${(nano / 1e9).toFixed(9)} USD`;
type Form = { budgetInr: string; allInInrPerUsd: string; priorSupplierUsd: string; priorAttempts: number; attempts: number; concurrency: number; outputTokens: number };
const empty: Form = { budgetInr: '', allInInrPerUsd: '', priorSupplierUsd: '', priorAttempts: 0, attempts: 0, concurrency: 2, outputTokens: 2048 };
/** Explicit operator actions only. Loading/reloading does not fetch or spend. */
export function ProviderLoadBatchPanel({ adminToken }: { adminToken: string }) {
  const [form, setForm] = useState<Form>(empty), [batch, setBatch] = useState<LoadBatch | null>(null);
  const [ordinal, setOrdinal] = useState('0'), [item, setItem] = useState<unknown>(null);
  const [message, setMessage] = useState(''), [running, setRunning] = useState(false), [busy, setBusy] = useState(false);
  const alive = useRef(true), loop = useRef(false), actionLock = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; loop.current = false; }; }, []);
  const latestRevision = useRef(0);
  function acceptBatch(value: LoadBatch | null) {
    if (value === null) { if (latestRevision.current === 0) setBatch(null); return; }
    if (!value || !Number.isSafeInteger(value.revision) || !value.authority || typeof value.scopeId !== 'string') throw new Error('invalid batch');
    if (value.revision < latestRevision.current) return;
    latestRevision.current = value.revision; setBatch(value);
  }
  async function request(path: string, body?: unknown) {
    const response = await fetch(`${API}/${path}`, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
      headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      if (path === 'configure') {
        try { const { diagnostic: d } = await response.json();
          if (d && /^[0-9a-f-]{36}$/i.test(d.correlationId) && /^[a-z_]{1,40}$/.test(d.stage) && /^[a-z_]{1,40}$/.test(d.reason)) {
            detail += ` · Request ${d.correlationId} · Stage ${d.stage} · Reason ${d.reason}`;
            if (Number.isInteger(d.upstreamStatus) && d.upstreamStatus >= 100 && d.upstreamStatus <= 599) detail += ` · Supplier HTTP ${d.upstreamStatus}`;
            if (['list_price_unknown','min_discount_unavailable','invalid_min_discount','invalid_api_key','insufficient_balance','rate_limit_exceeded','model_not_found'].includes(d.supplierCode)) detail += ` · Supplier code ${d.supplierCode}`;
            for (const key of ['object','model','min_discount_percent','max_input_per_million','max_output_per_million']) if (['missing','null','array','object','string','number','boolean'].includes(d.fields?.[key])) detail += ` · ${key}: ${d.fields[key]}`;
          }
        } catch { /* No raw body is displayed. */ }
      }
      throw new BatchRequestError(detail);
    } return response.json();
  }
  async function read() {
    if (!adminToken || actionLock.current) return; actionLock.current = true; setBusy(true);
    try {
      const data = await request('status');
      if (!alive.current) return;
      acceptBatch(data.batch); setMessage(data.batch ? 'Original batch read. No inference dispatched.' : 'No batch configured. Enter the approved remaining scope and costs.');
      if (data.batch && data.settings) setForm({ budgetInr: String(data.settings.budgetPaise / 100), allInInrPerUsd: String(data.settings.allInPaisePerUsd / 100),
        priorSupplierUsd: String(data.batch.authority.priorCostNanoUsd / 1e9), priorAttempts: data.batch.authority.priorAttempts,
        attempts: data.batch.count, concurrency: data.batch.concurrency, outputTokens: data.batch.authority.maxOutputTokens });
    } catch { if (alive.current) setMessage('Batch status unavailable. Do not start a replacement run.'); }
    finally { actionLock.current = false; if (alive.current) setBusy(false); }
  }
  async function save() {
    if (!adminToken || actionLock.current) return; actionLock.current = true; setBusy(true);
    try {
      const data = await request('configure', { ...form, expectedRevision: batch?.revision ?? 0 });
      if (alive.current) { acceptBatch(data.batch); setMessage('Configuration saved and audited. No inference dispatched.'); }
    } catch (error) { if (alive.current) setMessage(`Save outcome unconfirmed. No inference dispatched. ${error instanceof BatchRequestError ? error.message : 'Network or response unavailable; exact cause unknown.'}`); }
    finally { actionLock.current = false; if (alive.current) setBusy(false); }
  }
  async function start() {
    if (!adminToken || loop.current || actionLock.current || !batch || batch.stopped) return;
    loop.current = true; setRunning(true); setMessage('Concurrent batch running. No automatic provider retries or fallback.');
    try {
      let previous = batch.next;
      while (loop.current && alive.current) {
        const waveId = newRequestIdentity(); if (!waveId) throw new Error('identity');
        // A lost acknowledgement stops this loop; no new wave is sent until an explicit operator action.
        const data = await request('advance', { waveId });
        if (!alive.current) break;
        const current = data.batch as LoadBatch; acceptBatch(current);
        if (current.stopped || current.next >= current.count || current.next === previous || current.active >= current.concurrency) {
          setMessage('Batch paused or complete. Read status and individual receipts before continuing. Unknown liabilities remain held.'); break;
        }
        previous = current.next;
      }
    } catch { if (alive.current) setMessage('Wave outcome unconfirmed. Read the original batch; do not replace the run or retry individual requests.'); }
    finally { loop.current = false; if (alive.current) setRunning(false); }
  }
  async function readItem() {
    if (!adminToken || !/^(0|[1-9]\d{0,3})$/.test(ordinal)) return;
    try { const data = await request(`items/${ordinal}`); if (alive.current) setItem(data.item); }
    catch { if (alive.current) setMessage('Item receipt unavailable. No replacement call was made.'); }
  }
  async function stop() {
    loop.current = false;
    try { const data = await request('stop', {}); if (alive.current) { acceptBatch(data.batch); setMessage('Unsent work stopped. Already dispatched requests may still complete and be billed.'); } }
    catch { if (alive.current) setMessage('Stop acknowledgement unavailable. Read status; do not assume supplier cancellation.'); }
  }
  async function resume() {
    if (!batch || actionLock.current) return; actionLock.current = true;
    try { const data = await request('resume', { expectedRevision: batch.revision }); if (alive.current) { acceptBatch(data.batch); setMessage('Unsent work resumed. Original attempts, spend and unknown liabilities are unchanged. Select Run to send requests.'); } }
    catch { if (alive.current) setMessage('Resume not confirmed. Read the latest revision.'); }
    finally { actionLock.current = false; }
  }
  if (!adminToken) return null;
  const fields: Array<[keyof Form, string]> = [['budgetInr','Total approved budget (INR, including prior spend)'], ['allInInrPerUsd','All-in INR per USD ceiling (include fees and taxes)'],
    ['priorSupplierUsd','Previously spent supplier USD'], ['priorAttempts','Previously consumed attempts'], ['attempts','Additional attempts in this run'],
    ['concurrency','Concurrent requests'], ['outputTokens','Requested output token limit for this batch']];
  return <section aria-label="Concurrent CheaperInference batch" className="space-y-3 rounded-xl border border-line p-4 text-ink">
    <h3>Concurrent CheaperInference batch</h3>
    <p>Separate from manual bots. Use only the approved remaining count and total budget; earlier attempts and costs are included, never reset. Native provider limits apply. Budget reservations are not supplier receipts or a provider account spending cap.</p>
    <p>Saving reads current native pricing without inference. Unknown cost stays reserved. The all-in conversion ceiling must come from your actual payment terms; it is not guessed here. This runner currently derives conservative token exposure for the configured Beam model from the published input context and requested native output limit. A serving provider must honor that limit; this is not a guaranteed account cash cap.</p>
    <button className={button} disabled={busy} onClick={() => void read()}>Read original batch</button>
    {fields.map(([key,label]) => <label key={key} className="block">{label}<input className="ml-2 rounded border border-line bg-transparent p-2" type="text" value={form[key]}
      disabled={busy || !!batch && (key === 'priorAttempts' || key === 'priorSupplierUsd')}
      onChange={e => setForm(previous => ({ ...previous, [key]: ['priorAttempts','attempts','concurrency','outputTokens'].includes(key) ? Number(e.target.value) : e.target.value }))} /></label>)}
    <button className={button} disabled={busy} onClick={() => void save()}>Save approved batch configuration</button>
    <button className={button} disabled={busy || running || !batch || batch.stopped} onClick={() => void start()}>Run configured batch</button>
    <button className={button} disabled={!batch} onClick={() => void stop()}>Abort unsent work</button>
    <button className={button} disabled={!batch?.stopped || busy || running} onClick={() => void resume()}>Resume unsent work</button>
    <label className="block">Receipt ordinal (zero-based)<input className="ml-2 rounded border border-line bg-transparent p-2" value={ordinal} onChange={e => setOrdinal(e.target.value)} /></label>
    <button className={button} disabled={!batch} onClick={() => void readItem()}>Read item receipt</button>
    {item != null && <pre className="whitespace-pre-wrap break-words">{JSON.stringify(item, null, 2)}</pre>}
    {message && <p role="status">{message}</p>}
    {batch && <div><p>Run: {batch.scopeId} · Revision: {batch.revision} · Claimed: {batch.next}/{batch.count} · Completed outcomes: {batch.completed} · Active or uncertain: {batch.active}</p>
      <p>Operator-entered prior spend plus recorded supplier receipts: {money(batch.spentNanoUsd)} · Reserved including unknown: {money(batch.heldNanoUsd)} · Remaining after reservations: {money(Math.max(0, batch.authority.totalBudgetNanoUsd - batch.spentNanoUsd - batch.heldNanoUsd))}</p>
      <p>Conservative reservation per attempt: {money(batch.authority.maxAttemptNanoUsd)}. If the remaining budget cannot fund one reservation, no request is sent.</p>
      <p>Selected provider: cheaperinference · Model: {batch.model}. Provider-side routing is not controlled by this client. Completed outcomes do not mean correct answers.</p></div>}
  </section>;
}
