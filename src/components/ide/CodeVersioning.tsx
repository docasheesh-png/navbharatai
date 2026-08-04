import React, { useState, useEffect } from 'react';
import { Clock, RotateCcw, Save, Check, X, Loader2, History, ChevronDown, FolderOpen } from 'lucide-react';
import { filesHaveRealContent } from '../../lib/workspaceSource';
import { authedHeaders } from '../../App';

// Code Versioning — "Time Machine" (admin 2026-07-24): a simple, mobile-first way for a NON-technical
// user to go back to an earlier version of their app. It reads the DURABLE, cross-device build-history
// (every build is auto-saved as a restore point). A dropdown at the top lets a user with more than one
// app pick WHICH app's history to view. No diffs, no "commit"/"chars" jargon — just plain save-points
// and a Restore button. The old 3-column developer layout was retired.

interface Props {
  generatedCode: string;
  files?: Record<string, string>;
  /** The current v5 session — its durable build-history is shown by default. */
  sessionId?: string;
  onRestore: (code: string) => void;
  onRestoreFiles?: (files: Record<string, string>) => void;
  /** Switch the workspace to another of the user's apps (so its versions become restorable). */
  onSwitchApp?: (sessionId: string) => void;
}

interface RestorePoint {
  id: string;
  commitMessage: string;
  createdAt: string;
  fileCount: number;
  tier?: string;
}
interface AppOption { sessionId: string; label: string; fileCount: number; savedAt: number; }

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hour${Math.floor(diff / 3_600_000) === 1 ? '' : 's'} ago`;
  if (diff < 172_800_000) return 'Yesterday';
  return new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export function CodeVersioning({ files, sessionId, onRestoreFiles, onSwitchApp }: Props) {
  const [apps, setApps] = useState<AppOption[]>([]);
  const [viewSession, setViewSession] = useState<string>(sessionId || '');
  const [points, setPoints] = useState<RestorePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showSaveName, setShowSaveName] = useState(false);
  const [saveName, setSaveName] = useState('');

  const snapFiles = filesHaveRealContent(files) ? files : undefined;
  const viewingCurrent = !!sessionId && viewSession === sessionId;

  // Keep the view in sync if the current app changes underneath us (e.g. after switching apps).
  useEffect(() => { if (sessionId) setViewSession(sessionId); }, [sessionId]);

  // Load the user's apps for the dropdown.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        // The route resolves the user from a Bearer token; without one it can only answer "no apps",
        // so the dropdown was permanently empty. Found while wiring the same list into the Minifier.
        const res = await fetch('/api/versioning/apps', { headers: await authedHeaders() });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (live && data && Array.isArray(data.apps)) setApps(data.apps as AppOption[]);
      } catch { /* offline — dropdown just shows the current app */ }
    })();
    return () => { live = false; };
  }, []);

  // Load the selected app's restore points.
  const loadPoints = React.useCallback(async (sid: string) => {
    if (!sid) { setPoints([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/build-history/${encodeURIComponent(sid)}`);
      const data = await res.json().catch(() => null);
      setPoints(res.ok && data && Array.isArray(data.versions) ? (data.versions as RestorePoint[]) : []);
    } catch {
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void loadPoints(viewSession); }, [viewSession, loadPoints]);

  const changeApp = (sid: string) => {
    setNote('');
    setConfirmId(null);
    setViewSession(sid);
  };

  const doRestore = async (v: RestorePoint) => {
    if (!sessionId || !onRestoreFiles) return;
    setBusy(true);
    setNote('');
    try {
      const res = await fetch(`/api/build-history/${encodeURIComponent(sessionId)}/${encodeURIComponent(v.id)}`);
      const data = await res.json().catch(() => null);
      if (res.ok && data && data.files && typeof data.files === 'object') {
        onRestoreFiles(data.files as Record<string, string>);
        setNote(`Restored "${v.commitMessage}" ✓`);
      } else {
        setNote('Could not load that version — please try again.');
      }
    } catch {
      setNote('Could not reach the server — please try again.');
    } finally {
      setBusy(false);
      setConfirmId(null);
    }
  };

  const saveVersion = async () => {
    if (!sessionId || !snapFiles) return;
    setSaving(true);
    setNote('');
    try {
      const res = await fetch(`/api/build-history/${encodeURIComponent(sessionId)}/checkpoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: saveName.trim() || 'Saved version', files: snapFiles }),
      });
      if (res.ok) { setNote('Version saved ✓'); await loadPoints(sessionId); }
      else setNote('Could not save — please try again.');
    } catch {
      setNote('Could not reach the server — please try again.');
    } finally {
      setSaving(false);
      setShowSaveName(false);
      setSaveName('');
    }
  };

  const currentApp = apps.find((a) => a.sessionId === sessionId);
  const showDropdown = apps.length > 1 || (apps.length === 1 && !viewingCurrent);

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-[#e6edf3] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/5 bg-[#161b22] shrink-0">
        <div className="w-9 h-9 rounded-xl bg-emerald-500/15 grid place-items-center shrink-0">
          <History className="w-5 h-5 text-emerald-400" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-tight">Time Machine</h2>
          <p className="text-[11px] text-white/40 leading-tight mt-0.5">Go back to an earlier version of your app</p>
        </div>
      </div>

      {/* App picker — only shown when it matters (more than one app) */}
      {showDropdown && (
        <div className="px-4 pt-3 pb-1 shrink-0">
          <label className="block text-[10px] uppercase tracking-wide text-white/35 mb-1.5">Which app?</label>
          <div className="relative">
            <select
              value={viewSession}
              onChange={(e) => changeApp(e.target.value)}
              className="w-full appearance-none bg-[#161b22] border border-white/10 rounded-xl pl-3 pr-9 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50"
            >
              {sessionId && !apps.some((a) => a.sessionId === sessionId) && (
                <option value={sessionId}>This app (current)</option>
              )}
              {apps.map((a) => (
                <option key={a.sessionId} value={a.sessionId}>
                  {a.sessionId === sessionId ? 'This app (current)' : a.label}
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-white/40 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      )}

      {/* Save this version (only for the app you're currently working on) */}
      {viewingCurrent && (
        <div className="px-4 pt-2.5 pb-1 shrink-0">
          {showSaveName ? (
            <div className="flex gap-2">
              <input
                autoFocus
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void saveVersion(); if (e.key === 'Escape') setShowSaveName(false); }}
                placeholder="Name this version (optional)"
                className="flex-1 min-w-0 bg-[#161b22] border border-white/10 rounded-xl px-3 py-3 text-sm text-white placeholder-white/25 focus:outline-none focus:border-emerald-500/50"
              />
              <button onClick={() => void saveVersion()} disabled={saving || !snapFiles}
                className="shrink-0 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-[#04120c] font-semibold text-sm disabled:opacity-40 flex items-center gap-1.5">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save
              </button>
              <button onClick={() => setShowSaveName(false)} className="shrink-0 px-3 rounded-xl border border-white/10 text-white/50">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button onClick={() => setShowSaveName(true)} disabled={!snapFiles}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-[#04120c] font-semibold text-sm disabled:opacity-40">
              <Save className="w-4 h-4" /> Save this version
            </button>
          )}
          <p className="text-[10px] text-white/25 mt-1.5 px-0.5">Every build is saved here automatically — tap Save to name a version before a big change.</p>
        </div>
      )}

      {note && (
        <div className="mx-4 mt-2 shrink-0 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">{note}</div>
      )}

      {/* Restore points list */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* Viewing another app → offer to open it */}
        {!viewingCurrent && (
          <div className="mb-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
            <p className="text-xs text-amber-300">You're viewing another app. Open it to restore any of its versions.</p>
            {onSwitchApp && (
              <button onClick={() => onSwitchApp(viewSession)}
                className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-semibold text-sm">
                <FolderOpen className="w-4 h-4" /> Open this app
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-white/40 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading versions…
          </div>
        ) : !sessionId ? (
          <div className="flex flex-col items-center justify-center gap-2 py-14 text-center px-6">
            <History className="w-9 h-9 text-white/10" />
            <p className="text-sm text-white/40">Build an app first</p>
            <p className="text-xs text-white/25">Every build you make will appear here as a version you can go back to.</p>
          </div>
        ) : points.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-14 text-center px-6">
            <History className="w-9 h-9 text-white/10" />
            <p className="text-sm text-white/40">No saved versions yet</p>
            <p className="text-xs text-white/25">Each build is saved here automatically — your first one will show up as a version to restore.</p>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-[13px] top-3 bottom-3 w-px bg-white/8" />
            <div className="flex flex-col gap-2">
              {points.map((v, i) => {
                const isLatest = i === 0;
                const confirming = confirmId === v.id;
                return (
                  <div key={v.id} className="relative pl-8">
                    <div className={`absolute left-2 top-4 w-3 h-3 rounded-full border-2 ${isLatest ? 'border-emerald-400 bg-emerald-400' : 'border-white/25 bg-[#0d1117]'}`} />
                    <div className={`rounded-xl border p-3 ${isLatest ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : 'border-white/8 bg-[#161b22]'}`}>
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate flex items-center gap-1.5">
                            <span className="truncate">{v.commitMessage || 'App version'}</span>
                            {v.tier === 'manual' && <span className="shrink-0 text-[8px] font-bold text-emerald-300 bg-emerald-500/15 px-1.5 py-0.5 rounded">SAVED</span>}
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] text-white/35 mt-1">
                            <Clock className="w-3 h-3" /> {relativeTime(v.createdAt)}
                            {isLatest && <span className="text-emerald-400/80">· latest</span>}
                          </div>
                        </div>
                        {viewingCurrent && !confirming && (
                          <button onClick={() => { setConfirmId(v.id); setNote(''); }} disabled={busy}
                            className="shrink-0 flex items-center gap-1 text-xs font-semibold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 rounded-lg px-3 py-2 hover:bg-emerald-500/25 disabled:opacity-40">
                            <RotateCcw className="w-3.5 h-3.5" /> Restore
                          </button>
                        )}
                      </div>
                      {confirming && (
                        <div className="mt-2.5 pt-2.5 border-t border-white/8">
                          <p className="text-xs text-white/60 mb-2">Go back to this version? Your current app will be replaced with it.</p>
                          <div className="flex gap-2">
                            <button onClick={() => void doRestore(v)} disabled={busy}
                              className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-[#04120c] font-semibold text-sm flex items-center justify-center gap-1.5 disabled:opacity-40">
                              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} Yes, go back
                            </button>
                            <button onClick={() => setConfirmId(null)} disabled={busy}
                              className="px-4 py-2.5 rounded-lg border border-white/10 text-white/60 text-sm">Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {currentApp && viewingCurrent && (
        <div className="shrink-0 px-4 py-2 border-t border-white/5 text-[10px] text-white/25 text-center">
          Versions sync across your devices · last 50 kept
        </div>
      )}
    </div>
  );
}

export default CodeVersioning;
