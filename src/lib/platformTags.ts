/**
 * 🔴 PLATFORM TEXT IS NEVER THE USER'S WORDS (admin 2026-10-17: free chat answered with
 * "[Follow-up. No greeting needed. Respond in same language as user.]" pasted into the reply).
 *
 * ROOT CAUSE, the class and not the line: platform-written context — instruction tags, conversation
 * memory, the canvas, live web results, a clinical snapshot — was concatenated INTO the user's message.
 * A model treats everything in the user turn as something the person said, so it quotes it back, obeys
 * it as the user's request, or answers "as you asked…". #3790 removed the client half; the server built
 * the same thing in four more places (chat memory/canvas/live results, the professionals' recall and
 * live results, the builder chat lane's live results, SDA's fake "user" case-context turns).
 *
 * This file is SHARED (client + server) and PURE. It knows the shapes those blocks were written in, so:
 *   • `containsPlatformTag` — the regression guard: no user-role content the server builds may match.
 *   • `stripPlatformTags` — strip-on-read for chats saved while the bug was live (a stored user bubble
 *     or an assistant reply that quoted a tag), so the UI never shows them and they are never re-sent.
 *
 * The other half — where platform context GOES instead — is `src/server/lib/platformContext.ts`.
 */

/** Exact shapes the platform has written into user turns. Each is matched only at its real form. */
const BLOCK_PATTERNS: RegExp[] = [
  // client (pre-#3790): "[SESSION MEMORY]\n<summary>\n\n---\n\n<message>"
  /\[SESSION MEMORY\]\n[\s\S]*?\n\n---\n\n/g,
  // server chat.ts (pre-fix): "[CONVERSATION MEMORY — summary of earlier discussion:\n…]\n\nCurrent message: "
  /\[CONVERSATION MEMORY — summary of earlier discussion:\n[\s\S]*?\]\n\nCurrent message: /g,
  // server chat.ts canvas variant: "[MEMORY: …]\n\n"
  /\[MEMORY: [\s\S]*?\]\n\n/g,
  // SDA (pre-fix) fake user turns
  /\[CASE_CONTEXT\][\s\S]*?\[\/CASE_CONTEXT\]\n?(Continue the clinical assessment\.[^\n]*\n?)?/g,
  /\[EARLIER SESSION — \d+ exchanges before the recent history below\]\n(?:(?:Dr|SDA): [^\n]*\n?)*/g,
  // live web results / semantic recall prepended with a "---" separator (chat, professionals, builder chat)
  /(?:^|\n)LIVE WEB RESULTS \(fetched just now, [^)]*\):[\s\S]*?\n\n---\n/g,
  /(?:^|\n)LIVE TRANSIT DATA \(fetched just now[\s\S]*?\n\n---\n/g,
  /(?:^|\n)RELEVANT THINGS FROM EARLIER CONVERSATIONS WITH THIS PERSON[\s\S]*?\n\n---\n/g,
];

/** One-line directives the client used to prepend (pre-#3790). The whole line goes. */
const LINE_PATTERNS: RegExp[] = [
  /^[ \t]*\[(?:FIX|ADD|EDIT|CREATE) MODE\][^\n]*(?:\n|$)/gm,
  /^[ \t]*\[FOLLOW-UP\][^\n]*(?:\n|$)/gm,
  /^[ \t]*\[COMPONENT FOCUS\][^\n]*(?:\n|$)/gm,
  /^[ \t]*\[ERROR DETECTED\][^\n]*(?:\n|$)/gm,
  /^[ \t]*\[AUDITOR_ACTIVATION\][^\n]*(?:\n|$)/gm,
  /^[ \t]*\[GITHub_ACTIVATION\][^\n]*(?:\n|$)/gm,
];

/** The exact sentence that leaked into replies — removed wherever it sits, it is never real content. */
const FOLLOW_UP_TAG = /\[Follow-up\. No greeting needed\. Respond in same language as user\.\][ \t]*\n{0,2}/g;

/** Detection-only markers (a platform block that is not one of the legacy stored shapes above). */
const MARKER_PATTERNS: RegExp[] = [
  /\[CANVAS — current app on canvas/,
  /PLATFORM CONTEXT — supplied by NavBharatAI/,
];

const reset = (r: RegExp) => { r.lastIndex = 0; return r; };

/** True when the text carries any platform-written tag or block. PURE. */
export function containsPlatformTag(text: unknown): boolean {
  if (typeof text !== 'string' || !text) return false;
  return [...BLOCK_PATTERNS, ...LINE_PATTERNS, FOLLOW_UP_TAG, ...MARKER_PATTERNS].some((r) => reset(r).test(text));
}

/**
 * Remove platform-written tags/blocks from a stored message. PURE, never throws. Text with no tag is
 * returned as the SAME string (so callers can keep object identity and nothing re-renders).
 */
export function stripPlatformTags(text: string): string {
  if (typeof text !== 'string' || !text || !containsPlatformTag(text)) return text;
  let out = text;
  for (const r of BLOCK_PATTERNS) out = out.replace(reset(r), (m) => (m.startsWith('\n') ? '\n' : ''));
  for (const r of LINE_PATTERNS) out = out.replace(reset(r), '');
  out = out.replace(reset(FOLLOW_UP_TAG), '');
  if (out === text) return text;
  out = out.replace(/^\s+/, '');
  // Never turn a real message into nothing because it happened to be only a tag: keep the original.
  return out.trim() ? out : text;
}

/**
 * Strip-on-read for a list of chat turns of either shape the app stores ({sender,text} on the client,
 * {role,content} on the server). Untouched turns keep their identity; the array is new only if changed.
 */
export function cleanTurns<T>(turns: T[]): T[] {
  if (!Array.isArray(turns)) return turns;
  let changed = false;
  const out = turns.map((t) => {
    if (!t || typeof t !== 'object') return t;
    const rec = t as Record<string, unknown>;
    let next: Record<string, unknown> | null = null;
    for (const key of ['text', 'content'] as const) {
      const v = rec[key];
      if (typeof v === 'string') {
        const s = stripPlatformTags(v);
        if (s !== v) { next = next ?? { ...rec }; next[key] = s; }
      }
    }
    if (next) { changed = true; return next as T; }
    return t;
  });
  return changed ? out : turns;
}
