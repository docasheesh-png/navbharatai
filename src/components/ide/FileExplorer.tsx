import React, { useState, useEffect } from 'react';
import {
  FolderOpen, FileCode, Plus, FilePlus, FolderPlus,
  ChevronRight, ChevronDown, MoreVertical, Trash2,
  Edit2, HardDrive, Search, ArrowUpDown, SortAsc, Github, Lock, Image,
  CheckSquare, Square, X, AlertTriangle
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { svgPreviewSrc } from '../../lib/svgPreview';
import { motion, AnimatePresence } from 'motion/react';
import { requiresTypedConfirm, isTypedConfirmValid, canProceedWithDelete, DELETE_CONFIRM_WORD } from '../../lib/deleteConfirm';

interface FileExplorerProps {
  files: Record<string, string>;
  activeFile: string;
  onFileSelect: (path: string) => void;
  onFileDelete: (path: string) => void;
  /** Batch delete (multi-select / delete-all). Falls back to per-file onFileDelete if absent. */
  onFilesDelete?: (paths: string[]) => void;
  onFileCreate: (name: string) => void;
  onFileRename: (oldPath: string, newName: string) => void;
  /** C22: Tabs with unsaved changes — shows amber dot on affected files */
  dirtyTabs?: Set<string>;
  /** J19: GitHub repo URL for "Open in GitHub" link (e.g. "https://github.com/user/repo") */
  githubRepoUrl?: string;
  /** J19: Branch name for GitHub file links */
  githubBranch?: string;
}

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: Record<string, FileNode>;
}

// A20: files that should be treated as read-only (auto-generated / lock files)
const READ_ONLY_PATTERNS = /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.DS_Store|.*\.min\.(js|css)|.*\.d\.ts)$/;
function isReadOnly(name: string): boolean {
  return READ_ONLY_PATTERNS.test(name);
}

// C10: image file extensions for preview
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.avif']);
function isImageFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot !== -1 && IMAGE_EXTS.has(name.slice(dot).toLowerCase());
}

