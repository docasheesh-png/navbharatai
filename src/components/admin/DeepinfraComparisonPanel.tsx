import React, { useCallback, useEffect, useRef, useState } from 'react';
import { adminHeaders } from '../../lib/adminFetch';
import { newRequestIdentity } from '../../lib/requestIdentity';
import { isComparisonReport, isComparisonStatus, type ComparisonReport, type ComparisonStatus } from '../../lib/deepinfraComparison';

const API = '/api/v1/admin/free-chat-chain/deepinfra-comparison';
const button = 'min-h-11 rounded-lg border border-line px-3 py-2 text-sm text-ink disabled:opacity-40';
const money = (n: number | null) => n === null ? 'Not fully measured' : n > 0 && n < .000001 ? '<$0.000001' : `$${n.toFixed(6)}`;
const labels = { hindi: 'Hindi answer', math: 'Maths', json: 'JSON schema', tool: 'Tool call', stream: 'Streaming', typescript: 'TypeScript function' };

export function DeepinfraComparisonPanel({ adminToken }: { adminToken: string }): React.ReactElement {
  const [status, setStatus] = useState<ComparisonStatus | null>(null);
  const [report, setReport] = useState<ComparisonReport | null>(null);
  const [error, setError] = useState(''), [reason, setReason] = useState('');
  const [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const epoch = useRef(0), lock = useRef(false), runId = useRef<string | null>(null);
  const readAbort = useRef<AbortController | null>(null), runAbort = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    const current = epoch.current;
    readAbort.current?.abort(); const controller = new AbortController(); readAbort.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000); setLoading(true);
    try {
      const res = await fetch(API, { headers: adminHeaders(adminToken), cache: 'no-store', signal: controller.signal });
      const data: unknown = await res.json();
      if (current !== epoch.current || readAbort.current !== controller) return;
      if (!res.ok || !isComparisonStatus(data)) throw new Error('Comparison status is unavailable. Refresh before running.');
      setStatus(data); setAccepted(false); setError('');
      if (data.lastReport) { setReport(data.lastReport); if (runId.current === data.lastReport.runId) runId.current = null; }
    } catch (e) { if (current === epoch.current && readAbort.current === controller) setError(e instanceof Error ? e.message : 'Could not read comparison status.'); }
    finally { clearTimeout(timeout); if (current === epoch.current && readAbort.current === controller) setLoading(false); }
  }, [adminToken]);
  useEffect(() => {
    epoch.current++; lock.current = false; runId.current = null;
    setStatus(null); setReport(null); setReason(''); setAccepted(false); setBusy(false); setError('');
    void load();
    return () => { epoch.current++; readAbort.current?.abort(); runAbort.current?.abort(); };
  }, [load]);
  const ready = !!status && status.configured && status.catalogAvailable && status.budgetAvailable && !status.running && !loading && !busy && !error;
  const run = async () => {
    if (!ready || !accepted || reason.trim().length < 10 || reason.trim().length > 500 || lock.current || !status?.tariffDigest) return;
    runId.current ??= newRequestIdentity() ?? null;
    if (!runId.current) { setError('A secure comparison identity is unavailable in this browser. No paid request was sent.'); return; }
    lock.current = true; setBusy(true); setError(''); const current = epoch.current;
    const controller = new AbortController(); runAbort.current = controller;
    const timeout = setTimeout(() => controller.abort(), 200_000);
    try {
      const response = await fetch(API, { method: 'POST', cache: 'no-store', headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' },
        signal: controller.signal, body: JSON.stringify({ runId: runId.current, reason: reason.trim(), tariffDigest: status.tariffDigest, acceptPublishedRates: true }) });
      const data: unknown = await response.json();
      if (current !== epoch.current) return;
      if (!response.ok || !isComparisonReport(data) || data.runId !== runId.current) throw new Error('Comparison could not be confirmed. Refresh saved status before retrying; a failed request may still have cost.');
      setReport(data); runId.current = null; setAccepted(false);
      // Reread the shared budget and saved result only; this never reruns inference.
      await load();
    } catch (e) { if (current === epoch.current) { setAccepted(false); setError(e instanceof Error && !controller.signal.aborted ? e.message : 'Comparison timed out or was cancelled. Refresh saved status before retrying.'); } }
    finally { clearTimeout(timeout); if (current === epoch.current) { lock.current = false; setBusy(false); } }
  };
  return <section aria-label="DeepInfra model comparison" className="rounded-2xl border border-line bg-card p-4 space-y-4 text-body">
    <div className="flex flex-wrap justify-between gap-3"><h2 className="text-lg font-semibold text-ink">DeepInfra · V4 vs V4.1 comparison</h2><button className={button} disabled={busy || loading} onClick={() => void load()}>Refresh saved status</button></div>
    <p className="text-sm text-muted">Compare both pinned releases on the same six small, synthetic checks: Hindi, maths, JSON, tool calling, streaming and a TypeScript function. Generated code is parsed, never executed. This is a capability sample, not a full app-building benchmark. Results never switch your production model.</p>
    {error && <p role="alert" className="text-danger">{error}</p>}
    <p role="status" className="text-sm">{busy ? 'Running comparison… up to three minutes. No automatic retry.' : loading ? 'Reading comparison status…' : !status ? 'Status not available yet.' : status.running ? 'A comparison is already running. Refresh saved status later.' : 'Comparison status loaded.'}</p>
    {status && <>
      <p className="text-sm">Credential: {status.configured ? 'Configured on server' : 'Not configured on server'} · Catalog: {status.catalogAvailable ? 'Verified' : 'Unavailable'} · Shared budget remaining: {money(status.remainingBudgetUsd)}</p>
      {!status.budgetAvailable && <p className="text-sm text-warn">Shared budget is unavailable or insufficient. Review the Free Chat paid budget before running this comparison.</p>}
      <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="text-left text-muted">Current public rates, USD per million tokens. Reviewed {status.catalogObservedAt ? new Date(status.catalogObservedAt).toLocaleString() : 'not available'}.</caption><thead><tr><th scope="col" className="text-left">Pinned model</th><th scope="col">Input</th><th scope="col">Output</th></tr></thead><tbody>{status.rates.map(r => <tr key={r.model}><th scope="row" className="text-left break-all font-normal">{r.model}</th><td className="text-center">{money(r.inputPerMillion)}</td><td className="text-center">{money(r.outputPerMillion)}</td></tr>)}</tbody></table></div>
      <p className="text-sm text-muted">Maximum reservation for this run: {money(status.maximumReservationUsd)}, capped at $2 at the reviewed rates. This conservatively reserves each model’s full context; actual token-based estimated cost is usually lower. Unknown usage stays reserved. Uses the existing shared paid budget and daily request limits.</p>
    </>}
    <label className="block text-sm">Reason for comparison<input maxLength={500} minLength={10} value={reason} onChange={e => setReason(e.target.value)} disabled={busy} className="mt-1 block w-full rounded-lg border border-line bg-well p-3 text-ink" /></label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={accepted} disabled={!ready} onChange={e => setAccepted(e.target.checked)} />I confirm the displayed rates apply to this account and approve this comparison’s reservation, up to $2.</label>
    <button className={button} disabled={!ready || !accepted || reason.trim().length < 10 || reason.trim().length > 500} onClick={() => void run()}>Run paid comparison once</button>
    {report && <div className="space-y-3">
      <h3 className="font-semibold text-ink">Saved result · {new Date(report.endedAt).toLocaleString()}</h3>
      <p className="text-sm">{report.completed ? 'All checks attempted.' : `Incomplete comparison: ${report.stopReason?.replaceAll('-', ' ') ?? 'unavailable'}.`} A passing sample is not production approval; repeat measurements before selecting a model.</p>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th scope="col" className="text-left">Model</th><th scope="col">Passed</th><th scope="col">Median successful latency</th><th scope="col">Usage-based cost estimate</th><th scope="col">Cost / passed check</th></tr></thead><tbody>{report.summaries.map(s => <tr key={s.model}><th scope="row" className="text-left break-all font-normal">{s.model}</th><td className="text-center">{s.passed}/{s.total} ({s.attempted} attempted)</td><td className="text-center">{s.medianLatencyMs === null ? 'Not measured' : `${s.medianLatencyMs} ms`}</td><td className="text-center">{money(s.totalCostUsd)}</td><td className="text-center">{money(s.costPerPassedCaseUsd)}</td></tr>)}</tbody></table></div>
      <ul className="space-y-1 text-sm">{report.results.map(r => <li key={`${r.model}/${r.task}`} className="break-words">{r.model} · {labels[r.task]}: {r.passed ? 'Passed' : r.reason.replaceAll('-', ' ')} · {r.latencyMs} ms{r.firstTokenMs !== null ? ` · first token ${r.firstTokenMs} ms` : ''} · {money(r.costUsd)}{!r.settlementConfirmed ? ' · reservation retained' : ''}</li>)}</ul>
    </div>}
  </section>;
}
