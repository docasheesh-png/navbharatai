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
        headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' }, body: JSON.stringify({ requests, concurrency, retries: 2 }) });
      if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); setResult(s => ({ ...s, [provider]: `HTTP ${r.status} ${j.error ?? ''} ${j.reason ?? ''}` })); return; }
      // NDJSON stream: started → progress heartbeats → exactly one result | error line.
      const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '', final = false;
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (!line.trim()) continue;
          const j = JSON.parse(line);
          if (j.type === 'progress') setResult(s => ({ ...s, [provider]: `running ${j.done}/${j.requests} · ok ${j.ok} · correct ${j.pass} · ${Math.round(j.elapsedMs / 1000)}s` }));
          else if (j.type === 'result') { final = true; setResult(s => ({ ...s, [provider]: `ok ${j.ok}/${j.requests} · correct ${j.pass} · ${j.rpm} resp/min · ${j.workingRpm} correct/min · ${Math.round(j.durationMs / 1000)}s · p50 ${j.p50Ms}ms p95 ${j.p95Ms}ms · retried ${j.retried} · errors ${JSON.stringify(j.errors)} · $${j.costUsd}` })); }
          else if (j.type === 'error') { final = true; setResult(s => ({ ...s, [provider]: `aborted: ${j.reason}` })); }
        }
      }
      if (!final) setResult(s => ({ ...s, [provider]: `${s[provider] ?? ''} — stream ended before result (instance recycled or proxy timeout)` }));
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
