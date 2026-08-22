// AgentV3 — ONE normalization of a GitHub PR comment, shared by every client that reads one.
//
// 🔒 WHY THIS FILE EXISTS (fourth absolute rule, "fix the class not the instance"): two clients read
// PR comments — GitHubAppClient (the platform org, via an installation token) and UserGitHubClient
// (the user's OWN repo, via their OAuth token). They differ ONLY in who they authenticate as and
// which owner is in the path; the mapping from GitHub's JSON to the shape the triage decides on is
// identical. Copied into both, it is a textbook drift candidate: this codebase has already paid for
// that mistake twice (four drifted copies of `safeRelPath`, retired model ids in five files). One
// mapping, one place, both callers.
//
// Everything here is PURE — no network, no token, no owner — so the rules below are unit-testable
// without GitHub, and a change to them cannot be true for one client and false for the other.

import type { PrComment } from './GitHubAppClient';

/** The raw comment shape from either comments endpoint (the fields we read, and no others). */
export interface RawPrComment {
  id?: number;
  body?: string;
  path?: string;
  line?: number | null;
  /**
   * GitHub's own marker: `null` means this comment's diff hunk NO LONGER EXISTS. Carried through as
   * `outdated` rather than re-derived, because acting on a stale line number would send an edit to
   * whatever happens to occupy that line today.
   */
  position?: number | null;
  user?: { login?: string };
  author_association?: string;
}

/**
 * An INLINE review comment — anchored to a line of the diff (`pulls/N/comments`).
 *
 * The anchor is what makes it actionable: a path and a line tell the builder exactly where to look.
 * `outdated` is preserved so the triage can refuse a comment whose code has already moved.
 */
export function normalizeInlineComment(r: RawPrComment): PrComment {
  return {
    id: r.id ?? 0,
    author: r.user?.login ?? '',
    body: r.body ?? '',
    path: r.path,
    line: typeof r.line === 'number' ? r.line : null,
    outdated: r.position === null,
    association: r.author_association,
  };
}

/**
 * A CONVERSATION comment — the thread below the diff (`issues/N/comments`).
 *
 * 🔒 DELIBERATELY CARRIES NO path/line, because it genuinely has none. Defaulting them to something
 * would manufacture an anchor GitHub never gave us and point a builder at an arbitrary line.
 */
export function normalizeGeneralComment(r: RawPrComment): PrComment {
  return {
    id: r.id ?? 0,
    author: r.user?.login ?? '',
    body: r.body ?? '',
    association: r.author_association,
  };
}

/** One list as its client read it: did the call succeed, and what came back. */
export interface CommentFetch {
  ok: boolean;
  body: unknown;
}

/**
 * Both lists, normalized and concatenated — inline first, then the conversation.
 *
 * 🔒 BOTH LISTS, ALWAYS. GitHub keeps them apart and reviewers use both, so reading only the inline
 * one would silently miss "the login page is broken" posted as a plain comment — which is how most
 * non-developers review.
 *
 * 🔒 EMPTY, NEVER PARTIAL — and this is the rule worth stating out loud, because the tempting
 * behaviour is the wrong one. If ONE of the two calls fails, returning the half that loaded looks
 * like a graceful degrade and is actually the most dangerous outcome available: the round then acts
 * on an incomplete picture of what the reviewer asked for, while reporting success. Silence is
 * recoverable — the user presses the button again. A confident half-answer is not. So a single
 * failed side collapses the whole round to [].
 *
 * A non-array body contributes nothing rather than throwing, for the same reason.
 */
export function normalizePrComments(inline: CommentFetch, general: CommentFetch): PrComment[] {
  if (!inline?.ok || !general?.ok) return [];
  const rows: PrComment[] = [];
  for (const r of Array.isArray(inline.body) ? (inline.body as RawPrComment[]) : []) rows.push(normalizeInlineComment(r ?? {}));
  for (const r of Array.isArray(general.body) ? (general.body as RawPrComment[]) : []) rows.push(normalizeGeneralComment(r ?? {}));
  return rows;
}
