/**
 * AUDIT LOG — every admin action, newest first: who did what, to what, why, and whether it worked
 * (admin panel audit, PR 3, 2026-10-05).
 *
 * Admin actions have carried the admin's name and reason since PR 1, but they sat in the general server
 * log among every other event, readable only as the Monitor's last 40 lines. This screen reads the admin
 * audit log (`GET /api/admin/audit-log`, adminAuditLog.ts), which holds admin actions only and pages
 * exactly. A log the server could not read says so — it is never shown as an empty log.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, ScrollText } from 'lucide-react';
import { adminEventLabel, type AdminAuditRow } from '../../lib/adminAuditEvents';

interface Page { rows: AdminAuditRow[]; nextBefore: number | null; available: boolean }

/** Read a server body as a page, or null when it is not that shape. */
export function readAuditPage(body: unknown): Page | null {
  const b = body as Partial<Page> | null;
  if (!b || typeof b !== 'object' || !Array.isArray(b.rows) || typeof b.available !== 'boolean') return null;
  const rows = b.rows.filter((r): r is AdminAuditRow => !!r && typeof r === 'object' && typeof (r as AdminAuditRow).event === 'string');
  return { rows, nextBefore: typeof b.nextBefore === 'number' ? b.nextBefore : null, available: b.available };
}

/** Does a row match what the admin typed? Event, actor, target and reason, case-insensitively. */
export function auditRowMatches(row: AdminAuditRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.event, adminEventLabel(row.event), row.actor, row.target, row.reason, row.result]
    .some((f) => typeof f === 'string' && f.toLowerCase().includes(q));
}

const RESULT_TONE = (result: string): string =>
  /^(ok|done|saved)$/i.test(result) ? 'text-success' : result ? 'text-warn' : 'text-faint';

export function AdminAuditLogPanel({ adminToken }: { adminToken: string }): React.ReactElement {
  const [rows, setRows] = useState<AdminAuditRow[] | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async (before: number | null) => {
    setLoading(true);
    setError('');
    try {
      const qs = before !== null ? `?before=${before}` : '';
      const r = await fetch(`/api/admin/audit-log${qs}`, { headers: { 'x-admin-token': adminToken } });
      const body = await r.json().catch(() => null);
      const page = r.ok ? readAuditPage(body) : null;
      if (!page) {
        setError(r.ok ? 'The server answered in a shape this screen does not know.' : `Could not read the audit log (HTTP ${r.status}).`);
        if (before === null) setRows(null);
        return;
      }
      setAvailable(page.available);
      setRows((prev) => (before === null ? page.rows : [...(prev ?? []), ...page.rows]));
      setNextBefore(page.nextBefore);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the server.');
      if (before === null) setRows(null);
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  useEffect(() => { void load(null); }, [load]);

  const shown = useMemo(() => (rows ?? []).filter((r) => auditRowMatches(r, query)), [rows, query]);

  return (
    <div className="rounded-2xl border border-line bg-card p-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-tight text-ink">
            <ScrollText size={14} /> Audit log
          </h3>
          <p className="mt-1 text-[10px] font-semibold text-muted">
            Every admin action — bans, restores, token changes, messages, reviews, sign-ins — newest first, with who, why and the result. Kept 180 days.
          </p>
        </div>
        <button
          onClick={() => void load(null)}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg bg-raised px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-muted hover:text-ink disabled:opacity-40"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter the loaded rows by action, admin, app or user id, reason…"
        aria-label="Filter the audit log"
        className="w-full bg-well border border-line rounded-lg px-3 py-2 text-[12px] text-ink placeholder:text-faint focus:outline-none"
      />

      {error && <p role="alert" className="text-[11px] text-danger">{error}</p>}
      {!available && <p className="text-[11px] text-warn">The database is not reachable from this server, so the audit log cannot be read here.</p>}

      {rows === null && !error && <p className="text-[11px] text-muted">Loading…</p>}
      {rows !== null && available && rows.length === 0 && (
        <p className="text-[11px] text-muted">No admin action has been recorded yet. Actions are recorded from the moment this screen was added.</p>
      )}

      {shown.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 pr-2 font-black">When</th>
                <th className="py-1 pr-2 font-black">Action</th>
                <th className="py-1 pr-2 font-black">By</th>
                <th className="py-1 pr-2 font-black">On</th>
                <th className="py-1 pr-2 font-black">Reason</th>
                <th className="py-1 font-black">Result</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={`${r.ts}-${r.event}-${i}`} className="border-t border-line align-top">
                  <td className="py-1.5 pr-2 whitespace-nowrap text-muted tabular-nums">
                    {r.ts ? new Date(r.ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                  </td>
                  <td className="py-1.5 pr-2 font-bold text-body" title={r.event}>{adminEventLabel(r.event)}</td>
                  <td className="py-1.5 pr-2 text-body">{r.actor || <span className="text-faint">not recorded</span>}</td>
                  <td className="py-1.5 pr-2 font-mono text-[10px] text-muted break-all">{r.target || '—'}</td>
                  <td className="py-1.5 pr-2 text-muted break-words">{r.reason || <span className="text-faint">—</span>}</td>
                  <td className={`py-1.5 font-bold ${RESULT_TONE(r.result)}`}>{r.result || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows !== null && rows.length > 0 && shown.length === 0 && (
        <p className="text-[11px] text-muted">No loaded row matches "{query}".{nextBefore !== null ? ' Load older rows to search further back.' : ''}</p>
      )}

      {nextBefore !== null && (
        <button
          onClick={() => void load(nextBefore)}
          disabled={loading}
          className="w-full rounded-lg bg-raised px-3 py-2 text-[10px] font-black uppercase tracking-widest text-muted hover:text-ink disabled:opacity-40"
        >
          {loading ? 'Loading…' : 'Load 50 older'}
        </button>
      )}
    </div>
  );
}
