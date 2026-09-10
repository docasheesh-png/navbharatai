import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlignLeft, Check, ChevronDown, Columns, Copy, GitBranch, GitMerge, RotateCcw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { hasConflictMarkers } from '../../lib/merge3';
import { MergeEditor } from './MergeEditor';
// ONE diff engine, shared with the revert logic. The maths used to live in this file; revert needs
// the SAME line classification the view is showing, and two copies would eventually disagree — the
// user would click revert on one hunk and get another.
import {
  computeDiff, buildHunks, diffStats, splitLines, revertHunk, revertFile,
  type DiffLine, type DiffLineType, type Hunk,
} from '../../lib/fileDiff';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DiffViewerProps {
  files: Record<string, string>;
  previousFiles?: Record<string, string>;
  onClose?: () => void;
  /**
   * P-DEV.4 — called when the user resolves a file's merge conflicts in the built-in MergeEditor.
   * When provided, conflicted files show a "Resolve Conflicts" action; the resolved (marker-free)
   * content is handed back here to persist.
   */
  onResolveConflicts?: (fileName: string, resolvedContent: string) => void;
  /**
   * Write a file back to an earlier version — the "put that change back" half of reviewing a diff.
   *
   * Optional on purpose: where the host cannot persist (a read-only comparison), no revert control is
   * offered at all, rather than a button that appears to work and quietly changes nothing.
   */
  onRevertFile?: (fileName: string, content: string) => void;
}

function buildPatch(filename: string, hunks: Hunk[]): string {
  const lines: string[] = [`--- a/${filename}`, `+++ b/${filename}`];
  for (const hunk of hunks) {
    const oldStart = hunk.lines.find((l) => l.oldLineNo !== null)?.oldLineNo ?? 1;
    const newStart = hunk.lines.find((l) => l.newLineNo !== null)?.newLineNo ?? 1;
    const oldCount = hunk.lines.filter((l) => l.type !== 'added').length;
    const newCount = hunk.lines.filter((l) => l.type !== 'removed').length;
    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const line of hunk.lines) {
      const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
      lines.push(`${prefix}${line.content}`);
    }
  }
  return lines.join('\n');
}

// ─── PasteMode ────────────────────────────────────────────────────────────────

const PasteMode: React.FC<{
  newCode: string;
  onCompare: (oldCode: string) => void;
}> = ({ newCode, onCompare }) => {
  const [oldCode, setOldCode] = useState('');

  return (
    <div className="flex flex-col gap-3 p-4 h-full">
      <p className="text-gray-400 text-sm">
        No previous version provided. Paste the old code below to compare.
      </p>
      <div className="flex gap-3 flex-1 min-h-0">
        <div className="flex-1 flex flex-col gap-1">
          <span className="text-xs font-semibold text-red-400 uppercase tracking-wider">Old Code</span>
          <textarea
            className="flex-1 bg-[#161b22] border border-red-900/40 text-gray-300 font-mono text-xs p-3 rounded resize-none outline-none focus:border-red-500/60"
            placeholder="Paste the old version here…"
            value={oldCode}
            onChange={(e) => setOldCode(e.target.value)}
          />
        </div>
        <div className="flex-1 flex flex-col gap-1">
          <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">New Code</span>
          <textarea
            readOnly
            className="flex-1 bg-[#161b22] border border-emerald-900/40 text-gray-300 font-mono text-xs p-3 rounded resize-none outline-none"
            value={newCode}
          />
        </div>
      </div>
      <button
        onClick={() => onCompare(oldCode)}
        disabled={!oldCode.trim()}
        className="self-end px-4 py-2 text-sm bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded transition-colors"
      >
        Compare
      </button>
    </div>
  );
};

// ─── Unified diff line ────────────────────────────────────────────────────────

