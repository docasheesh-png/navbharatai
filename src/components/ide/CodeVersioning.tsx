import React, { useState, useEffect, useRef } from 'react';
import { GitBranch, GitCommit, Clock, RotateCcw, Save, Trash2, Check, X, Download, Plus, Edit2, GitMerge } from 'lucide-react';
import { filesHaveRealContent, isPlaceholderHtml } from '../../lib/workspaceSource';

interface Version {
  id: string;
  name: string;
  code: string;
  files?: Record<string, string>;
  timestamp: number;
  label: string;
  size: number;
}

interface Props {
  generatedCode: string;
  /** The v5-synced workspace files — the REAL app to snapshot/restore (admin autopsy 2026-07-21).
   *  Versioning used to snapshot only `generatedCode`, which is the retired placeholder in v5.0, so
   *  Save stayed disabled and restore pushed an empty string. Now a version carries the file set. */
  files?: Record<string, string>;
  /** The v5 session id — when present, Versioning uses the DURABLE, cross-device server build-history
   *  (every build is auto-saved as a restore point) instead of only per-browser localStorage. This is
   *  what makes "undo a bad change" genuinely reliable — there is always a real point to go back to. */
  sessionId?: string;
  onRestore: (code: string) => void;
  onRestoreFiles?: (files: Record<string, string>) => void;
}

/** One durable restore-point from the server build-history (metadata only; files fetched on restore). */
interface CloudVersion {
  id: string;
  commitMessage: string;
  createdAt: string;
  fileCount: number;
  tier?: string;
  isEdit?: boolean;
}

const MAX_VERSIONS = 50;
const STORAGE_KEY = 'navbharat_versions';
const AUTOSAVE_KEY = 'navbharat_autosave';

