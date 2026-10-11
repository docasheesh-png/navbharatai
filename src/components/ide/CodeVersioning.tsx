import { useState, useEffect } from 'react';
import { History, ChevronDown, FolderOpen } from 'lucide-react';
import { authedHeaders } from '../../lib/authHeaders';
import { VersionTimeline } from '../versions/VersionTimeline';
// Code Versioning — "Time Machine" (admin 2026-07-24): a simple, mobile-first way for a NON-technical
// user to go back to an earlier version of their app. It reads the DURABLE, cross-device build-history
// (every build is auto-saved as a restore point). A dropdown at the top lets a user with more than one
// app pick WHICH app's history to view. No diffs, no "commit"/"chars" jargon — just plain save-points
// and a Restore button. The old 3-column developer layout was retired.
//
// 🔒 SINCE 2026-10-11 (Q-128, "one timeline") THE LIST IS `VersionTimeline` — the same component the
// builder's History tab renders — and Restore is the server restore that puts the version back into the
// app itself. It used to download the version into this tab and call that restored; the saved app the
// next build reads stayed on the newer files.

interface Props {
  generatedCode: string;
  files?: Record<string, string>;
  /** The current app's history key (`historyKeyFor` of the builder's workspace) — shown by default. */
  sessionId?: string;
  /** The current app's workspace — where a restore writes. */
  workspaceId?: string;
  userId?: string | null;
  email?: string | null;
  onRestore: (code: string) => void;
  /** Called with the restored files once the server has put the version back. */
  onRestoreFiles?: (files: Record<string, string>) => void;
  /** Switch the workspace to another of the user's apps (so its versions become restorable). */
  onSwitchApp?: (sessionId: string) => void;
}

interface AppOption { sessionId: string; label: string; fileCount: number; savedAt: number; }

export function CodeVersioning({ sessionId, workspaceId, userId, email, onRestoreFiles, onSwitchApp }: Props) {
  const [apps, setApps] = useState<AppOption[]>([]);
  const [viewSession, setViewSession] = useState<string>(sessionId || '');

  const viewingCurrent = !!sessionId && viewSession === sessionId;

  // Keep the view in sync if the current app changes underneath us (e.g. after switching apps).
  useEffect(() => { if (sessionId) setViewSession(sessionId); }, [sessionId]);

  // 🔴 THE SELECT SHOWED ONE APP AND THE LIST ASKED ABOUT NONE (2026-09-20). With no app open,
  // `viewSession` stayed empty while the browser rendered the first <option> — so the screen named an
  // app of 20 files and, underneath it, "No saved versions yet". That sentence is a claim about the
  // user's app; the truth was that no request had been made. Selecting the first app makes what is
  // DISPLAYED and what is QUERIED the same thing by construction.
  useEffect(() => {
    if (!viewSession && apps.length > 0) setViewSession(apps[0].sessionId);
  }, [apps, viewSession]);

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

  const showDropdown = apps.length > 1 || (apps.length === 1 && !viewingCurrent);

  return (
    <div className="h-full flex flex-col bg-surface text-body overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-line bg-card shrink-0">
        <div className="w-9 h-9 rounded-xl bg-emerald-500/15 grid place-items-center shrink-0">
          <History className="w-5 h-5 text-success" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-tight">Time Machine</h2>
          <p className="text-[11px] text-faint leading-tight mt-0.5">Go back to an earlier version of your app</p>
        </div>
      </div>

      {/* App picker — only shown when it matters (more than one app) */}
      {showDropdown && (
        <div className="px-4 pt-3 pb-1 shrink-0">
          <label className="block text-[10px] uppercase tracking-wide text-faint mb-1.5">Which app?</label>
          <div className="relative">
            <select
              value={viewSession}
              onChange={(e) => setViewSession(e.target.value)}
              className="w-full appearance-none bg-card border border-line rounded-xl pl-3 pr-9 py-3 text-sm text-ink focus:outline-none focus:border-emerald-500/50"
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
            <ChevronDown className="w-4 h-4 text-faint absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {/* Viewing another app → offer to open it */}
        {!viewingCurrent && viewSession && (
          <div className="mx-4 mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
            <p className="text-xs text-warn">You're viewing another app. Open it to restore any of its versions.</p>
            {onSwitchApp && (
              <button onClick={() => onSwitchApp(viewSession)}
                className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-warn font-semibold text-sm">
                <FolderOpen className="w-4 h-4" /> Open this app
              </button>
            )}
          </div>
        )}

        {/* THE one timeline (Q-128). A restore writes only into the app that is open here. */}
        <VersionTimeline
          historyKey={viewSession}
          workspaceId={viewingCurrent ? workspaceId : undefined}
          userId={userId}
          email={email}
          onRestored={onRestoreFiles}
        />
      </div>

      {viewingCurrent && (
        <div className="shrink-0 px-4 py-2 border-t border-line text-[10px] text-faint text-center">
          The same versions are in the builder's History tab · they sync across your devices
        </div>
      )}
    </div>
  );
}

export default CodeVersioning;
