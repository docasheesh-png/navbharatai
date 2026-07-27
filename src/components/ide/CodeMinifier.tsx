import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Zap,
  Copy,
  Download,
  Check,
  Loader2,
  FolderOpen,
  FileCode,
  ChevronRight,
  ChevronDown,
  Code2,
  AlertTriangle,
  Save,
  History,
  PanelLeft,
} from 'lucide-react';
import { resolveAppSource } from '../../lib/workspaceSource';
import { authedHeaders } from '../../App';

// Code Minifier & Optimizer (admin 2026-07-26).
//
// WHAT CHANGED AND WHY. This screen used to be a bare textarea: the user had to find their own code,
// paste it in, and copy the result back out by hand. "User aise kahan se code layega?" — right. It now
// opens the user's REAL apps, lists their files, loads a file on tap, and can write the optimised
// version straight back into that file.
//
// TWO THINGS WERE DELIBERATELY REMOVED rather than carried over:
//
//  • The browser-side regex minifier. It was measurably WRONG, not merely imprecise — it cut
//    `const api = "https://…"` in half at the `//` and dropped a closing paren from any nested
//    console.log call, both producing code that will not parse. That was survivable while a human
//    eyeballed the output; it is not survivable now that "Apply" writes into a real project. All
//    minification happens on the server with esbuild (a real parser) — see src/server/lib/codeMinifier.ts.
//
//  • The per-language option checkboxes and "Beautify". The checkboxes described knobs the real
//    minifier does not expose, and Beautify was the same regex approach (it split on `;` and `{`,
//    which corrupts any string containing one). A control that does not do what it says is worse than
//    no control. What survives — "keep console.log" — is real and is honoured by the server.

export interface CodeMinifierProps {
  generatedCode?: string;
  /** The v5-synced workspace files — used only to seed the editor before an app is picked. */
  files?: Record<string, string>;
  /** The current Pro v5 session, pre-selected in the app list so the common case is one tap. */
  sessionId?: string;
  onOptimized?: (code: string) => void;
}

interface AppOption { sessionId: string; label: string; fileCount: number; savedAt: number; }
interface FileEntry { path: string; bytes: number; language: string; }

interface MinifyStats {
  originalBytes: number;
  minifiedBytes: number;
  savedBytes: number;
  savedPercent: number;
}

type PasteLanguage = 'js' | 'ts' | 'tsx' | 'css';

const PASTE_FILENAME: Record<PasteLanguage, string> = {
  js: 'pasted.js',
  ts: 'pasted.ts',
  tsx: 'pasted.tsx',
  css: 'pasted.css',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** Show the file name prominently and the folder quietly — a long path should not hide which file it is. */
function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf('/');
  return i < 0 ? { dir: '', name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) };
}

