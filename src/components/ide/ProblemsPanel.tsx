import React from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import type { PreviewProblem } from '../../lib/previewProblems';

/**
 * Real "Problems" panel for Code Studio — lists the actual compile errors esbuild reported when
 * bundling the live preview (file · line · message). No synthetic/fake entries: an empty list means
 * the bundle genuinely compiled. Click a row to open that file at the error line in the editor.
 */
export interface ProblemsPanelProps {
  problems: PreviewProblem[];
  onOpen?: (file: string, line: number) => void;
  onClose?: () => void;
}

export const ProblemsPanel: React.FC<ProblemsPanelProps> = ({ problems, onOpen, onClose }) => {
  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-[#c9d1d9]">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5 shrink-0">
        <span className="text-[10px] font-black uppercase tracking-widest text-[#8b949e] flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
          Problems
          {problems.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 text-[9px] font-black">{problems.length}</span>
          )}
        </span>
        {onClose && (
          <button onClick={onClose} className="p-1 text-[#8b949e] hover:text-white hover:bg-white/5 rounded transition-colors" aria-label="Close panel">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar">
        {problems.length === 0 ? (
          <div className="h-full flex items-center justify-center gap-2 text-[11px] text-[#8b949e] p-4">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            No problems detected — the preview compiled cleanly.
          </div>
        ) : (
          <ul className="py-1">
            {problems.map((p, i) => (
              <li key={`${p.file}:${p.line}:${p.column}:${i}`}>
                <button
                  onClick={() => p.file && onOpen?.(p.file, p.line)}
                  className="w-full text-left flex items-start gap-2 px-3 py-1.5 hover:bg-white/5 transition-colors group"
                  title={p.file ? `Open ${p.file}:${p.line}` : undefined}
                >
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[11px] text-[#e6edf3] whitespace-pre-wrap break-words">{p.message}</span>
                    {p.file && (
                      <span className="block text-[9.5px] text-[#8b949e] font-mono mt-0.5 group-hover:text-indigo-400 transition-colors">
                        {p.file}{p.line ? `:${p.line}${p.column ? `:${p.column}` : ''}` : ''}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
