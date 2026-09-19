/**
 * P-DEV.4 — Merge conflict resolver UI.
 *
 * Renders a file that contains Git-style conflict markers as a list of resolvable hunks: each
 * conflict shows OURS vs THEIRS with Ours / Theirs / Both buttons; stable regions are shown as
 * context. The live resolved preview + "Apply" produce clean, marker-free content via the pure
 * `merge3` engine. Self-contained: give it `content`, get back resolved content through `onResolved`.
 */
import React, { useMemo, useState, useCallback } from 'react';
import { Check, X, GitMerge } from 'lucide-react';
import { parseConflicts, resolveConflicts, type Resolution } from '../../lib/merge3';

interface MergeEditorProps {
  fileName: string;
  /** File content containing `<<<<<<< / ======= / >>>>>>>` markers. */
  content: string;
  onResolved?: (resolvedContent: string) => void;
  onCancel?: () => void;
}

const CHOICES: Array<{ key: Resolution; label: string }> = [
  { key: 'ours', label: 'Ours' },
  { key: 'theirs', label: 'Theirs' },
  { key: 'both', label: 'Both' },
];

export const MergeEditor: React.FC<MergeEditorProps> = ({ fileName, content, onResolved, onCancel }) => {
  const parsed = useMemo(() => parseConflicts(content), [content]);
  // One choice per conflict; default to 'ours' (matches resolveConflicts' default).
  const [choices, setChoices] = useState<Resolution[]>(() => parsed.segments.filter(s => s.type === 'conflict').map(() => 'ours' as Resolution));

  const setChoice = useCallback((idx: number, choice: Resolution) => {
    setChoices(prev => { const next = [...prev]; next[idx] = choice; return next; });
  }, []);

  const resolved = useMemo(() => resolveConflicts(parsed, choices), [parsed, choices]);
  const allChosen = choices.length === parsed.conflictCount;

  let conflictIdx = -1;

  return (
    <div className="flex flex-col h-full bg-surface text-body">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-line shrink-0">
        <div className="flex items-center gap-2">
          <GitMerge className="w-4 h-4 text-warn" />
          <span className="text-sm font-semibold">Resolve Conflicts</span>
          <span className="text-xs text-faint font-mono truncate max-w-[40ch]">{fileName}</span>
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-warn">
            {parsed.conflictCount} conflict{parsed.conflictCount === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {onCancel && (
            <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded bg-raised hover:bg-raised-hover text-muted flex items-center gap-1">
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
          )}
          <button
            onClick={() => onResolved?.(resolved)}
            disabled={!onResolved || !allChosen}
            className="px-3 py-1.5 text-xs rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-on-accent flex items-center gap-1"
          >
            <Check className="w-3.5 h-3.5" /> Apply Resolution
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3 space-y-2">
        {parsed.segments.map((seg, i) => {
          if (seg.type === 'stable') {
            if (seg.lines.length === 0) return null;
            return (
              <pre key={i} className="font-mono text-xs whitespace-pre-wrap text-muted px-2 leading-5">
                {seg.lines.join('\n')}
              </pre>
            );
          }
          conflictIdx += 1;
          const idx = conflictIdx;
          const choice = choices[idx] ?? 'ours';
          return (
            <div key={i} className="rounded-lg border border-amber-500/30 overflow-hidden">
              <div className="flex items-center gap-1 px-2 py-1.5 bg-amber-500/10 border-b border-amber-500/20">
                <span className="text-[10px] font-bold uppercase tracking-wider text-warn mr-2">Conflict {idx + 1}</span>
                {CHOICES.map(c => (
                  <button
                    key={c.key}
                    onClick={() => setChoice(idx, c.key)}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded transition-colors ${
                      choice === c.key ? 'bg-emerald-600 text-on-accent' : 'bg-raised text-muted hover:bg-raised-hover'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 divide-x divide-line">
                <div className={choice === 'theirs' ? 'opacity-40' : ''}>
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-accent-text bg-indigo-500/10">Ours</div>
                  <pre className="font-mono text-xs whitespace-pre-wrap px-2 py-1.5 leading-5 text-accent-text">{seg.ours.join('\n') || '(empty)'}</pre>
                </div>
                <div className={choice === 'ours' ? 'opacity-40' : ''}>
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-success bg-emerald-500/10">Theirs</div>
                  <pre className="font-mono text-xs whitespace-pre-wrap px-2 py-1.5 leading-5 text-success">{seg.theirs.join('\n') || '(empty)'}</pre>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-line">
        <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-faint">Resolved preview</div>
        <pre className="font-mono text-xs whitespace-pre-wrap px-3 pb-3 max-h-40 overflow-auto text-muted leading-5">{resolved}</pre>
      </div>
    </div>
  );
};

export default MergeEditor;
