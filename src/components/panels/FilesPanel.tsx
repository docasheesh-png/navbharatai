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
import { FolderOpen, Upload, Download, FileCode, ChevronRight, History, GitCommit, RotateCcw, Loader2, Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { listBuildHistory, fetchBuildVersion } from '../../services/buildService';
import type { VersionMeta } from '../../services/buildService';

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
  /** Phase 2.1 — sessionId for version history API calls */
  sessionId?: string;
  /** Phase 2.1 — called when user restores a version; parent updates workspace files */
  onRestoreVersion?: (files: Record<string, string>, commitMessage: string) => void;
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
  sessionId,
  onRestoreVersion,
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
    <div className="flex-1 h-full overflow-hidden bg-[#0d1117] flex flex-col">
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
              title="Upload any file"
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
                  <p className="text-[9px] text-[#484f58]">Build an app in NavBharatAI v2.0 — files will appear here.</p>
                </div>
              ) : (
              <div className="p-4 space-y-1">
                {Object.entries(files)
                  .filter(([path]) => !fileSearch || path.toLowerCase().includes(fileSearch.toLowerCase()))
                  .map(([path, content]) => {
                    const ext = path.split('.').pop() || '';
                    const color = EXT_COLOR[ext] || 'text-white/50';
                    const lines = (content as string).split('\n').length;
                    const isRenaming = renamingPath === path;
                    return (
                      <div key={path} className="group flex items-center gap-1 rounded-xl hover:bg-white/5 transition-colors">
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
                              onClick={() => onOpenFile(path)}
                              className="flex-1 flex items-center gap-3 px-3 py-2.5 text-left min-w-0"
                            >
                              <FileCode className={`w-4 h-4 flex-shrink-0 ${color}`} />
                              <span className="text-[11px] font-medium text-[#c9d1d9] flex-1 truncate">{path}</span>
                              <span className="text-[8px] text-[#484f58] font-mono shrink-0">{lines}L</span>
                            </button>
                            {/* C1/C2 — rename + delete (appear on hover) */}
                            <div className="flex items-center gap-0.5 pr-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
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
            <div className="flex items-center justify-center gap-2 py-12 text-[#484f58]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-[10px]">Loading history…</span>
            </div>
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
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
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
    </div>
  );
}
