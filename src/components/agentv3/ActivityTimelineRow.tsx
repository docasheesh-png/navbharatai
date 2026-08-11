// AgentV3 — Claude-style collapsed action row (the UI half of activityTimeline.ts).
//
// Renders one action group as a single glanceable row — "Created 33 files  +812 -0  ›" —
// with a spinner while work is in-flight and a failure accent when something failed.
// Tapping expands the REAL underlying activity: real file paths, real bash commands,
// real ✓/✗ results (nothing synthetic — the entries come straight from the engine's
// tool_call/tool_result/file_changed events). Full command output lives in the Terminal
// tab; the expansion says so instead of pretending to have it.

import { useState } from 'react';
import { ChevronRight, Loader2, X, Check, FileCode, Terminal as TerminalIcon, Search, BookOpen, Bot, Globe, ClipboardList, FileDiff } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import type { ActivityEntry } from './agentV3Types';
import type { ChatBlock, TimelineMsgLike } from './activityTimeline';
import { detailEntries, actionGroupOpen, entryFilePath } from './activityTimeline';
import { describeFile } from '../../lib/fileRole';

/** Max lines of a single file's diff rendered inline (the rest → the Diff tab), keeps the chat light. */
const MAX_DIFF_LINES = 200;
/** Max files shown inline in one group's changes view before collapsing the tail to a note. */
const MAX_DIFF_FILES = 12;

const basename = (p: string): string => p.split('/').pop() || p;

/** One file's colorized unified diff — real patch lines only (never fabricated), bounded for weight. */
function FileDiffView({ path, patch, op }: { path: string; patch: string; op: 'create' | 'edit' }) {
  const [open, setOpen] = useState(true);
  const lines = patch.split('\n');
  const shown = lines.slice(0, MAX_DIFF_LINES);
  return (
    <div className="rounded-md border border-zinc-800 overflow-hidden bg-zinc-950/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200 bg-zinc-900/60"
      >
        <ChevronRight className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <FileCode className="w-3 h-3 shrink-0 text-zinc-500" />
        <span className="truncate font-mono" title={path}>{basename(path)}</span>
        <span className={`ml-auto shrink-0 text-[9px] uppercase tracking-wide ${op === 'create' ? 'text-emerald-500/80' : 'text-sky-400/80'}`}>{op === 'create' ? 'new' : 'edit'}</span>
      </button>
      {open && (
        <pre className="text-[10.5px] leading-[1.5] font-mono overflow-x-auto px-2 py-1 max-h-64 overflow-y-auto">
          {shown.map((ln, i) => {
            const add = ln.startsWith('+') && !ln.startsWith('+++');
            const del = ln.startsWith('-') && !ln.startsWith('---');
            const hunk = ln.startsWith('@@');
            const cls = add ? 'text-emerald-400 bg-emerald-500/[0.06]'
              : del ? 'text-red-400 bg-red-500/[0.06]'
              : hunk ? 'text-sky-400'
              : 'text-zinc-500';
            return <div key={i} className={`whitespace-pre ${cls}`}>{ln || ' '}</div>;
          })}
          {lines.length > MAX_DIFF_LINES && (
            <div className="text-zinc-600 pt-0.5">… +{lines.length - MAX_DIFF_LINES} more lines — full diff in the Diff tab</div>
          )}
        </pre>
      )}
    </div>
  );
}

function entryIcon(e: ActivityEntry) {
  const t = e.text || '';
  if (e.kind === 'file' || /^(writing|editing) /.test(t)) return <FileCode className="w-3.5 h-3.5 text-zinc-500 shrink-0" />;
  if (/^running: /.test(t)) return <TerminalIcon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />;
  if (/^reading /.test(t)) return <BookOpen className="w-3.5 h-3.5 text-zinc-500 shrink-0" />;
  if (/^searching|^listing files/.test(t)) return <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />;
  if (e.kind === 'agent') return <Bot className="w-3.5 h-3.5 text-zinc-500 shrink-0" />;
  if (e.kind === 'preview') return <Globe className="w-3.5 h-3.5 text-zinc-500 shrink-0" />;
  return <ClipboardList className="w-3.5 h-3.5 text-zinc-500 shrink-0" />;
}

const MAX_DETAIL_ROWS = 80;