export const FileExplorer: React.FC<FileExplorerProps> = ({
  files,
  activeFile,
  onFileSelect,
  onFileDelete,
  onFilesDelete,
  onFileCreate,
  onFileRename,
  dirtyTabs,
  githubRepoUrl,
  githubBranch = 'main',
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddingFile, setIsAddingFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['']));
  // Multi-select delete: a select mode with per-file checkboxes + select-all + delete-all,
  // confirmed through a real modal (never the native confirm()).
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Paths queued for the confirmation dialog (null = closed). Empty array never opens.
  const [confirmPaths, setConfirmPaths] = useState<string[] | null>(null);
  // Type-to-confirm text for a BULK delete (2+ files) — the delete stays disabled until this === "delete",
  // so an accidental click can never wipe every file (admin-mandated 2026-07-17). Reset whenever the
  // dialog opens or closes so a prior confirmation never carries over to the next delete.
  const [confirmText, setConfirmText] = useState('');
  useEffect(() => { setConfirmText(''); }, [confirmPaths]);

  const allFilePaths = Object.keys(files);

  const toggleSelected = (path: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()); };

  // Perform the delete once confirmed — batch when possible, else per-file.
  const performDelete = (paths: string[]) => {
    if (paths.length === 0) return;
    // Defense in depth: a bulk delete never proceeds unless the user physically typed "delete" — even if
    // the button were somehow triggered, the data is not touched until the typed word matches.
    if (!canProceedWithDelete(paths.length, confirmText)) return;
    if (onFilesDelete) onFilesDelete(paths);
    else paths.forEach(p => onFileDelete(p));
    setSelected(prev => {
      const next = new Set(prev);
      paths.forEach(p => next.delete(p));
      return next;
    });
    setConfirmPaths(null);
    if (selectMode && paths.length > 1) exitSelectMode();
  };
  // C5: Sort mode (dirs-first by name is default)
  const [sortMode, setSortMode] = useState<'name' | 'type'>('name');
  // C13: Recently-opened files (last 5, persisted to localStorage)
  const [recentFiles, setRecentFiles] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('ide_recent_files') || '[]'); } catch { return []; }
  });

  // C10: image preview hover state
  const [imagePreviewPath, setImagePreviewPath] = useState<string | null>(null);

  // C24: Auto-expand parent directories when the active file changes
  useEffect(() => {
    if (!activeFile) return;
    const parts = activeFile.split('/');
    if (parts.length < 2) return;
    const parentDirs = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
    setExpandedDirs(prev => {
      const next = new Set(prev);
      parentDirs.forEach(d => next.add(d));
      return next;
    });
  }, [activeFile]);

  const buildTree = (filePaths: string[]): FileNode => {
    const root: FileNode = { name: 'root', path: '', type: 'dir', children: {} };
    
    filePaths.forEach(path => {
      const parts = path.split('/');
      let current = root;
      
      parts.forEach((part, index) => {
        const isLast = index === parts.length - 1;
        const currentPath = parts.slice(0, index + 1).join('/');
        
        if (!current.children![part]) {
          current.children![part] = {
            name: part,
            path: currentPath,
            type: isLast ? 'file' : 'dir',
            children: isLast ? undefined : {}
          };
        }
        current = current.children![part];
      });
    });
    
    return root;
  };

  const handleFileSelectWithRecent = (path: string) => {
    onFileSelect(path);
    setRecentFiles(prev => {
      const updated = [path, ...prev.filter(p => p !== path)].slice(0, 5);
      try { localStorage.setItem('ide_recent_files', JSON.stringify(updated)); } catch {}
      return updated;
    });
  };

  const toggleDir = (path: string) => {
    const next = new Set(expandedDirs);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setExpandedDirs(next);
  };

  const renderTree = (node: FileNode, level: number = 0) => {
    if (!node.children) return null;
    
    const sortedItems = Object.values(node.children).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      if (sortMode === 'type') {
        const extA = a.name.split('.').pop() || '';
        const extB = b.name.split('.').pop() || '';
        const extCmp = extA.localeCompare(extB);
        if (extCmp !== 0) return extCmp;
      }
      return a.name.localeCompare(b.name);
    });

    return sortedItems.map(item => {
      if (searchQuery && item.type === 'file' && !item.path.toLowerCase().includes(searchQuery.toLowerCase())) {
        return null;
      }

      const isExpanded = expandedDirs.has(item.path);
      const isActive = activeFile === item.path;

      if (item.type === 'dir') {
        const hasVisibleChildren = searchQuery ? 
          Object.values(item.children || {}).some(c => c.path.toLowerCase().includes(searchQuery.toLowerCase())) : true;
        
        if (!hasVisibleChildren && searchQuery) return null;

        return (
          <div key={item.path}>
            <div 
              onClick={() => toggleDir(item.path)}
              className="group flex items-center gap-2 px-4 py-1.5 hover:bg-white/5 cursor-pointer text-[#8b949e] transition-colors"
              style={{ paddingLeft: `${(level + 1) * 12}px` }}
            >
              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              <FolderOpen className="w-4 h-4 text-indigo-400/70" />
              <span className="text-[11px] font-bold uppercase tracking-tight text-[#c9d1d9]">{item.name}</span>
            </div>
            {isExpanded && renderTree(item, level + 1)}
          </div>
        );
      }

      const isSelected = selected.has(item.path);

      return (
        <div
          key={item.path}
          onClick={() => selectMode ? toggleSelected(item.path) : handleFileSelectWithRecent(item.path)}
          onMouseEnter={() => isImageFile(item.name) ? setImagePreviewPath(item.path) : undefined}
          onMouseLeave={() => setImagePreviewPath(null)}
          className={cn(
            "group relative flex items-center justify-between px-4 py-1.5 cursor-pointer transition-all",
            isSelected ? "bg-red-500/10" : isActive ? "bg-indigo-600/10 text-white border-r-2 border-indigo-500" : "hover:bg-white/5 text-[#8b949e]"
          )}
          style={{ paddingLeft: `${(level + 1) * 12}px` }}
        >
          <div className="flex items-center gap-3 min-w-0">
            {/* Multi-select checkbox */}
            {selectMode && (
              isSelected
                ? <CheckSquare className="w-3.5 h-3.5 shrink-0 text-red-400" />
                : <Square className="w-3.5 h-3.5 shrink-0 text-[#484f58]" />
            )}
            {/* C10: image icon for image files */}
            {isImageFile(item.name)
              ? <Image className={cn("w-3.5 h-3.5 shrink-0", isActive ? "text-indigo-400" : "text-[#484f58]")} />
              : <FileCode className={cn("w-3.5 h-3.5 shrink-0", isActive ? "text-indigo-400" : "text-[#484f58]")} />
            }
            <span className={cn("text-[11px] font-medium tracking-tight truncate", isActive ? "font-bold" : "")}>{item.name}</span>
            {dirtyTabs?.has(item.path) && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Unsaved changes" />
            )}
            {/* A20: read-only indicator */}
            {isReadOnly(item.name) && (
              <Lock className="w-2.5 h-2.5 shrink-0 text-[#484f58]/60" title="Read-only / auto-generated file" />
            )}
          </div>
          {/* TOUCH-SAFE reveal. These are the row's real actions (open in GitHub, delete), and
              `opacity-0 group-hover:opacity-100` made them INVISIBLE on a phone — there is no hover to
              trigger, so deleting a file from the Files tab was impossible on the device where Files IS
              a footer tab. Gated on `(hover: hover)`: pointer devices keep the tidy reveal-on-hover,
              touch devices get them permanently. */}
          <div className="opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
            {/* J19: Open in GitHub */}
            {githubRepoUrl && (
              <a
                href={`${githubRepoUrl}/blob/${githubBranch}/${item.path}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title="Open in GitHub"
                aria-label={`Open ${item.path} in GitHub`}
                className="p-1 hover:bg-white/10 rounded text-[#484f58] hover:text-white"
              >
                <Github className="w-3 h-3" />
              </a>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConfirmPaths([item.path]);
              }}
              aria-label={`Delete ${item.path}`}
              className="p-1 hover:bg-red-500/10 rounded text-red-500/40 hover:text-red-500"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
          {/* C10: image preview tooltip on hover */}
          {imagePreviewPath === item.path && (
            <div className="absolute left-full top-0 ml-2 z-50 p-2 bg-[#161b22] border border-white/10 rounded-xl shadow-2xl pointer-events-none" style={{ minWidth: '120px', maxWidth: '200px' }}>
              {(files[item.path] || '').startsWith('data:image') || item.name.endsWith('.svg') ? (
                item.name.endsWith('.svg')
                  // SECURITY: never inject raw SVG source as HTML — a generated/imported `logo.svg`
                  // containing `<img src=x onerror=…>` would run in the PLATFORM origin on hover and
                  // steal auth tokens (stored XSS). svgPreviewSrc renders it through an <img> data-URI
                  // (script-disabled "secure static" mode) so no script/onerror in the SVG can execute.
                  ? <img src={svgPreviewSrc(files[item.path] || '')} alt={item.name} className="w-full rounded" />
                  : <img src={files[item.path]} alt={item.name} className="w-full rounded" />
              ) : (
                <div className="flex items-center gap-2 p-1">
                  <Image className="w-4 h-4 text-[#484f58]" />
                  <span className="text-[9px] text-[#484f58]">{item.name}</span>
                </div>
              )}
            </div>
          )}
        </div>
      );
    });
  };

  const tree = buildTree(Object.keys(files));

  // C12: Collect all directory paths for expand-all
  const getAllDirPaths = (node: FileNode): string[] => {
    if (!node.children) return [];
    const dirs: string[] = [];
    for (const child of Object.values(node.children)) {
      if (child.type === 'dir') {
        dirs.push(child.path);
        dirs.push(...getAllDirPaths(child));
      }
    }
    return dirs;
  };

  const handleCreate = () => {
    if (newFileName.trim()) {
      onFileCreate(newFileName.trim());
      setNewFileName('');
      setIsAddingFile(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--theme-card)] text-[var(--theme-text)] border-r border-[var(--theme-border)] select-none transition-colors duration-500">
      <div className="p-4 border-b border-[var(--theme-border)] flex items-center justify-between bg-black/10">
        <div className="flex items-center gap-2">
           <HardDrive className="w-4 h-4 text-indigo-400" />
           <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50">Explorer</span>
        </div>
        <div className="flex items-center gap-1">
          {/* C12: Expand All / Collapse All */}
          <button
            onClick={() => {
              const allDirs = getAllDirPaths(tree);
              const allExpanded = allDirs.every(d => expandedDirs.has(d));
              if (allExpanded) {
                setExpandedDirs(new Set(['']));
              } else {
                setExpandedDirs(new Set([...allDirs, '']));
              }
            }}
            aria-label="Expand or collapse all folders"
            className="p-1.5 hover:bg-white/5 rounded-md text-[#8b949e] hover:text-white transition-all"
            title="Expand / Collapse All"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          {/* C5: Sort toggle */}
          <button
            onClick={() => setSortMode(m => m === 'name' ? 'type' : 'name')}
            aria-label={`Sort files by ${sortMode === 'name' ? 'file type' : 'name'}`}
            className={`p-1.5 rounded-md transition-all ${sortMode === 'type' ? 'text-indigo-400 bg-indigo-900/20' : 'text-[#8b949e] hover:text-white hover:bg-white/5'}`}
            title={`Sort by: ${sortMode === 'name' ? 'name' : 'type'} (click to toggle)`}
          >
            <SortAsc className="w-3 h-3" />
          </button>
          <button
            onClick={() => setIsAddingFile(true)}
            aria-label="Create new file"
            className="p-1.5 hover:bg-white/5 rounded-md text-[#8b949e] hover:text-white transition-all"
            title="New File"
          >
            <FilePlus className="w-3.5 h-3.5" />
          </button>
          {/* Multi-select delete mode */}
          {allFilePaths.length > 0 && (
            <button
              onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
              aria-label={selectMode ? 'Exit select mode' : 'Select files to delete'}
              className={`p-1.5 rounded-md transition-all ${selectMode ? 'text-red-400 bg-red-900/20' : 'text-[#8b949e] hover:text-white hover:bg-white/5'}`}
              title={selectMode ? 'Exit selection' : 'Select files to delete'}
            >
              <CheckSquare className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Multi-select action bar */}
      {selectMode && (
        <div className="px-4 py-2 border-b border-[var(--theme-border)] bg-red-950/10 flex items-center justify-between gap-2">
          <button
            onClick={() => setSelected(prev => prev.size === allFilePaths.length ? new Set() : new Set(allFilePaths))}
            className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-[#8b949e] hover:text-white transition-colors"
          >
            {selected.size === allFilePaths.length && allFilePaths.length > 0
              ? <CheckSquare className="w-3.5 h-3.5 text-red-400" />
              : <Square className="w-3.5 h-3.5" />}
            {selected.size === allFilePaths.length && allFilePaths.length > 0 ? 'Deselect All' : 'Select All'}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-[#8b949e]">{selected.size} selected</span>
            <button
              onClick={() => selected.size > 0 && setConfirmPaths([...selected])}
              disabled={selected.size === 0}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-red-600 text-white hover:bg-red-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </div>
        </div>
      )}

      <div className="px-4 py-3 bg-[#0d1117]/20">
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-[#484f58]" />
          <input 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files..."
            className="w-full bg-black/20 border border-white/5 rounded-lg py-1.5 pl-9 pr-4 text-[10px] font-bold outline-none focus:border-indigo-500/50 transition-all shadow-inner placeholder:text-[#484f58] uppercase tracking-wider"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar py-2">
        <AnimatePresence>
          {isAddingFile && (
            <motion.div 
               initial={{ opacity: 0, y: -10 }}
               animate={{ opacity: 1, y: 0 }}
               exit={{ opacity: 0, y: -10 }}
               className="px-4 py-2"
            >
               <input 
                 autoFocus
                 value={newFileName}
                 onChange={(e) => setNewFileName(e.target.value)}
                 onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                 onBlur={() => !newFileName && setIsAddingFile(false)}
                 placeholder="name.js"
                 className="w-full bg-[#0d1117] border border-indigo-500 rounded-lg px-3 py-2 text-[11px] text-white outline-none"
               />
            </motion.div>
          )}
        </AnimatePresence>

        {/* C13: Recently-opened files section */}
        {!searchQuery && recentFiles.filter(p => p in files).length > 0 && (
          <div className="mb-2">
            <div className="px-4 pt-2 pb-1">
              <span className="text-[8px] font-black uppercase tracking-[0.2em] text-[#484f58]">Recent</span>
            </div>
            {recentFiles.filter(p => p in files).map(path => (
              <div
                key={path}
                onClick={() => handleFileSelectWithRecent(path)}
                className={cn(
                  "flex items-center gap-2 px-4 py-1 cursor-pointer transition-all",
                  activeFile === path ? "bg-indigo-600/10 text-white border-r-2 border-indigo-500" : "hover:bg-white/5 text-[#8b949e]"
                )}
              >
                <FileCode className="w-3 h-3 shrink-0 text-[#484f58]" />
                <span className="text-[10px] font-medium truncate">{path.split('/').pop()}</span>
              </div>
            ))}
            <div className="mx-4 mt-1 mb-2 border-t border-white/5" />
          </div>
        )}

        <div className="space-y-0.5">
          {renderTree(tree)}
        </div>
      </div>

      {/* Delete confirmation modal — replaces the native confirm(); used for single + multi delete. */}
      <AnimatePresence>
        {confirmPaths && confirmPaths.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setConfirmPaths(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm bg-[#161b22] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-white">
                      Delete {confirmPaths.length === 1 ? 'file' : `${confirmPaths.length} files`}?
                    </h3>
                    <p className="text-[11px] text-[#8b949e]">This cannot be undone.</p>
                  </div>
                </div>
                <div className="max-h-32 overflow-y-auto no-scrollbar rounded-lg bg-black/30 border border-white/5 p-2 mb-4">
                  {confirmPaths.slice(0, 50).map(p => (
                    <div key={p} className="text-[10px] font-mono text-[#c9d1d9] truncate py-0.5">{p}</div>
                  ))}
                  {confirmPaths.length > 50 && (
                    <div className="text-[10px] text-[#484f58] py-0.5">…and {confirmPaths.length - 50} more</div>
                  )}
                </div>
                {/* Bulk delete (2+ files) — arm it by TYPING "delete", so one stray click can't wipe every
                    file. Nothing is deleted until this input matches (admin-mandated 2026-07-17). */}
                {requiresTypedConfirm(confirmPaths.length) && (
                  <div className="mb-4">
                    <label className="block text-[11px] text-[#8b949e] mb-1.5">
                      Type <span className="font-mono font-black text-red-300">{DELETE_CONFIRM_WORD}</span> to permanently delete these {confirmPaths.length} files:
                    </label>
                    <input
                      autoFocus
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && isTypedConfirmValid(confirmText)) performDelete(confirmPaths); }}
                      placeholder={DELETE_CONFIRM_WORD}
                      spellCheck={false}
                      autoCapitalize="none"
                      autoCorrect="off"
                      className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 focus:border-red-500/60 outline-none text-[12px] font-mono text-white placeholder:text-[#484f58] transition-colors"
                    />
                  </div>
                )}
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setConfirmPaths(null)}
                    className="px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider text-[#8b949e] hover:text-white hover:bg-white/5 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => performDelete(confirmPaths)}
                    disabled={!canProceedWithDelete(confirmPaths.length, confirmText)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider bg-red-600 text-white hover:bg-red-700 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-600"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
