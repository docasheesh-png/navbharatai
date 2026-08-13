/**
 * Phase 1.7 — App.tsx split, Part 6: FilesPanel
 * Phase 2.1 — Added version history tab (build checkpoints + restore).
 *
 * Two-tab panel:
 *   "Files" — project file tree with upload and download-ZIP actions.
 *   "History" — version history list; each entry has a "Restore" button.
 *
 * Owns the hidden file input ref internally.
 */
import React, { useRef, useState, useEffect } from 'react';
import { isSecretFile, maskSecretContent, maskNotice } from '../../lib/secretMask';
import { FolderOpen, Upload, Download, FileCode, ChevronRight, History, GitCommit, RotateCcw, Loader2, Plus, Trash2, Pencil, Check, X, Copy, Eye } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { listBuildHistory, fetchBuildVersion } from '../../services/buildService';
import type { VersionMeta } from '../../services/buildService';
import { SkeletonList } from '../ui/Skeleton';

export interface FileConflict {
  file: File;
  existingKey: string;
  isZip?: boolean;
}

export interface FilesPanelProps {
  files: Record<string, string>;
  hasGeneratedCode: boolean;
  fileUploadConflict: FileConflict | null;
  onResolveConflict: (resolution: 'replace' | 'merge') => void;
  onUpload: (file: File) => void;
  onDownloadZip: () => void;
  onOpenFile: (path: string) => void;
  /** Create a new empty file at a given path */
  onAddFile?: (path: string) => void;
  /** Delete a file by path */
  onDeleteFile?: (path: string) => void;
  /** Rename a file */
  onRenameFile?: (oldPath: string, newPath: string) => void;
  /** Duplicate a file — creates a copy at newPath with same content */
  onDuplicateFile?: (sourcePath: string, targetPath: string) => void;
  /** Phase 2.1 — sessionId for version history API calls */
  sessionId?: string;
  /** Phase 2.1 — called when user restores a version; parent updates workspace files */
  onRestoreVersion?: (files: Record<string, string>, commitMessage: string) => void;
  /**
   * Touch mode (admin 2026-07-07 — the v5.0 mobile footer's Files list): tapping a file opens an
   * inline action menu (Open · Copy file · Copy path · Delete) instead of opening it immediately —
   * hover-revealed actions don't exist on touch, so without this the actions were unreachable on
   * phones. Desktop (default) keeps tap-to-open + hover actions.
   */
  tapActions?: boolean;
}

