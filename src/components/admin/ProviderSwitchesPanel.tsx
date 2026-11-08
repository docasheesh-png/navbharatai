import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFailed, adminGet, adminHeaders } from '../../lib/adminFetch';
import { isProviderSwitchesView, switchReasonProblem, thisInstanceEnforces, type ProviderSwitchesView } from '../../lib/providerSwitchesView';

/**
 * Admin → AI Engines → AI provider switches (admin 2026-11-04: "sabhi ai provider ko on off karne ka switch
 * banao … 100% real and working"). Turning a provider off withdraws its keys and refuses its network calls on
 * every server (providerSwitches.ts); builds, chat and features fall back to the next provider or say the
 * service is unavailable. Every change needs a reason and is kept in the history below.
 *
 * 🔴 FIXED 2026-11-04 (admin: "on/off button kam nahi kar raha hai, off ho hi nahi raha"). Two defects together:
 * the confirm form opened BELOW all 22 rows — off-screen on a phone, so tapping a switch changed nothing the admin
 * could see — and its button was disabled until a reason was typed, with no word saying so. The form now opens
 * INSIDE the row that was tapped, focused, and the button always answers: with the save, or with what is missing.
 */
export function ProviderSwitchesPanel({ adminToken }: { adminToken: string }) {
  const [data, setData] = useState<ProviderSwitchesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; on: boolean } | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await adminGet<unknown>('/api/admin/provider-switches', { token: adminToken });
    if (adminFailed(r)) { setError(r.message); return; }
    if (!isProviderSwitchesView(r.data)) { setError('The server answered in a shape this screen does not know. Nothing is confirmed on or off.'); return; }
    setError(null); setData(r.data);
  }, [adminToken]);
  useEffect(() => { void load(); }, [load]);

  const confirm = async () => {
    if (!pending || !data) return;
    const problem = switchReasonProblem(reason);
    if (problem) { setSaveError(problem); return; }
    setSaving(true); setSaveError(null);
    try {
      const res = await fetch('/api/admin/provider-switches', {
        method: 'POST', headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pending.id, on: pending.on, reason: reason.trim(), expectedRevision: data.revision }),
      });
      const b = await res.json().catch(() => null) as { error?: unknown; revision?: unknown } | null;
      if (!res.ok) { setSaveError(typeof b?.error === 'string' ? b.error : `Could not save (HTTP ${res.status}).`); return; }
      if (!b || !Number.isInteger(b.revision)) { setSaveError('The server answered in a shape this screen does not know. Reload to see what was saved.'); return; }
      const name = data.providers.find((p) => p.id === pending.id)?.name ?? pending.id;
      setDone(`${name} is now ${pending.on ? 'ON' : 'OFF'}.`);
      setPending(null); setReason('');
      await load();
    } catch {
      setSaveError('Could not reach the server. Nothing was changed.');
    } finally { setSaving(false); }
  };

  return (
    <ProviderSwitchesBody
      data={data} error={error} pending={pending} reason={reason} saving={saving} saveError={saveError} done={done}
      onToggle={(id, on) => { setPending({ id, on }); setReason(''); setSaveError(null); setDone(null); }}
      onReason={(v) => { setReason(v); if (saveError) setSaveError(null); }}
      onConfirm={() => { void confirm(); }}
      onCancel={() => { setPending(null); setSaveError(null); }}
    />
  );
}

/** The panel's markup — pure props, so the static render tests read exactly what the admin sees. */
export function ProviderSwitchesBody(props: {
  data: ProviderSwitchesView | null; error: string | null; pending: { id: string; on: boolean } | null;
  reason: string; saving: boolean; saveError: string | null; done: string | null;
  onToggle: (id: string, on: boolean) => void; onReason: (v: string) => void; onConfirm: () => void; onCancel: () => void;
}) {
  const { data, error, pending, reason, saving, saveError, done } = props;
  const reasonRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  useEffect(() => {
    if (!pending) return;
    // The form opens where the admin's thumb is; bring it into view and put the cursor in the reason box.
    formRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    reasonRef.current?.focus();
  }, [pending]);
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
      {done && <p role="status" className="text-sm font-medium text-success" data-testid="provider-switch-done">{done}</p>}
      {data && (
        <>
          <p className="text-xs text-muted" data-testid="provider-switches-sync">
            {thisInstanceEnforces(data)
              ? `This server applied the current state (${fmt(data.thisInstance.at)}). Other servers apply it within ${Math.round(data.syncMs / 1000)} seconds.`
              : `This server has not applied the latest change yet (last sync ${fmt(data.thisInstance.at)}${data.thisInstance.ok ? '' : ', the last read failed'}). It retries every ${Math.round(data.syncMs / 1000)} seconds.`}
          </p>
          <ul className="divide-y divide-line rounded-md border border-line">
            {data.providers.map((p) => (
              <li key={p.id} className="p-2" data-testid={`provider-switch-${p.id}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{p.name}</p>
                    <p className="text-xs text-muted">
                      {p.on ? <span className="text-success">ON</span> : <span className="font-semibold text-danger">OFF</span>}
                      {p.hasKey === false && ' · no key set on this server'}
                      {p.hasKey === null && ' · uses the server’s Google Cloud identity'}
                    </p>
                  </div>
                  <button type="button" role="switch" aria-checked={p.on} aria-label={`${p.name}: ${p.on ? 'on' : 'off'}`}
                    data-testid={`provider-switch-toggle-${p.id}`}
                    onClick={() => props.onToggle(p.id, !p.on)}
                    className={`relative h-6 w-11 shrink-0 rounded-full border border-line ${p.on ? 'bg-success' : 'bg-danger/40'}`}>
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface transition-all ${p.on ? 'left-5' : 'left-0.5'}`} />
                  </button>
                </div>
                {pending?.id === p.id && (
                  <form ref={formRef} aria-label={`Confirm turning ${p.name} ${pending.on ? 'on' : 'off'}`} className="mt-2 space-y-2 rounded-md border border-line p-3"
                    data-testid={`provider-switch-confirm-${p.id}`} onSubmit={(e) => { e.preventDefault(); props.onConfirm(); }}>
                    <p className="text-sm text-ink">
                      Turn <strong>{p.name}</strong> {pending.on ? 'ON' : 'OFF'}?
                      {!pending.on && ' Work in progress moves to the next provider; anything only this provider can do will say it is unavailable.'}
                    </p>
                    <label className="block text-xs text-muted" htmlFor={`switch-reason-${p.id}`}>Reason (required, kept in the history)</label>
                    <input id={`switch-reason-${p.id}`} ref={reasonRef} value={reason} onChange={(e) => props.onReason(e.target.value)} maxLength={300}
                      data-testid="provider-switch-reason"
                      className="w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink" placeholder="e.g. balance finished, provider outage" />
                    <div className="flex gap-2">
                      <button type="submit" disabled={saving} data-testid="provider-switch-submit"
                        className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-on-accent disabled:opacity-50">
                        {saving ? 'Saving…' : `Turn ${pending.on ? 'on' : 'off'}`}
                      </button>
                      <button type="button" onClick={props.onCancel} className="text-sm text-muted underline">Cancel</button>
                    </div>
                    {saveError && <p role="alert" className="text-xs text-danger" data-testid="provider-switch-error">{saveError}</p>}
                  </form>
                )}
              </li>
            ))}
          </ul>
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
