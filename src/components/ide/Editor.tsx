import React, { useEffect, useRef, useState } from 'react';
import MonacoEditor, { loader } from '@monaco-editor/react';
import { cn } from '../../lib/utils';
import { X, Bug, Save, FileCode, Check, ChevronRight, RotateCcw, Search, Globe, Paintbrush, Braces, FileText, Image, FolderOpen } from 'lucide-react';
import type { FC, SVGProps } from 'react';

type IconComponent = FC<SVGProps<SVGSVGElement> & { className?: string }>;

function iconForFile(path: string): IconComponent {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'html': case 'htm': return Globe;
    case 'css': case 'scss': case 'sass': return Paintbrush;
    case 'json': return Braces;
    case 'md': case 'mdx': return FileText;
    case 'svg': case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': return Image;
    default: return FileCode;
  }
}
import { Tab } from '../../types/ide';
import {
  EDITOR_THEMES, registerEditorThemes, loadSavedTheme, saveTheme,
  type EditorThemeId,
} from './monacoThemes';

// Load Monaco from our OWN origin, not a CDN. `scripts/copyMonaco.mjs` copies the installed
// monaco-editor `min/vs` into `public/monaco/vs` at build time, so `/monaco/vs` is served as a
// static asset by our server. This removes the external CDN dependency that left the editor
// stuck on "Loading editor…" behind firewalls / CSP / region blocks. The load-failure fallback
// below (textarea) remains as a final safety net.
loader.config({ paths: { vs: '/monaco/vs' } });

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'pdf', 'zip', 'tar', 'gz',
  'woff', 'woff2', 'ttf', 'eot', 'otf', 'mp4', 'mp3', 'ogg', 'wav', 'avi', 'mov',
]);

interface EditorProps {
  content: string;
  language: string;
  fileName: string;
  openTabs: Tab[];
  activeTab: string;
  onChange: (value: string) => void;
  onTabChange: (path: string) => void;
  onTabClose: (path: string) => void;
  onMount?: (editor: any) => void;
  onRun?: () => void;
  onDebug?: () => void;
  /**
   * REAL save (admin 2026-08-04: "save button ko live karo, aur press karne par user ko dikhe ki file
   * save ho gyi hai, likh kar aye"). Runs the same path Ctrl+S does — trim, final newline, format-on-
   * save, mark the tab clean — so the button and the shortcut can never mean two different things.
   */
  onSave?: () => void | Promise<void>;
  /** Hide the header's debug icon where the IDE footer already owns that action (mobile). */
  hideHeaderDebug?: boolean;
  /** Tabs with unsaved changes (shows a dot indicator) */
  dirtyTabs?: Set<string>;
  /** A17: Monaco editor color theme */
  editorTheme?: 'vs-dark' | 'vs';
  /** Override / extend Monaco editor options */
  editorOptions?: Record<string, unknown>;
  /** C23: Reveal active file in the file explorer sidebar */
  onRevealInExplorer?: (path: string) => void;
  /** P-DEV.1: full workspace file set — enables cross-file Go-to-Definition / Find-References (F12 / Shift+F12). */
  allFiles?: Record<string, string>;
  /** P-DEV.1: open a (possibly different) file at a location when navigating cross-file. */
  onNavigateOpen?: (path: string, line?: number, column?: number) => void;
  /** P-DEV.3: breakpoint lines (1-based) for the active file — rendered as red gutter glyphs. */
  activeBreakpoints?: number[];
  /** P-DEV.3: toggle a breakpoint when the user clicks the line's gutter glyph margin. */
  onBreakpointToggle?: (file: string, line: number) => void;
}

