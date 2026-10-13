// Shared chat code block (chat-UI unification): a fenced block with a language label and a copy
// button. Rendered by ChatMarkdown.tsx on every chat surface. Presentational only; the only state is
// the transient "Copied" flag.
//
// 2026-10-13 ("claude jaisa"): the frame is the prose scale's — a quiet card, a one-line header, 13px
// mono at a readable leading, no line-number gutter (a gutter makes every pasted snippet copy with
// its numbers on a phone, and reads as an editor, not a reply).
import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export const ChatCodeBlock: React.FC<{ lang: string; code: string }> = ({ lang, code }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-line bg-card text-[13px]">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-line">
        <span className="font-mono text-xs text-muted">{lang || 'code'}</span>
        <button
          type="button"
          onClick={() => { navigator.clipboard.writeText(code).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted hover:text-ink hover:bg-raised transition-colors"
          aria-label="Copy code"
        >
          {copied ? <><Check className="w-3.5 h-3.5 text-success" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 m-0 bg-transparent border-0 rounded-none">
        <code className="font-mono text-body leading-relaxed whitespace-pre bg-transparent p-0 rounded-none">{code}</code>
      </pre>
    </div>
  );
};
