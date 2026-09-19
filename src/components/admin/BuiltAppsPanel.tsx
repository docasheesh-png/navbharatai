import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Globe, Search, ExternalLink, Eye, X, Ban as BanIcon } from 'lucide-react';
import {
  canBan, canUnpublish, matchesBuiltApp, previewPlan, publishStateView, replaceRow, type BuiltAppRow,
} from '../../lib/adminAppModeration';

/**
 * BUILT APPS — every user's built app, twelve at a time, each with a preview (admin 2026-09-18).
 *
 *   1. "sabhi users ki build app dikhni chahiye"       → rows come from the durable FILE store, so an app
 *                                                          that was built and never published is here too.
 *   2. "ek dam se sara data load na ho, 12-12 ke set me" → one page per request, an opaque cursor, a
 *                                                          "Load 12 more" button; never the whole registry.
 *   3. "sabhi ka preview chalna chahiye, live ya offline" → PREVIEW on every row, from the saved copy of the
 *                                                          last green build or an in-browser render of the
 *                                                          saved files — never by waking the owner's machine.
 *
 * The moderation actions (Unpublish / Ban) keep living in AdminDashboard — the confirmation dialog and
 * its copy are the safeguard against a permanent mistake and were not moved. This panel asks the
 * dashboard to open that dialog (`onModerate`) and is told when an action landed (`moderated`) so it
 * can refresh THAT row in place, keeping the page and the scroll position.
 */

const PAGE_SIZE = 12;
const PREVIEW_IFRAME_ALLOW = 'clipboard-write; fullscreen';
const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups';

type Mode = 'all' | 'exact' | 'owner' | 'url' | 'status' | 'text';

interface ListResponse {
  ok?: boolean;
  error?: string;
  mode?: Mode;
  order?: 'newest' | 'id';
  rows?: BuiltAppRow[];
  orphaned?: BuiltAppRow[];
  nextCursor?: string | null;
}

export interface BuiltAppsPanelProps {
  headers: Record<string, string>;
  openAccount: (uid: string) => void;
  toast: (msg: string) => void;
  onModerate: (workspaceId: string, action: 'unpublish' | 'ban') => void;
  /** Set by the dashboard after an Unpublish / Ban landed, so the affected row is re-read in place. */
  moderated: { workspaceId: string; tick: number } | null;
}

function fmtDate(ms: number): string {
  return ms > 0 ? new Date(ms).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '';
}

