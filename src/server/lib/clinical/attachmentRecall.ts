// PROFESSIONALS — ATTACHMENT RECALL (admin 2026-08-19, the sibling of Doctor AI's report memory).
//
// THE SAME BUG CLASS, one architecture over: in the config-driven Professionals route (Teacher, Lawyer,
// CA, …) an attached image/PDF is turned into TEXT by the vision-describe chain and prepended to that
// ONE turn's message. The chat history is owned by the client, which stores what the user TYPED — so
// the description is never in history, and the next turn ("us report me kya likha tha?") reaches the
// model with no trace of the file. Same user-visible failure as the Doctor AI transcript, different
// cause: there the image was dropped, here the text derived from it is.
//
// WHY TEXT AND NOT THE FILE: the professional engine is text-only by design, and the description has
// ALREADY been paid for on the turn it was produced. Remembering that text costs nothing and needs no
// second vision call — re-describing the image would spend real money to recover something we had.
//
// PURE (injected clock, no I/O).

/** How long a description stays recallable — a working-session lifetime, not a record. */
const RECALL_TTL_MS = 6 * 60 * 60 * 1000;
/** Kept per session; a conversation rarely juggles more than a few files at once. */
const MAX_PER_SESSION = 3;
/** Descriptions are model output and can be long; bound what we carry into a later prompt. */
const MAX_CHARS = 4000;

interface RecalledEntry {
  /** The vision-derived text block exactly as it was given to the model on the original turn. */
  text: string;
  ts: number;
}

/**
 * Does this follow-up refer to a file sent earlier?
 *
 * Narrower than Doctor AI's matcher on purpose: a Teacher/Lawyer conversation is mostly ordinary text,
 * so recall fires on words that genuinely point AT an attachment rather than on any topical noun.
 */
export function referencesEarlierAttachment(message: string): boolean {
  const m = ` ${String(message || '').toLowerCase()} `;
  if (!m.trim()) return false;
  return /\b(file|document|doc|pdf|image|photo|picture|screenshot|attachment|attached|report|paper|sheet|slide|scan|upload(ed)?|bheja|bheji|bheje|attach ki|jo (bheja|bheji|diya|di)|us (file|document|report|image|photo|pdf)|is (file|document|report|image|photo|pdf))\b/.test(m);
}

/** Per-session memory of what each attachment said, so a later turn can be answered from it. */
export class AttachmentRecallStore {
  private bySession = new Map<string, RecalledEntry[]>();

  remember(sessionId: string, text: string, now: number): void {
    const clean = String(text || '').trim();
    if (!sessionId || !clean) return;
    const list = this.bySession.get(sessionId) || [];
    list.push({ text: clean.slice(0, MAX_CHARS), ts: now });
    while (list.length > MAX_PER_SESSION) list.shift();
    this.bySession.set(sessionId, list);
  }

  /** The still-fresh descriptions for this session, oldest first. */
  recall(sessionId: string, now: number): string[] {
    const list = this.bySession.get(sessionId);
    if (!list?.length) return [];
    const fresh = list.filter((e) => now - e.ts <= RECALL_TTL_MS);
    if (!fresh.length) {
      this.bySession.delete(sessionId);
      return [];
    }
    return fresh.map((e) => e.text);
  }

  sweep(now: number): void {
    for (const [id, list] of this.bySession.entries()) {
      const newest = list[list.length - 1];
      if (!newest || now - newest.ts > RECALL_TTL_MS) this.bySession.delete(id);
    }
  }
}

/**
 * The block prepended to a follow-up turn so the assistant can answer from the file it was shown
 * earlier. Honest framing: it is stated as a record of what was read, never as a fresh look at the file.
 */
export function buildRecallBlock(texts: string[]): string {
  if (!texts.length) return '';
  return [
    '[EARLIER ATTACHMENT(S) IN THIS CONVERSATION — this is what you read from the file(s) the user sent before. Answer their question from this; if it does not contain the detail they are asking about, say so and ask them to send the file again.]',
    ...texts,
    '[END OF EARLIER ATTACHMENT(S)]',
  ].join('\n\n');
}
