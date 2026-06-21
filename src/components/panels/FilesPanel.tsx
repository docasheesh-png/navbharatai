/**
 * Phase 1.7 — App.tsx split, Part 6: FilesPanel
 *
 * Extracted from App.tsx (was the `activeView === 'files'` block, ~91 lines).
 * Shows the project file tree with upload and download-ZIP actions.
 * Owns the hidden file input ref internally.
 */
import React, { useRef } from 'react';
import { FolderOpen, Upload, Download, FileCode, ChevronRight } from 'lucide-react';

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
}

const EXT_COLOR: Record<string, string> = {
  html: 'text-orange-400', css: 'text-blue-400', js: 'text-yellow-400',
  ts: 'text-cyan-400', tsx: 'text-cyan-400', json: 'text-green-400',
  md: 'text-purple-400', py: 'text-emerald-400',
};

export function FilesPanel({
  files,
  hasGeneratedCode,
  fileUploadConflict,
  onResolveConflict,
  onUpload,
  onDownloadZip,
  onOpenFile,
}: FilesPanelProps) {
  const uploadRef = useRef<HTMLInputElement>(null);

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

      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-[#161b22]">
        <FolderOpen className="w-4 h-4 text-indigo-400" />
        <span className="text-[10px] font-black uppercase tracking-widest text-[#8b949e]">Project Files</span>
        <div className="ml-auto flex items-center gap-2">
          {hasGeneratedCode && (
            <span className="text-[8px] text-emerald-400 font-black uppercase tracking-widest mr-1">
              {Object.keys(files).filter(k => !k.startsWith('__pending__')).length} files
            </span>
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
              <Download className="w-3 h-3" /> Download ZIP
            </button>
          )}
        </div>
      </div>

      {/* File list */}
      {!hasGeneratedCode ? (
        <div className="flex-1 flex items-center justify-center flex-col gap-3 text-center p-8">
          <FolderOpen className="w-12 h-12 text-white/10" />
          <p className="text-[11px] text-[#484f58] font-medium">No app generated yet.</p>
          <p className="text-[9px] text-[#484f58]">Build an app in NavBharatAI Pro — files will appear here.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
          <div className="space-y-1">
            {Object.entries(files).map(([path, content]) => {
              const ext = path.split('.').pop() || '';
              const color = EXT_COLOR[ext] || 'text-white/50';
              const lines = (content as string).split('\n').length;
              return (
                <button
                  key={path}
                  onClick={() => onOpenFile(path)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors group text-left"
                >
                  <FileCode className={`w-4 h-4 flex-shrink-0 ${color}`} />
                  <span className="text-[11px] font-medium text-[#c9d1d9] flex-1 truncate">{path}</span>
                  <span className="text-[8px] text-[#484f58] font-mono">{lines}L</span>
                  <ChevronRight className="w-3 h-3 text-white/20 group-hover:text-white/50 transition-colors" />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
