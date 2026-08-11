// WHAT "DELETE" AND "EDIT" MEAN FOR A SENT MESSAGE — one set of rules for every AI in the app.
//
// ADMIN 2026-08-10: "NavBharatAI Pro me send kiye hue text ko delete kar sakte hai — yah sabhi jagah
// hona chahiye, saath me edit bhi kar sake (WhatsApp ke tarah)."
//
// The hard part is NOT the buttons. A chat with an AI is not WhatsApp: every assistant reply is an
// ANSWER TO a particular question. So the moment a question changes or disappears, the replies that
// followed it stop making sense — they are answers to something that is no longer there. WhatsApp
// never has this problem because nobody's next message was *derived* from the one you edited.
//
// Hence the two rules below, which are the whole design:
//
//  DELETE removes the message AND everything the AI said in reply to it, up to the user's next
//  message. Leaving an orphaned answer behind would be worse than the message the user wanted gone —
//  it reads as the AI answering a question the user never asked.
//
//  EDIT rewinds the conversation to that point: the edited text stands, and everything after it is
//  dropped so the AI can answer the NEW question. That is what a user means by "edit" here — they
//  want a different answer, not a different transcript. The edited message is marked so the history
//  never quietly pretends the original was never sent.
//
// PURE — no React, no network, no store. Given a transcript and an action, it returns the transcript
// that should result, so every one of these rules is unit-testable and identical on all four AIs.

export interface ChatMsgLike {
  id: string;
  sender: 'user' | 'ai';
  text?: string;
  /** Set when the user edited this message after sending it — the UI shows an "edited" marker. */
  edited?: boolean;
}

/** How far the AI is allowed to be rewound. Deleting one message must never wipe a whole session. */
export function repliesTo<T extends ChatMsgLike>(messages: readonly T[], index: number): number {
  let end = index + 1;
  while (end < messages.length && messages[end]?.sender === 'ai') end++;
  return end; // exclusive
}

/** True when this message may be deleted/edited: the USER's own, and it exists. PURE. */
export function canEditMessage<T extends ChatMsgLike>(messages: readonly T[], id: string): boolean {
  const m = messages.find((x) => x?.id === id);
  return !!m && m.sender === 'user';
}

/**
 * Delete a user message AND the answers that belong to it.
 *
 * An AI reply is an answer to the question above it, so leaving it behind after its question is gone
 * produces a transcript where the assistant answers something nobody asked — more confusing than the
 * message the user wanted removed. Only the replies UP TO the user's next message go; the rest of the
 * conversation is untouched. Deleting an assistant message alone is not offered: it is not the user's
 * text, and removing it would silently rewrite what they were told. PURE.
 */
export function deleteMessage<T extends ChatMsgLike>(messages: readonly T[], id: string): T[] {
  const list = [...(messages ?? [])];
  const i = list.findIndex((m) => m?.id === id);
  if (i < 0 || list[i].sender !== 'user') return list;
  list.splice(i, repliesTo(list, i) - i);
  return list;
}

export interface EditResult<T> {
  /** The transcript to display — everything from the edited message onward is gone except the edit. */
  messages: T[];
  /** The text to re-send, or '' when nothing should be sent (the edit changed nothing). */
  resend: string;
}

/**
 * Edit a sent message: the new text stands where the old one was, everything after it is dropped, and
 * the new text is handed back to be re-sent so the AI answers the question the user actually meant.
 *
 * WHY DROP WHAT FOLLOWS. Keeping the later turns would leave answers derived from the OLD wording
 * sitting under the new one — the transcript would look coherent while being quietly wrong, which is
 * the worst of both. Rewinding is also what the user is asking for: they edit because they want a
 * different answer.
 *
 * An edit to identical text is a no-op — no rewind, no re-send, nothing lost — because a user who
 * opens the editor and changes their mind should not be punished with a wiped conversation. An empty
 * edit is treated as a DELETE, which is what emptying a message means everywhere else. PURE.
 */
export function editMessage<T extends ChatMsgLike>(messages: readonly T[], id: string, next: string): EditResult<T> {
  const list = [...(messages ?? [])];
  const i = list.findIndex((m) => m?.id === id);
  if (i < 0 || list[i].sender !== 'user') return { messages: list, resend: '' };
  const text = (next ?? '').trim();
  if (text === (list[i].text ?? '').trim()) return { messages: list, resend: '' }; // changed nothing
  if (!text) return { messages: deleteMessage(list, id), resend: '' };             // emptied ⇒ delete
  const edited = { ...list[i], text, edited: true } as T;
  return { messages: [...list.slice(0, i), edited], resend: text };
}

/** The marker shown beside an edited message — small, honest, and never hidden. PURE. */
export function editedLabel(lang: 'en' | 'hi' = 'en'): string {
  return lang === 'hi' ? 'बदला गया' : 'edited';
}

/**
 * How long after sending a message it can still be edited or deleted, in ms.
 *
 * Unlimited would let a user rewrite a conversation they have already acted on — and on a BUILD chat
 * the assistant's answers have already changed real files, so "rewinding" an hour-old instruction
 * would show a transcript that no longer matches the app on disk. A generous window covers the real
 * case (a typo spotted straight away) without pretending the past can be undone.
 */
export const EDIT_WINDOW_MS = 15 * 60_000;

export function withinEditWindow(sentAt: number, now: number, windowMs = EDIT_WINDOW_MS): boolean {
  if (!Number.isFinite(sentAt) || !Number.isFinite(now)) return false;
  return now - sentAt <= windowMs && now >= sentAt;
}
