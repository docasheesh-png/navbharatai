import React, { useCallback, useEffect, useState } from 'react';
import { adminFailed, adminGet } from '../../lib/adminFetch';
import { isApiProviderDirectory, sortProvidersForAttention, type ApiProviderDirectoryView, type ApiProviderRowView } from '../../lib/apiProvidersView';

/**
 * Admin → Money → API Providers (admin 2026-11-03: "one click par, dekh len kon se api provider ka balance
 * low/khatam hai"). One list of every outside API NavBharatAI uses, with its billing link, and the real balance
 * where the provider offers a balance API. Rows that need attention come first. Nothing here is a guess: a row
 * without a live balance says "check manually", never "OK".
 */
export function ApiProvidersPanel({ adminToken }: { adminToken: string }) {
  const [data, setData] = useState<ApiProviderDirectoryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await adminGet<unknown>('/api/admin/api-providers', { token: adminToken });
    setLoading(false);
    if (adminFailed(r)) { setError(r.message); return; }
    if (!isApiProviderDirectory(r.data)) { setError('The server answered in a shape this screen does not know. No balance is confirmed.'); return; }
    setData(r.data);
  }, [adminToken]);

  useEffect(() => { void load(); }, [load]);

  const rows = data ? sortProvidersForAttention(data.rows) : [];
  return (
    <section className="space-y-4" aria-labelledby="api-providers-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="api-providers-title" className="text-lg font-semibold text-ink">API Providers</h2>
          <p className="text-sm text-muted">Every outside API NavBharatAI calls. Keep each account topped up. A live balance is read from the provider itself; the rest need a manual check on their billing page.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-on-accent disabled:opacity-50">
          {loading ? 'Checking…' : 'Check balances now'}
        </button>
      </div>

      {error && <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}

      {data && (
        <p className="text-sm text-ink" data-testid="api-providers-summary">
          {data.counts.configured} of {data.counts.total} configured ·{' '}
          <span className={data.counts.empty ? 'font-semibold text-danger' : ''}>{data.counts.empty} empty</span> ·{' '}
          <span className={data.counts.low ? 'font-semibold text-warn' : ''}>{data.counts.low} low (under ${data.lowBalanceUsd})</span> ·{' '}
          {data.counts.failed} could not be checked · {data.counts.manual} need a manual check
        </p>
      )}

      {data && (
        <ul className="divide-y divide-line rounded-md border border-line bg-surface">
          {rows.map((row) => <ProviderRow key={row.id} row={row} />)}
        </ul>
      )}
    </section>
  );
}

function ProviderRow({ row }: { row: ApiProviderRowView }) {
  const b = row.balance;
  let status: React.ReactNode;
  if (b.kind === 'live') {
    const cls = b.level === 'empty' ? 'text-danger font-semibold' : b.level === 'low' ? 'text-warn font-semibold' : 'text-success';
    const label = b.level === 'empty' ? 'EMPTY' : b.level === 'low' ? 'LOW' : 'OK';
    status = <span className={cls}>{label} · {b.amount.toFixed(2)} {b.currency}</span>;
  } else if (b.kind === 'failed') status = <span className="text-danger">Could not check — {b.reason}</span>;
  else if (b.kind === 'manual') status = <span className="text-muted">Check manually — {b.reason}</span>;
  else status = <span className="text-muted">Key not set</span>;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 p-3" data-testid={`api-provider-${row.id}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{row.name}{row.group === 'registered' && <span className="ml-2 text-xs text-muted">registered only</span>}</p>
        {row.usedFor.length > 0 && (
          <p className="text-xs text-ink" data-testid={`api-provider-used-${row.id}`}>Used for: {row.usedFor.join(' · ')}</p>
        )}
        <p className="text-xs text-muted">{row.configured ? `Key: ${row.configuredKeys.join(', ')}` : 'No key set'} · {row.billingHint}</p>
        <p className="text-sm">{status}</p>
      </div>
      {row.billingUrl
        ? <a href={row.billingUrl} target="_blank" rel="noopener noreferrer"
            className="rounded-md border border-line px-3 py-2 text-sm text-accent-text">🔗 Open billing</a>
        : <span className="text-xs text-muted">No billing link known</span>}
    </li>
  );
}