function simpleDiff(oldCode: string, newCode: string) {
  const oldLines = oldCode.split('\n');
  const newLines = newCode.split('\n');
  const maxLen = Math.max(oldLines.length, newLines.length);
  const result: { old: string; new: string; changed: boolean }[] = [];
  for (let i = 0; i < maxLen; i++) {
    const o = oldLines[i] ?? '';
    const n = newLines[i] ?? '';
    result.push({ old: o, new: n, changed: o !== n });
  }
  return result;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export function CodeVersioning({ generatedCode, files, sessionId, onRestore, onRestoreFiles }: Props) {
  // A snapshot is worth saving when there's a REAL app: either a bundled preview (non-placeholder
  // generatedCode) or real workspace files. `snapFiles` is what a version stores/restores.
  const snapFiles = filesHaveRealContent(files) ? files : undefined;
  const hasApp = !!snapFiles || !isPlaceholderHtml(generatedCode);
  const snapFingerprint = snapFiles ? JSON.stringify(snapFiles) : generatedCode;
  const [versions, setVersions] = useState<Version[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autosave, setAutosave] = useState(false);
  const [showNameInput, setShowNameInput] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [diffMode, setDiffMode] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Durable, cross-device restore points from the server build-history (every build is auto-saved here).
  const [cloudVersions, setCloudVersions] = useState<CloudVersion[]>([]);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudNote, setCloudNote] = useState('');

  const loadCloud = React.useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/build-history/${encodeURIComponent(sessionId)}`);
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (data && Array.isArray(data.versions)) setCloudVersions(data.versions as CloudVersion[]);
    } catch { /* offline — the local snapshots below still work */ }
  }, [sessionId]);

  useEffect(() => { void loadCloud(); }, [loadCloud]);

  // Save a durable, named restore-point to the server (in addition to the local snapshot).
  const saveCloudCheckpoint = async (name: string) => {
    if (!sessionId || !snapFiles) return;
    setCloudBusy(true);
    setCloudNote('');
    try {
      const res = await fetch(`/api/build-history/${encodeURIComponent(sessionId)}/checkpoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, files: snapFiles }),
      });
      if (!res.ok) { setCloudNote('Could not save to the cloud — a local copy was kept.'); return; }
      await loadCloud();
    } catch {
      setCloudNote('Offline — a local copy was kept.');
    } finally {
      setCloudBusy(false);
    }
  };

  // Restore a durable version: fetch its real files from the server and put them back into the workspace.
  const restoreCloud = async (v: CloudVersion) => {
    if (!sessionId || !onRestoreFiles) return;
    setCloudBusy(true);
    try {
      const res = await fetch(`/api/build-history/${encodeURIComponent(sessionId)}/${encodeURIComponent(v.id)}`);
      const data = await res.json().catch(() => null);
      if (res.ok && data && data.files && typeof data.files === 'object') {
        onRestoreFiles(data.files as Record<string, string>);
        setCloudNote(`Restored "${v.commitMessage}" ✓`);
      } else {
        setCloudNote('Could not load that version — please try again.');
      }
    } catch {
      setCloudNote('Could not reach the server — please try again.');
    } finally {
      setCloudBusy(false);
    }
  };

  const cloudRelTime = (iso: string): string => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? relativeTime(t) : '';
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setVersions(JSON.parse(saved));
      setAutosave(localStorage.getItem(AUTOSAVE_KEY) === 'true');
    } catch {}
  }, []);

  const persist = (vList: Version[]) => {
    setVersions(vList);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(vList)); } catch {}
  };

  useEffect(() => {
    if (!autosave || !hasApp) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const last = versions[0];
      // Dedup on the real fingerprint (files when present, else code) so identical states don't stack.
      if (last && (last.files ? JSON.stringify(last.files) : last.code) === snapFingerprint) return;
      const v: Version = {
        id: Date.now().toString(),
        name: `Auto v${versions.length + 1}`,
        code: generatedCode,
        files: snapFiles,
        timestamp: Date.now(),
        label: 'auto',
        size: snapFingerprint.length,
      };
      const updated = [v, ...versions].slice(0, MAX_VERSIONS);
      persist(updated);
    }, 3000);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapFingerprint, autosave, hasApp]);

  const saveSnapshot = () => {
    if (!hasApp) return;
    const name = newName.trim() || `Version ${versions.length + 1}`;
    const v: Version = {
      id: Date.now().toString(),
      name,
      code: generatedCode,
      files: snapFiles,
      timestamp: Date.now(),
      label: '',
      size: snapFingerprint.length,
    };
    const updated = [v, ...versions].slice(0, MAX_VERSIONS);
    persist(updated);
    // Also persist a DURABLE, cross-device restore-point to the server when we have a session.
    void saveCloudCheckpoint(name);
    setNewName('');
    setShowNameInput(false);
  };

  const deleteVersion = (id: string) => {
    const updated = versions.filter(v => v.id !== id);
    persist(updated);
    if (selectedId === id) setSelectedId(null);
  };

  const handleRename = (id: string) => {
    if (!editingName.trim()) { setEditingId(null); return; }
    const updated = versions.map(v => v.id === id ? { ...v, name: editingName.trim() } : v);
    persist(updated);
    setEditingId(null);
  };

  const toggleAutosave = () => {
    const next = !autosave;
    setAutosave(next);
    try { localStorage.setItem(AUTOSAVE_KEY, next.toString()); } catch {}
  };

  const exportAll = () => {
    const blob = new Blob([JSON.stringify(versions, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'navbharat-versions.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectedVersion = versions.find(v => v.id === selectedId);
  const diff = selectedVersion && diffMode ? simpleDiff(selectedVersion.code, generatedCode) : null;
  const totalSize = versions.reduce((a, v) => a + v.size, 0);
  const firstDate = versions.length > 0 ? new Date(versions[versions.length - 1].timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—';

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 bg-[#161b22]">
        <div className="w-10 h-10 bg-emerald-600/20 rounded-xl flex items-center justify-center">
          <GitBranch className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h2 className="font-semibold text-white text-base">Code Versioning</h2>
          <p className="text-xs text-white/40">
            {sessionId ? 'Every build auto-saved — go back to any version anytime' : 'Save snapshots and restore them anytime'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={toggleAutosave}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${
              autosave ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-white/5 border-white/10 text-white/40'
            }`}
          >
            <div className={`w-2 h-2 rounded-full ${autosave ? 'bg-emerald-400 animate-pulse' : 'bg-white/20'}`} />
            Auto-save {autosave ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Timeline */}
        <div className="w-[30%] flex flex-col border-r border-white/5 overflow-hidden">
          <div className="p-3 border-b border-white/5 flex items-center justify-between">
            <span className="text-xs text-white/40">{versions.length} versions</span>
            <button
              onClick={() => setShowNameInput(true)}
              disabled={!hasApp}
              className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Plus className="w-3 h-3" /> Save
            </button>
          </div>

          {showNameInput && (
            <div className="p-3 border-b border-white/5 bg-[#161b22]">
              <input
                autoFocus
                className="w-full bg-[#0d1117] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/50 mb-2"
                placeholder="Version name (optional)"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveSnapshot(); if (e.key === 'Escape') setShowNameInput(false); }}
              />
              <div className="flex gap-1.5">
                <button onClick={saveSnapshot} className="flex-1 py-1 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs flex items-center justify-center gap-1">
                  <Check className="w-3 h-3" /> Save
                </button>
                <button onClick={() => setShowNameInput(false)} className="px-2 py-1 bg-white/5 hover:bg-white/10 rounded-lg text-xs">
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {/* Durable, cross-device restore points (auto-saved on every build) — the reliable "undo". */}
            {sessionId && (
              <div className="border-b border-white/5 p-2">
                <div className="flex items-center justify-between px-1 mb-1">
                  <span className="text-[10px] uppercase tracking-wide text-emerald-400/80 flex items-center gap-1">
                    <GitBranch className="w-3 h-3" /> Restore points ({cloudVersions.length})
                  </span>
                  <button onClick={() => void loadCloud()} className="text-[9px] text-white/30 hover:text-white/60">Refresh</button>
                </div>
                <p className="text-[9px] text-white/20 px-1 mb-1.5">Auto-saved every build · synced across your devices</p>
                {cloudNote && <p className="text-[9px] text-emerald-300 px-1 mb-1">{cloudNote}</p>}
                {cloudVersions.length === 0 ? (
                  <p className="text-[9px] text-white/20 px-1 py-1">No builds saved yet — each build you make appears here to restore.</p>
                ) : (
                  <div className="space-y-1">
                    {cloudVersions.map((v) => (
                      <div key={v.id} className="flex items-center gap-1.5 p-1.5 rounded-lg border border-white/5 bg-[#161b22]">
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] text-white truncate flex items-center gap-1">
                            <span className="truncate">{v.commitMessage}</span>
                            {v.tier === 'manual' && <span className="shrink-0 text-[7px] text-emerald-300 bg-emerald-500/10 px-1 rounded">saved</span>}
                          </div>
                          <div className="text-[9px] text-white/30">{cloudRelTime(v.createdAt)} · {v.fileCount} file{v.fileCount === 1 ? '' : 's'}</div>
                        </div>
                        <button onClick={() => void restoreCloud(v)} disabled={cloudBusy}
                          className="shrink-0 flex items-center gap-0.5 text-[9px] px-1.5 py-1 bg-emerald-500/20 text-emerald-300 rounded-md hover:bg-emerald-500/30 disabled:opacity-40"
                          title="Put these files back into your app (undo to this point)">
                          <RotateCcw className="w-2.5 h-2.5" /> Restore
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[9px] uppercase tracking-wide text-white/20 px-1 mt-3 mb-0.5">Local quick-saves (this browser)</p>
              </div>
            )}
            {versions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2 p-4 text-center">
                <GitCommit className="w-8 h-8 text-white/10" />
                <p className="text-xs text-white/30">{sessionId ? 'No local quick-saves' : 'No versions yet'}</p>
                <p className="text-[10px] text-white/20">Tap Save to snapshot the current app.</p>
              </div>
            ) : (
              <div className="relative p-2 space-y-1">
                <div className="absolute left-[22px] top-2 bottom-2 w-px bg-white/5" />
                {versions.map((v, idx) => {
                  const isSelected = selectedId === v.id;
                  const isEditing = editingId === v.id;
                  const brightness = Math.max(0.3, 1 - idx * 0.05);
                  return (
                    <div
                      key={v.id}
                      className={`relative pl-7 group`}
                    >
                      <div className={`absolute left-3.5 top-3.5 w-3 h-3 rounded-full border-2 ${isSelected ? 'border-emerald-400 bg-emerald-400' : 'border-white/20 bg-[#0d1117]'} transition-all`}
                        style={{ opacity: brightness }}
                      />
                      <div
                        onClick={() => setSelectedId(isSelected ? null : v.id)}
                        className={`cursor-pointer p-2.5 rounded-xl border transition-all ${
                          isSelected ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-white/5 bg-[#161b22] hover:border-white/10'
                        }`}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            className="w-full bg-transparent text-xs text-white focus:outline-none border-b border-emerald-500/50 mb-1"
                            value={editingName}
                            onChange={e => setEditingName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleRename(v.id); if (e.key === 'Escape') setEditingId(null); }}
                            onBlur={() => handleRename(v.id)}
                          />
                        ) : (
                          <div className="flex items-center gap-1 mb-0.5">
                            <span className="text-xs font-medium text-white truncate flex-1">{v.name}</span>
                            {v.label === 'auto' && <span className="text-[8px] text-white/20 bg-white/5 px-1 rounded">auto</span>}
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 text-[10px] text-white/30">
                          <Clock className="w-2.5 h-2.5" />
                          <span>{relativeTime(v.timestamp)}</span>
                          <span className="ml-auto">{(v.size / 1000).toFixed(1)}k chars</span>
                        </div>
                        <div className="flex gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              if (v.files && onRestoreFiles) onRestoreFiles(v.files);
                              else onRestore(v.code);
                            }}
                            className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-md hover:bg-emerald-500/30"
                          >
                            <RotateCcw className="w-2.5 h-2.5" /> Restore
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); setEditingId(v.id); setEditingName(v.name); }}
                            className="p-0.5 text-white/30 hover:text-white/60"
                          ><Edit2 className="w-2.5 h-2.5" /></button>
                          <button
                            onClick={e => { e.stopPropagation(); deleteVersion(v.id); }}
                            className="p-0.5 text-white/30 hover:text-red-400"
                          ><Trash2 className="w-2.5 h-2.5" /></button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Middle: Diff / Code View */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-[#161b22]">
            {selectedVersion ? (
              <>
                <GitMerge className="w-3.5 h-3.5 text-white/40" />
                <span className="text-xs text-white/60">"{selectedVersion.name}"</span>
                <span className="text-[10px] text-white/30">↔ Current</span>
                <button
                  onClick={() => setDiffMode(!diffMode)}
                  className={`ml-auto text-[10px] px-2 py-1 rounded-lg border transition-all ${
                    diffMode ? 'border-amber-500/40 text-amber-300 bg-amber-500/10' : 'border-white/10 text-white/40 bg-white/5'
                  }`}
                >
                  {diffMode ? 'Diff View' : 'Code View'}
                </button>
              </>
            ) : (
              <span className="text-xs text-white/30">← Select a version to view the diff</span>
            )}
          </div>

          <div className="flex-1 overflow-auto">
            {!selectedVersion ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <GitCommit className="w-12 h-12 text-white/5" />
                <p className="text-sm text-white/20">Select a version to preview or view its diff</p>
              </div>
            ) : diff ? (
              <div className="grid grid-cols-2 h-full overflow-auto text-[10px] font-mono">
                <div className="border-r border-white/5 overflow-auto">
                  <div className="sticky top-0 bg-[#161b22] px-3 py-1.5 text-[9px] text-white/40 border-b border-white/5">{selectedVersion.name}</div>
                  {diff.map((line, i) => (
                    <div key={i} className={`px-3 py-0.5 flex gap-2 ${line.changed ? 'bg-red-500/10 text-red-300' : 'text-white/40'}`}>
                      <span className="text-white/20 select-none w-5 text-right shrink-0">{i + 1}</span>
                      <span className="break-all">{line.old || ' '}</span>
                    </div>
                  ))}
                </div>
                <div className="overflow-auto">
                  <div className="sticky top-0 bg-[#161b22] px-3 py-1.5 text-[9px] text-white/40 border-b border-white/5">Current Code</div>
                  {diff.map((line, i) => (
                    <div key={i} className={`px-3 py-0.5 flex gap-2 ${line.changed ? 'bg-emerald-500/10 text-emerald-300' : 'text-white/40'}`}>
                      <span className="text-white/20 select-none w-5 text-right shrink-0">{i + 1}</span>
                      <span className="break-all">{line.new || ' '}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="overflow-auto h-full">
                <pre className="p-4 text-[10px] font-mono text-white/50 whitespace-pre-wrap break-all">{selectedVersion.code}</pre>
              </div>
            )}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="w-[25%] flex flex-col gap-4 p-4 border-l border-white/5 overflow-y-auto">
          {/* Stats */}
          <div className="bg-[#161b22] rounded-xl p-3 border border-white/5 space-y-2">
            <p className="text-xs text-white/40 font-medium">Stats</p>
            <div className="grid grid-cols-1 gap-2">
              {[
                { label: 'Total Versions', value: versions.length },
                { label: 'Total Size', value: `${(totalSize / 1000).toFixed(1)}k chars` },
                { label: 'Oldest Save', value: firstDate },
              ].map(s => (
                <div key={s.label} className="flex items-center justify-between">
                  <span className="text-[10px] text-white/30">{s.label}</span>
                  <span className="text-[10px] text-white font-medium">{s.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Auto-save toggle */}
          <div className="bg-[#161b22] rounded-xl p-3 border border-white/5">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-white/60 font-medium">Auto-Save</p>
              <button onClick={toggleAutosave} className={`relative w-9 h-5 rounded-full transition-all ${autosave ? 'bg-emerald-500' : 'bg-white/10'}`}>
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autosave ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <p className="text-[9px] text-white/20">Auto snapshot 3 seconds after code changes</p>
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <button
              onClick={exportAll}
              disabled={versions.length === 0}
              className="w-full py-2 bg-[#161b22] hover:bg-white/5 border border-white/5 rounded-xl text-xs text-white/60 flex items-center justify-center gap-1.5 disabled:opacity-30 transition-all"
            >
              <Download className="w-3.5 h-3.5" /> Export All Versions
            </button>

            {confirmClear ? (
              <div className="space-y-1.5">
                <p className="text-[10px] text-red-400 text-center">All versions will be deleted!</p>
                <div className="flex gap-1.5">
                  <button onClick={() => { persist([]); setConfirmClear(false); setSelectedId(null); }}
                    className="flex-1 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded-lg text-xs">Delete</button>
                  <button onClick={() => setConfirmClear(false)}
                    className="flex-1 py-1.5 bg-white/5 hover:bg-white/10 text-white/40 border border-white/5 rounded-lg text-xs">Cancel</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                disabled={versions.length === 0}
                className="w-full py-2 bg-[#161b22] hover:bg-red-500/5 border border-white/5 hover:border-red-500/20 rounded-xl text-xs text-white/30 hover:text-red-400 flex items-center justify-center gap-1.5 disabled:opacity-30 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" /> Clear History
              </button>
            )}
          </div>

          {/* Tips */}
          <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-3">
            <p className="text-[10px] text-emerald-400 font-medium mb-1.5">Undo a bad change</p>
            <ul className="text-[9px] text-white/30 space-y-1">
              <li>• Every build is auto-saved as a Restore point</li>
              <li>• Made a change you don't like? Restore an earlier point to go back</li>
              <li>• Tap Save to name a checkpoint before a risky change</li>
              <li>• Restore points sync across your devices (last 50 kept)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
