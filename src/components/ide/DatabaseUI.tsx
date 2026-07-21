import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Database, RefreshCcw, Plus, Trash2, Edit2, Search,
  ChevronRight, Save, X, AlertCircle, Eye, Loader2, Check
} from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import {
  collection, getDocs, doc, setDoc, deleteDoc, addDoc,
  query, orderBy, limit, onSnapshot, startAfter,
  QueryDocumentSnapshot
} from 'firebase/firestore';
import { db } from '../../lib/firebase'; // shared handle → navbharat-prod (NOT the (default) DB)
import { cn } from '../../lib/utils';

interface DatabaseUIProps {
  userId?: string;
  userTier?: string;
  /** Admin gate (admin autopsy 2026-07-21): this is a RAW console over NavBharatAI's production
   *  Firestore — it must never be a normal user-facing tool. Non-admins get an honest card pointing
   *  to their own app's database (Settings → Database / BYOD) instead of the internal console. */
  isAdmin?: boolean;
  /** Navigate the user to Settings → Database (their real, own-app database). */
  onOpenAppDatabase?: () => void;
}

interface DocRow {
  id: string;
  data: Record<string, unknown>;
}

const KNOWN_COLLECTIONS = [
  'users',
  'user_sessions',
  'conversations',
  'generated_apps',
  'pwa_apps',
  'reports',
  'payments',
];

const PAGE_SIZE = 20;

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'object') {
    if ((val as Record<string, unknown>)?.toDate) {
      return (val as { toDate: () => Date }).toDate().toLocaleString();
    }
    return JSON.stringify(val);
  }
  return String(val);
}

function getTimestampField(data: Record<string, unknown>): string | null {
  const keys = ['createdAt', 'updatedAt', 'created_at', 'updated_at', 'timestamp'];
  for (const k of keys) {
    if (data[k] !== undefined) {
      return formatValue(data[k]);
    }
  }
  return null;
}

function previewFields(data: Record<string, unknown>): [string, string][] {
  const skipKeys = new Set(['createdAt', 'updatedAt', 'created_at', 'updated_at', 'timestamp']);
  const entries = Object.entries(data)
    .filter(([k]) => !skipKeys.has(k))
    .slice(0, 3);
  return entries.map(([k, v]) => [k, formatValue(v)]);
}

/**
 * Admin-only gate (admin autopsy 2026-07-21): a RAW console over NavBharatAI's production Firestore
 * must never be a normal user-facing tool. Non-admins get an honest card pointing to their own app's
 * database (Settings → Database / BYOD). Kept as a thin wrapper so the console's hooks only mount for
 * admins (no conditional-hooks violation). The real data boundary remains firestore.rules.
 */
export const DatabaseUI: React.FC<DatabaseUIProps> = ({ userId, userTier, isAdmin, onOpenAppDatabase }) => {
  if (!isAdmin) {
    return (
      <div className="h-full flex items-center justify-center bg-[#0d1117] text-white p-6">
        <div className="max-w-md text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-indigo-600/15 border border-indigo-600/25 flex items-center justify-center text-2xl">🗄️</div>
          <h2 className="text-lg font-black text-white">Your app&apos;s database</h2>
          <p className="text-sm text-[#8b949e] leading-relaxed">
            This internal console is for platform admins only. To connect and manage <span className="text-white">your own app&apos;s</span> database
            (Supabase, Firebase, MongoDB, Neon, Appwrite…), use <span className="text-white">Settings → Database</span> — your credentials are
            stored encrypted and wired into the apps NavBharatAI Pro v5.0 builds for you.
          </p>
          {onOpenAppDatabase && (
            <button
              onClick={onOpenAppDatabase}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition-colors"
            >
              Open Settings → Database
            </button>
          )}
        </div>
      </div>
    );
  }
  return <DatabaseConsole userId={userId} userTier={userTier} />;
};

