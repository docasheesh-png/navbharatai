import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * D3 REVIEW ROUTES — the two properties that must not be edited away.
 *
 * These are SHAPE tests over the route source, and that is a deliberate, limited choice: the logic
 * they call (triage, prompt, replies, the client) is already unit-tested against fakes, and this repo
 * has no harness that boots the 14k-line route module. What a fake client can NOT catch is a gate
 * being dropped from the handler around it — and both gates below are security properties, not
 * style. A shape test that pins them is worth more than the elegance it costs.
 */

const src = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

/** The body of one `app.post('<path>', …)` handler, up to the next route registration. */
function routeBody(path: string): string {
  const start = src.indexOf(`app.post('${path}'`);
  expect(start, `route ${path} must exist`).toBeGreaterThan(-1);
  const next = src.indexOf('app.post(', start + 10);
  return src.slice(start, next === -1 ? src.length : next);
}

describe('POST /api/agentv3/review — read a reviewer\'s notes', () => {
  const body = routeBody('/api/agentv3/review');

  it('verifies WRITE ACCESS to that exact repo before reading a single comment', () => {
    // Same authority as /ship. Without it, a caller could aim the read at any repository their token
    // can merely SEE — including one they were added to read-only, or a public repo they do not own.
    expect(body).toContain('getRepoAccess(repo)');
    expect(body).toContain('access.canPush');
    expect(body.indexOf('access.canPush')).toBeLessThan(body.indexOf('readReviewRound'));
  });

  it('passes the token\'s OWN login as selfLogin, so our past replies are not read as new feedback', () => {
    // Omit this and the loop answers itself forever: every reply we post comes back next round as a
    // reviewer asking for something.
    expect(body).toContain('getLogin()');
    expect(body).toContain('selfLogin');
  });

  it('is READ-ONLY — it never merges, and never posts', () => {
    expect(body).not.toContain('mergePullRequest');
    expect(body).not.toContain('replyToReviewRound');
  });
});

describe('POST /api/agentv3/review/reply — tell the reviewer what happened', () => {
  const body = routeBody('/api/agentv3/review/reply');

  it('🔒 RE-READS the round server-side instead of trusting comment ids from the request', () => {
    // A client-supplied list of comment ids would let a caller post NavBharatAI-branded replies onto
    // arbitrary threads. Re-reading means we can only ever reply to comments the triage itself chose.
    expect(body).toContain('readReviewRound(client, repo, prNumber, selfLogin)');
    expect(body.indexOf('readReviewRound')).toBeLessThan(body.indexOf('replyToReviewRound'));
  });

  it('verifies write access before posting anything', () => {
    expect(body).toContain('access.canPush');
    expect(body.indexOf('access.canPush')).toBeLessThan(body.indexOf('replyToReviewRound'));
  });

  it('does not default `ok` to true — an unstated outcome must never read as success', () => {
    // `req.body?.ok === true` means a missing/garbled field is FALSE, so the honest failure wording
    // is what goes out. Any looser coercion would let a dropped field claim work that never happened.
    expect(body).toContain('req.body?.ok === true');
  });
});
