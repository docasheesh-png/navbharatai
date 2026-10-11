import { useState, useEffect, useCallback } from 'react';
import { Clock, RotateCcw, Save, Check, X, Loader2, History } from 'lucide-react';
import { authedHeaders } from '../../lib/authHeaders';
import { retentionNote } from '../../lib/versionRetention';
import { readVersionRestoreResponse } from '../../lib/versionRestoreClient';

// THE ONE VERSION TIMELINE (admin 2026-10-11, Q-128: "one timeline — Time Machine is the one version history;
// the History tab becomes a view of it").
//
// NavBharatAI showed a user's history twice: Time Machine listed the saved versions, and the builder's History
// tab listed git steps from inside the sandbox — two lists of the same app that did not agree. This component
// IS the timeline, and both screens render it: the same versions, from the same store, with the same Restore.
//
// 🔒 A RESTORE IS A SERVER RESTORE. It used to download the version into this browser tab and call it
// restored, while the saved app the next build reads stayed on the newer files. It now asks the server to put
// the version back into the app itself (`/api/agentv3/restore-version`), which saves the app as it was a
// moment ago first — so going back can always be undone from this same list.

export interface TimelineVersion {
  id: string;
  commitMessage: string;
  createdAt: string;
  fileCount: number;
  tier?: string;
  omittedFileCount?: number;
}

export interface VersionTimelineProps {
  /** `build_history/{historyKey}` — the app's workspace id minus this user's own prefix (`historyKeyFor`). */
  historyKey: string;
  /** Where a restore writes. Absent ⇒ the list is read-only (another app is being viewed). */
  workspaceId?: string;
  userId?: string | null;
  email?: string | null;
  /** Called with the restored file set, after the server has restored it. */
  onRestored?: (files: Record<string, string>) => void;
  /** Bump to re-read the list (a build finished, another screen saved a version). */
  refreshKey?: unknown;
  /** The builder's History tab is a narrow column. */
  dense?: boolean;
}

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

