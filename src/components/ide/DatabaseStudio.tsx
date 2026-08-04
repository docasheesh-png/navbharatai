import React, { useState, useEffect } from 'react';
import { Database, Plus, Trash2, Edit2, Check, X, RefreshCw, Download, Upload, Search, ChevronRight, Copy, AlertCircle, Table, Filter, ArrowUpDown } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { db } from '../../App';
import { collection, getDocs, doc, setDoc, deleteDoc, addDoc, getDoc } from 'firebase/firestore';
import { Breadcrumb } from '../ui/Breadcrumb';

interface DBRow { [key: string]: any; }

const DEMO_COLLECTIONS: Record<string, DBRow[]> = {
  users: [
    { id: 'usr_1', name: 'Arjun Sharma', email: 'arjun@example.com', role: 'admin', created: '2024-01-15' },
    { id: 'usr_2', name: 'Priya Singh', email: 'priya@example.com', role: 'user', created: '2024-02-20' },
    { id: 'usr_3', name: 'Rahul Kumar', email: 'rahul@example.com', role: 'user', created: '2024-03-05' },
  ],
  products: [
    { id: 'prd_1', name: 'NavBharat Pro', price: 999, category: 'Software', stock: 999 },
    { id: 'prd_2', name: 'AI Credits Pack', price: 299, category: 'Credits', stock: 500 },
  ],
  orders: [
    { id: 'ord_1', userId: 'usr_1', product: 'NavBharat Pro', amount: 999, status: 'completed', date: '2024-04-10' },
    { id: 'ord_2', userId: 'usr_2', product: 'AI Credits Pack', amount: 299, status: 'pending', date: '2024-04-12' },
  ],
};

type SortDir = 'asc' | 'desc';

