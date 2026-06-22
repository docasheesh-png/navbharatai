/**
 * Phase 3.1 — Unified workspace pane (world-class "Chat IS the IDE").
 *
 * Lives to the RIGHT of the Pro Chat conversation. Shows the live app and its
 * source together — exactly like Cursor / Bolt / v0 / Lovable — so the user
 * never has to switch tabs while building. Desktop-only (md+); on mobile the
 * chat stays full-width and Preview/Code remain separate tabs.
 *
 * Two panes:
 *   • Preview — the running app (reuses the tested PreviewPanel)
 *   • Code    — file list + Monaco editor (reuses the tested Editor)
 *
 * Pure presentation: all state (files, generatedCode) is owned by App.tsx and
 * passed in. Editing a file calls back to onFilesChange so the single source of
 * truth stays in App.
 */
import React, { useState, useMemo } from 'react';
import { Eye, Code2, Maximize2, Rocket, FileCode } from 'lucide-react';
import { Editor } from '../ide/Editor';
import { PreviewPanel } from '../ide/PreviewPanel';
import type { Tab } from '../../types/ide';
import { cn } from '../../lib/utils';

type Pane = 'preview' | 'code';

interface WorkspacePaneProps {
  files: Record<string, string>;
  generatedCode: string;
  onFilesChange: (files: Record<string, string>) => void;
  onRun: (files?: Record<string, string>) => void;
  /** Open the full Code Studio IDE (separate tab) for power users. */
  onOpenStudio: () => void;
  /** Optional one-click deploy trigger. */
  onDeploy?: () => void;
  canDeploy?: boolean;
  previewHistory?: { id: string; label: string; ts: Date; html: string }[];
  onRestoreHistory?: (html: string) => void;
  onHtmlChange?: (html: string) => void;
}

function langFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx': return 'typescript';
    case 'js':
    case 'jsx': return 'javascript';
    case 'css': return 'css';
    case 'html': return 'html';
    case 'json': return 'json';
    case 'md': return 'markdown';
    default: return 'plaintext';
  }
}

/** Pick the most relevant file to show first (App component → entry → first). */
function pickDefaultFile(paths: string[]): string {
  return (
    paths.find((p) => /(^|\/)App\.(tsx|jsx)$/.test(p)) ||
    paths.find((p) => /(^|\/)index\.(html|tsx|jsx)$/.test(p)) ||
    paths.find((p) => /\.(tsx|jsx)$/.test(p)) ||
    paths[0] ||
    ''
  );
}

export const WorkspacePane: React.FC<WorkspacePaneProps> = ({
  files,
  generatedCode,
  onFilesChange,
  onRun,
  onOpenStudio,
  onDeploy,
  canDeploy,
  previewHistory,
  onRestoreHistory,
  onHtmlChange,
}) => {
  const [pane, setPane] = useState<Pane>('preview');
  const [activeFile, setActiveFile] = useState<string>('');
  const [openTabs, setOpenTabs] = useState<Tab[]>([]);

  const filePaths = useMemo(() => Object.keys(files).sort(), [files]);

  // The active file falls back to a sensible default whenever the current
  // selection no longer exists (e.g. after a rebuild replaced all files).
  const effectiveActive =
    activeFile && files[activeFile] !== undefined ? activeFile : pickDefaultFile(filePaths);

  // Tabs always include the file currently shown, without a render-loop effect.
  const tabs: Tab[] =
    !effectiveActive || openTabs.some((t) => t.path === effectiveActive)
      ? openTabs
      : [{ path: effectiveActive }, ...openTabs];

  const openFile = (path: string) => {
    setActiveFile(path);
    setOpenTabs((prev) => (prev.some((t) => t.path === path) ? prev : [...prev, { path }]));
  };

  const closeTab = (path: string) => {
    const remaining = openTabs.filter((t) => t.path !== path);
    setOpenTabs(remaining);
    if (path === effectiveActive) setActiveFile(remaining[0]?.path || '');
  };

  return (
    <div className="hidden md:flex flex-col h-full min-h-0 max-h-full overflow-hidden bg-[#0d1117]">
      {/* ── Pane tab bar ── */}
      <div className="flex items-center justify-between px-2 h-9 border-b border-white/10 bg-[#0d1117] shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPane('preview')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-bold transition-all',
              pane === 'preview' ? 'bg-indigo-600 text-white' : 'text-[#8b949e] hover:text-white hover:bg-white/5',
            )}
          >
            <Eye className="w-3.5 h-3.5" /> Preview
          </button>
          <button
            onClick={() => setPane('code')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-bold transition-all',
              pane === 'code' ? 'bg-indigo-600 text-white' : 'text-[#8b949e] hover:text-white hover:bg-white/5',
            )}
          >
            <Code2 className="w-3.5 h-3.5" /> Code
          </button>
        </div>
        <div className="flex items-center gap-1">
          {canDeploy && onDeploy && (
            <button
              onClick={onDeploy}
              title="Deploy your app"
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold text-emerald-400 hover:bg-emerald-900/30 transition-all"
            >
              <Rocket className="w-3 h-3" /> Deploy
            </button>
          )}
          <button
            onClick={onOpenStudio}
            title="Open the full Code Studio IDE"
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold text-[#8b949e] hover:text-white hover:bg-white/5 transition-all"
          >
            <Maximize2 className="w-3 h-3" /> Studio
          </button>
        </div>
      </div>

      {/* ── Pane body ── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {pane === 'preview' ? (
          <PreviewPanel
            files={files}
            onRun={() => onRun(files)}
            generatedCode={generatedCode}
            previewHistory={previewHistory}
            onRestoreHistory={onRestoreHistory}
            onHtmlChange={onHtmlChange}
          />
        ) : (
          <div className="flex h-full min-h-0">
            {/* file list */}
            <div className="w-44 shrink-0 border-r border-white/10 overflow-y-auto bg-[#0d1117] py-1">
              {filePaths.length === 0 && (
                <div className="px-3 py-2 text-[10px] text-[#484f58]">No files yet</div>
              )}
              {filePaths.map((p) => (
                <button
                  key={p}
                  onClick={() => openFile(p)}
                  title={p}
                  className={cn(
                    'w-full flex items-center gap-1.5 px-2 py-1 text-left text-[11px] truncate transition-all',
                    p === effectiveActive
                      ? 'bg-indigo-600/20 text-indigo-300'
                      : 'text-[#8b949e] hover:bg-white/5 hover:text-white',
                  )}
                >
                  <FileCode className="w-3 h-3 shrink-0" />
                  <span className="truncate">{p.split('/').pop()}</span>
                </button>
              ))}
            </div>
            {/* editor */}
            <div className="flex-1 min-w-0 min-h-0">
              {effectiveActive ? (
                <Editor
                  content={files[effectiveActive] ?? ''}
                  language={langFor(effectiveActive)}
                  fileName={effectiveActive}
                  openTabs={tabs}
                  activeTab={effectiveActive}
                  onChange={(value) => onFilesChange({ ...files, [effectiveActive]: value })}
                  onTabChange={(path) => setActiveFile(path)}
                  onTabClose={closeTab}
                  onRun={() => onRun(files)}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-[11px] text-[#484f58]">
                  Select a file
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