const EXT_COLOR: Record<string, string> = {
  html: 'text-orange-400', css: 'text-blue-400', js: 'text-yellow-400',
  ts: 'text-cyan-400', tsx: 'text-cyan-400', json: 'text-green-400',
  md: 'text-purple-400', py: 'text-emerald-400',
};

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function FilesPanel({
  files,
  hasGeneratedCode,
  fileUploadConflict,
  onResolveConflict,
  onUpload,
  onDownloadZip,
  onOpenFile,
  onAddFile,
  onDeleteFile,
  onRenameFile,
  onDuplicateFile,
  sessionId,
  onRestoreVersion,
  tapActions,
}: FilesPanelProps) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'files' | 'history'>('files');
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  // File management state (C1–C4)
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [fileSearch, setFileSearch] = useState('');
  // Touch mode: which file's inline action menu is open, + honest copy feedback ("Copied ✓" /
  // the real failure) — a copy that silently did nothing would be a fake success.
  const [actionPath, setActionPath] = useState<string | null>(null);
  // READ-ONLY VIEWER (admin 2026-08-02): "See" shows the file exactly as it is, without opening the
  // Code Studio editor — so a user can read a file (on a phone especially) with zero risk of a stray
  // tap changing it. "Open" keeps its existing behaviour (edit in Code Studio).
  const [viewPath, setViewPathRaw] = useState<string | null>(null);
  /** Opening ANY file re-arms the mask — a Reveal on one file must never carry into the next. */
  const setViewPath = (p: string | null): void => { setRevealSecret(false); setViewPathRaw(p); };
  /** Secret files open MASKED; revealing is a deliberate tap. Reset whenever a different file opens. */
  const [revealSecret, setRevealSecret] = useState(false);
  // ONE source for what the viewer shows AND what Copy puts on the clipboard — a copy button that
  // hands over what the screen is hiding would make the mask decorative.
  const viewerRaw = viewPath && typeof files[viewPath] === 'string' ? files[viewPath] : '';
  const viewerText = viewPath && !revealSecret ? maskSecretContent(viewPath, viewerRaw) : viewerRaw;
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const copyToClipboard = (text: string, what: string) => {
    navigator.clipboard.writeText(text).then(
      () => setCopyNote(`${what} copied ✓`),
      () => setCopyNote(`Could not copy ${what.toLowerCase()} — your browser blocked clipboard access.`),
    );
    setTimeout(() => setCopyNote(null), 2000);
  };

  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (renamingPath && trimmed && trimmed !== renamingPath && onRenameFile) {
      onRenameFile(renamingPath, trimmed);
    }
    setRenamingPath(null);
    setRenameValue('');
  };

  const commitNewFile = () => {
    const trimmed = newFileName.trim();
    if (trimmed && onAddFile) onAddFile(trimmed);
    setNewFileName('');
    setShowNewFile(false);
  };

  useEffect(() => {
    if (tab !== 'history' || !sessionId) return;
    setLoadingHistory(true);
    listBuildHistory(sessionId)
      .then(setVersions)
      .finally(() => setLoadingHistory(false));
  }, [tab, sessionId]);

  const handleRestore = async (v: VersionMeta) => {
    if (!sessionId || !onRestoreVersion) return;
    setRestoringId(v.id);
    setRestoreError(null);
    try {
      const entry = await fetchBuildVersion(sessionId, v.id);
      if (!entry || !entry.files) {
        setRestoreError('Version files not found.');
        return;
      }
      onRestoreVersion(entry.files, v.commitMessage);
    } catch {
      setRestoreError('Failed to restore version. Please try again.');
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="relative flex-1 h-full overflow-hidden bg-[#0d1117] flex flex-col">
      {/* Upload conflict popup */}
      {fileUploadConflict && (
        <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center p-4" onClick={() => onResolveConflict('merge')}>
          <div className="bg-[#161b22] border border-white/10 rounded-2xl p-6 max-w-sm w-full shadow-2xl" onClick={e => e.stopPropagation()}>
            <p className="text-[13px] font-black text-white mb-1">
              {fileUploadConflict.isZip ? 'ZIP Upload' : `File Conflict: ${fileUploadConflict.file.name}`}
            </p>
            <p className="text-[11px] text-[#8b949e] mb-5">
              {fileUploadConflict.isZip
                ? 'Workspace already has files. Replace everything or merge new files alongside existing ones?'
                : `"${fileUploadConflict.existingKey}" already exists. Replace it or keep both versions?`}
            </p>
            <div className="flex gap-3">
              <button onClick={() => onResolveConflict('replace')} className="flex-1 py-2.5 rounded-xl bg-red-600/20 border border-red-500/30 text-red-400 text-[11px] font-black hover:bg-red-600/30 transition-all active:scale-95">Replace</button>
              <button onClick={() => onResolveConflict('merge')} className="flex-1 py-2.5 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 text-[11px] font-black hover:bg-indigo-600/30 transition-all active:scale-95">Merge</button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={uploadRef}
        type="file"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }}
      />

      {/* Header bar with tab switcher */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-[#161b22]">
        <div className="flex items-center gap-1 bg-white/5 rounded-lg p-0.5">
          <button
            onClick={() => setTab('files')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${tab === 'files' ? 'bg-indigo-600 text-white' : 'text-[#8b949e] hover:text-white'}`}
          >
            <FolderOpen className="w-3 h-3" /> Files
          </button>
          <button
            onClick={() => setTab('history')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${tab === 'history' ? 'bg-indigo-600 text-white' : 'text-[#8b949e] hover:text-white'}`}
          >
            <History className="w-3 h-3" /> History
          </button>
        </div>
        {tab === 'files' && (
          <div className="ml-auto flex items-center gap-2">
            {hasGeneratedCode && (
              <span className="text-[8px] text-emerald-400 font-black uppercase tracking-widest mr-1">
                {Object.keys(files).filter(k => !k.startsWith('__pending__')).length} files
              </span>
            )}
            {onAddFile && (
              <button
                onClick={() => setShowNewFile(v => !v)}
                title="New file"
                className="flex items-center gap-1 px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[9px] font-black uppercase tracking-wider text-[#8b949e] hover:text-white transition-all active:scale-95"
              >
                <Plus className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={() => uploadRef.current?.click()}
              className="flex items-center gap-1 px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[9px] font-black uppercase tracking-wider text-[#8b949e] hover:text-white transition-all active:scale-95"
              // This button already imports a whole .zip PROJECT (App.handleFilesUpload routes a zip
              // through the 5 GB chunked importer), but it said only "Upload any file" -- so a user
              // arriving with an existing project had no reason to think this was the way in.
              title="Upload a file, or a .zip of a whole project"
            >
              <Upload className="w-3 h-3" /> Upload
            </button>
            {hasGeneratedCode && (
              <button
                onClick={onDownloadZip}
                className="flex items-center gap-1 px-2.5 py-1 bg-indigo-600/20 hover:bg-indigo-600/35 border border-indigo-500/30 rounded-lg text-[9px] font-black uppercase tracking-wider text-indigo-400 hover:text-indigo-300 transition-all active:scale-95"
                title="Download all files as ZIP"
              >
                <Download className="w-3 h-3" /> ZIP
              </button>
            )}
          </div>
        )}
      </div>

      {/* Files tab */}
      {tab === 'files' && (
        <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col min-h-0">
            <div className="flex flex-col flex-1 min-h-0">
              {/* C6 — file search */}
              {hasGeneratedCode && Object.keys(files).length > 5 && (
                <div className="px-3 py-2 border-b border-white/5">
                  <input
                    value={fileSearch}
                    onChange={e => setFileSearch(e.target.value)}
                    placeholder="Filter files..."
                    className="w-full bg-white/5 border border-white/5 rounded-lg px-2 py-1 text-[10px] text-white placeholder-[#484f58] outline-none focus:border-indigo-500/40 transition-all"
                  />
                </div>
              )}
              {/* C3 — new file input */}
              {showNewFile && (
                <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2">
                  <input
                    autoFocus
                    value={newFileName}
                    onChange={e => setNewFileName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commitNewFile(); if (e.key === 'Escape') { setShowNewFile(false); setNewFileName(''); } }}
                    placeholder="filename.tsx"
                    className="flex-1 bg-white/5 border border-indigo-500/30 rounded-lg px-2 py-1 text-[10px] text-white placeholder-[#484f58] outline-none"
                  />
                  <button onClick={commitNewFile} className="p-1 text-emerald-400 hover:text-emerald-300"><Check className="w-3 h-3" /></button>
                  <button onClick={() => { setShowNewFile(false); setNewFileName(''); }} className="p-1 text-[#484f58] hover:text-white"><X className="w-3 h-3" /></button>
                </div>
              )}
              {!hasGeneratedCode ? (
                <div className="flex-1 flex items-center justify-center flex-col gap-3 text-center p-8">
                  <FolderOpen className="w-12 h-12 text-white/10" />
                  <p className="text-[11px] text-[#484f58] font-medium">No app generated yet.</p>
                  <p className="text-[9px] text-[#484f58]">Build an app in NavBharatAI v5.0 — files will appear here.</p>
                </div>
              ) : (
              <div className="p-4 space-y-1">
                {Object.entries(files)
                  .filter(([path]) => !fileSearch || path.toLowerCase().includes(fileSearch.toLowerCase()))
                  .map(([path, content]) => {
                    const ext = path.split('.').pop() || '';
                    const color = EXT_COLOR[ext] || 'text-white/50';
                    // DEFENSIVE (crash report 2026-07-07: "undefined is not an object (evaluating
                    // 'ce.split')" — the WHOLE app died at the error boundary because one map entry
                    // held a non-string). A single bad value must never take the app down: render the
                    // row with an empty body instead. Write-side guards keep the map clean; this is
                    // the belt to their braces.
                    const contentStr = typeof content === 'string' ? content : '';
                    const lines = contentStr.split('\n').length;
                    const bytes = contentStr.length;
                    const sizeLabel = bytes < 1024 ? `${bytes}B` : `${(bytes / 1024).toFixed(1)}K`;
                    const isRenaming = renamingPath === path;
                    return (
                      <div key={path} className="rounded-xl hover:bg-white/5 transition-colors">
                      <div className="group flex items-center gap-1">
                        {isRenaming ? (
                          <div className="flex-1 flex items-center gap-1 px-2 py-1.5">
                            <input
                              autoFocus
                              value={renameValue}
                              onChange={e => setRenameValue(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingPath(null); }}
                              className="flex-1 bg-white/5 border border-indigo-500/30 rounded px-1.5 py-0.5 text-[10px] text-white outline-none min-w-0"
                            />
                            <button onClick={commitRename} className="p-0.5 text-emerald-400 hover:text-emerald-300 shrink-0"><Check className="w-2.5 h-2.5" /></button>
                            <button onClick={() => setRenamingPath(null)} className="p-0.5 text-[#484f58] hover:text-white shrink-0"><X className="w-2.5 h-2.5" /></button>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={() => (tapActions ? setActionPath(actionPath === path ? null : path) : onOpenFile(path))}
                              className="flex-1 flex items-center gap-3 px-3 py-2.5 text-left min-w-0 touch-manipulation"
                            >
                              <FileCode className={`w-4 h-4 flex-shrink-0 ${color}`} />
                              <span className="text-[11px] font-medium text-[#c9d1d9] flex-1 truncate">{path}</span>
                              <span className="text-[8px] text-[#484f58] font-mono shrink-0">{lines}L · {sizeLabel}</span>
                            </button>
                            {/* C1/C2/C8/C17 — copy path, duplicate, rename, delete. Hover-revealed on
                                desktop; on touch layouts they stay visible (hover doesn't exist there). */}
                            <div className="flex items-center gap-0.5 pr-2 opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
                              {/* "See" (admin 2026-08-02) — read-only view, parity with the touch menu so
                                  desktop users can read a file without opening the editor either. */}
                              <button
                                onClick={() => setViewPath(path)}
                                title="View read-only"
                                className="p-1 text-[#484f58] hover:text-emerald-400 rounded transition-colors"
                              >
                                <Eye className="w-2.5 h-2.5" />
                              </button>
                              <button
                                onClick={() => navigator.clipboard.writeText(path).catch(() => {})}
                                title="Copy file path"
                                className="p-1 text-[#484f58] hover:text-white rounded transition-colors"
                              >
                                <Copy className="w-2.5 h-2.5" />
                              </button>
                              {/* C17: Duplicate file */}
                              {onDuplicateFile && (
                                <button
                                  onClick={() => {
                                    const dotIdx = path.lastIndexOf('.');
                                    const copyPath = dotIdx > 0
                                      ? `${path.slice(0, dotIdx)}-copy${path.slice(dotIdx)}`
                                      : `${path}-copy`;
                                    onDuplicateFile(path, copyPath);
                                  }}
                                  title="Duplicate file"
                                  className="p-1 text-[#484f58] hover:text-white rounded transition-colors"
                                >
                                  <Plus className="w-2.5 h-2.5" />
                                </button>
                              )}
                              {onRenameFile && (
                                <button
                                  onClick={() => { setRenamingPath(path); setRenameValue(path); }}
                                  title="Rename"
                                  className="p-1 text-[#484f58] hover:text-white rounded transition-colors"
                                >
                                  <Pencil className="w-2.5 h-2.5" />
                                </button>
                              )}
                              {onDeleteFile && (
                                <button
                                  onClick={() => { if (window.confirm(`Delete ${path}?`)) onDeleteFile(path); }}
                                  title="Delete"
                                  className="p-1 text-[#484f58] hover:text-red-400 rounded transition-colors"
                                >
                                  <Trash2 className="w-2.5 h-2.5" />
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                      {/* Touch mode — inline action menu (admin 2026-07-07): Open · Copy file ·
                          Copy path · Delete. Real full-width buttons (guaranteed tap→click on iOS). */}
                      {tapActions && actionPath === path && !isRenaming && (
                        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5">
                          <button
                            onClick={() => { setActionPath(null); setViewPath(path); }}
                            title="View this file read-only (no editing)"
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-[10px] font-semibold text-emerald-300 touch-manipulation"
                          >
                            <Eye className="w-3 h-3" /> See
                          </button>
                          <button
                            onClick={() => { setActionPath(null); onOpenFile(path); }}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-[10px] font-semibold text-indigo-300 touch-manipulation"
                          >
                            <FileCode className="w-3 h-3" /> Open
                          </button>
                          <button
                            onClick={() => copyToClipboard(contentStr, 'File')}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[10px] font-semibold text-[#c9d1d9] touch-manipulation"
                          >
                            <Copy className="w-3 h-3" /> Copy file
                          </button>
                          <button
                            onClick={() => copyToClipboard(path, 'Path')}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[10px] font-semibold text-[#c9d1d9] touch-manipulation"
                          >
                            <Copy className="w-3 h-3" /> Copy path
                          </button>
                          {onDeleteFile && (
                            <button
                              onClick={() => { if (window.confirm(`Delete ${path}?`)) { setActionPath(null); onDeleteFile(path); } }}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/40 text-[10px] font-semibold text-red-300 touch-manipulation"
                            >
                              <Trash2 className="w-3 h-3" /> Delete
                            </button>
                          )}
                          {copyNote && <span className="text-[10px] text-emerald-400">{copyNote}</span>}
                        </div>
                      )}
                      </div>
                    );
                  })}
              </div>
              )}
            </div>
        </div>
      )}

      {/* History tab */}
      {tab === 'history' && (
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
          {loadingHistory ? (
            <SkeletonList count={5} />
          ) : versions.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <History className="w-12 h-12 text-white/10" />
              <p className="text-[11px] text-[#484f58] font-medium">No build history yet.</p>
              <p className="text-[9px] text-[#484f58]">Every successful build creates a checkpoint here.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[9px] text-[#484f58] font-black uppercase tracking-widest mb-3">{versions.length} checkpoint{versions.length !== 1 ? 's' : ''}</p>
              {restoreError && (
                <p className="text-[10px] text-red-400 bg-red-900/20 border border-red-500/20 rounded-xl px-3 py-2 mb-2">{restoreError}</p>
              )}
              {versions.map((v, i) => (
                <div key={v.id} className="bg-[#161b22] border border-white/5 rounded-xl p-3 flex items-start gap-3 group">
                  <div className="mt-0.5 flex-shrink-0">
                    <GitCommit className={`w-3.5 h-3.5 ${v.isEdit ? 'text-amber-400' : 'text-emerald-400'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold text-[#c9d1d9] truncate" title={v.commitMessage}>{v.commitMessage}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[8px] text-[#484f58]">{formatRelativeTime(v.createdAt)}</span>
                      <span className="text-[8px] text-[#484f58]">·</span>
                      <span className="text-[8px] text-[#484f58]">{v.fileCount} files</span>
                      {v.tier && <span className="text-[8px] text-[#484f58]">· {v.tier}</span>}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[7px] text-[#484f58] font-mono bg-white/5 px-1.5 py-0.5 rounded">
                        v{versions.length - i}
                      </span>
                    </div>
                  </div>
                  {onRestoreVersion && (
                    <button
                      onClick={() => handleRestore(v)}
                      disabled={restoringId === v.id}
                      className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 text-[8px] font-black hover:bg-indigo-600/35 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      title={`Restore to version ${versions.length - i}`}
                    >
                      {restoringId === v.id ? (
                        <TirangaLoader className="w-2.5 h-2.5" />
                      ) : (
                        <RotateCcw className="w-2.5 h-2.5" />
                      )}
                      Restore
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* READ-ONLY FILE VIEWER (admin 2026-08-02) — the "See" action. Shows the file exactly as stored,
          with NO editable surface at all: it renders into a <pre>, so there is no input, no textarea and
          no save path a stray tap could reach. "Open" still hands the file to the Code Studio editor. */}
      {viewPath !== null && (
        <div
          className="absolute inset-0 z-30 flex flex-col bg-[#0d1117]"
          role="dialog"
          aria-modal="true"
          aria-label={`Viewing ${viewPath}`}
        >
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/10 bg-[#161b22]">
            <Eye className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
            <span className="text-[11px] font-semibold text-[#c9d1d9] truncate flex-1" title={viewPath}>
              {viewPath}
            </span>
            <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30">
              READ ONLY
            </span>
            {/* REVEAL, not "always show" (incident 2026-08-06). A screenshot taken to show a build
                problem carried a live database password out of the app. Seeing your own secret is a
                deliberate act; having it on screen while you photograph something else is not. */}
            {isSecretFile(viewPath) && (
              <button
                onClick={() => setRevealSecret((v) => !v)}
                title={revealSecret ? 'Hide the values again' : 'Reveal the values'}
                className="flex-shrink-0 px-2 py-1 rounded-lg text-[10px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-colors touch-manipulation"
              >
                {revealSecret ? 'Hide' : 'Reveal'}
              </button>
            )}
            <button
              onClick={() => copyToClipboard(viewerText, 'File')}
              title="Copy file contents"
              className="flex-shrink-0 p-1.5 rounded-lg text-[#8b949e] hover:text-white hover:bg-white/5 transition-colors touch-manipulation"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewPath(null)}
              title="Close"
              aria-label="Close file viewer"
              className="flex-shrink-0 p-1.5 rounded-lg text-[#8b949e] hover:text-white hover:bg-white/5 transition-colors touch-manipulation"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-auto custom-scrollbar">
            <pre className="p-3 text-[11px] leading-relaxed text-[#c9d1d9] font-mono whitespace-pre-wrap break-words select-text">
              {viewerText.length > 0 ? viewerText : '(this file is empty)'}
            </pre>
            {isSecretFile(viewPath) && !revealSecret && (
              <p className="px-3 pb-3 text-[10px] text-amber-300/80 leading-relaxed">{maskNotice(viewPath)}</p>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-white/10 bg-[#161b22]">
            {copyNote
              ? <span className="text-[10px] text-emerald-400">{copyNote}</span>
              : <span className="text-[10px] text-[#484f58]">Viewing only — nothing here can change the file.</span>}
            <button
              onClick={() => { const p = viewPath; setViewPath(null); onOpenFile(p); }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-[10px] font-semibold text-indigo-300 touch-manipulation"
            >
              <FileCode className="w-3 h-3" /> Edit in Code Studio
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