export const Editor: React.FC<EditorProps> = React.memo(({
  content,
  language,
  fileName,
  openTabs,
  activeTab,
  onChange,
  onTabChange,
  onTabClose,
  onMount,
  onRun,
  onDebug,
  onSave,
  hideHeaderDebug,
  dirtyTabs,
  editorTheme = 'vs-dark',
  editorOptions = {},
  onRevealInExplorer,
  allFiles,
  onNavigateOpen,
  activeBreakpoints,
  onBreakpointToggle,
}) => {
  const isBinaryFile = BINARY_EXTENSIONS.has(fileName.split('.').pop()?.toLowerCase() ?? '');
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  // P-DEV.3 — keep the latest file name + toggle callback in a ref so the once-registered gutter
  // mouse handler always reads fresh values (same pattern as navRef below).
  const bpRef = useRef<{ fileName: string; onToggle?: (file: string, line: number) => void }>({ fileName });
  bpRef.current = { fileName, onToggle: onBreakpointToggle };
  const bpDecorationsRef = useRef<string[]>([]);
  // P-DEV.1 — keep the latest workspace file set / active file / open-callback in refs so the
  // once-registered F12/Shift+F12 actions always read fresh values.
  const navRef = useRef<{ allFiles?: Record<string, string>; fileName: string; onOpen?: (p: string, l?: number, c?: number) => void }>({ fileName });
  navRef.current = { allFiles, fileName, onOpen: onNavigateOpen };
  // 8.2 — lightweight textarea fallback on mobile to avoid Monaco memory issues
  const [isMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  // Monaco loads its core from a CDN (see loader.config above). If that CDN is unreachable
  // (offline, firewall/CSP, region block, CDN hiccup) the loader hangs and the editor shows
  // "Loading editor…" forever. Detect that — on init failure OR a timeout — and fall back to
  // the plain textarea editor so files ALWAYS open. The happy path (CDN reachable) is unchanged.
  const [monacoFailed, setMonacoFailed] = useState(false);
  const useTextarea = isMobile || monacoFailed;
  // P-DEV.9 — runtime-selectable editor theme (persisted), defaulting to the saved choice or the prop.
  const [theme, setThemeState] = useState<EditorThemeId>(() => loadSavedTheme(editorTheme as EditorThemeId));

  /**
   * "Saved" confirmation. The admin asked for it in words, not a colour: a save button that changes
   * nothing visible leaves the user tapping it again to be sure it worked. It clears itself, and the
   * timer is cancelled on unmount and on the next save so a rapid double-tap cannot leave a stale
   * "Saved" on screen after a later save quietly failed.
   */
  const [justSaved, setJustSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); }, []);

  const handleSave = async () => {
    if (!onSave) return;
    try {
      await onSave();
    } catch {
      return;   // the save genuinely failed — never claim it succeeded
    }
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    setJustSaved(true);
    savedTimerRef.current = setTimeout(() => setJustSaved(false), 1800);
  };
  const changeTheme = (id: EditorThemeId) => { setThemeState(id); saveTheme(id); };

  useEffect(() => {
    if (isMobile || monacoFailed) return;
    let active = true;
    const timer = setTimeout(() => {
      if (active) {
        // eslint-disable-next-line no-console
        console.warn('[Editor] Monaco did not load in time — falling back to the plain text editor.');
        setMonacoFailed(true);
      }
    }, 12_000);
    loader.init()
      .then(() => { if (active) clearTimeout(timer); })
      .catch(() => {
        if (active) {
          clearTimeout(timer);
          // eslint-disable-next-line no-console
          console.warn('[Editor] Monaco failed to load — falling back to the plain text editor.');
          setMonacoFailed(true);
        }
      });
    return () => { active = false; clearTimeout(timer); };
  }, [isMobile, monacoFailed]);

  useEffect(() => {
    return () => {
      if (onMount) onMount(null);
    };
  }, [onMount]);

  // P-DEV.9 — register the custom themes before the editor mounts so they're available to set.
  const handleEditorWillMount = (monaco: any) => {
    try { registerEditorThemes(monaco); } catch { /* non-fatal */ }
  };

  // P-DEV.3 — render breakpoint glyphs for the active file. Re-runs on breakpoint/file change.
  // Best-effort: a failure (e.g. textarea fallback, model swapping) is swallowed, never disrupts editing.
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    try {
      const decos = (activeBreakpoints ?? []).map((line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: { isWholeLine: false, glyphMarginClassName: 'nbai-breakpoint-glyph', glyphMarginHoverMessage: { value: 'Breakpoint' } },
      }));
      bpDecorationsRef.current = editor.deltaDecorations(bpDecorationsRef.current, decos);
    } catch { /* decorations are best-effort */ }
  }, [activeBreakpoints, fileName, monacoFailed]);

  const handleEditorDidMount = (editor: any, monaco?: any) => {
    editorRef.current = editor;
    if (monaco) monacoRef.current = monaco;
    if (onMount) onMount(editor);
    // P-DEV.3 — toggle a breakpoint when the user clicks the line's gutter glyph margin. Registered
    // once; reads the fresh file + callback from bpRef. Best-effort — never disrupts editing.
    if (monaco) {
      try {
        editor.onMouseDown((e: any) => {
          try {
            if (e?.target?.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
              const line = e.target.position?.lineNumber;
              if (typeof line === 'number' && line >= 1 && bpRef.current.onToggle) {
                bpRef.current.onToggle(bpRef.current.fileName, line);
              }
            }
          } catch { /* ignore a single mis-click */ }
        });
      } catch { /* gutter breakpoints are best-effort */ }
    }
    // P-DEV.1 — register workspace-wide Go-to-Definition (F12) + Find-References (Shift+F12) that call
    // the semantic /api/workspace/navigate engine over the WHOLE file set (Monaco's per-file worker
    // can't). Same-file hits move the cursor; cross-file hits open the target file. Additive: only
    // registered when the full file set is supplied, so existing single-file usage is unchanged.
    if (monaco && navRef.current.allFiles) {
      const navigate = async (action: 'definition' | 'references') => {
        try {
          const ctx = navRef.current;
          if (!ctx.allFiles) return;
          const pos = editor.getPosition();
          if (!pos) return;
          const res = await fetch('/api/workspace/navigate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: ctx.allFiles, file: ctx.fileName, line: pos.lineNumber, column: pos.column, action }),
          });
          const data = res.ok ? await res.json() : null;
          // For references, prefer the first location that isn't the symbol under the cursor.
          const locs: Array<{ file: string; line: number; column: number }> = Array.isArray(data?.locations) ? data.locations : [];
          const loc = action === 'references'
            ? (locs.find((l) => !(l.file === ctx.fileName && l.line === pos.lineNumber)) ?? locs[0])
            : locs[0];
          if (!loc) return;
          if (loc.file === ctx.fileName) {
            editor.setPosition({ lineNumber: loc.line, column: loc.column });
            editor.revealLineInCenter(loc.line);
            editor.focus();
          } else {
            ctx.onOpen?.(loc.file, loc.line, loc.column);
          }
        } catch { /* navigation is best-effort — never disrupts editing */ }
      };
      try {
        editor.addAction({ id: 'nbai-go-to-definition', label: 'Go to Definition (workspace)', keybindings: [monaco.KeyCode.F12], contextMenuGroupId: 'navigation', run: () => void navigate('definition') });
        editor.addAction({ id: 'nbai-find-references', label: 'Find References (workspace)', keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F12], contextMenuGroupId: 'navigation', run: () => void navigate('references') });
      } catch { /* action registration is best-effort */ }
    }
  };

  const getLanguage = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js':
      case 'jsx':
      case 'mjs':
      case 'cjs': return 'javascript';
      case 'ts':
      case 'tsx':
      case 'mts':
      case 'cts': return 'typescript';
      case 'html': return 'html';
      case 'css': return 'css';
      case 'py': return 'python';
      case 'json': return 'json';
      case 'md': return 'markdown';
      default: return 'plaintext';
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] overflow-hidden">
      {/* Tab bar */}
      <div className="h-9 bg-[#252526] flex items-center overflow-x-auto no-scrollbar shrink-0 select-none">
        {openTabs.map((tab) => {
          const isActive = tab.path === activeTab;
          const TabIcon = iconForFile(tab.path);
          return (
            <div
              key={tab.path}
              onClick={() => onTabChange(tab.path)}
              className={cn(
                "h-full flex items-center px-3 gap-2 border-r border-[#1e1e1e] cursor-pointer min-w-[120px] max-w-[200px] transition-all group",
                isActive ? "bg-[#1e1e1e] text-white" : "bg-[#2d2d2d] text-[#969696] hover:bg-[#2a2d2e]"
              )}
            >
              <TabIcon className={cn("w-3.5 h-3.5 shrink-0", isActive ? "text-indigo-400" : "text-[#858585]")} />
              <span className={cn("text-[11px] truncate flex-1", isActive ? "font-medium" : "")}>
                {tab.path}
              </span>
              {dirtyTabs?.has(tab.path) && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Unsaved changes" />
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTabClose(tab.path);
                }}
                aria-label={`Close tab ${tab.path}`}
                className={cn(
                  // Same touch trap as the file rows: hover-only meant a phone could not close a
                  // BACKGROUND tab at all without first switching to it. Pointer devices keep the
                  // reveal-on-hover; touch shows every ✕.
                  "p-0.5 rounded hover:bg-white/10 transition-opacity",
                  "opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100",
                  isActive && "[@media(hover:hover)]:opacity-100"
                )}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Editor Header / Breadcrumbs */}
      <div className="h-6 bg-[#1e1e1e] border-b border-white/5 flex items-center justify-between px-4 shrink-0 text-[#858585] select-none">
        <div className="flex items-center gap-1 text-[10px] font-medium tracking-tight">
           <span>Project Root</span>
           <ChevronRight className="w-3 h-3" />
           <span className="text-white">{fileName}</span>
           {/* C23: reveal active file in explorer */}
           {onRevealInExplorer && (
             <button
               onClick={() => onRevealInExplorer(activeTab)}
               title="Reveal in file explorer"
               className="ml-1 p-0.5 hover:text-white transition-colors"
             >
               <FolderOpen className="w-3 h-3" />
             </button>
           )}
        </div>
        <div className="flex items-center gap-3">
            {/* P-DEV.9 — editor theme selector */}
            {!useTextarea && (
              <select
                value={theme}
                onChange={(e) => changeTheme(e.target.value as EditorThemeId)}
                title="Editor theme"
                aria-label="Editor theme"
                className="bg-[#1e1e1e] border border-white/10 rounded text-[10px] text-[#858585] hover:text-white outline-none focus:border-indigo-500 px-1 py-0.5 cursor-pointer"
              >
                {EDITOR_THEMES.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            )}
            {/* DEBUG — desktop only. On a phone this action lives in the IDE footer, so keeping it here
                too would be the same button twice on the smallest screen we have. */}
            {onDebug && !hideHeaderDebug && (
               <button
                 onClick={onDebug}
                 aria-label="Preview debug"
                 className="hover:text-amber-500 transition-all"
                 title="Preview Debug"
               >
                 <Bug className="w-3.5 h-3.5" />
               </button>
            )}
            {/* SAVE — the only genuinely missing action in this row, and now a real one. It reports
                success in WORDS, not just a colour change: the whole point of pressing save is to be
                told it happened, and a silent button leaves the user pressing it again to be sure. */}
            {onSave && (
               <button
                 onClick={handleSave}
                 aria-label="Save file"
                 title="Save (Ctrl+S)"
                 className={cn(
                   'transition-all flex items-center gap-1 text-[10px] font-bold',
                   justSaved ? 'text-emerald-400' : 'hover:text-white',
                 )}
               >
                 {justSaved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                 {justSaved && <span>Saved</span>}
               </button>
            )}
            {/* REMOVED with the admin's screenshot (2026-08-04): a green ▶ that only re-ran the PREVIEW
                — already a top-right header button and a footer tab — and a <Layout> icon that had no
                onClick at all and never did anything. A control that does nothing is worse than a
                missing one: it teaches the user the app is broken. */}
        </div>
      </div>

      {/* C11: Binary file warning */}
      {isBinaryFile && (
        <div className="flex-1 flex flex-col items-center justify-center bg-[#1e1e1e] text-[#8b949e] gap-3 p-8">
          <Image className="w-10 h-10 text-[#484f58]" />
          <p className="text-sm font-medium text-[#c9d1d9]">Binary file</p>
          <p className="text-[11px] text-center max-w-[280px] leading-relaxed">
            This file type cannot be edited as text. Download the project ZIP to access it directly.
          </p>
        </div>
      )}

      {/* Editor — Monaco when available; plain textarea on mobile or if Monaco can't load */}
      {/* min-h-0 for the same reason as the file list: a flex-1 child in a `flex flex-col h-full`
          needs it so the item can shrink to the available height instead of being floored at its
          content height by the default `min-height:auto`. Without it, on a small screen the editor
          area is pushed to full content height and the mobile textarea / Monaco can't scroll within
          the visible pane. Locked by Editor.scroll.test.tsx. */}
      {!isBinaryFile && <div className="flex-1 min-h-0 overflow-hidden relative">
        {useTextarea ? (
          <textarea
            value={content}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="none"
            className="w-full h-full font-mono text-[13px] leading-relaxed p-4 resize-none outline-none border-none"
            // THEME-AWARE (light-theme readability fix 2026-07-22): the mobile textarea editor was hardcoded
            // to a DARK palette (bg #1e1e1e / text #d4d4d4). The compat layer remapped the BACKGROUND to the
            // theme surface (white in Light), but #d4d4d4 was never mapped, so the code text stayed light grey
            // on white — invisible in the Light theme. Drive both colours from the semantic theme variables
            // (defined per html[data-theme] for all 5 themes), falling back to the original dark values when
            // no theme attribute is set — so every theme (Light included) renders readable code.
            style={{
              fontFamily: "'Courier New', monospace",
              caretColor: '#569cd6',
              background: 'var(--surface-card, #1e1e1e)',
              color: 'var(--text-body, #d4d4d4)',
            }}
          />
        ) : (
        <MonacoEditor
          height="100%"
          path={fileName}
          language={getLanguage(fileName)}
          value={content}
          theme={theme}
          loading={<div className="w-full h-full flex items-center justify-center bg-[#1e1e1e] text-[#8b949e] text-xs font-mono">Loading editor…</div>}
          beforeMount={handleEditorWillMount}
          onMount={handleEditorDidMount}
          onChange={(val) => onChange(val || '')}
          options={{
            minimap: { enabled: true },
            fontSize: 14,
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            glyphMargin: true, // P-DEV.3 — room for breakpoint glyphs in the gutter
            tabSize: 2,
            padding: { top: 10 },
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            renderLineHighlight: 'all',
            lineNumbers: 'on',
            bracketPairColorization: { enabled: true },
            autoClosingBrackets: 'always',
            autoClosingQuotes: 'always',
            formatOnType: true,
            formatOnPaste: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            smoothScrolling: true,
            stickyScroll: { enabled: true },
            ...editorOptions,
          }}
        />
        )}
      </div>}

      {/* Mobile ACTION toolbar (admin 2026-07-31): a phone has no Ctrl key, so the key editor actions
          (Undo / Redo / Find / Run) become ≥40px tap buttons here. Hidden on desktop, where the real
          keyboard shortcuts do the job. */}
      <div className="md:hidden h-11 bg-[#1f1f1f] border-t border-white/5 flex items-center px-2 gap-1.5 shrink-0">
          {([
            { label: 'Undo', Icon: RotateCcw, mirror: false, run: () => editorRef.current?.trigger('mobile-toolbar', 'undo', {}) },
            { label: 'Redo', Icon: RotateCcw, mirror: true, run: () => editorRef.current?.trigger('mobile-toolbar', 'redo', {}) },
            { label: 'Find', Icon: Search, mirror: false, run: () => editorRef.current?.getAction('actions.find')?.run() },
          ]).map(({ label, Icon, mirror, run }) => (
            <button
              key={label}
              onClick={() => { editorRef.current?.focus(); run(); }}
              aria-label={label}
              className="min-w-[40px] h-9 px-2 bg-white/5 active:bg-white/10 rounded-lg text-white flex items-center justify-center border border-white/5"
            >
              <Icon className={cn('w-4 h-4', mirror && 'scale-x-[-1]')} />
            </button>
          ))}
          {/* SAVE, not Run. The green Run here re-ran the PREVIEW — which the header button and the
              footer tab already do — while the one action a phone genuinely cannot reach was Ctrl+S.
              It confirms in words so the user knows the tap registered. */}
          {onSave && (
            <button
              onClick={handleSave}
              aria-label="Save file"
              className={cn(
                'min-w-[40px] h-9 px-3 rounded-lg text-white flex items-center gap-1.5 font-bold text-xs ml-auto transition-colors',
                justSaved ? 'bg-emerald-600' : 'bg-white/10 active:bg-white/20',
              )}
            >
              {justSaved ? <><Check className="w-4 h-4" /> Saved</> : <><Save className="w-4 h-4" /> Save</>}
            </button>
          )}
      </div>

      {/* Mobile Input Helper Toolbar - Hidden on desktop */}
      <div className="md:hidden h-10 bg-[#252526] border-t border-white/5 flex items-center px-1 overflow-x-auto no-scrollbar gap-1 shrink-0">
          {['{', '}', '(', ')', '[', ']', ';', ':', '"', "'", '<', '>', '/', '=', '+', '-', '*', '_'].map((char, i) => (
            <button
              key={i}
              onClick={() => {
                if (editorRef.current) {
                  const selection = editorRef.current.getSelection();
                  const range = new (window as any).monaco.Range(
                    selection.startLineNumber,
                    selection.startColumn,
                    selection.endLineNumber,
                    selection.endColumn
                  );
                  editorRef.current.executeEdits('helper', [{ range, text: char, forceMoveMarkers: true }]);
                }
              }}
              className="min-w-[32px] h-8 bg-white/5 rounded-lg text-white font-mono text-xs flex items-center justify-center border border-white/5"
            >
              {char}
            </button>
          ))}
      </div>
    </div>
  );
}, (prev, next) => {
  return prev.content === next.content && 
         prev.fileName === next.fileName && 
         prev.activeTab === next.activeTab &&
         prev.openTabs.length === next.openTabs.length;
});
