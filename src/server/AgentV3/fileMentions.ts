// C3 — "@src/App.tsx make the header sticky": naming the file you mean (ROADMAP §8C).
//
// WHY IT PAYS FOR ITSELF. Without it, a request like "make the header sticky" starts with the builder
// SEARCHING — grep, glob, reading candidates — before it can change anything. That search is billed
// tokens and it is also where accuracy is lost: on a project with three header-ish files it can pick the
// wrong one, and the user pays again for the correction. Naming the file removes both costs at once.
//
// 🔒 A MENTION IS A CLAIM ABOUT THE PROJECT, SO IT IS CHECKED. Only paths that genuinely exist become
// scope. A mention we cannot resolve is REPORTED to the user, never silently dropped — silently ignoring
// "@src/Header.tsx" is indistinguishable from the AI disregarding the request, which is precisely the
// class of "it ignored what I said" complaint this feature exists to end.
//
// Pure — parsing and block assembly, so resolution is a test rather than a guess.

/** Most mentions we will honour in one message. Past this it is not scoping, it is the whole project. */
export const MAX_FILE_MENTIONS = 10;

/**
 * Matches `@` followed by a path-ish token: letters, digits, `_ - . / @` — enough for `@src/App.tsx`,
 * `@package.json` and `@apps/web/src/main.ts`, while stopping at whitespace and at sentence punctuation
 * so "@src/App.tsx, please" does not swallow the comma.
 *
 * Must be preceded by start-of-string or whitespace, so an email address (`me@example.com`) and a
 * decorator (`@Component`) inside pasted code are not read as file mentions.
 */
const MENTION_RE = /(^|\s)@([A-Za-z0-9_./@-]+[A-Za-z0-9_/-]|[A-Za-z0-9_-]+)/g;

export interface FileMentions {
  /** Mentioned paths that really exist, in the order written, deduped and capped. */
  resolved: string[];
  /** Mentioned tokens that match no file. Told to the user; never silently dropped. */
  unresolved: string[];
}

/**
 * Find the files a message names with `@`.
 *
 * Resolution is forgiving in the ways a person is careless and strict everywhere else: an exact match
 * first, then a case-insensitive match, then a unique basename match (so `@App.tsx` finds
 * `src/App.tsx`). A basename that matches MORE than one file is left UNRESOLVED rather than guessed —
 * picking one of three `index.ts` files silently is worse than asking. Pure.
 */
export function parseFileMentions(prompt: string | null | undefined, knownPaths: readonly string[] | null | undefined): FileMentions {
  const text = String(prompt ?? '');
  const paths = (knownPaths ?? []).filter((p): p is string => typeof p === 'string' && p.length > 0);
  const resolved: string[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();

  const push = (map: Map<string, string[]>, key: string, value: string): void => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  const byLower = new Map<string, string[]>();
  const byBase = new Map<string, string[]>();
  for (const p of paths) {
    const clean = p.replace(/^\.\//, '');
    push(byLower, clean.toLowerCase(), p);
    push(byBase, (clean.split('/').pop() ?? clean).toLowerCase(), p);
  }

  for (const m of text.matchAll(MENTION_RE)) {
    const token = m[2];
    if (!token) continue;
    const key = token.replace(/^\.\//, '').toLowerCase();
    const exact = byLower.get(key);
    // A basename is only usable when it is UNAMBIGUOUS — three index.ts files must not silently
    // become whichever one happened to be listed first.
    const base = byBase.get(key);
    const hit = exact?.[0] ?? (base && base.length === 1 ? base[0] : undefined);
    if (!hit) {
      if (!unresolved.includes(token)) unresolved.push(token);
      continue;
    }
    if (seen.has(hit)) continue;
    seen.add(hit);
    if (resolved.length < MAX_FILE_MENTIONS) resolved.push(hit);
  }

  return { resolved, unresolved };
}

/**
 * The prompt block naming the scope. Returns '' when nothing resolved, so the caller can prepend
 * unconditionally.
 *
 * Says "start here", not "only touch these": a sticky header may genuinely need a CSS file the user did
 * not name, and a hard restriction would produce a half-done change that looks like a bug. The point is
 * to remove the SEARCH, not to handcuff the fix. Pure.
 */
export function fileMentionsBlock(mentions: FileMentions | null | undefined): string {
  const resolved = mentions?.resolved ?? [];
  if (resolved.length === 0) return '';
  const list = resolved.map((p) => `- ${p}`).join('\n');
  return [
    'FILES THE USER NAMED — they pointed at these with `@`, so start here instead of searching for the right file:',
    list,
    'Read them first. If the change genuinely needs another file too, edit that as well — this is the starting point, not a restriction.',
  ].join('\n');
}

/**
 * What to tell the user about a mention that matched nothing. '' when everything resolved.
 *
 * Naming the failure is the whole point: a user who typed `@src/Header.tsx` and got a change somewhere
 * else needs to know we could not find their file, not be left thinking the AI ignored them. Pure.
 */
export function unresolvedMentionsNotice(mentions: FileMentions | null | undefined): string {
  const unresolved = mentions?.unresolved ?? [];
  if (unresolved.length === 0) return '';
  const list = unresolved.map((t) => `@${t}`).join(', ');
  return unresolved.length === 1
    ? `⚠️ I could not find ${list} in this project, so I worked from the rest of your message.`
    : `⚠️ I could not find these in this project: ${list} — I worked from the rest of your message.`;
}
