// The per-message action row shown under every user + AI bubble. Copy works today; the feedback
// (👍/👎/report) and unsend buttons render ONLY when their handlers are wired (slices 2 & 3) — never a
// button that does nothing (the "real features only" rule). Kept tiny + presentational.

import { useState } from 'react';
import { Copy, Check, ThumbsUp, ThumbsDown, Flag, X, Pencil, Star } from 'lucide-react';
import { MESSAGE_ACTION_BUTTON_CLASS, MESSAGE_ACTION_ICON_CLASS } from '../chat/conversation';

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
  // The shared ghost-icon look (conversation.ts), so this row matches every other chat surface's.
  const btn = MESSAGE_ACTION_BUTTON_CLASS;
  const icon = MESSAGE_ACTION_ICON_CLASS;
  return (
    <div className="flex items-center gap-0.5">
      <button type="button" onClick={copy} title="Copy" aria-label="Copy message" className={btn}>
        {copied ? <Check className={`${icon} text-success`} /> : <Copy className={icon} />}
      </button>
      {onFeedback && (
        <>
          <button type="button" onClick={() => onFeedback('up')} title="Good response" aria-label="Like" aria-pressed={reaction === 'up'} className={`${btn} ${reaction === 'up' ? 'text-success' : ''}`}>
            <ThumbsUp className={icon} />
          </button>
          <button type="button" onClick={() => onFeedback('down')} title="Bad response" aria-label="Dislike" aria-pressed={reaction === 'down'} className={`${btn} ${reaction === 'down' ? 'text-warn' : ''}`}>
            <ThumbsDown className={icon} />
          </button>
          <button type="button" onClick={() => onFeedback('report')} title="Report this message" aria-label="Report" aria-pressed={reaction === 'report'} className={`${btn} ${reaction === 'report' ? 'text-danger' : ''}`}>
            <Flag className={icon} />
          </button>
        </>
      )}
      {onSaveTemplate && (
        <button
          type="button"
          onClick={() => { onSaveTemplate(); setSaved(true); setTimeout(() => setSaved(false), 1500); }}
          title="Save as template — reuse this prompt to start a future app"
          aria-label="Save as template"
          className={`${btn} ${saved ? 'text-success' : 'hover:text-warn'}`}
        >
          {saved ? <Check className={icon} /> : <Star className={icon} />}
        </button>
      )}
      {onEdit && (
        <button type="button" onClick={onEdit} title="Edit — take this message back and re-write it" aria-label="Edit" className={`${btn} hover:text-accent-text`}>
          <Pencil className={icon} />
        </button>
      )}
      {onUnsend && (
        <button type="button" onClick={onUnsend} title="Unsend — stop the build and remove this message" aria-label="Unsend" className={`${btn} hover:text-danger`}>
          <X className={icon} />
        </button>
      )}
    </div>
  );
}
