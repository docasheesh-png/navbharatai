import { describe, it, expect } from 'vitest';
import { normalizeInlineComment, normalizeGeneralComment, normalizePrComments } from './prCommentMapping';

/**
 * ONE mapping for both GitHub clients (ROADMAP D3). These tests exist because the mapping used to
 * live inside GitHubAppClient and was about to be hand-copied into UserGitHubClient — the drift
 * pattern this repo has already paid for twice. Pinning the rules here means a change can never be
 * true for the platform's repos and false for the user's own.
 */

describe('normalizeInlineComment — an anchored review comment', () => {
  it('keeps the path and line that make it actionable', () => {
    const c = normalizeInlineComment({ id: 7, body: 'rename this', path: 'src/App.tsx', line: 42, position: 3, user: { login: 'reviewer' }, author_association: 'OWNER' });
    expect(c).toMatchObject({ id: 7, author: 'reviewer', body: 'rename this', path: 'src/App.tsx', line: 42, association: 'OWNER' });
  });

  it('carries GitHub\'s OWN outdated marker (position === null) rather than re-deriving it', () => {
    // Acting on a stale line number would send an edit to whatever occupies that line today, so the
    // triage must be able to refuse it — and only GitHub knows the hunk is gone.
    expect(normalizeInlineComment({ id: 1, position: null }).outdated).toBe(true);
    expect(normalizeInlineComment({ id: 1, position: 5 }).outdated).toBe(false);
  });

  it('a missing line becomes null, never 0 — 0 is a real line number to a caller', () => {
    expect(normalizeInlineComment({ id: 1 }).line).toBeNull();
    expect(normalizeInlineComment({ id: 1, line: 0 }).line).toBe(0);
  });

  it('survives a comment with nothing in it', () => {
    expect(normalizeInlineComment({})).toMatchObject({ id: 0, author: '', body: '' });
  });
});

describe('normalizeGeneralComment — a conversation comment', () => {
  it('carries NO path or line, because it genuinely has none', () => {
    // Defaulting them would manufacture an anchor GitHub never gave us and point a builder at an
    // arbitrary line of an arbitrary file.
    const c = normalizeGeneralComment({ id: 3, body: 'the login page is broken', user: { login: 'someone' } });
    expect(c.path).toBeUndefined();
    expect(c.line).toBeUndefined();
    expect(c.body).toBe('the login page is broken');
  });
});

describe('normalizePrComments — both lists, or nothing at all', () => {
  const ok = (body: unknown) => ({ ok: true, body });

  it('reads BOTH endpoints — inline first, then the conversation', () => {
    const rows = normalizePrComments(
      ok([{ id: 1, body: 'inline note', path: 'a.ts', line: 2, position: 1 }]),
      ok([{ id: 2, body: 'plain note' }]),
    );
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
    expect(rows[0].path).toBe('a.ts');
    expect(rows[1].path).toBeUndefined();
  });

  it('🔒 a FAILED half collapses the whole round to empty — never a partial answer', () => {
    // The dangerous, tempting behaviour: return the half that loaded. Then the round acts on an
    // incomplete picture of what the reviewer asked for while reporting success. Silence is
    // recoverable (press the button again); a confident half-answer is not.
    expect(normalizePrComments({ ok: false, body: [{ id: 1 }] }, ok([{ id: 2 }]))).toEqual([]);
    expect(normalizePrComments(ok([{ id: 1 }]), { ok: false, body: [{ id: 2 }] })).toEqual([]);
    expect(normalizePrComments({ ok: false, body: null }, { ok: false, body: null })).toEqual([]);
  });

  it('a non-array body contributes nothing instead of throwing', () => {
    expect(normalizePrComments(ok({ message: 'Not Found' }), ok(null))).toEqual([]);
    expect(normalizePrComments(ok(undefined), ok([{ id: 9, body: 'hi' }])).map((r) => r.id)).toEqual([9]);
  });

  it('both empty is a real, successful answer — an empty review is the common case', () => {
    expect(normalizePrComments(ok([]), ok([]))).toEqual([]);
  });
});
