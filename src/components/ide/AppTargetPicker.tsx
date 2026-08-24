import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, FolderOpen, FileCode, AlertTriangle } from 'lucide-react';
import { authedHeaders } from '../../lib/authHeaders';
// "Which app, and which file?" — the one shared answer for every Design & Build tool.
//
// WHY THIS EXISTS (admin 2026-07-27): Multi-Page, Components, Design System, Dark Mode and Figma each
// offered a button that put something "into your app", but none of them let the user CHOOSE the app —
// they silently used whatever preview happened to be open — and none of them wrote to the real
// project, only to the in-memory preview. Giving five tools five separate pickers would guarantee
// five subtly different behaviours, so the choice, the loading states and the save all live here.
//
// It is built as stacked dropdowns rather than a sidebar on purpose. The tools it replaces used
// fixed-width side panels (220px + 300px in the Component Library alone) which leave nothing on a
// 360px phone. A native <select> is the one control that is genuinely comfortable on a phone.

export interface AppOption {
  sessionId: string;
  label: string;
  fileCount: number;
  savedAt: number;
}

export interface AppFile {
  path: string;
  bytes: number;
  /** False for files a tool must not author — images, lockfiles, anything outside the project. */
  writable: boolean;
}

export interface SaveOutcome {
  ok: boolean;
  written: string[];
  /** The version this change can be undone from, or null when the app had nothing to protect yet. */
  versionId: string | null;
  /** True when the files already held exactly this content, so nothing needed changing. */
  unchanged: boolean;
  undoHint?: string;
  error?: string;
}

/**
 * Write files into one of the user's real apps.
 *
 * The server saves a restore point and proves it holds the originals before overwriting anything,
 * then reads the write back — so a resolved call here genuinely means the app changed. Every tool
 * routes its "put this into my app" button through this one function.
 */
export async function saveFilesToApp(
  sessionId: string,
  files: Record<string, string>,
  label: string,
): Promise<SaveOutcome> {
  try {
    const res = await fetch('/api/workspace/write', {
      method: 'POST',
      headers: await authedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sessionId, files, label }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      return {
        ok: false,
        written: [],
        versionId: null,
        unchanged: false,
        error: data?.error || 'Could not save into your app. Nothing was changed.',
      };
    }
    return {
      ok: true,
      written: Array.isArray(data.written) ? data.written : [],
      versionId: data.versionId ?? null,
      unchanged: data.unchanged === true,
      undoHint: data.undoHint,
    };
  } catch {
    return {
      ok: false,
      written: [],
      versionId: null,
      unchanged: false,
      error: 'Could not reach the server. Your app is unchanged.',
    };
  }
}

/** Load the signed-in user's apps, pre-selecting the one they are currently working on. */
export function useUserApps(preferredSessionId?: string) {
  const [apps, setApps] = useState<AppOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>(preferredSessionId || '');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch('/api/workspace/apps', { headers: await authedHeaders() });
        const data = res.ok ? await res.json().catch(() => null) : null;
        if (!live) return;
        const list: AppOption[] = data && Array.isArray(data.apps) ? data.apps : [];
        setApps(list);
        // Fall back to the most recent app so a first-time user still has a sensible target.
        setSelected((prev) => (prev && list.some((a) => a.sessionId === prev) ? prev : list[0]?.sessionId || ''));
      } catch {
        /* offline — the picker shows its "no apps" state, and tools stay usable without saving */
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, []);

  // If the user switches app in the main workspace while a tool is open, follow them.
  useEffect(() => {
    if (preferredSessionId) setSelected((prev) => prev || preferredSessionId);
  }, [preferredSessionId]);

  return { apps, loading, selected, setSelected };
}

