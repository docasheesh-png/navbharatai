// The bounds of ONE free-chat request — decided before any provider is called.
//
// 🔴 WHY (forensic audit 2026-10-04, P1). `POST /api/chat/navbharat(ai)` took the message, the attachment
// list and the history from the body with no size or count bound beyond the 30 MB JSON limit. For a
// signed-in account the guest quota does not apply and the route charges nothing, so the only bound was
// the per-minute limiter. A multi-megabyte prompt overflowed the free model onto PAID rungs; a list of
// PDFs went straight to paid vision; and an oversized prompt repeated every few seconds kept the free
// provider's circuit breaker open for every other user. Each of those is bounded here, in one pure place.
//
// The numbers are far above what the app itself sends (the client's window is at most 120 turns inside
// a 48,000-character budget — `lib/chatContextWindow.ts`), so no real conversation meets them; they
// exist to bound what a SCRIPT can send.
//
// 🔴 THE BOUND IS NOW ON CHARACTERS, NOT ONLY ON TURNS (admin 2026-11-25, the forgetting report).
// A per-turn-count cap of 60 was both too loose and too tight: 60 turns at 4,000 characters is a
// 240,000-character prompt — the very overflow onto paid rungs this file exists to stop — while a
// real conversation of 70 short turns, costing a twentieth of that, was cut off at the OLDEST end,
// which is exactly the opening the user expects to be remembered. `CHAT_MAX_HISTORY_CHARS` bounds
// what actually costs money, so the turn cap can be generous without widening the worst case: the
// new worst case (120,000 characters) is HALF the old one.

import { cleanTurns } from '../../lib/platformTags';

export const CHAT_MAX_MESSAGE_CHARS = 100_000;
export const CHAT_MAX_ATTACHMENTS = 10;
export const CHAT_MAX_VISION_ATTACHMENTS = 5;
export const CHAT_MAX_HISTORY_TURNS = 200;
export const CHAT_MAX_HISTORY_TURN_CHARS = 4_000;
export const CHAT_MAX_HISTORY_CHARS = 120_000;

export type ChatLimitVerdict =
  | { ok: true; history: unknown[] }
  | { ok: false; status: 413; reply: string };

/** PURE. Refuse what cannot be a real chat turn; trim the history to its bound (never refuse for it). */
export function checkChatInput(input: { message: unknown; fileAttachments: unknown; history: unknown }): ChatLimitVerdict {
  const message = typeof input.message === 'string' ? input.message : '';
  if (message.length > CHAT_MAX_MESSAGE_CHARS) {
    return { ok: false, status: 413, reply: `That message is too long (${message.length.toLocaleString()} characters; the limit is ${CHAT_MAX_MESSAGE_CHARS.toLocaleString()}). Please attach it as a file or send it in parts.` };
  }
  const atts = Array.isArray(input.fileAttachments) ? input.fileAttachments : [];
  if (atts.length > CHAT_MAX_ATTACHMENTS) {
    return { ok: false, status: 413, reply: `Please attach at most ${CHAT_MAX_ATTACHMENTS} files in one message.` };
  }
  const vision = atts.filter((f) => {
    const t = typeof (f as { type?: unknown })?.type === 'string' ? (f as { type: string }).type : '';
    return t.startsWith('image/') || t === 'application/pdf';
  }).length;
  if (vision > CHAT_MAX_VISION_ATTACHMENTS) {
    return { ok: false, status: 413, reply: `Please attach at most ${CHAT_MAX_VISION_ATTACHMENTS} images or PDFs in one message.` };
  }
  const raw = Array.isArray(input.history) ? input.history : [];
  // Strip-on-read (admin 2026-10-17): a chat saved while platform tags leaked into turns must not
  // re-send them to the model, or the model learns to quote them again (lib/platformTags.ts).
  const perTurn = cleanTurns(raw.slice(-CHAT_MAX_HISTORY_TURNS)).map((m) => {
    if (!m || typeof m !== 'object') return m;
    const t = (m as { text?: unknown }).text;
    return typeof t === 'string' && t.length > CHAT_MAX_HISTORY_TURN_CHARS ? { ...(m as object), text: t.slice(0, CHAT_MAX_HISTORY_TURN_CHARS) } : m;
  });
  // Drop the OLDEST turns, one at a time, until the whole history fits the character bound. Keeping
  // the newest is the only safe direction: the latest turn is the one the reply answers.
  const turnChars = (m: unknown) => {
    const t = (m as { text?: unknown } | null)?.text;
    return typeof t === 'string' ? t.length : 0;
  };
  let total = perTurn.reduce((sum, m) => sum + turnChars(m), 0);
  let from = 0;
  while (from < perTurn.length && total > CHAT_MAX_HISTORY_CHARS) { total -= turnChars(perTurn[from]); from += 1; }
  return { ok: true, history: from ? perTurn.slice(from) : perTurn };
}
