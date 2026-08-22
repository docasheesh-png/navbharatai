import { describe, it, expect } from 'vitest';
import { envNamesFromGrep, envKeysWithValues, conjureMissingLocalSecrets } from './ImportPreview';

/**
 * ADMIN, 2026-08-21: "preview mar gaya" — Mitrify, the SECOND time. The screen said:
 *
 *   "Your app started, but its login sessions have no secret key, so every page request fails."
 *
 * ROOT CAUSE. `conjurableSecrets` existed and worked, but ran ONLY on the IMPORT turn. Every later
 * turn goes through `ToolDispatcher.ensureUserSecretsEnvFile`, which opens with
 * `if (names.length === 0) return` — so a user with NO saved vault secrets got **no `.env` written at
 * all**. A live `.env` is deliberately never imported and never persisted durably (their secrets stay
 * theirs), so a recycled or rebuilt sandbox came back without one, express-session threw "secret
 * option required", and EVERY page request returned 500. The app was fine; it had no key to sign a
 * cookie with.
 *
 * This is PREVENTION, not a heal — the class stops being possible instead of being detected after.
 */
describe('envNamesFromGrep — what the app actually reads', () => {
  it('pulls names out of a real grep sweep, de-duplicated', () => {
    const out = [
      './server/index.js:process.env.SESSION_SECRET',
      './server/db.js:process.env.DATABASE_URL',
      './server/auth.js:process.env.SESSION_SECRET',
      './src/main.tsx:import.meta.env.VITE_API_URL',
    ].join('\n');
    expect(envNamesFromGrep(out)).toEqual(['SESSION_SECRET', 'DATABASE_URL', 'VITE_API_URL']);
  });

  it('empty or junk input yields nothing, never throws', () => {
    expect(envNamesFromGrep('')).toEqual([]);
    expect(envNamesFromGrep(undefined as never)).toEqual([]);
    expect(envNamesFromGrep('no env reads here')).toEqual([]);
  });
});

describe('envKeysWithValues — a key only counts when it HAS a value', () => {
  it('an empty value is not a value — it is exactly what kills express-session', () => {
    const have = envKeysWithValues('SESSION_SECRET=\nJWT_SECRET=""\nCOOKIE_SECRET=real');
    expect(have.has('SESSION_SECRET')).toBe(false);
    expect(have.has('JWT_SECRET')).toBe(false);
    expect(have.has('COOKIE_SECRET')).toBe(true);
  });

  it('reads `export FOO=` form and ignores comments', () => {
    const have = envKeysWithValues('export APP_SECRET=abc\n# SESSION_SECRET=nope\n');
    expect(have.has('APP_SECRET')).toBe(true);
    expect(have.has('SESSION_SECRET')).toBe(false);
  });
});

describe('conjureMissingLocalSecrets', () => {
  const rand = () => 'GENERATED';

  it('THE CASE THAT STARTED THIS: an app that reads SESSION_SECRET with no .env gets one', () => {
    const r = conjureMissingLocalSecrets('', ['SESSION_SECRET', 'DATABASE_URL'], rand);
    expect(r.added).toEqual(['SESSION_SECRET']);
    expect(r.content).toContain('SESSION_SECRET=GENERATED');
  });

  it('🔒 NEVER overwrites a value that already exists — the user\'s key always wins', () => {
    // Their real key from the vault, or one their own .env carries. We only ever fill a hole.
    const r = conjureMissingLocalSecrets('SESSION_SECRET=theirs\n', ['SESSION_SECRET'], rand);
    expect(r.added).toEqual([]);
    expect(r.content).toBe('SESSION_SECRET=theirs\n');
  });

  it('🔒 fills an EMPTY one, because an empty value is the boot-killer', () => {
    const r = conjureMissingLocalSecrets('SESSION_SECRET=\n', ['SESSION_SECRET'], rand);
    expect(r.added).toEqual(['SESSION_SECRET']);
  });

  it('🔒 NEVER invents a third-party credential', () => {
    // A fake external key makes the app fire real requests with garbage credentials and fail in
    // confusing ways. An absent one keeps that feature cleanly inactive — an honest partial preview.
    const r = conjureMissingLocalSecrets('', ['STRIPE_SECRET_KEY', 'OPENAI_API_KEY', 'DATABASE_URL', 'AWS_ACCESS_KEY_ID'], rand);
    expect(r.added).toEqual([]);
    expect(r.content).toBe('');
  });

  it('covers the self-issued family, not just sessions', () => {
    const r = conjureMissingLocalSecrets('', ['JWT_SECRET', 'COOKIE_SECRET', 'NEXTAUTH_SECRET', 'CSRF_SECRET'], rand);
    expect(r.added).toEqual(['JWT_SECRET', 'COOKIE_SECRET', 'NEXTAUTH_SECRET', 'CSRF_SECRET']);
  });

  it('preserves the existing file and appends cleanly', () => {
    const r = conjureMissingLocalSecrets('DATABASE_URL=postgres://x', ['SESSION_SECRET'], rand);
    expect(r.content).toBe('DATABASE_URL=postgres://x\nSESSION_SECRET=GENERATED\n');
  });

  it('nothing missing ⇒ the file is returned UNTOUCHED, byte for byte', () => {
    // A rewrite that changes nothing still risks clobbering formatting in somebody's real .env.
    const before = 'A=1\n\n# note\nSESSION_SECRET=x\n';
    expect(conjureMissingLocalSecrets(before, ['SESSION_SECRET', 'A'], rand).content).toBe(before);
  });

  it('the real generator produces distinct, high-entropy values', () => {
    const a = conjureMissingLocalSecrets('', ['SESSION_SECRET']).content;
    const b = conjureMissingLocalSecrets('', ['SESSION_SECRET']).content;
    expect(a).not.toBe(b);                       // per sandbox, never a shared constant
    expect(a.split('=')[1].trim().length).toBeGreaterThanOrEqual(32);
  });
});
