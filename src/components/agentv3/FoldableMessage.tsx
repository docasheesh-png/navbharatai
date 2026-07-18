// A long chat message collapses to a readable height with a "Show more / Show less" toggle, so a huge
// paste or a long AI reply never floods the timeline. Short messages render untouched (no toggle).
// The fold DECISION is a pure, unit-tested helper; the component is a thin wrapper around it.

import { useState } from 'react';

const FOLD_CHARS = 700;
const FOLD_LINES = 12;

/** PURE: is this message long enough to warrant a fold/expand toggle? */
export function shouldFoldMessage(text: string, maxChars = FOLD_CHARS, maxLines = FOLD_LINES): boolean {
  if (typeof text !== 'string') return false;
  if (text.length > maxChars) return true;
  let lines = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  return lines > maxLines;
}

/**
 * Render `text`, collapsed to a max height with a Show more/less toggle when it is long. `className`
 * carries the text styling (e.g. `whitespace-pre-wrap`). Collapsed state is local + defaults to folded.
 */
export function FoldableMessage({ text, className }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!shouldFoldMessage(text)) return <div className={className}>{text}</div>;
  return (
    <div>
      <div className={className} style={expanded ? undefined : { maxHeight: '15rem', overflow: 'hidden' }}>
        {text}
      </div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="mt-1 text-[11px] font-medium underline decoration-dotted opacity-80 hover:opacity-100"
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </div>
  );
}
