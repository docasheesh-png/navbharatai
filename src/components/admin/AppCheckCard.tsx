/**
 * APP CHECK — would enforcing lock anybody out? (admin panel audit, PR 3, 2026-10-05)
 *
 * The counters behind `GET /api/admin/app-check` existed with no screen, while the rule recorded with
 * them says to read them before setting APP_CHECK_MODE=enforce. This card is that reading: per website
 * and per phone app, how many guarded requests carried a valid token, and the one-sentence verdict
 * (`enforceVerdict`). The counts are per server instance since it started — the card says so, because a
 * fresh instance showing zero is not the same fact as a platform with zero traffic.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { readAppCheckStats, clientReadiness, enforceVerdict, type AppCheckStats, type Counts } from '../../lib/appCheckReadiness';

const TONE: Record<string, string> = { ok: 'text-success', warn: 'text-warn', danger: 'text-danger', unknown: 'text-muted' };

function Row({ label, counts }: { label: string; counts: Counts }): React.ReactElement {
  const r = clientReadiness(counts);
  return (
    <tr className="border-t border-line">
      <td className="py-1.5 pr-2 font-bold text-body">{label}</td>
      <td className="py-1.5 pr-2 tabular-nums text-muted">{r.seen}</td>
      <td className="py-1.5 pr-2 tabular-nums text-success">{counts.valid}</td>
      <td className={`py-1.5 pr-2 tabular-nums ${r.wouldRefuse > 0 ? 'text-danger font-bold' : 'text-muted'}`}>{r.wouldRefuse}</td>
      <td className="py-1.5 pr-2 tabular-nums text-muted">{counts.unverifiable}</td>
      <td className="py-1.5 tabular-nums text-muted">{r.validPct === null ? '—' : `${r.validPct}%`}</td>
    </tr>
  );
}

export function AppCheckCard({ adminToken }: { adminToken: string }): React.ReactElement {
  const [stats, setStats] = useState<AppCheckStats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/admin/app-check', { headers: { 'x-admin-token': adminToken } });
      const body = await r.json().catch(() => null);
      const read = r.ok ? readAppCheckStats(body) : null;
      if (!read) {
        setStats(null);
        setError(r.ok ? 'The server answered in a shape this screen does not know.' : `Could not read App Check (HTTP ${r.status}).`);
      } else {
        setStats(read);
      }
    } catch (e) {
      setStats(null);
      setError(e instanceof Error ? e.message : 'Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  useEffect(() => { void load(); }, [load]);

  const verdict = stats ? enforceVerdict(stats) : null;

  return (
    <div className="rounded-2xl border border-line bg-card p-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-tight text-ink">
            <ShieldCheck size={14} /> App Check
          </h3>
          <p className="mt-1 text-[10px] font-semibold text-muted">
            How many guarded requests (money and sign-in actions) carry a valid App Check token — read this before switching to enforce.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg bg-raised px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-muted hover:text-ink disabled:opacity-40"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && <p role="alert" className="text-[11px] text-danger">{error}</p>}

      {stats && verdict && (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            <span className="text-muted">Mode: <b className="text-ink">{stats.mode}</b></span>
            <span className="text-muted">Website site key: <b className={stats.siteKeyConfigured ? 'text-success' : 'text-warn'}>{stats.siteKeyConfigured ? 'set' : 'not set'}</b></span>
            {stats.mode === 'enforce' && <span className="text-muted">Refused: <b className={stats.refused > 0 ? 'text-danger' : 'text-ink'}>{stats.refused}</b></span>}
          </div>
          <p className={`text-[12px] font-bold ${TONE[verdict.tone]}`}>{verdict.sentence}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-1 pr-2 font-black">Client</th>
                  <th className="py-1 pr-2 font-black">Seen</th>
                  <th className="py-1 pr-2 font-black">Valid token</th>
                  <th className="py-1 pr-2 font-black">Enforce would refuse</th>
                  <th className="py-1 pr-2 font-black">Not checkable</th>
                  <th className="py-1 font-black">Valid %</th>
                </tr>
              </thead>
              <tbody>
                <Row label="Website" counts={stats.web} />
                <Row label="Phone apps" counts={stats.native} />
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-faint">
            Counted on {stats.scope || 'this server instance'}{stats.since ? `, since ${new Date(stats.since).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}. Another instance keeps its own count, and a restart starts from zero. "Not checkable" means our own verifier could not answer — those are never refused.
          </p>
        </>
      )}
    </div>
  );
}