const UnifiedDiffLine: React.FC<{ line: DiffLine }> = ({ line }) => {
  const base =
    line.type === 'added'
      ? 'bg-emerald-900/30 text-emerald-400'
      : line.type === 'removed'
        ? 'bg-red-900/30 text-red-400'
        : 'text-gray-400';

  const prefix = line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : '  ';

  return (
    <div className={cn('flex min-w-0 leading-5', base)}>
      <span className="select-none w-10 inline-block text-right pr-3 shrink-0 font-mono text-xs text-red-700/50">
        {line.type !== 'added' ? (line.oldLineNo ?? '') : ''}
      </span>
      <span className="select-none w-10 inline-block text-right pr-3 shrink-0 font-mono text-xs text-emerald-700/50">
        {line.type !== 'removed' ? (line.newLineNo ?? '') : ''}
      </span>
      <span className="font-mono text-xs whitespace-pre px-2 truncate">
        {prefix}
        {line.content}
      </span>
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

export const DiffViewer: React.FC<DiffViewerProps> = ({ files, previousFiles, onClose, onResolveConflicts, onRevertFile }) => {
  const fileNames = Object.keys(files);
  const [selectedFile, setSelectedFile] = useState<string>(fileNames[0] ?? '');
  const [unified, setUnified] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pastedOld, setPastedOld] = useState<Record<string, string>>({});
  const [mergeMode, setMergeMode] = useState(false); // P-DEV.4 — conflict-resolution view

  const leftPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);

  const newCode = files[selectedFile] ?? '';
  const resolvedOld = previousFiles?.[selectedFile] ?? pastedOld[selectedFile];
  const fileHasConflicts = hasConflictMarkers(newCode); // P-DEV.4

  // Leave merge mode whenever the selected file changes or no longer has conflicts.
  useEffect(() => { if (!fileHasConflicts) setMergeMode(false); }, [selectedFile, fileHasConflicts]);

  // splitLines, not split('\n'): the trailing newline is the END of the file, not an empty last line.
  // Diffing that phantom element shows a spurious blank-line change AND makes revert reassemble the
  // file with the newline dropped or doubled. The view and the revert must agree on this or the user
  // reverts what they saw and gets something else.
  const oldLines = resolvedOld !== undefined ? splitLines(resolvedOld).lines : [];
  const newLines = splitLines(newCode).lines;

  const diffLines = resolvedOld !== undefined ? computeDiff(oldLines, newLines) : [];
  const hunks = buildHunks(diffLines);
  const stats = diffStats(diffLines);
  const hasDiff = resolvedOld !== undefined;
  /**
   * Can this file be put back? Only when the host gave us a way to persist, a previous version
   * genuinely exists, and something actually changed. A file the build CREATED has no previous
   * version — offering "revert" there would promise a restore that cannot happen (deleting it is a
   * different action, with different consequences, and is not this control's job).
   */
  const canRevert = !!onRevertFile && resolvedOld !== undefined && resolvedOld !== newCode;

  const handleRevertFile = () => {
    const restored = revertFile(resolvedOld);
    if (restored === null || !onRevertFile) return;
    onRevertFile(selectedFile, restored);
  };

  /**
   * Put ONE change back and leave every other change in place — the reason this is not just an undo
   * button. `revertHunk` returns null for an index that no longer exists (the file moved under us),
   * and that refusal is honoured rather than written: a stale click must not corrupt a file.
   */
  const handleRevertHunk = (hunkIndex: number) => {
    if (resolvedOld === undefined || !onRevertFile) return;
    const next = revertHunk(resolvedOld, newCode, hunkIndex);
    if (next === null) return;
    onRevertFile(selectedFile, next);
  };

  // Synchronized scroll
  useEffect(() => {
    const l = leftPanelRef.current;
    const r = rightPanelRef.current;
    if (!l || !r) return;

    const onLeft = () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      r.scrollTop = l.scrollTop;
      syncingRef.current = false;
    };

    const onRight = () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      l.scrollTop = r.scrollTop;
      syncingRef.current = false;
    };

    l.addEventListener('scroll', onLeft);
    r.addEventListener('scroll', onRight);
    return () => {
      l.removeEventListener('scroll', onLeft);
      r.removeEventListener('scroll', onRight);
    };
  }, [unified, hasDiff]);

  const handleCopy = useCallback(async () => {
    if (!hasDiff) return;
    const patch = buildPatch(selectedFile, hunks);
    await navigator.clipboard.writeText(patch);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [hasDiff, selectedFile, hunks]);

  const handlePasteCompare = useCallback(
    (oldCode: string) => {
      setPastedOld((prev) => ({ ...prev, [selectedFile]: oldCode }));
    },
    [selectedFile],
  );

  // ── Side-by-side renderer ──────────────────────────────────────────────────

  const renderSideBySide = () => {
    type PanelRow = { type: DiffLineType | 'empty'; content: string; lineNo: number | null };

    const oldRows: PanelRow[] = [];
    const newRows: PanelRow[] = [];

    for (const hunk of hunks) {
      for (const dl of hunk.lines) {
        if (dl.type === 'added') {
          oldRows.push({ type: 'empty', content: '', lineNo: null });
          newRows.push({ type: 'added', content: dl.content, lineNo: dl.newLineNo });
        } else if (dl.type === 'removed') {
          oldRows.push({ type: 'removed', content: dl.content, lineNo: dl.oldLineNo });
          newRows.push({ type: 'empty', content: '', lineNo: null });
        } else {
          oldRows.push({ type: 'unchanged', content: dl.content, lineNo: dl.oldLineNo });
          newRows.push({ type: 'unchanged', content: dl.content, lineNo: dl.newLineNo });
        }
      }
    }

    const renderPanel = (
      rows: PanelRow[],
      side: 'old' | 'new',
      ref: React.RefObject<HTMLDivElement>,
    ) => (
      <div
        ref={ref}
        className={cn(
          'flex-1 overflow-auto min-w-0 bg-[#0d1117] border-t',
          side === 'old' ? 'border-red-900/30' : 'border-emerald-900/30',
        )}
      >
        {rows.length === 0 && (
          <div className="p-4 text-gray-600 text-sm italic">No changes</div>
        )}
        {rows.map((row, idx) => {
          const isEmpty = row.type === 'empty';
          const bg =
            row.type === 'added'
              ? 'bg-emerald-900/30'
              : row.type === 'removed'
                ? 'bg-red-900/30'
                : isEmpty
                  ? 'bg-gray-900/20'
                  : '';
          const textColor =
            row.type === 'added'
              ? 'text-emerald-400'
              : row.type === 'removed'
                ? 'text-red-400'
                : 'text-gray-400';

          return (
            <div key={idx} className={cn('flex min-w-0 leading-5 h-5', bg)}>
              <span
                className={cn(
                  'select-none w-10 inline-block text-right pr-3 shrink-0 font-mono text-xs',
                  side === 'old' ? 'text-red-700/50' : 'text-emerald-700/50',
                  (isEmpty || row.lineNo === null) && 'opacity-0',
                )}
              >
                {row.lineNo ?? ''}
              </span>
              <span className={cn('font-mono text-xs whitespace-pre px-1 min-w-0', textColor)}>
                {row.content}
              </span>
            </div>
          );
        })}
      </div>
    );

    return (
      <div className="flex flex-1 min-h-0 divide-x divide-gray-800">
        <div className="flex flex-col flex-1 min-w-0">
          <div className="px-3 py-1 text-xs font-semibold text-red-400 bg-red-900/10 border-b border-red-900/30 uppercase tracking-wider shrink-0">
            Before
          </div>
          {renderPanel(oldRows, 'old', leftPanelRef)}
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <div className="px-3 py-1 text-xs font-semibold text-emerald-400 bg-emerald-900/10 border-b border-emerald-900/30 uppercase tracking-wider shrink-0">
            After
          </div>
          {renderPanel(newRows, 'new', rightPanelRef)}
        </div>
      </div>
    );
  };

  // ── Unified renderer ───────────────────────────────────────────────────────

  const renderUnified = () => (
    <div className="flex-1 overflow-auto bg-[#0d1117]" ref={leftPanelRef}>
      {hunks.length === 0 && (
        <div className="p-4 text-gray-600 text-sm italic">No changes</div>
      )}
      {hunks.map((hunk, hi) => (
        <div key={hi} className="border-b border-gray-800/50">
          <div className="flex items-center gap-2 px-3 py-0.5 bg-gray-900/60 text-gray-500 font-mono text-xs">
            <span>@@ hunk {hi + 1} @@</span>
            <span className="flex-1" />
            {/* Put back THIS change only. The reason the whole feature is worth building: without it
                the user's only escape from one unwanted edit is restoring the entire project from
                History and losing everything else the build did. */}
            {canRevert && (
              <button
                onClick={() => handleRevertHunk(hi)}
                title={`Undo this change only — every other change in ${selectedFile} stays`}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
              >
                <RotateCcw size={10} />
                <span>Revert</span>
              </button>
            )}
          </div>
          {hunk.lines.map((line, li) => (
            <UnifiedDiffLine key={li} line={line} />
          ))}
        </div>
      ))}
    </div>
  );

  // ── Header ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-gray-300 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 shrink-0">
        <GitBranch size={14} className="text-gray-500 shrink-0" />

        {/* File selector */}
        {fileNames.length > 1 ? (
          <div className="relative">
            <select
              value={selectedFile}
              onChange={(e) => setSelectedFile(e.target.value)}
              className="appearance-none bg-gray-900 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1 pr-6 outline-none focus:border-gray-500 cursor-pointer"
            >
              {fileNames.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <ChevronDown
              size={12}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"
            />
          </div>
        ) : (
          <span className="text-xs text-gray-400 font-mono">{selectedFile}</span>
        )}

        {/* Stats */}
        {hasDiff && (
          <div className="flex items-center gap-2 text-xs ml-1">
            {stats.added > 0 && (
              <span className="text-emerald-400">+{stats.added} lines added</span>
            )}
            {stats.removed > 0 && (
              <span className="text-red-400">-{stats.removed} lines removed</span>
            )}
            {stats.added === 0 && stats.removed === 0 && (
              <span className="text-gray-500">no changes</span>
            )}
          </div>
        )}

        {/* P-DEV.4 — conflict indicator */}
        {fileHasConflicts && (
          <span className="flex items-center gap-1 text-xs ml-1 text-amber-400 font-semibold">
            <GitMerge size={12} /> merge conflicts
          </span>
        )}

        <div className="flex-1" />

        {/* Put the WHOLE file back to how it was before the build. Shown only when there is genuinely
            something to go back to — see `canRevert`. */}
        {canRevert && !mergeMode && (
          <button
            onClick={handleRevertFile}
            title={`Undo every change to ${selectedFile} and restore the version from before this build`}
            className="flex items-center gap-1 px-2 py-1 text-xs border rounded transition-colors bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white"
          >
            <RotateCcw size={12} />
            <span>Revert file</span>
          </button>
        )}

        {/* P-DEV.4 — open the merge-conflict resolver */}
        {fileHasConflicts && (
          <button
            onClick={() => setMergeMode((m) => !m)}
            title="Resolve merge conflicts"
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-xs border rounded transition-colors',
              mergeMode
                ? 'bg-amber-600 border-amber-500 text-white'
                : 'bg-gray-900 border-amber-700/50 text-amber-400 hover:bg-gray-800',
            )}
          >
            <GitMerge size={12} />
            <span>{mergeMode ? 'Back to diff' : 'Resolve Conflicts'}</span>
          </button>
        )}

        {/* View toggle */}
        {hasDiff && !mergeMode && (
          <div className="flex items-center bg-gray-900 border border-gray-700 rounded overflow-hidden">
            <button
              onClick={() => setUnified(false)}
              title="Side-by-side"
              className={cn(
                'px-2 py-1 text-xs flex items-center gap-1 transition-colors',
                !unified ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200',
              )}
            >
              <Columns size={12} />
            </button>
            <button
              onClick={() => setUnified(true)}
              title="Unified"
              className={cn(
                'px-2 py-1 text-xs flex items-center gap-1 transition-colors',
                unified ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200',
              )}
            >
              <AlignLeft size={12} />
            </button>
          </div>
        )}

        {/* Copy diff button */}
        {hasDiff && (
          <button
            onClick={handleCopy}
            title="Copy patch"
            className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-900 border border-gray-700 rounded hover:bg-gray-800 transition-colors text-gray-400 hover:text-gray-200"
          >
            {copied ? (
              <Check size={12} className="text-emerald-400" />
            ) : (
              <Copy size={12} />
            )}
            <span>{copied ? 'Copied' : 'Copy diff'}</span>
          </button>
        )}

        {onClose && (
          <button
            onClick={onClose}
            className="ml-1 text-gray-500 hover:text-gray-300 text-xs px-1.5 py-1 rounded hover:bg-gray-800 transition-colors"
          >
            ✕
          </button>
        )}
      </div>

      {/* Body */}
      {mergeMode && fileHasConflicts ? (
        <MergeEditor
          fileName={selectedFile}
          content={newCode}
          onResolved={onResolveConflicts ? (resolved) => { onResolveConflicts(selectedFile, resolved); setMergeMode(false); } : undefined}
          onCancel={() => setMergeMode(false)}
        />
      ) : !hasDiff ? (
        <PasteMode newCode={newCode} onCompare={handlePasteCompare} />
      ) : unified ? (
        renderUnified()
      ) : (
        renderSideBySide()
      )}
    </div>
  );
};

export default DiffViewer;
