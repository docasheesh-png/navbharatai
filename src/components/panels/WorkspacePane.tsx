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
import React, { useState, useMemo, useRef } from 'react';
import { Eye, Code2, Maximize2, Rocket, FileCode, RefreshCw, ExternalLink, Smartphone, Monitor, Tablet, ChevronUp, ChevronDown } from 'lucide-react';
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
  const [reloadKey, setReloadKey] = useState(0);
  // H3: zoom level (50–150%)
  const [previewZoom, setPreviewZoom] = useState(100);
  // H14: responsive breakpoints
  type Viewport = 'mobile' | 'tablet' | 'desktop';
  const [viewport, setViewport] = useState<Viewport>('desktop');

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
          {pane === 'preview' && (
            <>
              {/* H14: Responsive viewport presets */}
              <div className="flex items-center gap-0.5 bg-white/5 rounded-md p-0.5">
                {([
                  { id: 'mobile', icon: Smartphone, label: '375px' },
                  { id: 'tablet', icon: Tablet, label: '768px' },
                  { id: 'desktop', icon: Monitor, label: 'Full' },
                ] as const).map(({ id, icon: Icon, label }) => (
                  <button
                    key={id}
                    onClick={() => setViewport(id)}
                    title={`${id.charAt(0).toUpperCase() + id.slice(1)} — ${label}`}
                    className={cn(
                      'flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold transition-all',
                      viewport === id ? 'bg-indigo-600 text-white' : 'text-[#8b949e] hover:text-white',
                    )}
                  >
                    <Icon className="w-2.5 h-2.5" />
                  </button>
                ))}
              </div>
              {/* H12: Viewport dimensions indicator */}
              <span className="text-[9px] font-mono text-[#484f58]">
                {viewport === 'mobile' ? '375' : viewport === 'tablet' ? '768' : '—'}
                {viewport !== 'desktop' ? 'px' : ''}
              </span>
              {/* H3: Zoom controls */}
              <div className="flex items-center gap-0.5">
                <button onClick={() => setPreviewZoom(z => Math.max(50, z - 10))} title="Zoom out" className="p-1 text-[#8b949e] hover:text-white rounded hover:bg-white/5 transition-all"><ChevronDown className="w-3 h-3" /></button>
                <span className="text-[9px] font-mono text-[#8b949e] w-7 text-center">{previewZoom}%</span>
                <button onClick={() => setPreviewZoom(z => Math.min(150, z + 10))} title="Zoom in" className="p-1 text-[#8b949e] hover:text-white rounded hover:bg-white/5 transition-all"><ChevronUp className="w-3 h-3" /></button>
              </div>
              <button
                onClick={() => setReloadKey(k => k + 1)}
                title="Reload preview"
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold text-[#8b949e] hover:text-white hover:bg-white/5 transition-all"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
              {generatedCode && (
                <button
                  onClick={() => {
                    const blob = new Blob([generatedCode], { type: 'text/html' });
                    const url = URL.createObjectURL(blob);
                    window.open(url, '_blank');
                    setTimeout(() => URL.revokeObjectURL(url), 5000);
                  }}
                  title="Open preview in new tab"
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold text-[#8b949e] hover:text-white hover:bg-white/5 transition-all"
                >
                  <ExternalLink className="w-3 h-3" />
                </button>
              )}
            </>
          )}
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
          <div className="w-full h-full flex justify-center overflow-auto bg-[#0a0a0a]">
            <div
              style={{
                width: viewport === 'mobile' ? 375 : viewport === 'tablet' ? 768 : '100%',
                minWidth: viewport === 'desktop' ? '100%' : undefined,
                transform: `scale(${previewZoom / 100})`,
                transformOrigin: 'top center',
                height: `${100 * (100 / previewZoom)}%`,
                flexShrink: 0,
              }}
            >
              <PreviewPanel
                key={reloadKey}
                files={files}
                onRun={() => onRun(files)}
                generatedCode={generatedCode}
                previewHistory={previewHistory}
                onRestoreHistory={onRestoreHistory}
                onHtmlChange={onHtmlChange}
              />
            </div>
          </div>
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
