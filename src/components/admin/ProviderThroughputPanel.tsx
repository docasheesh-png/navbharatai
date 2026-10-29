import { useState } from 'react';
import { adminHeaders } from '../../lib/adminFetch';

/** Owner t124u: per-provider concurrent throughput test, unique prompt per request. Explicit click only. */
export function ProviderThroughputPanel({ adminToken }: { adminToken: string }) {
  const [requests, setRequests] = useState(1000), [concurrency, setConcurrency] = useState(200);
  const [busy, setBusy] = useState<string | null>(null), [result, setResult] = useState<Record<string, string>>({});
  async function run(provider: 'surplus' | 'cheaperinference') {
    setBusy(provider);
    try {
      const r = await fetch(`/api/admin/provider-diagnostics/${provider}/throughput`, { method: 'POST', cache: 'no-store',
        headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' }, body: JSON.stringify({ requests, concurrency, retries: 1, maxOutputTokens: 64 }) });
      const j = await r.json().catch(() => ({}));
      setResult(s => ({ ...s, [provider]: r.ok
        ? `ok ${j.ok}/${j.requests} · correct ${j.pass} · ${j.rpm} resp/min · ${j.workingRpm} correct/min · ${Math.round(j.durationMs / 1000)}s · p50 ${j.p50Ms}ms p95 ${j.p95Ms}ms · retried ${j.retried} · errors ${JSON.stringify(j.errors)} · $${j.costUsd}`
        : `HTTP ${r.status} ${j.error ?? ''} ${j.reason ?? ''}` }));
    } catch { setResult(s => ({ ...s, [provider]: 'Network error / timeout' })); }
    finally { setBusy(null); }
  }
  const b = 'rounded border px-3 py-1 disabled:opacity-50';
  return <div className="space-y-2" data-testid="provider-throughput">
    <h3>Throughput test (unique prompts, target 1000/min)</h3>
    <label>Requests <input type="number" min={1} max={20000} value={requests} onChange={e => setRequests(Number(e.target.value))} /></label>{' '}
    <label>Concurrency <input type="number" min={1} max={2000} value={concurrency} onChange={e => setConcurrency(Number(e.target.value))} /></label>
    {(['surplus', 'cheaperinference'] as const).map(p => <div key={p}>
      <button className={b} disabled={busy !== null} onClick={() => void run(p)}>{busy === p ? `Running ${p}…` : `Run ${p} throughput`}</button>
      {result[p] && <p role="status">{p}: {result[p]}</p>}
    </div>)}
  </div>;
}