const DatabaseConsole: React.FC<{ userId?: string; userTier?: string }> = ({ userId, userTier }) => {
  const [selectedCollection, setSelectedCollection] = useState<string>('');
  const [customCollection, setCustomCollection] = useState('');
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<DocRow | null>(null);
  const [editJson, setEditJson] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newDocJson, setNewDocJson] = useState('{\n  \n}');
  const [newDocError, setNewDocError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [lastVisible, setLastVisible] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [realtimeEnabled, setRealtimeEnabled] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const getDb = useCallback(() => db, []); // shared handle → navbharat-prod

  const loadDocs = useCallback(async (colName: string, append = false, cursor: QueryDocumentSnapshot | null = null) => {
    if (!colName) return;
    setLoading(true);
    setError(null);
    try {
      const db = getDb();
      if (!db) throw new Error('Firestore is not initialized. Check your Firebase configuration.');
      const colRef = collection(db, colName);
      let q = query(colRef, orderBy('__name__'), limit(PAGE_SIZE));
      if (append && cursor) {
        q = query(colRef, orderBy('__name__'), startAfter(cursor), limit(PAGE_SIZE));
      }
      const snapshot = await getDocs(q);
      const rows: DocRow[] = snapshot.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
      setDocs((prev) => (append ? [...prev, ...rows] : rows));
      const last = snapshot.docs[snapshot.docs.length - 1] ?? null;
      setLastVisible(last);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes('permission') || msg.includes('PERMISSION_DENIED')
        ? 'Permission denied. Make sure your Firestore security rules allow read access for this collection.'
        : msg);
    } finally {
      setLoading(false);
    }
  }, [getDb]);

  const startRealtime = useCallback((colName: string) => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    if (!colName) return;
    try {
      const db = getDb();
      if (!db) return;
      const colRef = collection(db, colName);
      const q = query(colRef, orderBy('__name__'), limit(PAGE_SIZE));
      const unsub = onSnapshot(q, (snapshot) => {
        const rows: DocRow[] = snapshot.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
        setDocs(rows);
        setLastVisible(snapshot.docs[snapshot.docs.length - 1] ?? null);
        setHasMore(snapshot.docs.length === PAGE_SIZE);
        setError(null);
      }, (err) => {
        setError(err.message);
      });
      unsubscribeRef.current = unsub;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }, [getDb]);

  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) unsubscribeRef.current();
    };
  }, []);

  const handleSelectCollection = (name: string) => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    setSelectedCollection(name);
    setDocs([]);
    setLastVisible(null);
    setSelectedDoc(null);
    setError(null);
    setSearchQuery('');
    if (realtimeEnabled) {
      startRealtime(name);
    } else {
      loadDocs(name);
    }
  };

  const handleToggleRealtime = () => {
    if (realtimeEnabled) {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      setRealtimeEnabled(false);
    } else {
      setRealtimeEnabled(true);
      if (selectedCollection) startRealtime(selectedCollection);
    }
  };

  const handleRefresh = () => {
    setLastVisible(null);
    if (realtimeEnabled) {
      startRealtime(selectedCollection);
    } else {
      setDocs([]);
      loadDocs(selectedCollection);
    }
  };

  const handleSelectDoc = (row: DocRow) => {
    setSelectedDoc(row);
    setEditJson(JSON.stringify(row.data, null, 2));
    setEditError(null);
    setSaveSuccess(false);
  };

  const handleSaveDoc = async () => {
    if (!selectedDoc || !selectedCollection) return;
    setEditError(null);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(editJson);
    } catch {
      setEditError('Invalid JSON. Please fix the syntax and try again.');
      return;
    }
    setSaving(true);
    try {
      const db = getDb();
      if (!db) throw new Error('Firestore not initialized.');
      const ref = doc(db, selectedCollection, selectedDoc.id);
      await setDoc(ref, parsed, { merge: true });
      setSaveSuccess(true);
      setSelectedDoc({ ...selectedDoc, data: parsed });
      setDocs((prev) => prev.map((d) => d.id === selectedDoc.id ? { ...d, data: parsed } : d));
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    if (!selectedCollection) return;
    setDeleting(true);
    try {
      const db = getDb();
      if (!db) throw new Error('Firestore not initialized.');
      await deleteDoc(doc(db, selectedCollection, docId));
      setDocs((prev) => prev.filter((d) => d.id !== docId));
      if (selectedDoc?.id === docId) setSelectedDoc(null);
      setDeleteConfirm(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const handleAddDoc = async () => {
    if (!selectedCollection) return;
    setNewDocError(null);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(newDocJson);
    } catch {
      setNewDocError('Invalid JSON. Please fix the syntax and try again.');
      return;
    }
    setAdding(true);
    try {
      const db = getDb();
      if (!db) throw new Error('Firestore not initialized.');
      const ref = await addDoc(collection(db, selectedCollection), parsed);
      const newRow: DocRow = { id: ref.id, data: parsed };
      setDocs((prev) => [newRow, ...prev]);
      setShowAddModal(false);
      setNewDocJson('{\n  \n}');
    } catch (err: unknown) {
      setNewDocError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  const filteredDocs = searchQuery
    ? docs.filter((d) => d.id.toLowerCase().startsWith(searchQuery.toLowerCase()))
    : docs;

  const showTable = selectedCollection && (docs.length > 0 || !loading);

  return (
    <div className="flex h-full bg-[#0d1117] text-white overflow-hidden">
      {/* Left panel: Collections */}
      <div className="w-[200px] flex-shrink-0 border-r border-white/5 bg-[#161b22] flex flex-col">
        <div className="p-3 border-b border-white/5">
          <div className="flex items-center gap-2 mb-3">
            <Database className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-black uppercase tracking-widest text-[#8b949e]">Collections</span>
          </div>
          <input
            value={customCollection}
            onChange={(e) => setCustomCollection(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customCollection.trim()) {
                handleSelectCollection(customCollection.trim());
              }
            }}
            placeholder="Custom collection..."
            className="w-full bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] text-white placeholder:text-[#484f58] outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {KNOWN_COLLECTIONS.map((name) => (
            <button
              key={name}
              onClick={() => handleSelectCollection(name)}
              className={cn(
                'w-full text-left px-3 py-2 text-[11px] font-medium flex items-center gap-2 transition-colors',
                selectedCollection === name
                  ? 'bg-indigo-600/20 text-indigo-400'
                  : 'text-[#8b949e] hover:bg-white/5 hover:text-white'
              )}
            >
              <ChevronRight className={cn('w-3 h-3 flex-shrink-0 transition-transform', selectedCollection === name && 'rotate-90')} />
              <span className="truncate">{name}</span>
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-white/5">
          <button
            onClick={handleToggleRealtime}
            className={cn(
              'w-full text-[9px] font-black uppercase tracking-widest rounded-lg py-1.5 px-2 transition-colors border',
              realtimeEnabled
                ? 'bg-emerald-600/20 border-emerald-500/30 text-emerald-400'
                : 'bg-white/5 border-white/10 text-[#8b949e] hover:text-white'
            )}
          >
            {realtimeEnabled ? '● Live' : '○ Live'}
          </button>
        </div>
      </div>

      {/* Main panel: Documents */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 bg-[#161b22] flex-shrink-0">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#484f58]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by ID prefix..."
              className="w-full bg-black/40 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-[11px] text-white placeholder:text-[#484f58] outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
          <span className="text-[10px] text-[#484f58] font-black uppercase ml-1">
            {selectedCollection ? `${filteredDocs.length} docs` : ''}
          </span>
          <div className="flex items-center gap-1.5 ml-auto">
            <button
              onClick={handleRefresh}
              disabled={!selectedCollection || loading}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[#8b949e] hover:text-white transition-colors disabled:opacity-40"
              title="Refresh"
            >
              <RefreshCcw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            </button>
            <button
              onClick={() => { setShowAddModal(true); setNewDocJson('{\n  \n}'); setNewDocError(null); }}
              disabled={!selectedCollection}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-40"
            >
              <Plus className="w-3 h-3" /> Add Doc
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-4 mt-3 flex items-start gap-2 bg-red-900/20 border border-red-500/30 rounded-xl p-3 flex-shrink-0">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[11px] font-bold text-red-300">{error}</p>
              <p className="text-[10px] text-red-400/70 mt-1">
                Troubleshooting: Check Firestore rules, ensure the app is initialized, and verify collection name spelling.
              </p>
            </div>
          </div>
        )}

        {/* Empty placeholder */}
        {!selectedCollection && !loading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-3">
              <Database className="w-12 h-12 text-[#30363d] mx-auto" />
              <p className="text-[#484f58] text-sm font-bold">Select a collection to browse documents</p>
            </div>
          </div>
        )}

        {/* Loading state (initial) */}
        {loading && docs.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <TirangaLoader className="w-8 h-8" />
          </div>
        )}

        {/* Documents table */}
        {showTable && (
          <div className="flex-1 overflow-y-auto">
            {filteredDocs.length > 0 ? (
              <table className="w-full text-left table-fixed">
                <thead>
                  <tr className="border-b border-white/5 sticky top-0 bg-[#0d1117] z-10">
                    <th className="px-4 py-2 text-[9px] font-black uppercase tracking-widest text-[#484f58] w-[200px]">Document ID</th>
                    <th className="px-4 py-2 text-[9px] font-black uppercase tracking-widest text-[#484f58]">Fields Preview</th>
                    <th className="px-4 py-2 text-[9px] font-black uppercase tracking-widest text-[#484f58] w-[160px]">Timestamp</th>
                    <th className="px-4 py-2 text-[9px] font-black uppercase tracking-widest text-[#484f58] w-[80px] text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDocs.map((row) => {
                    const preview = previewFields(row.data);
                    const ts = getTimestampField(row.data);
                    return (
                      <tr
                        key={row.id}
                        onClick={() => handleSelectDoc(row)}
                        className={cn(
                          'border-b border-white/5 cursor-pointer transition-colors',
                          selectedDoc?.id === row.id ? 'bg-indigo-600/10' : 'hover:bg-white/5'
                        )}
                      >
                        <td className="px-4 py-2.5">
                          <span
                            className="font-mono text-[10px] text-indigo-300 bg-indigo-500/10 px-1.5 py-0.5 rounded truncate block max-w-[180px]"
                            title={row.id}
                          >
                            {row.id.length > 20 ? row.id.slice(0, 20) + '…' : row.id}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1.5">
                            {preview.map(([k, v]) => (
                              <span
                                key={k}
                                className="text-[10px] bg-white/5 border border-white/10 rounded px-1.5 py-0.5 max-w-[120px] truncate"
                                title={`${k}: ${v}`}
                              >
                                <span className="text-[#8b949e]">{k}:</span>{' '}
                                <span className="text-white">{v.length > 12 ? v.slice(0, 12) + '…' : v}</span>
                              </span>
                            ))}
                            {Object.keys(row.data).length === 0 && (
                              <span className="text-[10px] text-[#484f58] italic">empty</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          {ts ? (
                            <span className="text-[10px] text-[#8b949e] truncate block">{ts}</span>
                          ) : (
                            <span className="text-[10px] text-[#30363d]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleSelectDoc(row)}
                              className="p-1 rounded hover:bg-white/10 text-[#8b949e] hover:text-indigo-400 transition-colors"
                              title="View / Edit"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(row.id)}
                              className="p-1 rounded hover:bg-white/10 text-[#8b949e] hover:text-red-400 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="flex items-center justify-center py-16">
                <div className="text-center space-y-2">
                  <Eye className="w-8 h-8 text-[#30363d] mx-auto" />
                  <p className="text-[#484f58] text-xs font-bold">No documents found</p>
                  {searchQuery && <p className="text-[10px] text-[#30363d]">Try clearing the search filter</p>}
                </div>
              </div>
            )}

            {/* Load more */}
            {hasMore && !realtimeEnabled && (
              <div className="p-4 flex justify-center">
                <button
                  onClick={() => loadDocs(selectedCollection, true, lastVisible)}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10px] font-black uppercase tracking-widest text-[#8b949e] hover:text-white transition-colors disabled:opacity-40"
                >
                  {loading ? <TirangaLoader className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                  Load More
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right panel: Document detail */}
      {selectedDoc && (
        <div className="w-[300px] flex-shrink-0 border-l border-white/5 bg-[#161b22] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 flex-shrink-0">
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-black uppercase tracking-widest text-[#484f58]">Document</p>
              <p className="font-mono text-[11px] text-indigo-300 truncate mt-0.5" title={selectedDoc.id}>
                {selectedDoc.id}
              </p>
            </div>
            <button
              onClick={() => setSelectedDoc(null)}
              className="p-1 rounded hover:bg-white/10 text-[#8b949e] hover:text-white transition-colors flex-shrink-0 ml-2"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 flex flex-col p-3 gap-2 overflow-hidden min-h-0">
            <p className="text-[9px] font-black uppercase tracking-widest text-[#484f58] flex-shrink-0">Edit JSON</p>
            <textarea
              value={editJson}
              onChange={(e) => setEditJson(e.target.value)}
              className="flex-1 bg-black/60 border border-white/10 rounded-xl p-3 font-mono text-[11px] text-white outline-none focus:border-indigo-500 resize-none transition-colors min-h-0"
              spellCheck={false}
            />
            {editError && (
              <div className="flex items-start gap-1.5 bg-red-900/20 border border-red-500/30 rounded-lg p-2 flex-shrink-0">
                <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-red-300">{editError}</p>
              </div>
            )}
            <button
              onClick={handleSaveDoc}
              disabled={saving}
              className={cn(
                'flex-shrink-0 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors',
                saveSuccess
                  ? 'bg-emerald-600 text-white'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50'
              )}
            >
              {saving ? (
                <TirangaLoader className="w-3.5 h-3.5" />
              ) : saveSuccess ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {saveSuccess ? 'Saved!' : saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {/* Add Document Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[#161b22] border border-white/10 rounded-2xl w-[440px] max-w-[90vw] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-black text-white">Add New Document</span>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded hover:bg-white/10 text-[#8b949e] hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 flex flex-col gap-3">
              <p className="text-[10px] text-[#8b949e]">
                Collection: <span className="text-indigo-300 font-mono">{selectedCollection}</span>
              </p>
              <textarea
                value={newDocJson}
                onChange={(e) => setNewDocJson(e.target.value)}
                rows={10}
                className="bg-black/60 border border-white/10 rounded-xl p-3 font-mono text-[11px] text-white outline-none focus:border-indigo-500 resize-none transition-colors"
                spellCheck={false}
              />
              {newDocError && (
                <div className="flex items-start gap-1.5 bg-red-900/20 border border-red-500/30 rounded-lg p-2">
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[10px] text-red-300">{newDocError}</p>
                </div>
              )}
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-[#8b949e] hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddDoc}
                  disabled={adding}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-white bg-indigo-600 hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {adding ? <TirangaLoader className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                  {adding ? 'Adding...' : 'Add Document'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[#161b22] border border-white/10 rounded-2xl w-[380px] max-w-[90vw] shadow-2xl">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
              <Trash2 className="w-4 h-4 text-red-400" />
              <span className="text-sm font-black text-white">Delete Document</span>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-[#8b949e]">
                Are you sure you want to delete{' '}
                <span className="font-mono text-[11px] text-red-300 bg-red-500/10 px-1.5 py-0.5 rounded">
                  {deleteConfirm}
                </span>
                ? This action cannot be undone.
              </p>
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  disabled={deleting}
                  className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-[#8b949e] hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDeleteDoc(deleteConfirm)}
                  disabled={deleting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {deleting ? <TirangaLoader className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
