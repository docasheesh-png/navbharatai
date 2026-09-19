/**
 * A user pressed "Google Play bundle" on `12thmentors/app-50-files-2026-09-19`. The run died in TWELVE
 * SECONDS with all four signing secrets absent — and `signingReadiness` is precisely the pre-flight
 * that exists to stop a press that cannot succeed. It did not stop it, so it must have answered
 * `unknown`, which falls through to the build BY DESIGN.
 *
 * The defect was not the fall-through. It was that nobody could say why it happened: the route
 * swallowed every failure into one bare `catch`, so "GitHub refused this token permission" and "GitHub
 * had a bad second" were indistinguishable, produced no log line, and left nothing in the failure
 * report the admin reads. That report carried nine steps and a failure and not one word about the gate.
 *
 * ⚠️ WHAT THIS SUITE ALSO LOCKS IS WHAT DID **NOT** CHANGE. Blocking on a 403 would be the trade this
 * repo forbids — a repository whose secrets were set by somebody else (an org where this user has write
 * but not admin) genuinely can build, and would be refused on OUR lack of permission. So the verdict
 * function is asserted to be untouched, and a test below fails if a reason ever starts deciding one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  signingLookupReason, signingLookupIsDurable, signingLookupNote, isSigningSecretFailure,
  signingVerdict, ANDROID_SIGNING_SECRETS,
} from '../src/lib/signingReadiness';

const root = join(__dirname, '..');
const route = readFileSync(join(root, 'src/server/routes/mobileShip.ts'), 'utf8');
const store = readFileSync(join(root, 'src/server/lib/AdminApkReportStore.ts'), 'utf8');

describe('the gate that declined to decide', () => {
  it('separates a permission denial from an exhausted rate limit, which GitHub gives the same status', () => {
    // This is the whole reason the header is an input rather than an afterthought: calling a rate limit
    // "you do not have permission" sends a user to fix access they already have.
    expect(signingLookupReason(403, null)).toBe('forbidden');
    expect(signingLookupReason(403, '0')).toBe('rate-limited');
    expect(signingLookupReason(403, 0)).toBe('rate-limited');
    expect(signingLookupReason(403, '4999')).toBe('forbidden');
    expect(signingLookupReason(429, null)).toBe('rate-limited');
  });

  it('classifies the rest, and calls anything unrecognised "unavailable" rather than guessing', () => {
    expect(signingLookupReason(404, null)).toBe('not-found');
    expect(signingLookupReason(500, null)).toBe('unavailable');
    expect(signingLookupReason(null, null)).toBe('unavailable');       // no response at all
    expect(signingLookupReason(undefined, undefined)).toBe('unavailable');
    expect(signingLookupReason(401, null)).toBe('unavailable');
  });

  it('marks exactly the reasons that would ALSO break the one-press key creation', () => {
    // The permission that lists a repository's secrets is the one that writes them, so on these two the
    // "Create my signing key" button cannot work either — "try again" is the wrong advice.
    expect(signingLookupIsDurable('forbidden')).toBe(true);
    expect(signingLookupIsDurable('not-found')).toBe(true);
    expect(signingLookupIsDurable('rate-limited')).toBe(false);
    expect(signingLookupIsDurable('unavailable')).toBe(false);
  });

  it('never puts a token, a secret name or a value in the admin note', () => {
    for (const reason of ['forbidden', 'not-found', 'rate-limited', 'unavailable'] as const) {
      const note = signingLookupNote(reason);
      expect(note.length).toBeGreaterThan(10);
      expect(note).not.toMatch(/ghp_|github_pat_|Bearer/i);
      for (const secret of ANDROID_SIGNING_SECRETS) expect(note).not.toContain(secret);
    }
  });

  it('recognises a signing failure from the classifier\'s own detail, not from a second vocabulary', () => {
    expect(isSigningSecretFailure({ missing: [...ANDROID_SIGNING_SECRETS] })).toBe(true);
    expect(isSigningSecretFailure({ missing: ['ANDROID_KEY_ALIAS'] })).toBe(true);
    expect(isSigningSecretFailure({ missing: ['android_key_alias'] })).toBe(true); // case-insensitive
    // A different failure that happens to carry a `missing` list must not trigger the extra lookup.
    expect(isSigningSecretFailure({ missing: ['SOME_OTHER_SECRET'] })).toBe(false);
    expect(isSigningSecretFailure({ missing: [] })).toBe(false);
    expect(isSigningSecretFailure({ secret: 'x' })).toBe(false);
    expect(isSigningSecretFailure(null)).toBe(false);
    expect(isSigningSecretFailure(undefined)).toBe(false);
  });

  it('🔒 does NOT let any of this change a verdict — the fall-through is deliberate', () => {
    // If a later change makes `signingVerdict` consider a reason, these stop holding.
    expect(signingVerdict(null)).toBe('unknown');
    expect(signingVerdict(undefined)).toBe('unknown');
    expect(signingVerdict([])).toBe('missing');
    expect(signingVerdict([...ANDROID_SIGNING_SECRETS])).toBe('ready');
    expect(signingVerdict.length).toBe(1); // still takes names alone — no status, no reason
  });

  it('reports the reason from the status route without changing what it answers', () => {
    expect(route).toContain("return res.json({ verdict: 'unknown', missing: [], reason });");
    expect(route).toContain('signingLookupReason(ghErrorStatus(err), ghRateLimitRemaining(err))');
    // One admin line, and only for the durable reasons — a rate limit is not worth waking anyone for.
    expect(route).toContain('if (signingLookupIsDurable(reason)) {');
    expect(route).toContain('[SIGNING] secrets lookup declined');
  });

  it('records on the failure report whether the gate could see the repository at all', () => {
    expect(store).toMatch(/preflight\?: \{/);
    expect(store).toContain('couldCheck: boolean;');
    // Asked ONLY on the failure the gate exists to prevent, so no other build pays for the call.
    expect(route).toContain('isSigningSecretFailure(full.failure.detail)');
    expect(route).toContain('await describeSigningPreflight(headers, owner, repo)');
    // And it must reach the stored report — computing it and dropping it is how this rots.
    expect(route).toContain('failure: full.failure, preflight,');
  });

  it('never reports "we could not look" as "the user has no permission"', () => {
    // describeSigningPreflight's catch must go through the classifier, which answers `unavailable` for
    // a network error — a different claim from `forbidden`, and it has to stay one.
    expect(route).toContain('return { couldCheck: false, reason, note: signingLookupNote(reason) };');
    expect(signingLookupReason(null, null)).not.toBe('forbidden');
  });
});