/** Load one app's files. `reload` is exposed so a tool can refresh after it writes. */
export function useAppFiles(sessionId: string) {
  const [files, setFiles] = useState<AppFile[]>([]);
  const [loading, setLoading] = useState(false);
  const liveRef = useRef(true);
  useEffect(() => () => { liveRef.current = false; }, []);

  const reload = useCallback(async (sid: string) => {
    if (!sid) { setFiles([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/workspace/files?sessionId=${encodeURIComponent(sid)}`, {
        headers: await authedHeaders(),
      });
      const data = await res.json().catch(() => null);
      if (!liveRef.current) return;
      setFiles(res.ok && data && Array.isArray(data.files) ? (data.files as AppFile[]) : []);
    } catch {
      if (liveRef.current) setFiles([]);
    } finally {
      if (liveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(sessionId); }, [sessionId, reload]);

  return { files, loading, reload };
}

/** Read one file's current source — for tools that modify existing content rather than add to it. */
export async function readAppFile(sessionId: string, path: string): Promise<string | null> {
  try {
    const res = await fetch(
      `/api/workspace/file?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`,
      { headers: await authedHeaders() },
    );
    const data = await res.json().catch(() => null);
    return res.ok && typeof data?.code === 'string' ? data.code : null;
  } catch {
    return null;
  }
}

const selectStyle: React.CSSProperties = {
  background: 'var(--surface-base)',
  color: 'var(--text-body)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 8,
  padding: '10px 12px',
  fontSize: 13,
  width: '100%',
  // 16px would be ideal to stop iOS zooming on focus, but 13px matches the surrounding tools; the
  // viewport is already locked with maximum-scale in index.html, so focus does not zoom here.
  outline: 'none',
  appearance: 'none',
};

export interface AppTargetPickerProps {
  sessionId: string;
  onSessionChange: (sessionId: string) => void;
  /** Omit both file props to pick only an app (for tools that write a fixed set of paths). */
  selectedPath?: string;
  onPathChange?: (path: string) => void;
  /** Narrow the file list to what this particular tool can meaningfully change. */
  fileFilter?: (file: AppFile) => boolean;
  /** Files the tool will create; shown as choices even though they do not exist yet. */
  newPathOptions?: string[];
  /** Label above the file dropdown, e.g. "Add the component to". */
  fileLabel?: string;
  files: AppFile[];
  filesLoading: boolean;
  apps: AppOption[];
  appsLoading: boolean;
}

/**
 * The picker itself: app on top, file below, both full-width so they work on the narrowest phone.
 * It renders an honest empty state rather than an empty dropdown when the user has no apps yet.
 */
export const AppTargetPicker: React.FC<AppTargetPickerProps> = ({
  sessionId, onSessionChange, selectedPath, onPathChange, fileFilter, newPathOptions,
  fileLabel = 'File to change', files, filesLoading, apps, appsLoading,
}) => {
  const choices = useMemo(() => {
    const existing = files.filter((f) => f.writable && (!fileFilter || fileFilter(f))).map((f) => f.path);
    const extra = (newPathOptions || []).filter((p) => !existing.includes(p));
    return { existing, extra };
  }, [files, fileFilter, newPathOptions]);

  if (appsLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-xs text-gray-500">
        <Loader2 size={13} className="animate-spin" /> Loading your apps…
      </div>
    );
  }

  if (apps.length === 0) {
    return (
      <div className="flex items-start gap-2 px-3 py-3 text-xs text-amber-300 leading-relaxed">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        <span>
          No saved apps found on this account. Build an app with NavBharatAI Pro first — then this tool
          can save changes straight into it.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <label className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          <FolderOpen size={11} className="text-indigo-400" /> Your app
        </span>
        <select value={sessionId} onChange={(e) => onSessionChange(e.target.value)} style={selectStyle}>
          {apps.map((a) => (
            <option key={a.sessionId} value={a.sessionId}>{a.label}</option>
          ))}
        </select>
      </label>

      {onPathChange && (
        <label className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            <FileCode size={11} className="text-indigo-400" /> {fileLabel}
          </span>
          {filesLoading ? (
            <span className="flex items-center gap-2 text-xs text-gray-500 py-2">
              <Loader2 size={12} className="animate-spin" /> Opening files…
            </span>
          ) : choices.existing.length === 0 && choices.extra.length === 0 ? (
            <span className="text-xs text-gray-500 py-2">This app has no file this tool can change.</span>
          ) : (
            <select value={selectedPath || ''} onChange={(e) => onPathChange(e.target.value)} style={selectStyle}>
              <option value="" disabled>Choose a file…</option>
              {choices.existing.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
              {choices.extra.map((p) => (
                <option key={p} value={p}>{p} (new file)</option>
              ))}
            </select>
          )}
        </label>
      )}
    </div>
  );
};
