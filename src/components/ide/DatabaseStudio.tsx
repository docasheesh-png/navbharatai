// Database Studio — the user's OWN data (ROADMAP #1 Phase 2.1).
//
// WHAT CHANGED AND WHY. This screen used to show one of two things, and neither was the user's data:
// hard-coded demo rows ("Arjun Sharma"), or — if you typed a collection name — NavBharatAI's OWN
// Firestore, read straight from the browser with the platform's client SDK. The second is the serious
// one: it browsed the platform's store, which by standing constraint must never back a user's app, and
// it let a signed-in user page through platform collections that Firestore rules leave readable
// (`users`, `posts`). Both paths are gone. The studio now reads the Supabase project that Phase 1
// provisions inside the user's own account, through the server, which holds the token.
//
// Read-only, deliberately: writes are Phase 2.2 with their own confirmation path. Every mutating
// control is absent rather than present-but-broken — a Delete button that does nothing is exactly the
// half-built feature the constitution forbids.
//
// Sample data survives for one case only: nobody has connected a database yet. It is labelled sample,
// and it is never writable, because rows that look live but go nowhere are a lie about where the
// user's data is.

import React, { useState, useEffect, useCallback } from 'react';
import { Database, RefreshCw, Download, Search, AlertCircle, Table, ArrowUpDown, Copy, Check, ChevronLeft, ChevronRight, Columns } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { Breadcrumb } from '../ui/Breadcrumb';
import { authedFetch } from '../../lib/authedFetch';
import { studioState, renderCell, filterRows, pageSummary } from '../../lib/dataStudioSource';

interface DBRow { [key: string]: unknown; }

/** Shown only when no database is connected — and always labelled as a sample. */
const SAMPLE_TABLES: Record<string, DBRow[]> = {
  users: [
    { id: 1, name: 'Arjun Sharma', email: 'arjun@example.com', role: 'admin', created_at: '2024-01-15' },
    { id: 2, name: 'Priya Singh', email: 'priya@example.com', role: 'user', created_at: '2024-02-20' },
  ],
  products: [
    { id: 1, name: 'NavBharat Pro', price: 999, category: 'Software', stock: 999 },
    { id: 2, name: 'AI Credits Pack', price: 299, category: 'Credits', stock: 500 },
  ],
};

const PAGE_SIZE = 50;

interface TableInfo { name: string; rowEstimate: number }
interface ColumnInfo { name: string; type: string; nullable: boolean; default: string | null }

