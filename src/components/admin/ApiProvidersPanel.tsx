import React, { useCallback, useEffect, useState } from 'react';
import { adminFailed, adminGet, adminHeaders } from '../../lib/adminFetch';
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

      {data && !data.accountsAvailable && (
        <p role="alert" className="text-sm text-warn">The saved logins could not be loaded just now — balances are shown, logins are not. Reload to try again.</p>
      )}

      {data && (
        <ul className="divide-y divide-line rounded-md border border-line bg-surface">
          {rows.map((row) => <ProviderRow key={row.id} row={row} adminToken={adminToken} accountsAvailable={data.accountsAvailable}
            onSaved={(email) => setData((d) => d && { ...d, rows: d.rows.map((r) => r.id === row.id ? { ...r, accountEmail: email } : r) })} />)}
        </ul>
      )}
    </section>
  );
}

function ProviderRow({ row, adminToken, accountsAvailable, onSaved }: {
  row: ApiProviderRowView; adminToken: string; accountsAvailable: boolean; onSaved: (email: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.accountEmail ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const save = async () => {
    setSaving(true); setSaveError(null);
    try {
      const res = await fetch(`/api/admin/api-providers/${encodeURIComponent(row.id)}/account`, {
        method: 'POST', headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountEmail: draft }),
      });
      const body: unknown = await res.json().catch(() => null);
      const b = body as { accountEmail?: unknown; error?: unknown } | null;
      if (!res.ok) { setSaveError(typeof b?.error === 'string' ? b.error : `Could not save (HTTP ${res.status}).`); return; }
      if (!b || !(b.accountEmail === null || typeof b.accountEmail === 'string')) { setSaveError('The server answered in a shape this screen does not know. Reload to see what was saved.'); return; }
      onSaved(b.accountEmail as string | null);
      setEditing(false);
    } catch {
      setSaveError('Could not reach the server. Nothing was changed.');
    } finally { setSaving(false); }
  };
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
        {accountsAvailable && !editing && (
          <p className="text-xs text-ink" data-testid={`api-provider-login-${row.id}`}>
            Login: {row.accountEmail ?? <span className="text-muted">not recorded</span>}{' '}
            <button type="button" className="text-accent-text underline" onClick={() => { setDraft(row.accountEmail ?? ''); setEditing(true); }}>
              {row.accountEmail ? 'Edit' : 'Add'}
            </button>
          </p>
        )}
        {editing && (
          <form className="mt-1 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <label className="sr-only" htmlFor={`login-${row.id}`}>Login email for {row.name}</label>
            <input id={`login-${row.id}`} type="email" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="name@example.com"
              className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink" />
            <button type="submit" disabled={saving} className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-on-accent disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => { setEditing(false); setSaveError(null); }} className="text-xs text-muted underline">Cancel</button>
            {saveError && <span role="alert" className="text-xs text-danger">{saveError}</span>}
          </form>
        )}
      </div>
      {row.billingUrl
        ? <a href={row.billingUrl} target="_blank" rel="noopener noreferrer"
            className="rounded-md border border-line px-3 py-2 text-sm text-accent-text">🔗 Open billing</a>
        : <span className="text-xs text-muted">No billing link known</span>}
    </li>
  );
}
