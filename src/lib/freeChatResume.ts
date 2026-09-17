// freeChatResume — putting the Free chat's own conversation back on the screen, with the SAME id.
//
// 🔴 THE HALF THAT MATTERS, AND THE REASON THIS IS NOT JUST "RESTORE THE MESSAGES".
//
// `App.tsx` initialised `currentSessionId` to a fresh `Date.now()` on every single load, while
// `initialNbiMessages()` returned a welcome line. So a reload did not merely hide yesterday's
// conversation — it ORPHANED it. The next thing the user typed opened a brand-new session row, and
// their History slowly filled with one-message fragments of conversations they believed they were
// still inside.
//
// Restoring the TRANSCRIPT alone would have made that worse, not better: the old messages would be
// on screen, and the save effect would copy them into a NEW row on every reload — one duplicate per
// refresh, for ever. The transcript and the id have to come back together or neither should.
//
// So this module answers exactly one question — *which saved conversation is the Free chat
// continuing, and what is in it?* — and the caller uses BOTH halves of the answer.
//
// PURE over the already-saved sessions array (`navbharat_sessions`), so every rule below is pinned
// by tests rather than living inside a 4,300-line component.

import type { ChatSession, Message } from '../types';
import type { LastPlace } from './lastPlace';

/**
 * How many of the older, already-collapsed turns (`restoredMessages`) come back with the
 * conversation — the same 40 the existing UCI-restore path shows, matched deliberately rather than
 * chosen again so "resume" and "open from History" do not disagree about how much context returns.
 *
 * 🔴 IT DOES **NOT** CAP `messages`, AND THAT DISTINCTION IS THE WHOLE REASON THIS CONSTANT HAS A
 * COMMENT. App.tsx's save effect writes `messages: <whatever is on screen>` back into the saved
 * session on the next change, keeping `restoredMessages` as it found them. So anything dropped from
 * `messages` while resuming is not hidden — it is **deleted from the user's saved conversation on
 * the first message they send afterwards.** A `slice(-40)` over the whole transcript (this file's
 * first draft) would have silently destroyed every turn older than the last forty in every
 * conversation the feature resumed. `restoredMessages` is safe to trim precisely because that
 * effect never writes to it.
 */
export const RESUME_VISIBLE_MESSAGES = 40;

/** Is this message part of a real conversation, or the app talking to itself? */
function isRealMessage(m: Message | undefined): boolean {
  if (!m) return false;
  const id = String((m as { id?: string }).id ?? '');
  if (id.includes('welcome') || id === 'lang-picker') return false;
  return String((m as { text?: string }).text ?? '').trim().length > 0;
}

/**
 * Does this saved session belong to the FREE chat?
 *
 * Deliberately a NEGATIVE test against the other surfaces rather than a positive one for 'navbharatai':
 * a session saved by an older build, or by an agent nobody has thought about since, is still a free
 * chat — it is what the Free surface saved. Only sessions that clearly belong somewhere else are
 * excluded, so an unrecognised agent resumes instead of silently vanishing.
 */
export function isFreeSession(session: Partial<ChatSession> & { meta?: { tab?: string } }): boolean {
  const agent = String(
    (session as { currentAgent?: string }).currentAgent
    ?? session.agent
    ?? (session as { originalAgent?: string }).originalAgent
    ?? '',
  );
  const tab = String(session.meta?.tab ?? '');
  if (tab && tab !== 'nbi_chat') return false;
  if (agent.includes('pro') || agent.startsWith('vishwakarma') || agent === 'agentv3' || agent === 'sda') return false;
  if (typeof session.id === 'string' && session.id.startsWith('v3_')) return false;
  return true;
}

export interface FreeChatResume {
  sessionId: string;
  messages: Message[];
}

/**
 * Which Free-chat conversation should be on screen, and what of it?
 *
 * `null` means "start fresh" — today's behaviour exactly, so every path that has nothing to resume
 * is byte-identical to before this existed.
 */
export function pickFreeChatResume(
  sessions: unknown,
  lastPlace: LastPlace | null,
): FreeChatResume | null {
  if (!Array.isArray(sessions) || sessions.length === 0) return null;

  const free = (sessions as ChatSession[]).filter(
    (s) => s && typeof s.id === 'string' && s.id && isFreeSession(s),
  );
  if (free.length === 0) return null;

  // The remembered place wins when it names one of these sessions. Falling straight to "the newest"
  // would quietly ignore the user's actual last conversation whenever another device synced a newer
  // session in behind them.
  const named = lastPlace?.view === 'nbi_chat' && lastPlace.sessionId
    ? free.find((s) => s.id === lastPlace.sessionId)
    : undefined;

  const newest = [...free].sort(
    (a, b) => new Date(b.lastUpdated || 0).getTime() - new Date(a.lastUpdated || 0).getTime(),
  )[0];

  const chosen = named ?? newest;
  if (!chosen) return null;

  // `restoredMessages` holds the collapsed older turns of a previously-restored session, and
  // `messages` the live ones — the same two halves `handleRestoreUci` joins. The older half is
  // TRIMMED (it stays whole in the saved session, which nothing here rewrites); the live half is
  // carried in FULL, because putting it on screen is what decides what gets saved back.
  const older = Array.isArray((chosen as { restoredMessages?: Message[] }).restoredMessages)
    ? ((chosen as { restoredMessages?: Message[] }).restoredMessages as Message[])
    : [];
  const live = Array.isArray(chosen.messages) ? chosen.messages : [];
  const all = [...older.slice(-RESUME_VISIBLE_MESSAGES), ...live];

  // A conversation the user never actually had is not worth resuming into — they would land on a
  // greeting that looks like a fresh chat while the app quietly adopted an old session's id.
  if (!all.some(isRealMessage)) return null;

  return { sessionId: chosen.id, messages: all };
}
