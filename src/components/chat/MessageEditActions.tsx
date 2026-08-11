// Delete and edit a message you already sent — the same two controls on every AI.
//
// ADMIN 2026-08-10: "NavBharatAI Pro me send kiye hue text ko delete kar sakte hai — yah sabhi jagah
// hona chahiye, saath me edit bhi kar sake (WhatsApp ke tarah)."
//
// The buttons are the easy half. The rules they enforce — that deleting a question also removes the
// answers to it, that editing rewinds so the AI can answer the NEW question, that an unchanged edit
// costs nothing and an emptied one is a delete — live in `lib/chatMessageActions.ts` and are proven
// there. This file is the surface.
//
// WHY ONLY THE USER'S OWN MESSAGES. An assistant reply is not the user's text; removing it would
// silently rewrite what they were told, which is a worse outcome than leaving a bad answer visible.
// Delete takes the replies with it because they belong to the question — that is a consequence of
// removing the question, not an edit of the AI's words.

import { useState } from 'react';
import { Pencil, Trash2, Check, X } from 'lucide-react';

export interface MessageEditActionsProps {
  /** Current text, used to prefill the inline editor. */
  text: string;
  /** Remove this message and the answers that belong to it. */
  onDelete: () => void;
  /** Commit an edit: the host rewinds to this point and re-sends. '' means the user emptied it. */
  onEdit: (next: string) => void;
  /** Hidden entirely while a turn is in flight — rewinding under a running answer is not a state we
   *  can honestly represent, and a disabled-looking button the user can still press is worse. */
  disabled?: boolean;
  className?: string;
}

export function MessageEditActions({ text, onDelete, onEdit, disabled, className }: MessageEditActionsProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  if (disabled) return null;

  const commit = () => { setEditing(false); onEdit(draft); };
  const cancel = () => { setEditing(false); setDraft(text); };

  if (editing) {
    return (
      <div className={`mt-1.5 w-full ${className ?? ''}`}>
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter commits, Shift+Enter is a newline, Escape abandons — the shape people already
            // know from every message box. Deliberately NOT the shared send-toggle: this is a small
            // inline editor, not the composer, and a toggle that hides "how do I save this?" behind a
            // preference set on another screen would be a trap.
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
          rows={2}
          className="w-full resize-none rounded-lg bg-black/30 border border-indigo-500/40 px-2 py-1.5 text-[12px] text-white outline-none focus:border-indigo-400"
        />
        <div className="mt-1 flex items-center gap-1.5">
          <button
            type="button"
            onClick={commit}
            title="Save and ask again"
            className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30"
          >
            <Check className="w-3 h-3" /> Save
          </button>
          <button
            type="button"
            onClick={cancel}
            title="Cancel"
            className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg bg-white/5 text-[#8b949e] hover:text-white hover:bg-white/10"
          >
            <X className="w-3 h-3" /> Cancel
          </button>
          <span className="text-[9px] text-[#586069]">Everything after this is replaced by the new answer</span>
        </div>
      </div>
    );
  }

  const btn = 'p-1 rounded text-[#484f58] transition-colors';
  return (
    <div className={`flex items-center gap-0.5 ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => { setDraft(text); setEditing(true); }}
        title="Edit — re-write this and get a new answer"
        aria-label="Edit message"
        className={`${btn} hover:text-indigo-400 hover:bg-white/10`}
      >
        <Pencil className="w-3 h-3" />
      </button>
      <button
        type="button"
        // Asked here so no screen can ship a delete that skips the question. The wording names the
        // consequence people do not expect — the replies go too.
        onClick={() => { if (window.confirm('Delete this message? The replies to it will go as well.')) onDelete(); }}
        title="Delete this message and its replies"
        aria-label="Delete message"
        className={`${btn} hover:text-red-400 hover:bg-white/10`}
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}