export const BuiltAppsPanel: React.FC<BuiltAppsPanelProps> = ({ headers, openAccount, toast, onModerate, moderated }) => {
  const [rows, setRows] = useState<BuiltAppRow[] | null>(null);
  const [orphaned, setOrphaned] = useState<BuiltAppRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('all');
  const [order, setOrder] = useState<'newest' | 'id'>('newest');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [queryInput, setQueryInput] = useState('');
  /** The query the last request was made with — the input can differ while the admin is still typing. */
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [preview, setPreview] = useState<{ row: BuiltAppRow; html: string | null; loading: boolean; error: string; kind: string } | null>(null);

  const load = useCallback(async (opts: { cursor?: string | null; q: string; status: string; append: boolean }) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      if (opts.cursor) params.set('cursor', opts.cursor);
      if (opts.q) params.set('q', opts.q);
      if (opts.status) params.set('status', opts.status);
      const r = await fetch(`/api/admin/apps?${params.toString()}`, { headers });
      const d = (await r.json()) as ListResponse;
      if (!r.ok || d?.ok === false || !Array.isArray(d?.rows)) {
        // An unreadable list is NOT an empty one — "no built apps" over a failed read would tell the
        // admin the opposite of the truth on the screen they moderate from.
        if (!opts.append) setRows(null);
        setError(d?.error || 'Could not read the built-app list.');
        return;
      }
      setError('');
      setMode(d.mode ?? 'all');
      setOrder(d.order ?? 'newest');
      setNextCursor(typeof d.nextCursor === 'string' && d.nextCursor ? d.nextCursor : null);
      if (opts.append) {
        setRows((prev) => {
          const seen = new Set((prev || []).map((x) => x.workspaceId));
          return [...(prev || []), ...d.rows!.filter((x) => !seen.has(x.workspaceId))];
        });
      } else {
        setRows(d.rows);
        setOrphaned(Array.isArray(d.orphaned) ? d.orphaned : []);
      }
    } catch (e) {
      console.error(e);
      if (!opts.append) setRows(null);
      setError('Could not read the built-app list.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers['x-admin-token']]);

  // First page on mount, and a fresh first page whenever the state filter changes.
  useEffect(() => { void load({ q: query, status: statusFilter, append: false }); }, [load, statusFilter, query]);

  // A moderation landed: re-read that one row and put it back in place. The page is kept — the admin
  // is looking at the row they just acted on, and a reload to page one would scroll it away.
  useEffect(() => {
    if (!moderated) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/admin/apps?q=${encodeURIComponent(moderated.workspaceId)}&limit=1`, { headers });
        const d = (await r.json()) as ListResponse;
        const fresh = Array.isArray(d?.rows) && d.rows.length > 0 ? d.rows[0] : null;
        if (!cancelled) {
          setRows((prev) => (prev ? replaceRow(prev, fresh, moderated.workspaceId) : prev));
          setOrphaned((prev) => replaceRow(prev, fresh, moderated.workspaceId));
        }
      } catch { /* the row keeps its last-known state; the next Refresh reads the truth */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moderated?.tick]);

  const submitSearch = useCallback(() => { setQuery(queryInput.trim()); }, [queryInput]);

  /** Text mode: the server answered no rows on purpose, so the rows in hand are filtered here. */
  const visible = useMemo(() => {
    if (!rows) return [];
    return mode === 'text' ? rows.filter((r) => matchesBuiltApp(r, query)) : rows;
  }, [rows, mode, query]);

  const openPreview = useCallback(async (row: BuiltAppRow) => {
    const plan = previewPlan(row);
    if (plan.source === 'none') { setPreview({ row, html: null, loading: false, error: plan.label, kind: '' }); return; }
    if (plan.source === 'copy') { setPreview({ row, html: null, loading: false, error: '', kind: 'copy' }); return; }
    setPreview({ row, html: null, loading: true, error: '', kind: '' });
    try {
      const r = await fetch(`/api/admin/apps/${encodeURIComponent(row.workspaceId)}/preview`, {
        method: 'POST', headers, body: JSON.stringify({ origin: window.location.origin }),
      });
      const d = await r.json();
      if (!r.ok || d?.error) { setPreview({ row, html: null, loading: false, error: d?.error || 'Could not render this app.', kind: '' }); return; }
      if (d?.empty || !d?.html) { setPreview({ row, html: null, loading: false, error: d?.note || 'No saved files for this app.', kind: '' }); return; }
      setPreview({ row, html: String(d.html), loading: false, error: '', kind: String(d.kind || '') });
    } catch (e) {
      console.error(e);
      setPreview({ row, html: null, loading: false, error: 'Could not render this app.', kind: '' });
    }
  }, [headers]);

  const renderRow = (d: BuiltAppRow, opts: { orphan?: boolean } = {}) => {
    const view = publishStateView(d.publish);
    const plan = previewPlan(d);
    const owner = d.userId || d.ownerUid;
    return (
      <div key={d.workspaceId} className="rounded-xl bg-well border border-line px-3 py-2.5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${
                view.tone === 'live' ? 'bg-emerald-500/10 border-emerald-500/30 text-success'
                : view.tone === 'banned' ? 'bg-red-500/10 border-red-500/30 text-danger'
                : view.tone === 'warn' ? 'bg-amber-500/10 border-amber-500/30 text-warn'
                : 'bg-raised border-line text-muted'}`}>
                {view.label}
              </span>
              <span className="text-[11px] font-mono text-body truncate">{d.workspaceId}</span>
            </div>
            <p className="text-[10px] text-muted mt-1 leading-relaxed">
              {opts.orphan ? 'Still live, but the owner deleted the workspace — its files are gone; only the site remains.' : view.meaning}
            </p>
            <div className="flex items-center gap-2.5 mt-1 flex-wrap">
              {d.fileCount > 0 && <span className="text-[10px] text-faint">{d.fileCount} files</span>}
              {d.savedAt > 0 && <span className="text-[10px] text-faint">built {fmtDate(d.savedAt)}</span>}
              {d.publishedAt > 0 && d.publish !== 'never' && <span className="text-[10px] text-faint">published {fmtDate(d.publishedAt)}</span>}
              {d.url && d.publish === 'live' && (
                <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] text-info hover:underline">
                  <ExternalLink size={10} /> Open the live app
                </a>
              )}
              {owner && (
                <button onClick={() => openAccount(owner)} className="text-[10px] text-muted hover:text-ink underline">Owner</button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => void openPreview(d)}
              disabled={plan.source === 'none'}
              title={plan.label}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-raised border border-line text-[10px] font-black uppercase tracking-wider text-ink hover:border-sky-500/40 disabled:opacity-40"
            >
              <Eye size={11} /> Preview
            </button>
            {d.status !== null && canUnpublish(d.status) && d.publish === 'live' && (
              <button
                onClick={() => onModerate(d.workspaceId, 'unpublish')}
                className="px-2.5 py-1.5 rounded-lg bg-raised border border-line text-[10px] font-black uppercase tracking-wider text-body hover:text-ink"
              >
                Unpublish
              </button>
            )}
            {/* Ban acts on the PUBLISH registry (the deploy gate re-checks it), so it is offered only where a
                registry record exists to hold it. An app never published has nothing for a ban to attach to;
                offering one would "succeed" and change nothing. */}
            {d.status !== null && canBan(d.status) && (
              <button
                onClick={() => onModerate(d.workspaceId, 'ban')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-600/10 hover:bg-red-600/20 border border-red-500/30 text-[10px] font-black uppercase tracking-wider text-danger"
              >
                <BanIcon size={11} /> Ban
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const liveLoaded = (rows || []).filter((r) => r.publish === 'live').length;

  return (
    <div className="bg-card border border-line rounded-[1.5rem] p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="flex items-center gap-2 text-sm font-black text-ink uppercase tracking-tight">
          <Globe size={15} className="text-info" /> Built apps
          {Array.isArray(rows) && (
            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border border-line text-muted">
              {rows.length} loaded · {liveLoaded} live
            </span>
          )}
        </h3>
        <button
          onClick={() => void load({ q: query, status: statusFilter, append: false })}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-raised border border-line text-[10px] font-black uppercase tracking-wider text-ink hover:border-sky-500/40 transition-all disabled:opacity-40"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      <p className="text-[11px] text-muted leading-relaxed">
        Every app any user has built — published or not — newest first, {PAGE_SIZE} at a time.{' '}
        <span className="text-body">Preview</span> shows the app without waking its owner&apos;s machine.{' '}
        <span className="text-body">Unpublish</span> takes a live site off the internet and the owner can publish
        it again themselves. <span className="text-danger">Ban</span> removes it and stops that workspace publishing
        ever again — permanent, and nothing here can undo it.
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitSearch(); }}
            placeholder="App id, owner uid or link — press Enter"
            className="w-full bg-well border border-line rounded-lg pl-8 pr-3 py-1.5 text-[11px] text-ink placeholder:text-faint focus:outline-none focus:border-sky-500/40"
          />
        </div>
        <button onClick={submitSearch} className="px-3 py-1.5 rounded-lg bg-raised border border-line text-[10px] font-black uppercase tracking-wider text-ink hover:border-sky-500/40">
          Search
        </button>
        {query && (
          <button onClick={() => { setQueryInput(''); setQuery(''); }} className="px-3 py-1.5 rounded-lg bg-raised border border-line text-[10px] font-black uppercase tracking-wider text-muted hover:text-ink">
            Clear
          </button>
        )}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-well border border-line rounded-lg px-2.5 py-1.5 text-[11px] text-ink focus:outline-none focus:border-sky-500/40"
        >
          <option value="">All built apps</option>
          <option value="active">Live only</option>
          <option value="unpublished">Offline</option>
          <option value="taken_down">Banned</option>
          <option value="held">Held</option>
          <option value="plan_paused">Paused</option>
        </select>
      </div>

      {mode === 'text' && rows !== null && !error && (
        <p className="text-[10px] text-faint">
          Showing matches among the {rows.length} app{rows.length === 1 ? '' : 's'} loaded so far — a full id, an owner uid or a
          link is looked up directly; a fragment is filtered here. Clear the search and load more to search further.
        </p>
      )}
      {mode === 'status' && order === 'id' && !error && (
        <p className="text-[10px] text-faint">Filtered by state from the publish registry, ordered by app id.</p>
      )}

      {error && (
        <p className="text-[11px] text-warn">
          {error}{' '}
          <button onClick={() => void load({ q: query, status: statusFilter, append: false })} className="underline">Retry</button>
        </p>
      )}

      {!error && orphaned.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-black uppercase tracking-widest text-warn">Live, owner deleted the workspace</p>
          {orphaned.map((d) => renderRow(d, { orphan: true }))}
        </div>
      )}

      {!error && rows !== null && visible.length === 0 && (
        <p className="text-[11px] text-muted">
          {rows.length === 0 ? (query || statusFilter ? 'Nothing matches.' : 'No built apps yet.') : 'Nothing matches that search among the loaded apps.'}
        </p>
      )}

      {!error && visible.length > 0 && (
        <div className="space-y-1.5">
          {visible.map((d) => renderRow(d))}
        </div>
      )}

      {!error && rows !== null && (
        <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
          <span className="text-[10px] text-faint">
            {nextCursor ? `${rows.length} loaded — more available` : `${rows.length} loaded — that is all of them`}
          </span>
          {nextCursor && (
            <button
              onClick={() => void load({ cursor: nextCursor, q: query, status: statusFilter, append: true })}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg bg-raised border border-line text-[10px] font-black uppercase tracking-wider text-ink hover:border-sky-500/40 disabled:opacity-40"
            >
              {loading ? 'Loading…' : `Load ${PAGE_SIZE} more`}
            </button>
          )}
        </div>
      )}

      {preview && (() => {
        const plan = previewPlan(preview.row);
        return (
          <div className="fixed inset-0 z-[9998] flex items-center justify-center p-3 sm:p-6 bg-scrim backdrop-blur-sm" role="presentation">
            <div role="dialog" aria-modal="true" aria-label={`Preview of ${preview.row.workspaceId}`}
                 className="w-full max-w-[1100px] h-[88vh] rounded-2xl bg-card border border-line shadow-2xl flex flex-col overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-line">
                <div className="min-w-0">
                  <p className="text-[11px] font-mono text-body truncate">{preview.row.workspaceId}</p>
                  <p className="text-[10px] text-muted truncate">{preview.error || plan.label}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {plan.source === 'copy' && (
                    <a href={plan.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] text-info hover:underline">
                      <ExternalLink size={10} /> Open in a tab
                    </a>
                  )}
                  <button onClick={() => setPreview(null)} aria-label="Close preview"
                          className="w-8 h-8 rounded-lg bg-raised border border-line text-ink flex items-center justify-center hover:border-sky-500/40">
                    <X size={14} />
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0">
                {plan.source === 'copy' && (
                  <iframe title={`Saved copy of ${preview.row.workspaceId}`} src={plan.url} className="w-full h-full border-0" allow={PREVIEW_IFRAME_ALLOW} sandbox={IFRAME_SANDBOX} />
                )}
                {plan.source === 'render' && preview.html && (
                  <iframe title={`In-browser render of ${preview.row.workspaceId}`} srcDoc={preview.html} className="w-full h-full border-0" allow={PREVIEW_IFRAME_ALLOW} sandbox={IFRAME_SANDBOX} />
                )}
                {plan.source === 'render' && preview.loading && (
                  <p className="p-6 text-[12px] text-muted">Rendering from the saved files…</p>
                )}
                {(plan.source === 'none' || (!preview.loading && !preview.html && plan.source === 'render')) && (
                  <p className="p-6 text-[12px] text-warn">{preview.error || plan.label}</p>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
