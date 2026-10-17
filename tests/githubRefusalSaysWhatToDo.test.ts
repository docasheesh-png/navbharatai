import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';
import { githubErrorAnswer } from '../src/server/lib/githubErrorHint';

/**
 * Q-1133, found while fixing Q-887. Measured across the repo, one question had three different
 * answers and four non-answers:
 *
 *   ❌ `github.ts` ×3 and `cloudsync.ts`: `{ error: err.response?.data?.message || err.message }` —
 *      GitHub's own wording as the WHOLE error. A user pulling a private repo met "Not Found", and
 *      `GitPanel` renders that string straight into its log line, so the sentence IS the UI.
 *   ✅ `mobileShip.ts`: a curated hint per status, upstream message kept as a secondary `detail`.
 *   ✅ `mobileSetup.ts`: a THIRD, separately-written ladder over the same statuses.
 *
 * 🔑 THE CLASS: a judgement every call site had to make for itself. Four made none, and the two that
 * made it made it twice — so improving a rung could never reach the others.
 */
const err = (status: number, message?: string) => ({
  response: { status, ...(message ? { data: { message } } : {}) },
  message: message ?? 'axios error',
});

describe('githubErrorAnswer — every rung says what to DO', () => {
  it('404 names the thing and the two real causes, instead of "Not Found"', () => {
    const a = githubErrorAnswer(err(404, 'Not Found'), { action: 'read that repository', subject: 'that repository' });
    expect(a.status).toBe(404);
    expect(a.error).toContain('that repository');
    expect(a.error).toMatch(/private, renamed or deleted/);
    expect(a.error, 'the account they connected may simply not see it').toMatch(/account you connected/);
    expect(a.error, "never GitHub's bare wording as the whole answer").not.toBe('Not Found');
    expect(a.detail, 'the upstream message is still useful — kept as detail').toBe('Not Found');
  });

  it('401 sends them to reconnect', () => {
    expect(githubErrorAnswer(err(401, 'Bad credentials'), { action: 'x' }).error).toMatch(/Reconnect GitHub/);
  });

  /**
   * 🔑 GitHub answers 403 for BOTH "you may not" and "you asked too often", and the two need OPPOSITE
   * actions — reconnect versus wait. Only the message tells them apart, so only the message may.
   */
  it('a 403 RATE LIMIT is told to wait, not to reconnect', () => {
    const limited = githubErrorAnswer(err(403, 'API rate limit exceeded for user ID 1'), { action: 'x' });
    expect(limited.error).toMatch(/rate limit/i);
    expect(limited.error).toMatch(/try again in a few minutes/);
    expect(limited.error, 'reconnecting does nothing about a rate limit').not.toMatch(/Reconnect/);

    const forbidden = githubErrorAnswer(err(403, 'Resource not accessible by integration'), { action: 'x' });
    expect(forbidden.error).toMatch(/Reconnect GitHub/);
    expect(forbidden.error).not.toMatch(/rate limit/i);
  });

  it('429 is a rate limit without needing the message to say so', () => {
    expect(githubErrorAnswer(err(429), { action: 'x' }).error).toMatch(/rate limit/i);
  });

  it('an unreachable GitHub blames neither the user nor us, and says nothing changed', () => {
    for (const e of [err(500, 'Server Error'), err(502), { message: 'ECONNRESET' }]) {
      const a = githubErrorAnswer(e, { action: 'pull that repository' });
      expect(a.status, 'a gateway problem is a 502, not a 500 from our server').toBe(502);
      expect(a.error).toMatch(/not responding/);
      expect(a.error).toMatch(/nothing was changed/);
    }
  });

  it('a route may override a rung — and may say a status it knows better, explicitly', () => {
    const a = githubErrorAnswer(err(401, 'Bad credentials'), {
      action: 'set up the repository on GitHub',
      hints: { 401: { error: 'Your GitHub connection does not have permission…', status: 403 } },
    });
    expect(a.error).toBe('Your GitHub connection does not have permission…');
    expect(a.status, 'on that route a 401 is not "sign in again"').toBe(403);
    // A wording-only override never moves the status.
    expect(githubErrorAnswer(err(404, 'nf'), { action: 'x', hints: { 404: 'Workflow not found…' } }))
      .toMatchObject({ status: 404, error: 'Workflow not found…' });
  });

  /**
   * 🔒 The upstream message is KEPT (Q-887's recorded line: a BODY must never pass through, a
   * `.message` from a service the user connected may) — but it is REDACTED now, which it was not
   * before. Somebody else's error text can carry a URL, a token-bearing clone URL, or a vendor name.
   */
  it('the detail is redacted, not passed through raw', () => {
    const a = githubErrorAnswer(err(422, 'failed at https://x-access-token:ghp_SECRET@github.com/a/b.git'), { action: 'x' });
    expect(a.detail).toBeTruthy();
    expect(a.detail, 'a token in somebody else\'s message must not ride out on ours').not.toContain('ghp_SECRET');
    expect(a.detail).not.toContain('https://');
  });

  it('never throws on junk, and says nothing it cannot support', () => {
    for (const junk of [null, undefined, 'a string', 42, {}, { response: {} }]) {
      const a = githubErrorAnswer(junk, { action: 'do that' });
      expect(typeof a.error).toBe('string');
      expect(a.error.length).toBeGreaterThan(0);
      expect(a.status).toBe(502);
    }
  });
});

