// WHICH CONVERSATION A PROFESSIONAL TURN BELONGS TO (admin 2026-09-21: five chats at once, and
// *"ek chat ki baat/memory 2nd me na jaye"*).
//
// The client mints a conversation id per chat window and sends it with every turn. On the server it
// does exactly two things, both under the VERIFIED user id (so it can only ever reach that user's own
// conversations): it decides which semantic-memory chunks this turn may recall and which it writes, and
// it keys the attachment recall so a file sent in one window is never handed to another.
//
// Pure, so the two rules are unit-testable without a request.

/** The shape a client-minted conversation id must have. Anything else is treated as absent. */
const CONVERSATION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The conversation id from a request body, or `undefined` when none was sent or it is not a plausible
 * id. `undefined` means the LEGACY, id-less conversation (a client built before this change) — see
 * `MemoryChunk.conversationId` for why that is a conversation of its own and never "all of them".
 */
export function conversationIdFromBody(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const id = raw.trim();
  return CONVERSATION_ID_RE.test(id) ? id : undefined;
}

/**
 * The attachment-recall key for one conversation. It used to be `${uid}:${professionalId}` — one pool
 * per professional — so a report uploaded to Teacher AI in chat A answered "us report me kya likha
 * tha?" in chat B. The conversation is part of the key now; the legacy (id-less) conversation keeps a
 * key of its own, so it cannot reach a named conversation's files either.
 */
export function attachmentRecallKey(userId: string, professionalId: string, conversationId: string | undefined): string {
  return `${userId}:${professionalId}#${conversationId ?? ''}`;
}