export function VersionTimeline({ historyKey, workspaceId, userId, email, onRestored, refreshKey, dense }: VersionTimelineProps) {
  const [points, setPoints] = useState<TimelineVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showSaveName, setShowSaveName] = useState(false);
  const [saveName, setSaveName] = useState('');
  const canRestore = !!workspaceId;

  const load = useCallback(async (key: string) => {
    if (!key) { setPoints([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/build-history/${encodeURIComponent(key)}`, { headers: await authedHeaders() });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setPoints([]); setLoadFailed(true); return; }
      setLoadFailed(false);
      setPoints(data && Array.isArray(data.versions) ? (data.versions as TimelineVersion[]) : []);
    } catch {
      // "We could not read your versions" and "you have none" are different facts.
      setPoints([]);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(historyKey); }, [historyKey, refreshKey, load]);
  useEffect(() => { setNote(null); setConfirmId(null); }, [historyKey]);

  const restore = async (v: TimelineVersion) => {
    if (!workspaceId) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/agentv3/restore-version', {
        method: 'POST',
        headers: await authedHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ workspaceId, versionId: v.id, userId: userId ?? undefined, email: email ?? undefined }),
      });
      const out = readVersionRestoreResponse(res.ok, await res.json().catch(() => null));
      if (out.ok) {
        onRestored?.(out.files);
        setNote({ text: out.message, ok: !out.needsRetry });
        await load(historyKey); // the version saved just before the restore is now in the list
      } else {
        setNote({ text: out.message, ok: false });
      }
    } catch {
      setNote({ text: 'Could not reach the server — nothing was changed. Please try again.', ok: false });
    } finally {
      setBusy(false);
      setConfirmId(null);
    }
  };

  const saveVersion = async () => {
    if (!historyKey || !workspaceId) return;
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch(`/api/build-history/${encodeURIComponent(historyKey)}/checkpoint`, {
        method: 'POST',
        headers: await authedHeaders({ 'Content-Type': 'application/json' }),
        // The app's OWN saved files, read on the server — never this screen's copy, which can be stale or
        // belong to the app the user was on before switching (Q-128).
        body: JSON.stringify({ name: saveName.trim() || 'Saved version', fromWorkspace: true }),
      });
      if (res.ok) { setNote({ text: 'Version saved ✓', ok: true }); await load(historyKey); }
      else setNote({ text: 'Could not save — please try again.', ok: false });
    } catch {
      setNote({ text: 'Could not reach the server — please try again.', ok: false });
    } finally {
      setSaving(false);
      setShowSaveName(false);
      setSaveName('');
    }
  };

  const pad = dense ? '' : 'px-4';
  return (
    <div className="flex flex-col min-h-0">
      {canRestore && (
        <div className={`${pad} pt-2.5 pb-1 shrink-0`}>
          {showSaveName ? (
            <div className="flex gap-2">
              <input
                autoFocus
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void saveVersion(); if (e.key === 'Escape') setShowSaveName(false); }}
                placeholder="Name this version (optional)"
                className="flex-1 min-w-0 bg-card border border-line rounded-xl px-3 py-2.5 text-sm text-ink placeholder-faint focus:outline-none focus:border-emerald-500/50"
              />
              <button onClick={() => void saveVersion()} disabled={saving}
                className="shrink-0 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-on-accent font-semibold text-sm disabled:opacity-40 flex items-center gap-1.5">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save
              </button>
              <button onClick={() => setShowSaveName(false)} className="shrink-0 px-3 rounded-xl border border-line text-muted">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button onClick={() => setShowSaveName(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-on-accent font-semibold text-sm disabled:opacity-40">
              <Save className="w-4 h-4" /> Save this version
            </button>
          )}
          <p className="text-[10px] text-faint mt-1.5 px-0.5">Every build is saved here automatically — tap Save to name a version before a big change.</p>
        </div>
      )}

      {note && (
        <div className={`${dense ? '' : 'mx-4'} mt-2 shrink-0 text-xs rounded-lg px-3 py-2 border ${note.ok ? 'text-success bg-emerald-500/10 border-emerald-500/20' : 'text-warn bg-amber-500/10 border-amber-700/40'}`}>{note.text}</div>
      )}

      <div className={`${pad} py-3`}>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-faint text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading versions…
          </div>
        ) : !historyKey ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center px-6">
            <History className="w-9 h-9 text-faint" />
            <p className="text-sm text-faint">Build an app first</p>
            <p className="text-xs text-faint">Every build you make will appear here as a version you can go back to.</p>
          </div>
        ) : points.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center px-6">
            <History className="w-9 h-9 text-faint" />
            <p className="text-sm text-faint">{loadFailed ? 'Could not load your versions' : 'No saved versions yet'}</p>
            <p className="text-xs text-faint">
              {loadFailed
                ? 'Your versions are safe — we just could not read them right now. Please try again in a moment.'
                : 'Each build is saved here automatically — your first one will show up as a version to restore.'}
            </p>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-[13px] top-3 bottom-3 w-px bg-raised" />
            <div className="flex flex-col gap-2">
              {points.map((v, i) => {
                const isLatest = i === 0;
                const confirming = confirmId === v.id;
                return (
                  <div key={v.id} className="relative pl-8">
                    <div className={`absolute left-2 top-4 w-3 h-3 rounded-full border-2 ${isLatest ? 'border-emerald-400 bg-emerald-400' : 'border-line bg-surface'}`} />
                    <div className={`rounded-xl border p-3 ${isLatest ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : 'border-line bg-card'}`}>
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate flex items-center gap-1.5">
                            <span className="truncate">{v.commitMessage || 'App version'}</span>
                            {v.tier === 'manual' && <span className="shrink-0 text-[8px] font-bold text-success bg-emerald-500/15 px-1.5 py-0.5 rounded">SAVED</span>}
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] text-faint mt-1">
                            <Clock className="w-3 h-3" /> {relativeTime(v.createdAt)}
                            {isLatest && <span className="text-success">· latest</span>}
                          </div>
                        </div>
                        {canRestore && !confirming && (
                          <button onClick={() => { setConfirmId(v.id); setNote(null); }} disabled={busy}
                            className="shrink-0 flex items-center gap-1 text-xs font-semibold text-success bg-emerald-500/15 border border-emerald-500/30 rounded-lg px-3 py-2 hover:bg-emerald-500/25 disabled:opacity-40">
                            <RotateCcw className="w-3.5 h-3.5" /> Restore
                          </button>
                        )}
                      </div>
                      {confirming && (
                        <div className="mt-2.5 pt-2.5 border-t border-line">
                          <p className="text-xs text-muted mb-2">Go back to this version? Your whole app will be put back to it. The app as it is now is saved first, so you can come forward again.</p>
                          <div className="flex gap-2">
                            <button onClick={() => void restore(v)} disabled={busy}
                              className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-on-accent font-semibold text-sm flex items-center justify-center gap-1.5 disabled:opacity-40">
                              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} Yes, go back
                            </button>
                            <button onClick={() => setConfirmId(null)} disabled={busy}
                              className="px-4 py-2.5 rounded-lg border border-line text-muted text-sm">Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* The limit is a COUNT, derived from the same constant the store enforces (versionRetention.ts). */}
            <p className="mt-4 px-0.5 text-[10px] leading-relaxed text-faint">{retentionNote(points.length)}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default VersionTimeline;