/**
 * THE CENSUS — a per-file ratchet, not a list of exempt files.
 *
 * ⚠️ WHY A RATCHET: earlier the same day a file-level allowlist hid a real miss inside an allowed
 * file (the third definition of "needs a server" in `appServerHalf`'s first census). A count fails on
 * a NEW occurrence even where some are allowed, and may only go DOWN.
 */
describe('🔒 no route answers with the upstream wording as its whole error', () => {
  /** `{ error: <upstream message> }` — the exact shape Q-1133 is about. */
  const BARE = /error:\s*(?:err|e|error)\??\.response\??\.?\.?data\??\.?message/;

  it('the four sites that had no sentence of their own now have one', () => {
    for (const f of ['src/server/routes/github.ts', 'src/server/routes/cloudsync.ts']) {
      const code = stripCodeComments(readFileSync(resolve(__dirname, '..', f), 'utf8'));
      expect(code, `${f} must not answer with the upstream message alone`).not.toMatch(BARE);
      expect(code, `${f} must use the shared ladder`).toContain('githubErrorAnswer(');
    }
    const gh = stripCodeComments(readFileSync(resolve(__dirname, '..', 'src/server/routes/github.ts'), 'utf8'));
    // Measured, not guessed: three call sites, and the import names it WITHOUT parentheses.
    expect((gh.match(/githubErrorAnswer\(/g) || []).length, 'all three sites in github.ts').toBe(3);
  });

  it('ONE ladder: no file writes its own status chain for a GitHub refusal', () => {
    const root = resolve(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
        const rel = full.slice(root.length + 1);
        if (rel === 'src/server/lib/githubErrorHint.ts') continue;   // the ladder itself
        const code = stripCodeComments(readFileSync(full, 'utf8'));
        if (BARE.test(code)) offenders.push(`${rel} (upstream message as the whole error)`);
      }
    };
    walk(resolve(root, 'src'));
    expect(offenders, 'use githubErrorAnswer — four sites said nothing of their own and two said it twice')
      .toEqual([]);
  });

  it('the two curated ladders kept their exact sentences through the move', () => {
    // Behaviour-preserving is a claim, so it is checked: the wording that existed before this change
    // must still be the wording these two routes send.
    const ship = readFileSync(resolve(__dirname, '..', 'src/server/routes/mobileShip.ts'), 'utf8');
    expect(ship).toContain('Workflow not found on that branch — push the ship kit to GitHub first.');
    expect(ship).toContain('reconnect GitHub so the token includes the "workflow" permission.');
    const setup = readFileSync(resolve(__dirname, '..', 'src/server/routes/mobileSetup.ts'), 'utf8');
    expect(setup).toContain('does not have permission to create repositories or workflows');
    expect(setup).toContain('the name may already be taken on your account');
    expect(setup).toContain('That repository changed while we were writing to it.');
  });
});