export function DatabaseStudio() {
  const [collections, setCollections] = useState<string[]>(Object.keys(DEMO_COLLECTIONS));
  const [selectedCol, setSelectedCol] = useState<string>('users');
  const [rows, setRows] = useState<DBRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [source, setSource] = useState<'demo' | 'firestore'>('demo');
  const [firestoreCol, setFirestoreCol] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [editingRow, setEditingRow] = useState<DBRow | null>(null);
  const [editJson, setEditJson] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [showAddRow, setShowAddRow] = useState(false);
  const [newRowJson, setNewRowJson] = useState('{\n  "field": "value"\n}');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [copiedId, setCopiedId] = useState('');
  const [activeView, setActiveView] = useState<'table' | 'json'>('table');

  useEffect(() => {
    loadCollection(selectedCol);
  }, [selectedCol, source]);

  const loadCollection = async (colName: string) => {
    setLoading(true);
    setError('');
    try {
      if (source === 'demo') {
        setRows((DEMO_COLLECTIONS[colName] || []).map(r => ({ ...r })));
      } else {
        const snap = await getDocs(collection(db, colName));
        const data: DBRow[] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setRows(data);
        if (!collections.includes(colName)) setCollections(prev => [...prev, colName]);
      }
    } catch (e: any) {
      setError('Load failed: ' + (e.message || 'Check Firestore rules'));
    }
    setLoading(false);
  };

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const sortedRows = [...rows].sort((a, b) => {
    if (!sortField) return 0;
    const av = a[sortField]; const bv = b[sortField];
    if (av === bv) return 0;
    const cmp = String(av).localeCompare(String(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const filteredRows = sortedRows.filter(row => {
    if (!searchQuery) return true;
    return Object.values(row).some(v => String(v).toLowerCase().includes(searchQuery.toLowerCase()));
  });

  const allKeys = rows.length > 0 ? Array.from(new Set(rows.flatMap(r => Object.keys(r)))) : [];

  const startEdit = (row: DBRow) => {
    setEditingRow(row);
    setEditJson(JSON.stringify(row, null, 2));
    setJsonError('');
  };

  const saveEdit = async () => {
    try {
      const parsed = JSON.parse(editJson);
      setJsonError('');
      if (source === 'firestore') {
        await setDoc(doc(db, selectedCol, parsed.id || editingRow!.id), parsed);
      }
      setRows(prev => prev.map(r => (r.id === editingRow!.id ? parsed : r)));
      if (source === 'demo' && DEMO_COLLECTIONS[selectedCol]) {
        const idx = DEMO_COLLECTIONS[selectedCol].findIndex(r => r.id === editingRow!.id);
        if (idx >= 0) DEMO_COLLECTIONS[selectedCol][idx] = parsed;
      }
      setEditingRow(null);
    } catch { setJsonError('Invalid JSON — check syntax'); }
  };

  const deleteRow = async (row: DBRow) => {
    if (!window.confirm(`Delete "${row.id || row.name}"?`)) return;
    if (source === 'firestore') {
      try { await deleteDoc(doc(db, selectedCol, row.id)); } catch {}
    }
    setRows(prev => prev.filter(r => r.id !== row.id));
    if (source === 'demo' && DEMO_COLLECTIONS[selectedCol]) {
      const idx = DEMO_COLLECTIONS[selectedCol].findIndex(r => r.id === row.id);
      if (idx >= 0) DEMO_COLLECTIONS[selectedCol].splice(idx, 1);
    }
  };

  const addRow = async () => {
    try {
      const parsed = JSON.parse(newRowJson);
      setJsonError('');
      if (source === 'firestore') {
        const ref = await addDoc(collection(db, selectedCol), parsed);
        parsed.id = ref.id;
      } else {
        parsed.id = parsed.id || 'row_' + Date.now();
        if (!DEMO_COLLECTIONS[selectedCol]) DEMO_COLLECTIONS[selectedCol] = [];
        DEMO_COLLECTIONS[selectedCol].push(parsed);
      }
      setRows(prev => [...prev, parsed]);
      setShowAddRow(false);
      setNewRowJson('{\n  "field": "value"\n}');
    } catch { setJsonError('Invalid JSON'); }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${selectedCol}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = () => {
    try {
      const parsed = JSON.parse(importText);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      setRows(arr);
      setImportText(''); setShowImport(false);
    } catch { alert('Invalid JSON'); }
  };

  const copyCell = (val: string) => {
    navigator.clipboard.writeText(val).then(() => { setCopiedId(val); setTimeout(() => setCopiedId(''), 1500); });
  };

  const connectFirestore = () => {
    if (!firestoreCol.trim()) return;
    setSource('firestore');
    setSelectedCol(firestoreCol.trim());
    setCollections(prev => prev.includes(firestoreCol.trim()) ? prev : [...prev, firestoreCol.trim()]);
  };

  const renderValue = (val: any): string => {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  };

  const truncate = (s: string, n = 28) => s.length > n ? s.slice(0, n) + '…' : s;

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 bg-[#161b22]">
        <div className="w-10 h-10 bg-cyan-600/20 rounded-xl flex items-center justify-center">
          <Database className="w-5 h-5 text-cyan-400" />
        </div>
        <div className="min-w-0">
          <h2 className="font-semibold text-white text-base">Database Studio</h2>
          {/* P-UX.5 — breadcrumb: source → collection → [selected document] */}
          <Breadcrumb
            className="mt-0.5"
            items={[
              { label: source === 'firestore' ? 'Firestore' : 'Demo' },
              ...(selectedCol ? [{ label: selectedCol, title: `Collection: ${selectedCol}`, onClick: selectedDocId ? () => setSelectedDocId(null) : undefined }] : []),
              ...(selectedDocId ? [{ label: selectedDocId, title: `Document: ${selectedDocId}` }] : []),
            ]}
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className={`flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-lg border ${source === 'firestore' ? 'border-cyan-500/40 text-cyan-300 bg-cyan-500/10' : 'border-amber-500/40 text-amber-300 bg-amber-500/10'}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${source === 'firestore' ? 'bg-cyan-400' : 'bg-amber-400'} animate-pulse`} />
            {source === 'firestore' ? 'Firestore Live' : 'Demo Data'}
          </div>
          <div className="flex items-center gap-1.5">
            {['table', 'json'].map(v => (
              <button key={v} onClick={() => setActiveView(v as any)} className={`text-[10px] px-2.5 py-1 rounded-lg border transition-all capitalize ${activeView === v ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300' : 'border-white/10 bg-white/5 text-white/40'}`}>{v}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Collections Panel */}
        <div className="w-44 flex flex-col border-r border-white/5 bg-[#161b22]">
          <div className="p-3 border-b border-white/5">
            <p className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Collections</p>
            <div className="flex gap-1.5 mb-2">
              <input
                className="flex-1 min-w-0 bg-[#0d1117] border border-white/10 rounded-lg px-2 py-1 text-[10px] text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50"
                placeholder="collection name"
                value={firestoreCol}
                onChange={e => setFirestoreCol(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') connectFirestore(); }}
              />
              <button onClick={connectFirestore} className="p-1.5 bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/30 rounded-lg text-cyan-400 transition-all" title="Connect">
                <Plus className="w-3 h-3" />
              </button>
            </div>
            <p className="text-[8px] text-white/20">Enter name + press Enter to connect Firestore</p>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {collections.map(col => (
              <button key={col} onClick={() => { setSelectedCol(col); if (source === 'demo') loadCollection(col); }} className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs text-left transition-all ${selectedCol === col ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-300' : 'text-white/50 hover:bg-white/5 border border-transparent'}`}>
                <Table className="w-3 h-3 shrink-0" />
                <span className="truncate">{col}</span>
                <span className="ml-auto text-[9px] text-white/20">{source === 'demo' ? (DEMO_COLLECTIONS[col]?.length || 0) : ''}</span>
              </button>
            ))}
          </div>
          <div className="p-2 border-t border-white/5 space-y-1.5">
            <button onClick={() => loadCollection(selectedCol)} className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] text-white/40 transition-all">
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={exportJson} className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] text-white/40 transition-all">
              <Download className="w-3 h-3" /> Export JSON
            </button>
            <button onClick={() => setShowImport(!showImport)} className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] text-white/40 transition-all">
              <Upload className="w-3 h-3" /> Import JSON
            </button>
          </div>
        </div>

        {/* Main: Table / JSON View */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-[#161b22]">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30" />
              <input className="w-full bg-[#0d1117] border border-white/10 rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50" placeholder="Search rows..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>
            <span className="text-xs text-white/30">{filteredRows.length} rows</span>
            <button onClick={() => setShowAddRow(true)} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-cyan-600/20 border border-cyan-500/30 rounded-lg text-cyan-300 hover:bg-cyan-600/30 ml-auto transition-all">
              <Plus className="w-3.5 h-3.5" /> Add Row
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="mx-3 mt-2 flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          {/* Import panel */}
          {showImport && (
            <div className="mx-3 mt-2 bg-[#161b22] border border-white/10 rounded-xl p-3">
              <textarea className="w-full bg-[#0d1117] border border-white/10 rounded-lg p-2 text-xs font-mono text-white/70 resize-none focus:outline-none mb-2" rows={3} placeholder='[{"id":"1","name":"test"}]' value={importText} onChange={e => setImportText(e.target.value)} />
              <div className="flex gap-2">
                <button onClick={importJson} className="px-3 py-1.5 bg-cyan-600 rounded-lg text-xs">Import</button>
                <button onClick={() => setShowImport(false)} className="px-3 py-1.5 bg-white/5 rounded-lg text-xs text-white/40">Cancel</button>
              </div>
            </div>
          )}

          {/* Add Row panel */}
          {showAddRow && (
            <div className="mx-3 mt-2 bg-[#161b22] border border-cyan-500/20 rounded-xl p-3">
              <p className="text-xs text-white/50 mb-2">New Row (JSON)</p>
              <textarea className="w-full bg-[#0d1117] border border-white/10 rounded-lg p-2 text-xs font-mono text-white/70 resize-none focus:outline-none mb-2" rows={4} value={newRowJson} onChange={e => setNewRowJson(e.target.value)} />
              {jsonError && <p className="text-[10px] text-red-400 mb-1">{jsonError}</p>}
              <div className="flex gap-2">
                <button onClick={addRow} className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-xs flex items-center gap-1 transition-all"><Check className="w-3 h-3" /> Add</button>
                <button onClick={() => { setShowAddRow(false); setJsonError(''); }} className="px-3 py-1.5 bg-white/5 rounded-lg text-xs text-white/40">Cancel</button>
              </div>
            </div>
          )}

          {/* Table View */}
          {activeView === 'table' && (
            <div className="flex-1 overflow-auto">
              {loading ? (
                <div className="flex items-center justify-center h-40 gap-2">
                  <TirangaLoader className="w-5 h-5" />
                  <p className="text-sm text-white/40">Loading...</p>
                </div>
              ) : filteredRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2">
                  <Database className="w-10 h-10 text-white/10" />
                  <p className="text-sm text-white/30">No data yet — click "Add Row" to get started</p>
                </div>
              ) : (
                <table className="w-full text-xs border-collapse min-w-max">
                  <thead className="sticky top-0 bg-[#161b22] z-10">
                    <tr className="border-b border-white/5">
                      {allKeys.map(key => (
                        <th key={key} className="text-left px-3 py-2.5 font-normal text-white/40 whitespace-nowrap cursor-pointer hover:text-white/70 select-none" onClick={() => handleSort(key)}>
                          <div className="flex items-center gap-1">
                            <span>{key}</span>
                            {sortField === key ? (
                              <span className="text-cyan-400">{sortDir === 'asc' ? '↑' : '↓'}</span>
                            ) : (
                              <ArrowUpDown className="w-2.5 h-2.5 text-white/20" />
                            )}
                          </div>
                        </th>
                      ))}
                      <th className="w-20 px-2 py-2.5 text-white/30 text-right font-normal">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, ri) => (
                      <tr key={row.id || ri} className={`border-b border-white/3 hover:bg-white/2 transition-colors group ${selectedDocId === row.id ? 'bg-cyan-500/5' : ''}`} onClick={() => setSelectedDocId(row.id === selectedDocId ? null : row.id)}>
                        {allKeys.map(key => {
                          const val = renderValue(row[key]);
                          return (
                            <td key={key} className="px-3 py-2 max-w-xs">
                              <div className="flex items-center gap-1 group/cell">
                                <span className={`truncate ${row[key] === null || row[key] === undefined ? 'text-white/15 italic' : 'text-white/60'}`} title={val}>
                                  {truncate(val)}
                                </span>
                                <button onClick={e => { e.stopPropagation(); copyCell(val); }} className="opacity-0 group-hover/cell:opacity-100 shrink-0 transition-opacity">
                                  {copiedId === val ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5 text-white/20 hover:text-white/50" />}
                                </button>
                              </div>
                            </td>
                          );
                        })}
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={e => { e.stopPropagation(); startEdit(row); }} className="p-1 text-white/30 hover:text-cyan-400 transition-colors"><Edit2 className="w-3 h-3" /></button>
                            <button onClick={e => { e.stopPropagation(); deleteRow(row); }} className="p-1 text-white/30 hover:text-red-400 transition-colors"><Trash2 className="w-3 h-3" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* JSON View */}
          {activeView === 'json' && (
            <div className="flex-1 overflow-auto p-4">
              <pre className="text-[10px] font-mono text-emerald-300 whitespace-pre-wrap">{JSON.stringify(filteredRows, null, 2)}</pre>
            </div>
          )}
        </div>

        {/* Edit Panel */}
        {editingRow && (
          <div className="w-80 border-l border-white/5 bg-[#161b22] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <p className="text-sm font-medium text-white">Edit Document</p>
              <button onClick={() => setEditingRow(null)}><X className="w-4 h-4 text-white/40 hover:text-white/70" /></button>
            </div>
            <div className="flex-1 p-3 overflow-auto">
              <textarea className="w-full h-full min-h-[300px] bg-[#0d1117] border border-white/10 rounded-xl p-3 text-xs font-mono text-white/70 resize-none focus:outline-none focus:border-cyan-500/50" value={editJson} onChange={e => setEditJson(e.target.value)} spellCheck={false} />
              {jsonError && <p className="text-[10px] text-red-400 mt-1">{jsonError}</p>}
            </div>
            <div className="p-3 border-t border-white/5 flex gap-2">
              <button onClick={saveEdit} className="flex-1 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-all"><Check className="w-3.5 h-3.5" /> Save</button>
              <button onClick={() => setEditingRow(null)} className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-xs text-white/40 transition-all">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
