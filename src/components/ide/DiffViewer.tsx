import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlignLeft, Check, ChevronDown, Columns, Copy, GitBranch } from 'lucide-react';
import { cn } from '../../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DiffViewerProps {
  files: Record<string, string>;
  previousFiles?: Record<string, string>;
  onClose?: () => void;
}

type DiffLineType = 'added' | 'removed' | 'unchanged';

interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

interface Hunk {
  lines: DiffLine[];
}

// ─── LCS-based diff ──────────────────────────────────────────────────────────

function lcs(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

function computeDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const dp = lcs(oldLines, newLines);
  const result: DiffLine[] = [];

  let i = oldLines.length;
  let j = newLines.length;

  // Backtrack through the LCS table
  const ops: DiffLine[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: 'unchanged', content: oldLines[i - 1], oldLineNo: i, newLineNo: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'added', content: newLines[j - 1], oldLineNo: null, newLineNo: j });
      j--;
    } else {
      ops.push({ type: 'removed', content: oldLines[i - 1], oldLineNo: i, newLineNo: null });
      i--;
    }
  }

  ops.reverse().forEach((op) => result.push(op));
  return result;
}

function buildHunks(diffLines: DiffLine[], contextLines = 5): Hunk[] {
  const changedIndices = new Set<number>();
  diffLines.forEach((line, idx) => {
    if (line.type !== 'unchanged') {
      for (
        let c = Math.max(0, idx - contextLines);
        c <= Math.min(diffLines.length - 1, idx + contextLines);
        c++
      ) {
        changedIndices.add(c);
      }
    }
  });

  if (changedIndices.size === 0) return [];

  const hunks: Hunk[] = [];
  let currentHunk: DiffLine[] | null = null;
  let prevIncluded = false;

  diffLines.forEach((line, idx) => {
    const included = changedIndices.has(idx);
    if (included) {
      if (!prevIncluded) {
        currentHunk = [];
        hunks.push({ lines: currentHunk });
      }
      currentHunk!.push(line);
    }
    prevIncluded = included;
  });

  return hunks;
}

function diffStats(diffLines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diffLines) {
    if (line.type === 'added') added++;
    else if (line.type === 'removed') removed++;
  }
  return { added, removed };
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

export const DiffViewer: React.FC<DiffViewerProps> = ({ files, previousFiles, onClose }) => {
  const fileNames = Object.keys(files);
  const [selectedFile, setSelectedFile] = useState<string>(fileNames[0] ?? '');
  const [unified, setUnified] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pastedOld, setPastedOld] = useState<Record<string, string>>({});

  const leftPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);

  const newCode = files[selectedFile] ?? '';
  const resolvedOld = previousFiles?.[selectedFile] ?? pastedOld[selectedFile];

  const oldLines = resolvedOld !== undefined ? resolvedOld.split('\n') : [];
  const newLines = newCode.split('\n');

  const diffLines = resolvedOld !== undefined ? computeDiff(oldLines, newLines) : [];
  const hunks = buildHunks(diffLines);
  const stats = diffStats(diffLines);
  const hasDiff = resolvedOld !== undefined;

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
          <div className="px-3 py-0.5 bg-gray-900/60 text-gray-500 font-mono text-xs">
            @@ hunk {hi + 1} @@
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

        <div className="flex-1" />

        {/* View toggle */}
        {hasDiff && (
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
      {!hasDiff ? (
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