export function DatabaseStudio() {
  const [connected, setConnected] = useState(false);
  const [hasDatabase, setHasDatabase] = useState(false);
  const [booting, setBooting] = useState(true);

  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [rows, setRows] = useState<DBRow[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [schema, setSchema] = useState<ColumnInfo[] | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('');
  const [sortDesc, setSortDesc] = useState(false);
  const [copied, setCopied] = useState('');
  const [view, setView] = useState<'table' | 'json' | 'schema'>('table');

  const state = studioState({ connected, hasDatabase });
  const live = state.isRealData;

  // Is there a database to read? Both facts come from the server: whether the account is connected,
  // and whether a table listing actually succeeds. "Connected" alone is not enough — a user can link
  // Supabase and never create a project, and claiming a database exists then would be the same
  // nearly-true claim this phase exists to remove.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch('/api/integrations/supabase/status');
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const isConnected = !!data?.connected;
        setConnected(isConnected);
        if (!isConnected) { setBooting(false); return; }
        const t = await authedFetch('/api/integrations/supabase/tables');
        const tj = await t.json().catch(() => ({}));
        if (cancelled) return;
        if (t.ok && Array.isArray(tj?.tables)) {
          setHasDatabase(true);
          setTables(tj.tables);
          if (tj.tables.length > 0) setSelected(tj.tables[0].name);
        } else {
          setHasDatabase(false);
          // A failure here is not necessarily an error the user must act on — most often it just
          // means no project exists yet, which the sample-data hint already explains.
          if (t.status >= 500) setError(tj?.error || 'Could not read your database just now.');
        }
      } catch {
        if (!cancelled) setConnected(false);
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadRows = useCallback(async (table: string, from: number) => {
    if (!table) return;
    setLoading(true);
    setError('');
    try {
      if (!live) {
        const sample = SAMPLE_TABLES[table] || [];
        setRows(sample);
        setColumns(sample.length ? Object.keys(sample[0]) : []);
        setHasMore(false);
        return;
      }
      const params = new URLSearchParams({ table, limit: String(PAGE_SIZE), offset: String(from) });
      if (sortField) { params.set('orderBy', sortField); if (sortDesc) params.set('desc', '1'); }
      const res = await authedFetch(`/api/integrations/supabase/rows?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || 'Could not read that table.'); setRows([]); setColumns([]); return; }
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setColumns(Array.isArray(data.columns) ? data.columns : []);
      setHasMore(!!data.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that table.');
    } finally {
      setLoading(false);
    }
  }, [live, sortField, sortDesc]);

  // Sample mode has no tables from the server, so seed the sidebar from the samples themselves.
  useEffect(() => {
    if (booting || live) return;
    setTables(Object.keys(SAMPLE_TABLES).map((name) => ({ name, rowEstimate: SAMPLE_TABLES[name].length })));
    setSelected((s) => s || 'users');
  }, [booting, live]);

  useEffect(() => { setOffset(0); }, [selected]);
  useEffect(() => { if (selected) void loadRows(selected, offset); }, [selected, offset, loadRows]);

  // The Schema view fetches only when opened — most visits never need it, and a column read per table
  // switch would double the queries against someone else's database for a panel nobody looked at.
  useEffect(() => {
    if (view !== 'schema' || !live || !selected) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch(`/api/integrations/supabase/columns?table=${encodeURIComponent(selected)}`);
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && Array.isArray(data.columns)) setSchema(data.columns);
      } catch { /* the schema panel is additive — a failure leaves the rows untouched */ }
    })();
    return () => { cancelled = true; };
  }, [view, live, selected]);

  const handleSort = (field: string) => {
    if (sortField === field) setSortDesc((d) => !d);
    else { setSortField(field); setSortDesc(false); }
    setOffset(0);
  };

  // Search filters the CURRENT PAGE, and the label says so — implying it searched the whole table
  // would be the kind of quietly-wrong claim that makes a user trust an empty result.
  const visibleRows = filterRows(rows, searchQuery);
  const headerKeys = columns.length ? columns : Array.from(new Set(rows.flatMap((r) => Object.keys(r || {}))));
  const rowEstimate = tables.find((t) => t.name === selected)?.rowEstimate ?? null;

  const copyCell = (val: string) => {
    navigator.clipboard.writeText(val).then(() => { setCopied(val); setTimeout(() => setCopied(''), 1500); }).catch(() => { /* clipboard blocked — nothing to report */ });
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${selected || 'table'}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 bg-[#161b22]">
        <div className="w-10 h-10 bg-cyan-600/20 rounded-xl flex items-center justify-center">
          <Database className="w-5 h-5 text-cyan-400" />
        </div>
        <div className="min-w-0">
          <h2 className="font-semibold text-white text-base">Database Studio</h2>
          <Breadcrumb
            className="mt-0.5"
            items={[
              { label: state.label },
              ...(selected ? [{ label: selected, title: `Table: ${selected}` }] : []),
            ]}
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className={`flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-lg border ${live ? 'border-cyan-500/40 text-cyan-300 bg-cyan-500/10' : 'border-amber-500/40 text-amber-300 bg-amber-500/10'}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-cyan-400' : 'bg-amber-400'} animate-pulse`} />
            {state.label}
          </div>
          <div className="flex items-center gap-1.5">
            {(['table', 'json', 'schema'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`text-[10px] px-2.5 py-1 rounded-lg border transition-all capitalize ${view === v ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300' : 'border-white/10 bg-white/5 text-white/40'}`}>{v}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: tables */}
        <div className="w-48 flex flex-col border-r border-white/5 bg-[#161b22]">
          <div className="p-3 border-b border-white/5">
            <p className="text-[10px] text-white/30 uppercase tracking-wider">Tables</p>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {booting ? (
              <div className="flex items-center gap-2 px-2 py-3 text-[10px] text-white/30">
                <TirangaLoader className="w-3.5 h-3.5" /> Checking your database…
              </div>
            ) : tables.length === 0 ? (
              <p className="px-2 py-3 text-[10px] text-white/30 leading-relaxed">
                No tables yet. They appear here as soon as your app creates them.
              </p>
            ) : tables.map((t) => (
              <button
                key={t.name}
                onClick={() => setSelected(t.name)}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs text-left transition-all ${selected === t.name ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-300' : 'text-white/50 hover:bg-white/5 border border-transparent'}`}
              >
                <Table className="w-3 h-3 shrink-0" />
                <span className="truncate">{t.name}</span>
                {/* "~" because this is the planner's estimate, not an exact count — see listTablesSql. */}
                <span className="ml-auto text-[9px] text-white/20">{t.rowEstimate > 0 ? `~${t.rowEstimate}` : ''}</span>
              </button>
            ))}
          </div>
          <div className="p-2 border-t border-white/5 space-y-1.5">
            <button onClick={() => void loadRows(selected, offset)} className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] text-white/40 transition-all">
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={exportJson} className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] text-white/40 transition-all">
              <Download className="w-3 h-3" /> Export page
            </button>
          </div>
        </div>

        {/* Main */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-[#161b22]">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30" />
              <input
                className="w-full bg-[#0d1117] border border-white/10 rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50"
                placeholder="Search this page…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <span className="text-xs text-white/30">{pageSummary({ offset, shown: visibleRows.length, rowEstimate })}</span>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                disabled={offset === 0 || loading}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                title="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5 text-white/50" />
              </button>
              <button
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                disabled={!hasMore || loading}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                title="Next page"
              >
                <ChevronRight className="w-3.5 h-3.5 text-white/50" />
              </button>
            </div>
          </div>

          {/* Honest state — sample rows say outright that they are not the user's data. */}
          {state.hint && (
            <div className="mx-3 mt-2 flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200/90 leading-relaxed">{state.hint}</p>
            </div>
          )}

          {error && (
            <div className="mx-3 mt-2 flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          {view === 'table' && (
            <div className="flex-1 overflow-auto">
              {loading ? (
                <div className="flex items-center justify-center h-40 gap-2">
                  <TirangaLoader className="w-5 h-5" />
                  <p className="text-sm text-white/40">Loading…</p>
                </div>
              ) : visibleRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2">
                  <Database className="w-10 h-10 text-white/10" />
                  <p className="text-sm text-white/30">
                    {searchQuery ? 'Nothing on this page matches your search' : 'This table has no rows yet'}
                  </p>
                </div>
              ) : (
                <table className="w-full text-xs border-collapse min-w-max">
                  <thead className="sticky top-0 bg-[#161b22] z-10">
                    <tr className="border-b border-white/5">
                      {headerKeys.map((key) => (
                        <th
                          key={key}
                          className="text-left px-3 py-2.5 font-normal text-white/40 whitespace-nowrap cursor-pointer hover:text-white/70 select-none"
                          onClick={() => live && handleSort(key)}
                        >
                          <div className="flex items-center gap-1">
                            <span>{key}</span>
                            {sortField === key
                              ? <span className="text-cyan-400">{sortDesc ? '↓' : '↑'}</span>
                              : <ArrowUpDown className="w-2.5 h-2.5 text-white/20" />}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, ri) => (
                      <tr key={ri} className="border-b border-white/3 hover:bg-white/2 transition-colors">
                        {headerKeys.map((key) => {
                          const val = renderCell(row[key]);
                          return (
                            <td key={key} className="px-3 py-2 max-w-xs">
                              <div className="flex items-center gap-1 group/cell">
                                <span className={`truncate ${row[key] === null || row[key] === undefined ? 'text-white/15 italic' : 'text-white/60'}`} title={val}>
                                  {val.length > 28 ? `${val.slice(0, 28)}…` : val}
                                </span>
                                <button onClick={() => copyCell(val)} className="opacity-0 group-hover/cell:opacity-100 shrink-0 transition-opacity">
                                  {copied === val ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5 text-white/20 hover:text-white/50" />}
                                </button>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {view === 'json' && (
            <div className="flex-1 overflow-auto p-4">
              <pre className="text-[10px] font-mono text-emerald-300 whitespace-pre-wrap">{JSON.stringify(visibleRows, null, 2)}</pre>
            </div>
          )}

          {view === 'schema' && (
            <div className="flex-1 overflow-auto p-4">
              {!live ? (
                <p className="text-xs text-white/30">Connect a database to see its schema.</p>
              ) : !schema ? (
                <div className="flex items-center gap-2 text-xs text-white/30"><TirangaLoader className="w-4 h-4" /> Reading schema…</div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-white/40 border-b border-white/5">
                      <th className="text-left px-3 py-2 font-normal">Column</th>
                      <th className="text-left px-3 py-2 font-normal">Type</th>
                      <th className="text-left px-3 py-2 font-normal">Nullable</th>
                      <th className="text-left px-3 py-2 font-normal">Default</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schema.map((c) => (
                      <tr key={c.name} className="border-b border-white/3">
                        <td className="px-3 py-2 text-white/70 flex items-center gap-1.5"><Columns className="w-3 h-3 text-white/20" />{c.name}</td>
                        <td className="px-3 py-2 text-cyan-300/70">{c.type}</td>
                        <td className="px-3 py-2 text-white/40">{c.nullable ? 'yes' : 'no'}</td>
                        <td className="px-3 py-2 text-white/30">{c.default ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
