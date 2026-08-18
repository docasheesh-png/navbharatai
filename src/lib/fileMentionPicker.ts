// C3 (client) — the `@` file picker's PURE rules, kept out of the composer so they are unit-tested
// rather than verified by typing into a live build.
//
// The picker is what makes the feature discoverable. Without it, `@` scoping only helps the handful of
// users who read documentation — and the whole point is that it saves tokens and wrong-file guesses for
// everyone.

/** How many suggestions to show. A long list is a menu to read, not a shortcut. */
export const MENTION_SUGGESTION_LIMIT = 8;

export interface MentionQuery {
  /** Text typed after the `@`, possibly empty right after typing `@`. */
  query: string;
  /** Index of the `@` in the text, so an accepted suggestion replaces exactly the right span. */
  at: number;
}

/**
 * Is the caret currently inside an `@mention` being typed?
 *
 * Returns null unless the `@` starts a word (start of text or after whitespace) and nothing since it is
 * whitespace — so `me@example.com` never opens the picker, and it closes as soon as the user types a
 * space. Only the text BEFORE the caret is considered, so editing earlier in the message does not
 * reopen a menu for a mention typed later. Pure.
 */
export function activeMentionQuery(text: string | null | undefined, caret: number): MentionQuery | null {
  const s = String(text ?? '');
  const pos = Math.max(0, Math.min(typeof caret === 'number' ? caret : s.length, s.length));
  const before = s.slice(0, pos);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null; // mid-word @ → an email, not a mention
  const query = before.slice(at + 1);
  if (/\s/.test(query)) return null; // the mention ended
  return { query, at };
}

/**
 * Rank file paths for a query.
 *
 * Ordered by how a person thinks about their own project: a FILENAME match beats a path match (typing
 * "head" means Header.tsx, not `src/headless/thing.ts`), and a prefix beats a mid-string hit. Shallow
 * paths come first among equals because a project's own top-level files are the ones users mean, and
 * node_modules-ish depth is never what they want. Pure.
 */
export function rankMentionSuggestions(paths: readonly string[] | null | undefined, query: string, limit = MENTION_SUGGESTION_LIMIT): string[] {
  const all = (paths ?? []).filter((p): p is string => typeof p === 'string' && p.length > 0);
  const q = String(query ?? '').toLowerCase();
  if (!q) return [...all].sort(byDepthThenName).slice(0, limit);

  const scored: Array<{ p: string; score: number }> = [];
  for (const p of all) {
    const lower = p.toLowerCase();
    const base = lower.split('/').pop() ?? lower;
    let score = -1;
    if (base.startsWith(q)) score = 0;
    else if (base.includes(q)) score = 1;
    else if (lower.startsWith(q)) score = 2;
    else if (lower.includes(q)) score = 3;
    if (score >= 0) scored.push({ p, score });
  }
  scored.sort((a, b) => (a.score - b.score) || byDepthThenName(a.p, b.p));
  return scored.slice(0, limit).map((s) => s.p);
}

function byDepthThenName(a: string, b: string): number {
  const da = a.split('/').length;
  const db = b.split('/').length;
  return da !== db ? da - db : a.localeCompare(b);
}

/**
 * Replace the in-progress mention with the chosen path, returning the new text and where the caret
 * belongs. A trailing space is added so the user can keep typing straight away — and so the mention is
 * TERMINATED, which is what closes the picker. Pure.
 */
export function applyMentionSuggestion(text: string | null | undefined, mention: MentionQuery, path: string): { text: string; caret: number } {
  const s = String(text ?? '');
  const head = s.slice(0, mention.at);
  const tail = s.slice(mention.at + 1 + mention.query.length);
  const inserted = `@${path} `;
  return { text: `${head}${inserted}${tail}`, caret: head.length + inserted.length };
}
