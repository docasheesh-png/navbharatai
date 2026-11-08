import { useCallback, useEffect, useState } from 'react';
import { adminFailed, adminGet, adminHeaders } from '../../lib/adminFetch';

/**
 * Admin → AI Engines → Game asset download check (L3 step 1, admin 2026-11-04). One button runs the game asset
 * engine's real download path from THIS server — Poly Haven search, a reviewed model download, its hash and its
 * validation — and shows each stage. It writes nothing and does not turn external game assets on.
 */
interface Step { name: string; ok: boolean; ms: number; detail: string }
interface Result { ok: boolean; at: number; steps: Step[] }
const isResult = (v: unknown): v is Result => {
  const r = v as Result | null;
  return !!r && typeof r.ok === 'boolean' && typeof r.at === 'number' && Array.isArray(r.steps)
    && r.steps.every((s) => s && typeof s.name === 'string' && typeof s.ok === 'boolean' && typeof s.ms === 'number' && typeof s.detail === 'string');
};

export function GameAssetLiveCheckPanel({ adminToken }: { adminToken: string }) {
  const [last, setLast] = useState<Result | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const read = useCallback(async () => {
    const r = await adminGet<{ last: unknown }>('/api/admin/game-assets/live-check', { token: adminToken });
    if (!adminFailed(r) && isResult(r.data?.last)) setLast(r.data.last);
  }, [adminToken]);
  useEffect(() => { void read(); }, [read]);
  const run = async () => {
    setRunning(true); setError(null);
    try {
      const res = await fetch('/api/admin/game-assets/live-check', { method: 'POST', headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' }, body: '{}' });
      const b = await res.json().catch(() => null) as { last?: unknown; error?: unknown } | null;
      if (!res.ok) { setError(typeof b?.error === 'string' ? b.error : `Could not run (HTTP ${res.status}).`); return; }
      if (!isResult(b?.last)) { setError('The server answered in a shape this screen does not know.'); return; }
      setLast(b!.last as Result);
    } catch { setError('Could not reach the server.'); } finally { setRunning(false); }
  };
  return (
    <section className="space-y-2 rounded-md border border-line bg-surface p-4" aria-labelledby="game-asset-check-title">
      <h3 id="game-asset-check-title" className="text-base font-semibold text-ink">Game asset download check</h3>
      <p className="text-sm text-muted">
        Tests, from this server, whether the game engine can really download free 3D models (search, download, hash, validation).
        It saves nothing and does not turn external game assets on for users.
      </p>
      <button type="button" onClick={() => void run()} disabled={running} data-testid="game-asset-check-run"
        className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-on-accent disabled:opacity-50">
        {running ? 'Checking… (up to 40 seconds)' : 'Run the check'}
      </button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {last && (
        <div data-testid="game-asset-check-result">
          <p className={`text-sm font-semibold ${last.ok ? 'text-success' : 'text-danger'}`}>
            {last.ok ? 'PASSED — downloads work from this server' : 'FAILED — see the stage below'} · {new Date(last.at).toLocaleString()}
          </p>
          <ul className="mt-1 space-y-1">
            {last.steps.map((s) => (
              <li key={s.name} className="text-xs text-ink">
                <span className={s.ok ? 'text-success' : 'text-danger'}>{s.ok ? '✓' : '✗'}</span> {s.name} — {s.detail} <span className="text-muted">({s.ms} ms)</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
