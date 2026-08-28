// THE SHAPE OF A SAVED CHAT SESSION, MADE TRUE AT THE DOOR.
//
// 🔒 ROOT CAUSE (admin 2026-08-27, a crash reachable from the footer):
//
//     SOMETHING WENT WRONG
//     I.find is not a function. (In 'I.find(h=>h.sender==="user")', 'I.find' is undefined)
//
// That is `session.messages.find(m => m.sender === 'user')` in HistoryView — and note WHICH error it
// is. Not "cannot read property of undefined": the object EXISTS and has no `.find`. So `messages`
// was present and was not an array. The call site even used `?.`, which guards null and undefined and
// is no help at all against a value of the wrong TYPE — the exact false sense of safety that let this
// ship.
//
// A session arrives from two places, and NEITHER is under our control at read time:
//   • Firestore `chat_sessions` — spread straight in as `{ id, ...doc.data() }`. A document written by
//     an older client, a partial write, or any path that stored messages as a map rather than a list
//     produces this precisely.
//   • localStorage `navbharat_sessions` — JSON.parse of whatever is on that device, possibly written
//     by a build from months ago.
//
// 🔒 WHY A NORMALIZER AND NOT A GUARD AT THE CALL SITE. The same file ALREADY had the guard, twelve
// lines away: the search filter reads `s.messages && Array.isArray(s.messages) && …`. So the codebase
// knew the field was untrustworthy and defended exactly one of its two readers. Adding a third guard
// at the crash site would leave the fourth reader to be found by the next user. Fixing the VALUE where
// it enters means every reader — including ones not written yet — is safe without knowing any of this.

/** One message, reduced to the fields the app's own lists actually read. */
export interface SessionMessage {
  sender?: string;
  text?: string;
  [key: string]: unknown;
}

export interface ShapedSession {
  /** ALWAYS an array. That is this module's entire promise. */
  messages: SessionMessage[];
  [key: string]: unknown;
}

/**
 * A session's messages as a real array — whatever was actually stored.
 *
 * PURE, never throws. An array passes through untouched (same reference, so nothing re-renders that
 * would not have). Anything else becomes an empty array, because a wrong-shaped field carries no
 * messages we can honestly display, and an empty list renders as the "New Conversation" fallback the
 * UI already has for a session with nothing in it.
 *
 * A Firestore MAP is the one non-array worth recovering: `{ "0": {...}, "1": {...} }` is a list that
 * lost its type on the way through some writer, and its values are the messages. Recovering it shows
 * the user their real conversation title instead of "New Conversation" — the difference between a bug
 * that is fixed and a bug that is merely no longer fatal.
 */
export function messagesOf(session: unknown): SessionMessage[] {
  const raw = (session as { messages?: unknown } | null | undefined)?.messages;
  if (Array.isArray(raw)) return raw as SessionMessage[];
  if (raw && typeof raw === 'object') {
    const values = Object.values(raw as Record<string, unknown>);
    // Only when it really looks like a list of messages — never a stray settings object coerced into
    // rows the user never wrote.
    if (values.length > 0 && values.every((v) => v !== null && typeof v === 'object')) {
      return values as SessionMessage[];
    }
  }
  return [];
}

/**
 * Make a session safe to hand to any renderer. PURE.
 *
 * Only `messages` is rewritten, and only when it is not already an array — so a well-formed session is
 * returned with its own identity intact and this costs nothing on the normal path.
 */
export function shapeSession<T extends object>(session: T): T & ShapedSession {
  const messages = messagesOf(session);
  const current = (session as { messages?: unknown }).messages;
  if (current === messages) return session as T & ShapedSession;
  return { ...session, messages } as T & ShapedSession;
}

/**
 * The same for a whole list, including the list itself.
 *
 * A non-array here is just as possible as a non-array `messages` — `JSON.parse(localStorage…)` returns
 * whatever is on the device — and `.sort` or `.map` on it throws before any component renders.
 */
export function shapeSessions(raw: unknown): Array<Record<string, unknown> & ShapedSession> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => shapeSession(s));
}
