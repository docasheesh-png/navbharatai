import { describe, it, expect } from 'vitest';
import { classifyDevServerFailure, sessionSecretMissing, missingCredentialFromLog } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/DevServerRecovery';
import { halfBootCause } from '../src/server/AgentV3/ImportPreview';

/**
 * ADMIN REPORT 2026-08-13 — a zip import of a Replit-exported app.
 *
 * The boot log said, in as many words:
 *
 *     express-session deprecated req.secret; provide secret option at …/replitAuth.ts
 *     … secret option required for sessions
 *
 * and the verdict printed directly ABOVE that log said something else entirely:
 *
 *     "This is common for a full-stack app whose client routes aren't served (only its API)"
 *
 * Not a routing problem. We had already computed the answer, printed it, and then guessed past it —
 * the exact failure DevServerRecovery's own header was written to prevent.
 *
 * WHY IT IS A CLASS, NOT ONE APP: exports from Replit, Heroku and Railway lean on a platform-provided
 * session secret, and NavBharatAI deliberately never imports `.env` files (SECRET_FILE_RE — we do not
 * take somebody's secrets). The secret is therefore missing BY DESIGN on every such import, and the app
 * 500s on its first request while the port looks perfectly healthy.
 */

const REAL_LOG = `[preview-host] patched vite.config.ts to allow the preview host (allowedHosts).
[health-check] installing dependencies (package.json changed)… done.
> rest-express@1.0.0 dev
> NODE_ENV=development tsx server/index.ts

Thu, 13 Aug 2026 18:54:40 GMT express-session deprecated req.secret; provide secret option at file:/home/user/workspace/server/replit_integrations/auth/replitAuth.ts:1:1131
Google OAuth not configured: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET missing
6:54:40 PM [express] serving on port 3000
secret option required for sessions`;

describe('the real log the admin sent', () => {
  it('is recognised', () => {
    expect(sessionSecretMissing(REAL_LOG)).toBe(true);
    expect(classifyDevServerFailure(REAL_LOG).cause).toBe('missing_session_secret');
  });

  it('produces a verdict that names the ACTUAL cause', () => {
    const verdict = halfBootCause(REAL_LOG);
    expect(verdict).toBeTruthy();
    expect(verdict).toMatch(/session/i);
    expect(verdict).toMatch(/secret/i);
    // …and never the guess it used to print over this very log.
    expect(verdict).not.toMatch(/client routes/i);
  });

  it('tells the user why it is missing — a deliberate choice, not a bug', () => {
    // "Your app is broken" and "we never take your .env, by design" lead to completely different
    // reactions, and only the second one is true.
    expect(halfBootCause(REAL_LOG)).toMatch(/never imports those|secrets stay yours/i);
  });

  it('gives an action, and it is not "restart"', () => {
    // A restart re-reads the same absent env forever. The header's own rule: the recovery must be the
    // single action that can actually change the outcome.
    expect(classifyDevServerFailure(REAL_LOG).recovery).toBe('code_fix');
    expect(halfBootCause(REAL_LOG)).toMatch(/Secrets & API Keys|development fallback/);
  });
});

describe('why it needed its own detector', () => {
  it('the credential scanner genuinely cannot see it', () => {
    // That one extracts an UPPER_SNAKE variable NAME, and this message has none — express-session is
    // describing its own option, not an env var. Loosening it would have cost the precision its header
    // promises, and a wrong "edit your source for X" is worse than no verdict at all.
    expect(missingCredentialFromLog(REAL_LOG)).toBeNull();
  });

  it('a named credential still classifies as before', () => {
    const log = 'Error: Missing STRIPE_SECRET_KEY';
    expect(classifyDevServerFailure(log).cause).toBe('missing_credential');
    expect(sessionSecretMissing(log)).toBe(false);
  });
});

describe('precision — it must not fire on unrelated logs', () => {
  it('an ordinary boot is untouched', () => {
    expect(sessionSecretMissing('[express] serving on port 3000\nready in 412ms')).toBe(false);
  });

  it('the word "secret" alone is not enough', () => {
    // A false hit here would send a user to fix sessions over an unrelated crash.
    expect(sessionSecretMissing('Google OAuth not configured: GOOGLE_CLIENT_SECRET missing')).toBe(false);
    expect(sessionSecretMissing('warning: do not commit your secret')).toBe(false);
  });

  it('a database failure still wins, because it has a better remedy', () => {
    // Ordering matters: a db_unreachable app can be REPAIRED by provisioning Postgres. Letting the
    // session line shadow that would trade a fixable cause for an unfixable one.
    const log = 'Error: connect ECONNREFUSED 127.0.0.1:5432\nsecret option required for sessions';
    expect(classifyDevServerFailure(log).cause).toBe('db_unreachable');
  });
});
