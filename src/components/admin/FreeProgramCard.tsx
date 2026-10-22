import React, { useCallback, useEffect, useRef, useState } from 'react';
import { adminGet, adminFailed, adminHeaders } from '../../lib/adminFetch';

interface Setting { paused: boolean; updatedAt: number | null }

/**
 * THE FREE PROGRAM SWITCH (admin 2026-10-22: "free token system pause kar do — paise nahi hai"). One button pauses
 * everything NavBharatAI gives away; Free Chat is not part of it. What the pause covers is written out in
 * src/server/lib/freeProgram.ts, and the card says it in plain words so the admin knows before pressing Resume.
 */
export function FreeProgramCard({ adminToken }: { adminToken: string }): React.ReactElement {
  const revision = useRef(0);
  const [state, setState] = useState<Setting | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const started = revision.current;
    const r = await adminGet<Setting>('/api/admin/free-program', { token: adminToken });
    if (started !== revision.current) return;
    if (adminFailed(r)) setError(r.message);
    else { setState(r.data); setError(''); }
  }, [adminToken]);
  useEffect(() => { void load(); }, [load]);
  const save = async (paused: boolean) => {
    if (!paused && !window.confirm('Resume the free program? New users will again earn rewards, never-paid users can build and use the free daily limits, and gifted tokens become visible again. This costs money.')) return;
    revision.current++;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/admin/free-program', {
        method: 'POST', headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' }, body: JSON.stringify({ paused }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Could not save the free program setting.');
      setState(json);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the free program setting.'); }
    finally { setBusy(false); }
  };
  return <section aria-label="Free program" className="rounded-xl border border-line bg-card p-4 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-base font-bold text-ink">Free program</h3>
        <p className="text-sm text-muted" role="status">{!state ? 'Checking status…' : state.paused ? 'PAUSED — nothing free is given away' : 'LIVE — free rewards and allowances are running'}</p></div>
      <button type="button" disabled={!state || busy || !!error} onClick={() => state && void save(!state.paused)}
        className={`min-h-11 rounded-lg px-4 py-2 font-bold disabled:opacity-50 ${state?.paused ? 'bg-accent text-on-accent' : 'bg-raised border border-line text-danger'}`}>
        {busy ? 'Saving…' : state?.paused ? 'Resume free program' : 'Pause free program'}
      </button>
    </div>
    <p className="text-sm text-muted">While paused: no new rewards or promo codes; an account that has never paid cannot build with Pro, make pictures, or use the free tools and professionals; and its old gifted tokens show as 0 with “Free trial ended” (kept safely, not deleted). Free Chat keeps working. Paying accounts are not affected.</p>
    {state?.updatedAt && <p className="text-xs text-muted">Last changed: {new Date(state.updatedAt).toLocaleString()}</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <button type="button" onClick={() => void load()} disabled={busy} className="min-h-10 text-sm underline">Refresh status</button>
  </section>;
}