export const CodeMinifier: React.FC<CodeMinifierProps> = ({ generatedCode, files, sessionId, onOptimized }) => {
  // ── The user's apps and files (the left panel) ──────────────────────────────
  const [apps, setApps] = useState<AppOption[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [openSession, setOpenSession] = useState<string>(sessionId || '');
  const [fileList, setFileList] = useState<FileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [browserOpen, setBrowserOpen] = useState(true);

  // ── The code itself ────────────────────────────────────────────────────────
  const [inputCode, setInputCode] = useState(() => resolveAppSource(generatedCode, files).html);
  const [loadingFile, setLoadingFile] = useState(false);
  const [pasteLanguage, setPasteLanguage] = useState<PasteLanguage>('js');
  const [outputCode, setOutputCode] = useState('');
  const [stats, setStats] = useState<MinifyStats | null>(null);
  const [keepConsole, setKeepConsole] = useState(false);
  const [minifying, setMinifying] = useState(false);
  const [problem, setProblem] = useState('');

  // ── Applying back into the real file ───────────────────────────────────────
  const [applying, setApplying] = useState(false);
  const [applyNote, setApplyNote] = useState('');
  const [applyFailed, setApplyFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [usedInPreview, setUsedInPreview] = useState(false);

  const liveRef = useRef(true);
  useEffect(() => () => { liveRef.current = false; }, []);

  // Load the user's apps. Signed-out users get an empty list and simply paste code instead — the tool
  // still works, it just cannot write anything back.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch('/api/versioning/apps', { headers: await authedHeaders() });
        const data = res.ok ? await res.json().catch(() => null) : null;
        if (live && data && Array.isArray(data.apps)) setApps(data.apps as AppOption[]);
      } catch { /* offline — the paste path still works */ } finally {
        if (live) setAppsLoading(false);
      }
    })();
    return () => { live = false; };
  }, []);

  const loadFiles = useCallback(async (sid: string) => {
    if (!sid) { setFileList([]); return; }
    setFilesLoading(true);
    setProblem('');
    try {
      const res = await fetch(`/api/minify/files?sessionId=${encodeURIComponent(sid)}`, { headers: await authedHeaders() });
      const data = await res.json().catch(() => null);
      if (!liveRef.current) return;
      if (res.ok && data && Array.isArray(data.files)) setFileList(data.files as FileEntry[]);
      else { setFileList([]); setProblem(data?.error || 'Could not open that app.'); }
    } catch {
      if (liveRef.current) { setFileList([]); setProblem('Could not reach the server.'); }
    } finally {
      if (liveRef.current) setFilesLoading(false);
    }
  }, []);

  // Open the current app straight away, so a user who just built something taps once, not three times.
  useEffect(() => { if (openSession) void loadFiles(openSession); }, [openSession, loadFiles]);

  // Seed the editor from the live preview ONLY while nothing has been picked — otherwise a background
  // workspace sync would silently replace the file the user is looking at.
  useEffect(() => {
    if (selectedPath) return;
    const resolved = resolveAppSource(generatedCode, files);
    if (resolved.html) setInputCode(resolved.html);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatedCode, files]);

  const openApp = (sid: string) => {
    setOpenSession((prev) => (prev === sid ? '' : sid));
    setSelectedPath(null);
    setOutputCode('');
    setStats(null);
    setApplyNote('');
  };

  const openFile = useCallback(async (path: string) => {
    setLoadingFile(true);
    setProblem('');
    setOutputCode('');
    setStats(null);
    setApplyNote('');
    setApplyFailed(false);
    try {
      const res = await fetch(
        `/api/minify/file?sessionId=${encodeURIComponent(openSession)}&path=${encodeURIComponent(path)}`,
        { headers: await authedHeaders() },
      );
      const data = await res.json().catch(() => null);
      if (!liveRef.current) return;
      if (res.ok && typeof data?.code === 'string') {
        setInputCode(data.code);
        setSelectedPath(path);
        setBrowserOpen(false); // on a phone, get out of the way once a file is chosen
      } else {
        setProblem(data?.error || 'Could not open that file.');
      }
    } catch {
      if (liveRef.current) setProblem('Could not reach the server.');
    } finally {
      if (liveRef.current) setLoadingFile(false);
    }
  }, [openSession]);

  const handleMinify = useCallback(async () => {
    if (!inputCode.trim() || minifying) return;
    setMinifying(true);
    setProblem('');
    setApplyNote('');
    setApplyFailed(false);
    try {
      const res = await fetch('/api/minify', {
        method: 'POST',
        headers: await authedHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          code: inputCode,
          filename: selectedPath || PASTE_FILENAME[pasteLanguage],
          keepConsole,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!liveRef.current) return;
      if (!res.ok || !data) {
        setOutputCode('');
        setStats(null);
        setProblem(data?.error || 'Could not optimise that code.');
        return;
      }
      if (!data.ok) {
        // A real parser error, with the line and column — worth showing verbatim so it can be fixed.
        setOutputCode('');
        setStats(null);
        setProblem(data.error || 'That code could not be parsed, so it was left alone.');
        return;
      }
      setOutputCode(data.code);
      setStats({
        originalBytes: data.originalBytes,
        minifiedBytes: data.minifiedBytes,
        savedBytes: data.savedBytes,
        savedPercent: data.savedPercent,
      });
      if (data.savedBytes <= 0) setProblem('This file is already as small as it can get — nothing to save here.');
    } catch {
      if (liveRef.current) setProblem('Could not reach the server.');
    } finally {
      if (liveRef.current) setMinifying(false);
    }
  }, [inputCode, selectedPath, pasteLanguage, keepConsole, minifying]);

  /**
   * Write the optimised version into the user's real file.
   *
   * The server re-minifies from what is actually stored rather than trusting the text on screen, and it
   * refuses unless it has first saved — and read back — a restore point. So this button either changes
   * the file AND leaves an undo behind, or it changes nothing at all.
   */
  const handleApply = useCallback(async () => {
    if (!selectedPath || !openSession || applying) return;
    setApplying(true);
    setApplyNote('');
    setApplyFailed(false);
    try {
      const res = await fetch('/api/minify/apply', {
        method: 'POST',
        headers: await authedHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ sessionId: openSession, path: selectedPath, keepConsole }),
      });
      const data = await res.json().catch(() => null);
      if (!liveRef.current) return;
      if (!res.ok || !data?.ok) {
        setApplyFailed(true);
        setApplyNote(data?.error || 'Could not update that file. Your app is unchanged.');
        return;
      }
      if (!data.applied) {
        setApplyNote(data.reason || 'Nothing needed changing.');
        return;
      }
      setApplyNote(
        `Saved into ${splitPath(selectedPath).name} — ${formatBytes(data.savedBytes)} smaller. ${data.undoHint || ''}`.trim(),
      );
      // Show the file as it now is, and refresh its size in the list.
      setInputCode(outputCode);
      setOutputCode('');
      setStats(null);
      void loadFiles(openSession);
    } catch {
      if (liveRef.current) { setApplyFailed(true); setApplyNote('Could not reach the server. Your app is unchanged.'); }
    } finally {
      if (liveRef.current) setApplying(false);
    }
  }, [selectedPath, openSession, keepConsole, applying, outputCode, loadFiles]);

  const handleCopy = useCallback(() => {
    if (!outputCode) return;
    navigator.clipboard.writeText(outputCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [outputCode]);

  const handleDownload = useCallback(() => {
    if (!outputCode) return;
    const name = selectedPath ? splitPath(selectedPath).name : PASTE_FILENAME[pasteLanguage];
    const blob = new Blob([outputCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name.replace(/(\.\w+)$/, '.min$1');
    a.click();
    URL.revokeObjectURL(url);
  }, [outputCode, selectedPath, pasteLanguage]);

  const handleUseInPreview = useCallback(() => {
    if (!outputCode || !onOptimized) return;
    onOptimized(outputCode);
    setUsedInPreview(true);
    setTimeout(() => setUsedInPreview(false), 2000);
  }, [outputCode, onOptimized]);

  const canApply = !!selectedPath && !!openSession && !!outputCode && !!stats && stats.savedBytes > 0;
  const sourceName = selectedPath ? splitPath(selectedPath).name : 'Pasted code';

  // ── Left panel: the user's apps, and the files inside them ─────────────────
  const browser = (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#161b22' }}>
      <div
        className="flex items-center gap-2 px-3 py-2.5 border-b text-xs font-semibold text-gray-300 shrink-0"
        style={{ borderColor: 'rgba(255,255,255,0.08)' }}
      >
        <FolderOpen size={13} className="text-indigo-400" />
        Your apps
      </div>

      <div className="flex-1 overflow-y-auto">
        {appsLoading ? (
          <div className="flex items-center gap-2 px-3 py-4 text-xs text-gray-500">
            <Loader2 size={13} className="animate-spin" /> Loading your apps…
          </div>
        ) : apps.length === 0 ? (
          <p className="px-3 py-4 text-xs text-gray-500 leading-relaxed">
            No saved apps found on this account yet. You can still paste code on the right and optimise it.
          </p>
        ) : (
          apps.map((a) => {
            const open = openSession === a.sessionId;
            return (
              <div key={a.sessionId}>
                <button
                  onClick={() => openApp(a.sessionId)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left border-b hover:bg-white/5 transition-colors"
                  style={{ borderColor: 'rgba(255,255,255,0.05)' }}
                >
                  {open ? <ChevronDown size={13} className="text-indigo-400 shrink-0" /> : <ChevronRight size={13} className="text-gray-500 shrink-0" />}
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs text-gray-200 truncate">{a.label}</span>
                  </span>
                </button>

                {open && (
                  <div style={{ background: '#0d1117' }}>
                    {filesLoading ? (
                      <div className="flex items-center gap-2 px-6 py-3 text-xs text-gray-500">
                        <Loader2 size={12} className="animate-spin" /> Opening files…
                      </div>
                    ) : fileList.length === 0 ? (
                      <p className="px-6 py-3 text-xs text-gray-600">No files here that can be optimised.</p>
                    ) : (
                      fileList.map((f) => {
                        const { dir, name } = splitPath(f.path);
                        const active = selectedPath === f.path;
                        return (
                          <button
                            key={f.path}
                            onClick={() => void openFile(f.path)}
                            className={`w-full flex items-center gap-2 pl-6 pr-3 py-2 text-left transition-colors ${
                              active ? 'bg-indigo-600/20' : 'hover:bg-white/5'
                            }`}
                          >
                            <FileCode size={12} className={active ? 'text-indigo-300 shrink-0' : 'text-gray-600 shrink-0'} />
                            <span className="flex-1 min-w-0">
                              {dir && <span className="block text-[10px] text-gray-600 truncate">{dir}</span>}
                              <span className={`block text-xs truncate ${active ? 'text-indigo-200' : 'text-gray-300'}`}>{name}</span>
                            </span>
                            <span className="text-[10px] text-gray-600 shrink-0">{formatBytes(f.bytes)}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#0d1117', color: '#e6edf3' }}>
      {/* ── Header ── */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 border-b shrink-0"
        style={{ borderColor: 'rgba(255,255,255,0.1)', background: '#161b22' }}
      >
        <button
          onClick={() => setBrowserOpen((v) => !v)}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border border-white/10 hover:bg-white/5 transition-colors"
          aria-label={browserOpen ? 'Hide your apps' : 'Show your apps'}
        >
          <PanelLeft size={13} className={browserOpen ? 'text-indigo-400' : ''} />
          <span className="hidden sm:inline">Apps</span>
        </button>
        <Code2 size={16} className="text-indigo-400 shrink-0" />
        <span className="font-semibold text-sm truncate">Code Minifier &amp; Optimizer</span>
      </div>

      {/* ── Body: apps ▸ source ▸ result ── */}
      <div className="flex flex-1 overflow-hidden">
        {browserOpen && (
          <div
            className="shrink-0 border-r overflow-hidden w-56 sm:w-64"
            style={{ borderColor: 'rgba(255,255,255,0.1)' }}
          >
            {browser}
          </div>
        )}

        <div className="flex flex-1 flex-col md:flex-row overflow-hidden">
          {/* Source */}
          <div
            className="flex flex-col flex-1 overflow-hidden border-b md:border-b-0 md:border-r"
            style={{ borderColor: 'rgba(255,255,255,0.1)' }}
          >
            <div
              className="flex items-center gap-2 px-3 py-2 border-b text-xs shrink-0"
              style={{ borderColor: 'rgba(255,255,255,0.08)', background: '#161b22' }}
            >
              <span className="font-medium text-gray-200 truncate">{sourceName}</span>
              {selectedPath ? (
                <span className="text-[10px] text-gray-500 truncate hidden sm:inline">{splitPath(selectedPath).dir}</span>
              ) : (
                <select
                  value={pasteLanguage}
                  onChange={(e) => setPasteLanguage(e.target.value as PasteLanguage)}
                  className="text-[11px] rounded border border-white/10 px-1 py-0.5 outline-none"
                  style={{ background: '#0d1117', color: '#e6edf3' }}
                  aria-label="Language of the pasted code"
                >
                  <option value="js">JavaScript</option>
                  <option value="ts">TypeScript</option>
                  <option value="tsx">React (TSX)</option>
                  <option value="css">CSS</option>
                </select>
              )}
              <div className="flex-1" />
              <span className="text-gray-500 shrink-0">{formatBytes(new Blob([inputCode]).size)}</span>
            </div>

            {loadingFile ? (
              <div className="flex-1 flex items-center justify-center gap-2 text-xs text-gray-500">
                <Loader2 size={14} className="animate-spin" /> Opening file…
              </div>
            ) : (
              <textarea
                value={inputCode}
                onChange={(e) => { setInputCode(e.target.value); if (selectedPath) setSelectedPath(null); }}
                placeholder="Pick a file from your app on the left — or paste code here."
                spellCheck={false}
                className="flex-1 resize-none p-3 text-xs font-mono leading-relaxed outline-none text-gray-200 placeholder-gray-600"
                style={{ background: '#0d1117' }}
              />
            )}
          </div>

          {/* Result */}
          <div className="flex flex-col flex-1 overflow-hidden">
            <div
              className="flex items-center gap-2 px-3 py-2 border-b text-xs shrink-0"
              style={{ borderColor: 'rgba(255,255,255,0.08)', background: '#161b22' }}
            >
              <span className="font-medium text-gray-200">Optimised</span>
              <div className="flex-1" />
              {outputCode && (
                <>
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 px-2 py-0.5 rounded border border-white/10 hover:bg-white/5 transition-colors"
                  >
                    {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
                    <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                  <button
                    onClick={handleDownload}
                    className="flex items-center gap-1 px-2 py-0.5 rounded border border-white/10 hover:bg-white/5 transition-colors"
                  >
                    <Download size={11} />
                    <span className="hidden sm:inline">Download</span>
                  </button>
                </>
              )}
            </div>

            {/* THE APPLY BUTTON — the whole point of the right-hand pane. It sits above the result so a
                user who has scrolled the code is never hunting for it. */}
            {outputCode && (
              <div
                className="px-3 py-2.5 border-b shrink-0"
                style={{ borderColor: 'rgba(255,255,255,0.08)', background: '#161b22' }}
              >
                <button
                  onClick={() => void handleApply()}
                  disabled={!canApply || applying}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {applying ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {applying ? 'Saving into your app…' : `Apply to ${sourceName}`}
                </button>
                <p className="mt-1.5 text-[11px] text-gray-500 leading-snug flex items-start gap-1">
                  <History size={11} className="mt-0.5 shrink-0" />
                  {selectedPath
                    ? 'This replaces the file in your app. A restore point is saved first, so you can undo it any time from Versioning.'
                    : 'Pick a file from one of your apps on the left to save the optimised code back into it.'}
                </p>
                {onOptimized && (
                  <button
                    onClick={handleUseInPreview}
                    className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs border border-white/10 hover:bg-white/5 transition-colors"
                  >
                    {usedInPreview ? <Check size={12} className="text-green-400" /> : <Zap size={12} />}
                    {usedInPreview ? 'Loaded into preview' : 'Just try it in the preview (does not change your app)'}
                  </button>
                )}
              </div>
            )}

            {applyNote && (
              <div
                className={`px-3 py-2 text-xs border-b shrink-0 leading-snug ${applyFailed ? 'text-amber-300' : 'text-green-300'}`}
                style={{
                  borderColor: 'rgba(255,255,255,0.08)',
                  background: applyFailed ? 'rgba(245,158,11,0.08)' : 'rgba(63,185,80,0.08)',
                }}
              >
                {applyNote}
              </div>
            )}

            {outputCode ? (
              <pre
                className="flex-1 overflow-auto p-3 text-xs font-mono leading-relaxed text-green-300 whitespace-pre-wrap break-all"
                style={{ background: '#0d1117' }}
              >
                {outputCode}
              </pre>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6" style={{ background: '#0d1117' }}>
                <Zap size={28} className="text-gray-700" />
                <p className="text-xs text-gray-500 leading-relaxed">
                  The optimised code will appear here, with a button to save it into your app.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── The action bar: one obvious thing to press ── */}
      <div
        className="shrink-0 border-t px-3 py-3"
        style={{ borderColor: 'rgba(255,255,255,0.1)', background: '#161b22' }}
      >
        {problem && (
          <p className="mb-2 flex items-start gap-1.5 text-xs text-amber-300 leading-snug">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span className="break-words">{problem}</span>
          </p>
        )}

        {stats && stats.savedBytes > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-gray-400">
              {formatBytes(stats.originalBytes)} → <span className="text-indigo-300 font-semibold">{formatBytes(stats.minifiedBytes)}</span>
            </span>
            <span className="px-2 py-0.5 rounded-full bg-green-600/15 text-green-300 font-semibold">
              {stats.savedPercent.toFixed(1)}% smaller
            </span>
          </div>
        )}

        <label className="mb-2 flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none w-fit">
          <input
            type="checkbox"
            checked={keepConsole}
            onChange={(e) => setKeepConsole(e.target.checked)}
            className="accent-indigo-500"
          />
          Keep console.log lines (useful while you are still testing)
        </label>

        <button
          onClick={() => void handleMinify()}
          disabled={!inputCode.trim() || minifying}
          className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-base font-bold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {minifying ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} />}
          {minifying ? 'Optimising…' : 'Optimise this code'}
        </button>
      </div>
    </div>
  );
};
