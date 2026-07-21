// The per-message action row shown under every user + AI bubble. Copy works today; the feedback
// (👍/👎/report) and unsend buttons render ONLY when their handlers are wired (slices 2 & 3) — never a
// button that does nothing (the "real features only" rule). Kept tiny + presentational.

import { useState } from 'react';
import { Copy, Check, ThumbsUp, ThumbsDown, Flag, X, Pencil, Star } from 'lucide-react';

export type MessageReaction = 'up' | 'down' | 'report';

export interface MessageActionsProps {
  /** The message text to copy. */
  text: string;
  /** Slice 2 — record 👍/👎/report. Absent → those buttons are hidden. */
  onFeedback?: (reaction: MessageReaction) => void;
  /** The reaction the user already gave, to show its active state. */
  reaction?: MessageReaction | null;
  /** Slice 2 — cancel a just-sent message (stop the build + remove it). Absent → the button is hidden. */
  onUnsend?: () => void;
  /** Slice 2 — take the message back AND load its text into the composer to edit + re-send. Absent → hidden. */
  onEdit?: () => void;
  /** Save this message's prompt as a reusable starter template (on-device). Absent → the button is hidden. */
  onSaveTemplate?: () => void;
}

export function MessageActions({ text, onFeedback, reaction, onUnsend, onEdit, onSaveTemplate }: MessageActionsProps) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (blocked / insecure context) — fail silently, never fake success */
    }
  };
  const btn = 'p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-white/5 transition-colors';
  return (
    <div className="flex items-center gap-0.5">
      <button type="button" onClick={copy} title="Copy" aria-label="Copy message" className={btn}>
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      {onFeedback && (
        <>
          <button type="button" onClick={() => onFeedback('up')} title="Good response" aria-label="Like" aria-pressed={reaction === 'up'} className={`${btn} ${reaction === 'up' ? 'text-emerald-400' : ''}`}>
            <ThumbsUp className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => onFeedback('down')} title="Bad response" aria-label="Dislike" aria-pressed={reaction === 'down'} className={`${btn} ${reaction === 'down' ? 'text-amber-400' : ''}`}>
            <ThumbsDown className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => onFeedback('report')} title="Report this message" aria-label="Report" aria-pressed={reaction === 'report'} className={`${btn} ${reaction === 'report' ? 'text-red-400' : ''}`}>
            <Flag className="w-3.5 h-3.5" />
          </button>
        </>
      )}
      {onSaveTemplate && (
        <button
          type="button"
          onClick={() => { onSaveTemplate(); setSaved(true); setTimeout(() => setSaved(false), 1500); }}
          title="Save as template — reuse this prompt to start a future app"
          aria-label="Save as template"
          className={`${btn} ${saved ? 'text-emerald-400' : 'hover:text-amber-300'}`}
        >
          {saved ? <Check className="w-3.5 h-3.5" /> : <Star className="w-3.5 h-3.5" />}
        </button>
      )}
      {onEdit && (
        <button type="button" onClick={onEdit} title="Edit — take this message back and re-write it" aria-label="Edit" className={`${btn} hover:text-indigo-300`}>
          <Pencil className="w-3.5 h-3.5" />
        </button>
      )}
      {onUnsend && (
        <button type="button" onClick={onUnsend} title="Unsend — stop the build and remove this message" aria-label="Unsend" className={`${btn} hover:text-red-400`}>
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