export function ActionGroupRow<M extends TimelineMsgLike>({ block }: { block: Extract<ChatBlock<M>, { kind: 'actions' }> }) {
  // Untouched (null) → auto: EXPANDED while the build is active so each file streams live in the feed
  // (admin 2026-07-12), collapsed to the summary once done. A tap overrides and sticks.
  const [userOverride, setUserOverride] = useState<boolean | null>(null);
  const open = actionGroupOpen(userOverride, block.active);
  const rows = open ? detailEntries(block.entries) : [];
  const hasCommand = block.entries.some((e) => /^running: /.test(e.text || ''));

  // INLINE PERSISTENT DIFF (admin 2026-07-21 — "har edit/create file wale response ke niche diff …
  // gayab na ho"): the real colorized patch of every created/edited file, shown right under the
  // response and NEVER removed once the build finishes (it survives the next message via the
  // archived activityLog). NEVER auto-opens (admin 2026-07-23 — "View changes … auto off karo"): the
  // diff stays collapsed behind the "View changes" button until the user opens it; a tap sticks.
  const files = block.files ?? [];
  const [diffUserOverride, setDiffUserOverride] = useState<boolean | null>(null);
  const diffOpen = diffUserOverride ?? false;
  const shownFiles = files.slice(0, MAX_DIFF_FILES);
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] w-full">
        <button
          type="button"
          onClick={() => setUserOverride(!open)}
          className={`group/act inline-flex items-center gap-2 max-w-full rounded-lg border px-2.5 py-1.5 text-xs touch-manipulation transition-colors ${
            block.failed
              ? 'border-red-500/30 bg-red-500/5 text-red-200 hover:bg-red-500/10'
              : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
          }`}
        >
          {block.active
            ? <TirangaLoader className="w-3 h-3 text-indigo-400 shrink-0" />
            : block.failed
              ? <X className="w-3 h-3 text-red-400 shrink-0" />
              : <Check className="w-3 h-3 text-emerald-500/80 shrink-0" />}
          <span className="truncate">{block.summary}</span>
          {block.progress && <span className="text-indigo-300 shrink-0">· {block.progress}</span>}
          {block.stats && (block.stats.plus > 0 || block.stats.minus > 0) && (
            <span className="shrink-0 font-mono text-[11px]">
              <span className="text-emerald-400">+{block.stats.plus}</span>{' '}
              <span className="text-red-400">-{block.stats.minus}</span>
            </span>
          )}
          <ChevronRight className={`w-3.5 h-3.5 shrink-0 text-zinc-600 transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>
        {open && (
          <div className="mt-1 ml-1.5 border-l border-zinc-800 pl-3 py-1 space-y-1">
            {rows.slice(0, MAX_DETAIL_ROWS).map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-[11px] text-zinc-500 min-w-0">
                {entryIcon(e)}
                <span className={`truncate ${/^running: /.test(e.text || '') ? 'font-mono' : ''}`}>
                  {(e.text || '').replace(/^running: /, '$ ')}
                </span>
                {/* WHAT IS THIS FILE (admin 2026-08-10): the row already shows the NAME; this adds the
                    one thing the name does not carry. Derived from the path — never generated — so it
                    costs nothing, cannot be wrong about behaviour it did not read, and works the same
                    when this feed is replayed from history. Absent when the path does not confidently
                    say what it is: a missing label is honest, a guessed one is not. */}
                {(() => {
                  const label = describeFile(entryFilePath(e));
                  return label ? <span className="shrink-0 text-zinc-600 hidden sm:inline">· {label}</span> : null;
                })()}
                {e.active
                  ? <TirangaLoader className="w-3 h-3 text-indigo-400 shrink-0" />
                  : e.ok === false
                    ? <X className="w-3 h-3 text-red-400 shrink-0" />
                    : <Check className="w-3 h-3 text-emerald-600/70 shrink-0" />}
              </div>
            ))}
            {rows.length > MAX_DETAIL_ROWS && (
              <div className="text-[11px] text-zinc-600">+{rows.length - MAX_DETAIL_ROWS} more</div>
            )}
            {hasCommand && (
              <div className="text-[10px] text-zinc-600 pt-0.5">Full command output → Terminal tab</div>
            )}
          </div>
        )}

        {/* Inline, persistent code diff — always present under a file-editing response (does not vanish
            when the build finishes or the next message is sent). */}
        {files.length > 0 && (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setDiffUserOverride(!diffOpen)}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/50 px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 touch-manipulation"
            >
              <FileDiff className="w-3 h-3 shrink-0 text-indigo-400" />
              {diffOpen ? 'Hide' : 'View'} changes · {files.length} file{files.length === 1 ? '' : 's'}
              {block.stats && (block.stats.plus > 0 || block.stats.minus > 0) && (
                <span className="font-mono text-[10px]">
                  <span className="text-emerald-400">+{block.stats.plus}</span>{' '}
                  <span className="text-red-400">-{block.stats.minus}</span>
                </span>
              )}
              <ChevronRight className={`w-3.5 h-3.5 shrink-0 text-zinc-600 transition-transform ${diffOpen ? 'rotate-90' : ''}`} />
            </button>
            {diffOpen && (
              <div className="mt-1 space-y-1.5">
                {shownFiles.map((f) => <FileDiffView key={f.path} path={f.path} patch={f.patch} op={f.op} />)}
                {files.length > MAX_DIFF_FILES && (
                  <div className="text-[10px] text-zinc-600">+{files.length - MAX_DIFF_FILES} more changed files — see the Diff tab</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
