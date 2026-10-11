// Shared chat code block (chat-UI unification): a fenced code block with a language header, a copy
// button and line numbers. Moved verbatim out of ide/AIChat.tsx so both chat surfaces can render code
// the same way. Presentational only; the only state is the transient "Copied" flag.
import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

// B10/B12: Standalone code block with language header and copy button
export const ChatCodeBlock: React.FC<{ lang: string; code: string }> = ({ lang, code }) => {
  const [copied, setCopied] = useState(false);
  const lines = code.split('\n');
  const displayLines = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
  return (
    <div className="rounded-xl overflow-hidden border border-line my-2 text-[11px]">
      <div className="flex items-center justify-between px-3 py-1 bg-surface border-b border-line">
        <span className="text-[9px] font-mono font-black text-faint uppercase tracking-widest">{lang || 'code'}</span>
        <button
          onClick={() => { navigator.clipboard.writeText(code).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="text-[8px] font-black uppercase tracking-widest text-faint hover:text-ink transition-colors flex items-center gap-1"
        >
          {copied ? <><Check className="w-2.5 h-2.5 text-success" /> Copied</> : <><Copy className="w-2.5 h-2.5" /> Copy</>}
        </button>
      </div>
      <div className="bg-surface overflow-x-auto">
        <code className="font-mono text-body leading-relaxed block">
          {displayLines.map((line, i) => (
            <div key={i} className="flex hover:bg-raised">
              <span className="select-none text-right pr-3 pl-2 text-faint text-[9px] min-w-[2rem] shrink-0 leading-[1.6]">{i + 1}</span>
              <span className="pl-1 pr-3 whitespace-pre leading-[1.6]">{line}</span>
            </div>
          ))}
        </code>
      </div>
    </div>
  );
};
