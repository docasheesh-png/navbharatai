import { useCallback, useEffect, useState } from 'react';
import { adminFailed, adminGet, adminHeaders } from '../../lib/adminFetch';
import { isProviderSwitchesView, thisInstanceEnforces, type ProviderSwitchRowView, type ProviderSwitchesView } from '../../lib/providerSwitchesView';

/**
 * Admin → AI Engines → AI provider switches (admin 2026-11-04: "sabhi ai provider ko on off karne ka switch
 * banao … 100% real and working"). Turning a provider off withdraws its keys and refuses its network calls on
 * every server (providerSwitches.ts); builds, chat and features fall back to the next provider or say the
 * service is unavailable. Every change needs a reason and is kept in the history below.
 */
export function ProviderSwitchesPanel({ adminToken }: { adminToken: string }) {
  const [data, setData] = useState<ProviderSwitchesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ row: ProviderSwitchRowView; on: boolean } | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await adminGet<unknown>('/api/admin/provider-switches', { token: adminToken });
    if (adminFailed(r)) { setError(r.message); return; }
    if (!isProviderSwitchesView(r.data)) { setError('The server answered in a shape this screen does not know. Nothing is confirmed on or off.'); return; }
    setError(null); setData(r.data);
  }, [adminToken]);
  useEffect(() => { void load(); }, [load]);

  const confirm = async () => {
    if (!pending || !data) return;
    setSaving(true); setSaveError(null);
    try {
      const res = await fetch('/api/admin/provider-switches', {
        method: 'POST', headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pending.row.id, on: pending.on, reason, expectedRevision: data.revision }),
      });
      const b = await res.json().catch(() => null) as { error?: unknown; revision?: unknown } | null;
      if (!res.ok) { setSaveError(typeof b?.error === 'string' ? b.error : `Could not save (HTTP ${res.status}).`); return; }
      if (!b || !Number.isInteger(b.revision)) { setSaveError('The server answered in a shape this screen does not know. Reload to see what was saved.'); return; }
      setPending(null); setReason('');
      await load();
    } catch {
      setSaveError('Could not reach the server. Nothing was changed.');
    } finally { setSaving(false); }
  };

  const fmt = (t: number | null) => (t ? new Date(t).toLocaleString() : 'never');
  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-4" aria-labelledby="provider-switches-title">
      <div>
        <h3 id="provider-switches-title" className="text-base font-semibold text-ink">AI provider switches</h3>
        <p className="text-sm text-muted">
          Turn an AI provider off to stop NavBharatAI using it everywhere — builds, chat, images, Free Chat. Its keys are withdrawn and
          its network calls are refused on every server; work moves to the next provider, or the feature says it is unavailable.
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {data && (
        <>
          <p className="text-xs text-muted" data-testid="provider-switches-sync">
            {thisInstanceEnforces(data)
              ? `This server applied the current state (${fmt(data.thisInstance.at)}). Other servers apply it within ${Math.round(data.syncMs / 1000)} seconds.`
              : `This server has not applied the latest change yet (last sync ${fmt(data.thisInstance.at)}${data.thisInstance.ok ? '' : ', the last read failed'}). It retries every ${Math.round(data.syncMs / 1000)} seconds.`}
          </p>
          <ul className="divide-y divide-line rounded-md border border-line">
            {data.providers.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 p-2" data-testid={`provider-switch-${p.id}`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{p.name}</p>
                  <p className="text-xs text-muted">
                    {p.on ? <span className="text-success">ON</span> : <span className="font-semibold text-danger">OFF</span>}
                    {p.hasKey === false && ' · no key set on this server'}
                    {p.hasKey === null && ' · uses the server’s Google Cloud identity'}
                  </p>
                </div>
                <button type="button" role="switch" aria-checked={p.on} aria-label={`${p.name}: ${p.on ? 'on' : 'off'}`}
                  onClick={() => { setPending({ row: p, on: !p.on }); setReason(''); setSaveError(null); }}
                  className={`relative h-6 w-11 shrink-0 rounded-full border border-line ${p.on ? 'bg-success' : 'bg-danger/40'}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface transition-all ${p.on ? 'left-5' : 'left-0.5'}`} />
                </button>
              </li>
            ))}
          </ul>
          {pending && (
            <form role="dialog" aria-label="Confirm switch" className="space-y-2 rounded-md border border-line p-3"
              onSubmit={(e) => { e.preventDefault(); void confirm(); }}>
              <p className="text-sm text-ink">
                Turn <strong>{pending.row.name}</strong> {pending.on ? 'ON' : 'OFF'}?
                {!pending.on && ' Work in progress moves to the next provider; anything that only this provider can do will say it is unavailable.'}
              </p>
              <label className="block text-xs text-muted" htmlFor="switch-reason">Reason (kept in the history)</label>
              <input id="switch-reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={300} required
                className="w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink" placeholder="e.g. balance finished, provider outage" />
              <div className="flex gap-2">
                <button type="submit" disabled={saving || reason.trim().length < 3} className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-on-accent disabled:opacity-50">
                  {saving ? 'Saving…' : `Turn ${pending.on ? 'on' : 'off'}`}
                </button>
                <button type="button" onClick={() => setPending(null)} className="text-sm text-muted underline">Cancel</button>
              </div>
              {saveError && <p role="alert" className="text-xs text-danger">{saveError}</p>}
            </form>
          )}
          {data.history.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm text-ink">Change history ({data.history.length})</summary>
              <ul className="mt-1 space-y-1">
                {data.history.map((h, i) => (
                  <li key={i} className="text-xs text-muted">
                    {fmt(h.at)} · {h.by} turned <strong className="text-ink">{data.providers.find((p) => p.id === h.id)?.name ?? h.id}</strong> {h.on ? 'ON' : 'OFF'} — {h.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
