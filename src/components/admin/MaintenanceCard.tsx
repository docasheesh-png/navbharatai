import React, { useCallback, useEffect, useRef, useState } from 'react';
import { adminGet, adminFailed, adminHeaders } from '../../lib/adminFetch';
interface Setting {
  enabled: boolean;
  autoEnabled: boolean;
  reason: 'manual' | 'kimi_quota' | null;
  updatedAt: number | null;
  message: string;
  threshold: number;
  windowSeconds: number;
}
export function MaintenanceCard({ adminToken }: { adminToken: string }): React.ReactElement {
  const revision = useRef(0);
  const [state, setState] = useState<Setting | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const started = revision.current;
    const r = await adminGet<Setting>('/api/admin/ai-maintenance', { token: adminToken });
    if (started !== revision.current) return;
    if (adminFailed(r)) setError(r.message);
    else { setState(r.data); setError(''); }
  }, [adminToken]);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 15_000); return () => clearInterval(timer); }, [load]);
  const save = async (patch: { enabled?: boolean; autoEnabled?: boolean }) => {
    revision.current++;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/admin/ai-maintenance', {
        method: 'POST', headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Could not save Maintenance.');
      setState(json);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save Maintenance.'); }
    finally { setBusy(false); }
  };
  return <section aria-label="Maintenance" className="rounded-xl border border-line bg-card p-4 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-base font-bold text-ink">Maintenance</h3>
        <p className="text-sm text-muted" role="status">{!state ? 'Checking status…' : state.enabled ? 'ON — AI service paused' : 'OFF — AI service running'}</p></div>
      <button type="button" disabled={!state || busy || !!error} onClick={() => state && void save({ enabled: !state.enabled })}
        className={`min-h-11 rounded-lg px-4 py-2 font-bold disabled:opacity-50 ${state?.enabled ? 'bg-accent text-on-accent' : 'bg-raised border border-line text-danger'}`}>
        {busy ? 'Saving…' : state?.enabled ? 'Resume AI service' : 'Turn on Maintenance'}
      </button>
    </div>
    <p className="text-sm text-muted">Pause AI for everyone to control spending. AI tools and other service actions are paused; admin access, sign-in, wallet and payments stay available. Calls already sent may still have a cost.</p>
    {state && <>
      <blockquote className="rounded-lg bg-raised p-3 text-sm text-ink">{state.message}</blockquote>
      {state.enabled && <p className="text-sm text-ink">{state.reason === 'kimi_quota' ? 'Automatic protection: repeated primary provider account token/quota failures.' : 'Maintenance is enabled.'} Resume only when you are ready.</p>}
      <label className="flex items-start gap-3 text-sm text-ink">
        <input type="checkbox" className="mt-1 h-5 w-5" checked={state.autoEnabled} disabled={busy || !!error} onChange={e => void save({ autoEnabled: e.target.checked })} />
        <span><strong>Auto-on protection</strong><br />Turn Maintenance on after {state.threshold} primary provider account token/quota failures within {state.windowSeconds / 60} minutes. It stays on until you resume it. Temporary rate limits and oversized prompts do not trigger it.</span>
      </label>
      {state.updatedAt && <p className="text-xs text-muted">Last changed: {new Date(state.updatedAt).toLocaleString()}</p>}
    </>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <button type="button" onClick={() => void load()} disabled={busy} className="min-h-10 text-sm underline">Refresh status</button>
  </section>;
}
