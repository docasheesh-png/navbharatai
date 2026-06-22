import React, { useState } from 'react';
import {
  FolderOpen, FileCode, Plus, FilePlus, FolderPlus,
  ChevronRight, ChevronDown, MoreVertical, Trash2,
  Edit2, HardDrive, Search, ArrowUpDown, SortAsc, Github
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface FileExplorerProps {
  files: Record<string, string>;
  activeFile: string;
  onFileSelect: (path: string) => void;
  onFileDelete: (path: string) => void;
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

export const FileExplorer: React.FC<FileExplorerProps> = ({
  files,
  activeFile,
  onFileSelect,
  onFileDelete,
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
  // C5: Sort mode (dirs-first by name is default)
  const [sortMode, setSortMode] = useState<'name' | 'type'>('name');
  // C13: Recently-opened files (last 5, persisted to localStorage)
  const [recentFiles, setRecentFiles] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('ide_recent_files') || '[]'); } catch { return []; }
  });

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

      return (
        <div
          key={item.path}
          onClick={() => handleFileSelectWithRecent(item.path)}
          className={cn(
            "group flex items-center justify-between px-4 py-1.5 cursor-pointer transition-all",
            isActive ? "bg-indigo-600/10 text-white border-r-2 border-indigo-500" : "hover:bg-white/5 text-[#8b949e]"
          )}
          style={{ paddingLeft: `${(level + 1) * 12}px` }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <FileCode className={cn("w-3.5 h-3.5 shrink-0", isActive ? "text-indigo-400" : "text-[#484f58]")} />
            <span className={cn("text-[11px] font-medium tracking-tight truncate", isActive ? "font-bold" : "")}>{item.name}</span>
            {dirtyTabs?.has(item.path) && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Unsaved changes" />
            )}
          </div>
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
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
                if (confirm(`Delete ${item.path}?`)) onFileDelete(item.path);
              }}
              aria-label={`Delete ${item.path}`}
              className="p-1 hover:bg-red-500/10 rounded text-red-500/40 hover:text-red-500"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
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
        </div>
      </div>

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
    </div>
  );
};
