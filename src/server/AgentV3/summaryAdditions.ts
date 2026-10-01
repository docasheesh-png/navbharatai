// AgentV3 — WHAT THE PLATFORM ADDED TO A SUCCESSFUL BUILD'S REPLY, SO IT CAN BE SHOWN LAST.
//
// 🔴 WHY (admin 2026-09-30: "app banne ke last me clearly user ko dikhe"). A build's `result.summary` is
// the model's own closing reply plus lines the platform appends after it: the "what this app needs from
// you" checklist (AppRequirements), honesty corrections (claimCorrection), the green-repair line, review
// offers, the live-preview line. The chat panel renders `summary` only for a FAILED build. On success
// the user reads the model's reply as it streamed, and nothing else. So every one of those appended lines
// — the key checklist first among them — reached the stream and was never on screen.
//
// The fix belongs on the server: the Android and iOS apps are BUNDLED, so a panel change reaches an
// installed phone only with a new store build, while a chat line the server sends reaches every client
// today. This module decides what that line says: the summary minus the part the user already saw.
//
// ⚠️ CONSERVATIVE BY DESIGN. If the model's reply cannot be found inside the summary, nothing is sent.
// A duplicated reply is worse than a missing note, and the caller records the miss so it is counted
// rather than guessed at.
//
// PURE — no I/O, never throws.
import { sanitizeResponseEmoji } from '../lib/responseEmoji';

/** Below this, a narrated line is a status blip, not the model's reply. */
const MIN_REPLY_CHARS = 40;

const squash = (t: string): string => t.replace(/\s+/g, ' ').trim();

/** Where `text` sits inside `summary`: exactly, or line by line with whitespace differences. */
function locate(summary: string, text: string): { start: number; end: number } | null {
  const t = text.trim();
  const exact = summary.indexOf(t);
  if (exact >= 0) return { start: exact, end: exact + t.length };
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const start = summary.indexOf(lines[0]);
  if (start < 0) return null;
  const last = lines[lines.length - 1];
  const lastAt = summary.indexOf(last, start);
  if (lastAt < 0) return null;
  const end = lastAt + last.length;
  return squash(summary.slice(start, end)) === squash(t) ? { start, end } : null;
}

export interface SummaryAdditions {
  /** Whether the model's reply was found in the summary. `false` ⇒ `text` is empty and nothing is sent. */
  matched: boolean;
  /** What the platform added around the reply, in order; `''` when nothing was added. */
  text: string;
}

/**
 * The part of a successful build's summary the user has NOT seen: the summary without the longest
 * already-narrated text it contains (the model's reply), and without any other narrated line repeated
 * inside what remains. PURE.
 */
export function summaryAdditions(summary: string, narrated: readonly string[]): SummaryAdditions {
  // The narrated reply passed through the event stream's emoji rule for a build still running
  // (AgentEventStream.withHonestEmoji), which drops celebration emoji; the summary did not. So "ready. 🎉"
  // in the summary never matched "ready." on screen, and every reply that celebrated lost its additions
  // (autopsy a106df77, SUMMARY_REPLY_NOT_FOUND). Both sides are compared after the same rule — and the
  // additions are emitted as a narration line, which applies it anyway.
  const s = sanitizeResponseEmoji(String(summary ?? ''), 'working');
  if (!s.trim()) return { matched: false, text: '' };
  const seen = (Array.isArray(narrated) ? narrated : [])
    .map((t) => String(t ?? ''))
    .filter((t) => t.trim().length >= MIN_REPLY_CHARS)
    .sort((a, b) => b.trim().length - a.trim().length);
  let reply: { start: number; end: number } | null = null;
  for (const t of seen) {
    reply = locate(s, t);
    if (reply) break;
  }
  if (!reply) return { matched: false, text: '' };
  let rest = `${s.slice(0, reply.start).trim()}\n\n${s.slice(reply.end).trim()}`;
  // A line that was ALSO narrated on its own must not appear twice.
  for (const t of seen) {
    const at = locate(rest, t);
    if (at) rest = `${rest.slice(0, at.start)}${rest.slice(at.end)}`;
  }
  return { matched: true, text: rest.replace(/\n{3,}/g, '\n\n').trim() };
}
