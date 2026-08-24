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
// Editing (Phase 2.2) is real, and it is deliberately NARROW. A row can only be changed when the
// table has a real PRIMARY KEY, read from the database's own catalogue — without one there is no
// expression that provably identifies a single row, so the controls are not shown at all and the
// reason is stated. Deleting asks first, and every write is verified server-side to have touched
// exactly one row before it is reported as saved.
//
// Sample data survives for one case only: nobody has connected a database yet. It is labelled sample,
// and it is never writable, because rows that look live but go nowhere are a lie about where the
// user's data is.

import { useState, useEffect, useCallback } from 'react';
import { Database, RefreshCw, Download, Search, AlertCircle, Table, ArrowUpDown, Copy, Check, ChevronLeft, ChevronRight, Columns, Plus, Edit2, Trash2, X, Lock, Link2, Play, Zap, Upload } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { Breadcrumb } from '../ui/Breadcrumb';
import { authedFetch } from '../../lib/authedFetch';
import { studioState, renderCell, filterRows, pageSummary } from '../../lib/dataStudioSource';
import { parseCsv, rowsToObjects } from '../../lib/csv';

interface DBRow { [key: string]: unknown; }

/** Small local glyph for the import/export notice — avoids widening the icon import for one use. */
const FileSpreadsheetIcon = () => <Table className="w-4 h-4 text-white/30 shrink-0 mt-0.5" />;

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
interface ForeignKey { name: string; column: string; referencesTable: string; referencesColumn: string }
interface IndexInfo { name: string; unique: boolean; primary: boolean; definition: string }

export function DatabaseStudio() {
  const [connected, setConnected] = useState(false);
  const [hasDatabase, setHasDatabase] = useState(false);
  /** The server's own reason it cannot browse this database — shown verbatim instead of a guess. */
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
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
  const [view, setView] = useState<'table' | 'json' | 'schema' | 'sql'>('table');
  const [relations, setRelations] = useState<{ foreignKeys: ForeignKey[]; indexes: IndexInfo[] } | null>(null);

  // SQL runner (2.4). `allowWrite` is off by default and resets after every run, so a write can never
  // be the thing that happens because a toggle was left on from ten minutes ago.
  const [sqlText, setSqlText] = useState('select * from ');
  const [sqlRunning, setSqlRunning] = useState(false);
  const [sqlResult, setSqlResult] = useState<{ rows: DBRow[]; columns: string[]; rowCount: number; capped: boolean; elapsedMs: number; readOnly: boolean } | null>(null);
  const [sqlError, setSqlError] = useState('');

  // CSV import (2.5). The file is parsed IN THE BROWSER first so the user sees what was understood —
  // how many rows, which columns matched — before anything reaches their database.
  const [importPreview, setImportPreview] = useState<{ rows: Record<string, unknown>[]; headers: string[]; adjusted: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState('');

  // Editing (2.2). `primaryKey` is what makes a row addressable; an empty key means this table is
  // read-only and the UI says why rather than offering a Save that cannot work.
  const [primaryKey, setPrimaryKey] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ row: DBRow; json: string } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [writeError, setWriteError] = useState('');
  const [saving, setSaving] = useState(false);

  const state = studioState({ connected, hasDatabase, blockedReason });
  const live = state.isRealData;

  // Is there a database to read? Both facts come from the server: whether the account is connected,
  // and whether a table listing actually succeeds. "Connected" alone is not enough — a user can link
  // Supabase and never create a project, and claiming a database exists then would be the same
  // nearly-true claim this phase exists to remove.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // ASK THE SERVER WHETHER IT CAN READ THE DATABASE, rather than whether ONE provider is linked.
        // This used to gate on the Supabase OAuth status, so a user whose database is a Neon/Render/own
        // Postgres connection string was told "connect a database" while they had connected one — and
        // then shown sample rows. The server now owns that decision (it knows both transports), so the
        // honest probe is simply to try.
        const t = await authedFetch('/api/integrations/supabase/tables');
        const tj = await t.json().catch(() => ({}));
        if (cancelled) return;
        if (t.ok && Array.isArray(tj?.tables)) {
          setConnected(true);
          setHasDatabase(true);
          setTables(tj.tables);
          if (tj.tables.length > 0) setSelected(tj.tables[0].name);
        } else {
          setHasDatabase(false);
          // The server's 400 says WHICH database it found and that the app still uses it normally —
          // far more useful than a generic "connect a database" to someone who already did.
          if (t.status === 400 && typeof tj?.error === 'string') setBlockedReason(tj.error);
          else if (t.status >= 500) setError(tj?.error || 'Could not read your database just now.');
          // Fall back to the Supabase status ONLY to distinguish "linked but no project yet" from
          // "nothing connected at all" — the two deserve different hints.
          const res = await authedFetch('/api/integrations/supabase/status');
          const data = await res.json().catch(() => ({}));
          if (!cancelled) setConnected(!!data?.connected);
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

  // The key is fetched BEFORE any edit control is offered, so a table we cannot safely write is
  // shown read-only with the reason instead of a Save that fails at the last moment.
  useEffect(() => {
    if (!live || !selected) { setPrimaryKey([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch(`/api/integrations/supabase/primary-key?table=${encodeURIComponent(selected)}`);
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setPrimaryKey(res.ok && Array.isArray(data.primaryKey) ? data.primaryKey : []);
      } catch { if (!cancelled) setPrimaryKey([]); }
    })();
    return () => { cancelled = true; };
  }, [live, selected]);

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
        const rel = await authedFetch(`/api/integrations/supabase/relations?table=${encodeURIComponent(selected)}`);
        const rj = await rel.json().catch(() => ({}));
        if (!cancelled && rel.ok) {
          setRelations({
            foreignKeys: Array.isArray(rj.foreignKeys) ? rj.foreignKeys : [],
            indexes: Array.isArray(rj.indexes) ? rj.indexes : [],
          });
        }
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

  const editable = live && primaryKey.length > 0;

  /** The key of one row — exactly the primary-key columns, taken from the row we are looking at. */
  const keyOf = (row: DBRow): Record<string, unknown> =>
    Object.fromEntries(primaryKey.map((c) => [c, row[c]]));

  /**
   * One place for every write, so success and failure are handled identically.
   *
   * The row is re-read from the server's response rather than patched locally: a database applies
   * defaults, triggers and type coercion, so the row we think we saved and the row that now exists
   * are not always the same — and showing our guess would be a quiet lie about their data.
   */
  const write = async (method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>): Promise<boolean> => {
    setSaving(true);
    setWriteError('');
    try {
      const res = await authedFetch('/api/integrations/supabase/row', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: selected, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) { setWriteError(data?.error || 'That change could not be saved.'); return false; }
      await loadRows(selected, offset);
      return true;
    } catch (e) {
      setWriteError(e instanceof Error ? e.message : 'That change could not be saved.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    let values: Record<string, unknown>;
    try { values = JSON.parse(editing.json); } catch { setWriteError('That is not valid JSON — check the syntax.'); return; }
    // The key columns are what identify the row; sending them as values too would let a typo silently
    // move the row to a different key instead of editing the one on screen.
    const changed = Object.fromEntries(Object.entries(values).filter(([k]) => !primaryKey.includes(k)));
    if (Object.keys(changed).length === 0) { setWriteError('Nothing to save — no fields were changed.'); return; }
    if (await write('PATCH', { key: keyOf(editing.row), values: changed })) setEditing(null);
  };

  const addRow = async () => {
    if (adding === null) return;
    let values: Record<string, unknown>;
    try { values = JSON.parse(adding); } catch { setWriteError('That is not valid JSON — check the syntax.'); return; }
    if (await write('POST', { values })) setAdding(null);
  };

  const deleteRow = async (row: DBRow) => {
    // Deleting is the one action with no undo, so it asks — and names the row it will remove.
    const label = primaryKey.map((c) => `${c}=${renderCell(row[c])}`).join(', ');
    if (!window.confirm(`Delete this row (${label}) from "${selected}"? This cannot be undone.`)) return;
    await write('DELETE', { key: keyOf(row) });
  };

  /**
   * Run whatever the user typed.
   *
   * `allowWrite` is passed explicitly and only after they confirm, because the server's default is
   * read-only — enforced by Postgres, not by us reading the text (see sqlSafety.ts). A confirmation
   * that could be bypassed by a stale toggle would not be a confirmation at all, so it resets here.
   */
  const runSql = async (allowWrite: boolean) => {
    if (sqlRunning || !sqlText.trim()) return;
    if (allowWrite) {
      if (!window.confirm('This will CHANGE your database and cannot be undone. Run it anyway?')) return;
    }
    setSqlRunning(true);
    setSqlError('');
    try {
      const res = await authedFetch('/api/integrations/supabase/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: sqlText, allowWrite }),
      }, 60_000);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) { setSqlError(data?.error || 'That query could not be run.'); setSqlResult(null); return; }
      setSqlResult({
        rows: Array.isArray(data.rows) ? data.rows : [],
        columns: Array.isArray(data.columns) ? data.columns : [],
        rowCount: Number(data.rowCount ?? 0),
        capped: !!data.capped,
        elapsedMs: Number(data.elapsedMs ?? 0),
        readOnly: !!data.readOnly,
      });
      // A write can change what the table view is showing, so re-read it rather than leave a stale page.
      if (allowWrite && selected) await loadRows(selected, offset);
    } catch (e) {
      setSqlError(e instanceof Error ? e.message : 'That query could not be run.');
    } finally {
      setSqlRunning(false);
    }
  };

  /** Download the table as CSV, and say plainly when the file is only part of it. */
  const exportCsv = async () => {
    if (!live || !selected) return;
    try {
      const res = await authedFetch(`/api/integrations/supabase/export?table=${encodeURIComponent(selected)}`, {}, 120_000);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || 'Could not export that table.');
        return;
      }
      const text = await res.text();
      const count = res.headers.get('X-Nbai-Row-Count') ?? '';
      const truncated = res.headers.get('X-Nbai-Truncated') === '1';
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${selected}.csv`; a.click();
      URL.revokeObjectURL(url);
      // The file itself stays clean CSV — a warning inside it would corrupt the data for every other
      // tool — so the partial-export warning is said here instead.
      if (truncated) setImportNote(`Exported the first ${count} rows — this table has more.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not export that table.');
    }
  };

  /** Read a chosen CSV, in the browser, so the user sees what was understood before it is sent. */
  const pickCsv = async (file: File | null | undefined) => {
    setImportNote('');
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsv(text);
    const { rows, adjusted } = rowsToObjects(parsed);
    if (rows.length === 0) { setImportNote('That file has no data rows.'); return; }
    setImportPreview({ rows, headers: parsed.headers, adjusted });
  };

  /**
   * Send the parsed rows.
   *
   * The result is reported exactly as it happened, including a PARTIAL import: rows go in batches and
   * each batch is atomic, so a failure can leave earlier ones applied. Saying "import failed" then
   * would send the user to re-run the whole file and duplicate everything that did land.
   */
  const runImport = async () => {
    if (!importPreview || importing) return;
    setImporting(true);
    setImportNote('');
    try {
      const res = await authedFetch('/api/integrations/supabase/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: selected, rows: importPreview.rows }),
      }, 120_000);
      const data = await res.json().catch(() => ({}));
      const imported = Number(data?.imported ?? 0);
      const total = Number(data?.total ?? importPreview.rows.length);
      if (!res.ok && imported === 0) { setImportNote(data?.error || 'Nothing could be imported.'); return; }
      const unknown = Array.isArray(data?.unknownColumns) ? data.unknownColumns : [];
      const parts = [`Imported ${imported} of ${total} rows.`];
      if (data?.error) parts.push(`Stopped: ${data.error}`);
      if (unknown.length) parts.push(`Ignored ${unknown.length} column${unknown.length === 1 ? '' : 's'} the table does not have: ${unknown.join(', ')}.`);
      setImportNote(parts.join(' '));
      if (imported > 0) { setImportPreview(null); await loadRows(selected, offset); }
    } catch (e) {
      setImportNote(e instanceof Error ? e.message : 'That import could not be completed.');
    } finally {
      setImporting(false);
    }
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
            {(['table', 'json', 'schema', 'sql'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`text-[10px] px-2.5 py-1 rounded-lg border transition-all capitalize ${view === v ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300' : 'border-white/10 bg-white/5 text-white/40'}`}>{v === 'sql' ? 'SQL' : v}</button>
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
              <Download className="w-3 h-3" /> Export page (JSON)
            </button>
            {live && (
              <>
                <button onClick={() => void exportCsv()} className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] text-white/40 transition-all">
                  <Download className="w-3 h-3" /> Export table (CSV)
                </button>
                {editable && (
                  <label className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] text-white/40 transition-all cursor-pointer">
                    <Upload className="w-3 h-3" /> Import CSV
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(e) => { void pickCsv(e.target.files?.[0]); e.target.value = ''; }}
                    />
                  </label>
                )}
              </>
            )}
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
              {editable && (
                <button
                  onClick={() => { setWriteError(''); setAdding(`{\n  "field": "value"\n}`); }}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 mr-1 bg-cyan-600/20 border border-cyan-500/30 rounded-lg text-cyan-300 hover:bg-cyan-600/30 transition-all"
                >
                  <Plus className="w-3.5 h-3.5" /> Add row
                </button>
              )}
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

          {/* No primary key = no safe way to name one row. Say that, rather than offering a broken Save. */}
          {live && selected && primaryKey.length === 0 && (
            <div className="mx-3 mt-2 flex items-start gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
              <Lock className="w-4 h-4 text-white/40 shrink-0 mt-0.5" />
              <p className="text-xs text-white/50 leading-relaxed">
                <span className="text-white/70">Read-only.</span> "{selected}" has no primary key, so NavBharatAI
                cannot tell one row from another and will not risk changing the wrong one. Add a primary key to this
                table to edit it here.
              </p>
            </div>
          )}

          {(error || writeError) && (
            <div className="mx-3 mt-2 flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-xs text-red-300">{error || writeError}</p>
            </div>
          )}

          {/* CSV import preview — what was understood, before anything reaches their database. */}
          {importPreview && (
            <div className="mx-3 mt-2 bg-[#161b22] border border-cyan-500/20 rounded-xl p-3">
              <p className="text-xs text-white/70 mb-1">
                Import {importPreview.rows.length} row{importPreview.rows.length === 1 ? '' : 's'} into "{selected}"
              </p>
              <p className="text-[10px] text-white/40 mb-2">
                Columns in the file: {importPreview.headers.join(', ')}
                {/* Said up front, because a padded row is a row that will import with fields empty. */}
                {importPreview.adjusted > 0 && (
                  <span className="text-amber-300/80"> · {importPreview.adjusted} row{importPreview.adjusted === 1 ? ' has' : 's have'} a different number of columns and will be padded</span>
                )}
              </p>
              <p className="text-[10px] text-white/30 mb-2">
                Columns your table does not have are skipped, and NavBharatAI will name them afterwards.
              </p>
              <div className="flex gap-2">
                <button onClick={() => void runImport()} disabled={importing} className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 rounded-lg text-xs flex items-center gap-1 transition-all">
                  {importing ? <TirangaLoader className="w-3 h-3" /> : <Upload className="w-3 h-3" />} Import
                </button>
                <button onClick={() => { setImportPreview(null); setImportNote(''); }} className="px-3 py-1.5 bg-white/5 rounded-lg text-xs text-white/40">Cancel</button>
              </div>
            </div>
          )}

          {importNote && (
            <div className="mx-3 mt-2 flex items-start gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
              <FileSpreadsheetIcon />
              <p className="text-xs text-white/60 leading-relaxed">{importNote}</p>
            </div>
          )}

          {/* Add row */}
          {adding !== null && (
            <div className="mx-3 mt-2 bg-[#161b22] border border-cyan-500/20 rounded-xl p-3">
              <p className="text-xs text-white/50 mb-2">New row in "{selected}" (JSON)</p>
              <textarea
                className="w-full bg-[#0d1117] border border-white/10 rounded-lg p-2 text-xs font-mono text-white/70 resize-none focus:outline-none mb-2"
                rows={5}
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                spellCheck={false}
              />
              <div className="flex gap-2">
                <button onClick={() => void addRow()} disabled={saving} className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 rounded-lg text-xs flex items-center gap-1 transition-all">
                  {saving ? <TirangaLoader className="w-3 h-3" /> : <Check className="w-3 h-3" />} Add
                </button>
                <button onClick={() => { setAdding(null); setWriteError(''); }} className="px-3 py-1.5 bg-white/5 rounded-lg text-xs text-white/40">Cancel</button>
              </div>
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
                      {editable && <th className="w-16 px-2 py-2.5 text-white/30 text-right font-normal">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, ri) => (
                      <tr key={ri} className="border-b border-white/3 hover:bg-white/2 transition-colors group">
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
                        {editable && (
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => { setWriteError(''); setEditing({ row, json: JSON.stringify(row, null, 2) }); }}
                                className="p-1 text-white/30 hover:text-cyan-400 transition-colors"
                                title="Edit this row"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => void deleteRow(row)}
                                className="p-1 text-white/30 hover:text-red-400 transition-colors"
                                title="Delete this row"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                        )}
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
                        <td className="px-3 py-2 text-white/70 flex items-center gap-1.5">
                          <Columns className="w-3 h-3 text-white/20" />{c.name}
                          {primaryKey.includes(c.name) && <span className="text-[9px] px-1 rounded bg-cyan-500/15 text-cyan-300">PK</span>}
                        </td>
                        <td className="px-3 py-2 text-cyan-300/70">{c.type}</td>
                        <td className="px-3 py-2 text-white/40">{c.nullable ? 'yes' : 'no'}</td>
                        <td className="px-3 py-2 text-white/30">{c.default ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Relations — outgoing only: "what does this user_id point at?" is the question a
                  person browsing a row is actually asking. */}
              {relations && relations.foreignKeys.length > 0 && (
                <div className="mt-6">
                  <p className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Relations</p>
                  {relations.foreignKeys.map((fk) => (
                    <div key={`${fk.name}-${fk.column}`} className="flex items-center gap-2 py-1.5 text-xs border-b border-white/3">
                      <Link2 className="w-3 h-3 text-white/20 shrink-0" />
                      <span className="text-white/70">{fk.column}</span>
                      <span className="text-white/25">→</span>
                      <button
                        onClick={() => { setSelected(fk.referencesTable); setView('table'); }}
                        className="text-cyan-300/80 hover:text-cyan-200 hover:underline"
                        title={`Open ${fk.referencesTable}`}
                      >
                        {fk.referencesTable}.{fk.referencesColumn}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Indexes — the usual reason a generated app slows down as it fills up is that the
                  column the app filters by has none. */}
              {relations && relations.indexes.length > 0 && (
                <div className="mt-6">
                  <p className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Indexes</p>
                  {relations.indexes.map((ix) => (
                    <div key={ix.name} className="py-1.5 text-xs border-b border-white/3">
                      <div className="flex items-center gap-2">
                        <Zap className="w-3 h-3 text-white/20 shrink-0" />
                        <span className="text-white/70">{ix.name}</span>
                        {ix.primary && <span className="text-[9px] px-1 rounded bg-cyan-500/15 text-cyan-300">primary</span>}
                        {ix.unique && !ix.primary && <span className="text-[9px] px-1 rounded bg-white/10 text-white/50">unique</span>}
                      </div>
                      <p className="pl-5 text-[10px] text-white/25 font-mono truncate" title={ix.definition}>{ix.definition}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {view === 'sql' && (
            <div className="flex-1 overflow-auto p-4">
              {!live ? (
                <p className="text-xs text-white/30">Connect a database to run queries.</p>
              ) : (
                <>
                  <textarea
                    className="w-full bg-[#0d1117] border border-white/10 rounded-xl p-3 text-xs font-mono text-white/80 resize-y focus:outline-none focus:border-cyan-500/50"
                    rows={6}
                    value={sqlText}
                    onChange={(e) => setSqlText(e.target.value)}
                    spellCheck={false}
                    placeholder="select * from users where created_at > now() - interval '7 days'"
                  />
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => void runSql(false)}
                      disabled={sqlRunning}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 rounded-lg text-xs font-medium transition-all"
                    >
                      {sqlRunning ? <TirangaLoader className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />} Run
                    </button>
                    {/* A separate button, not a toggle: a toggle left on from ten minutes ago is how a
                        read becomes a write nobody meant to run. This one always asks first. */}
                    <button
                      onClick={() => void runSql(true)}
                      disabled={sqlRunning}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/15 border border-red-500/30 text-red-300 hover:bg-red-600/25 disabled:opacity-40 rounded-lg text-xs transition-all"
                      title="Run a statement that CHANGES your database. You will be asked to confirm."
                    >
                      Run as a change…
                    </button>
                    <p className="text-[10px] text-white/25 ml-1">
                      Run is read-only — your database rejects anything that would change data.
                    </p>
                  </div>

                  {sqlError && (
                    <div className="mt-3 flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-red-300 leading-relaxed">{sqlError}</p>
                    </div>
                  )}

                  {sqlResult && (
                    <div className="mt-3">
                      <p className="text-[10px] text-white/30 mb-2">
                        {sqlResult.rowCount} row{sqlResult.rowCount === 1 ? '' : 's'} · {sqlResult.elapsedMs} ms
                        {sqlResult.capped && <span className="text-amber-300/80"> · showing the first {sqlResult.rowCount} — there may be more</span>}
                        {!sqlResult.readOnly && <span className="text-red-300/80"> · this changed your database</span>}
                      </p>
                      {sqlResult.rows.length === 0 ? (
                        <p className="text-xs text-white/30">No rows returned.</p>
                      ) : (
                        <div className="overflow-auto border border-white/5 rounded-xl">
                          <table className="w-full text-xs border-collapse min-w-max">
                            <thead className="bg-[#161b22]">
                              <tr className="border-b border-white/5">
                                {sqlResult.columns.map((c) => (
                                  <th key={c} className="text-left px-3 py-2 font-normal text-white/40 whitespace-nowrap">{c}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {sqlResult.rows.map((row, ri) => (
                                <tr key={ri} className="border-b border-white/3">
                                  {sqlResult.columns.map((c) => {
                                    const val = renderCell(row[c]);
                                    return (
                                      <td key={c} className="px-3 py-2 max-w-xs">
                                        <span className={`truncate block ${row[c] === null || row[c] === undefined ? 'text-white/15 italic' : 'text-white/60'}`} title={val}>{val}</span>
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Edit panel — the key columns are shown but not editable: they identify the row we are
            changing, and letting a typo rewrite them would move the row instead of editing it. */}
        {editing && (
          <div className="w-80 border-l border-white/5 bg-[#161b22] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">Edit row</p>
                <p className="text-[10px] text-white/30 truncate">
                  {primaryKey.map((c) => `${c}=${renderCell(editing.row[c])}`).join(', ')}
                </p>
              </div>
              <button onClick={() => { setEditing(null); setWriteError(''); }} aria-label="Close">
                <X className="w-4 h-4 text-white/40 hover:text-white/70" />
              </button>
            </div>
            <div className="flex-1 p-3 overflow-auto">
              <textarea
                className="w-full h-full min-h-[300px] bg-[#0d1117] border border-white/10 rounded-xl p-3 text-xs font-mono text-white/70 resize-none focus:outline-none focus:border-cyan-500/50"
                value={editing.json}
                onChange={(e) => setEditing({ ...editing, json: e.target.value })}
                spellCheck={false}
              />
              <p className="mt-2 text-[10px] text-white/30 leading-relaxed">
                {primaryKey.join(', ')} identif{primaryKey.length === 1 ? 'ies' : 'y'} this row and {primaryKey.length === 1 ? 'is' : 'are'} not changed by saving.
              </p>
            </div>
            <div className="p-3 border-t border-white/5 flex gap-2">
              <button onClick={() => void saveEdit()} disabled={saving} className="flex-1 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-all">
                {saving ? <TirangaLoader className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />} Save
              </button>
              <button onClick={() => { setEditing(null); setWriteError(''); }} className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-xs text-white/40 transition-all">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
