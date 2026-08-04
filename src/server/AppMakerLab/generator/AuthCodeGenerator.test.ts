import { describe, it, expect } from 'vitest';
import { generateAuthCode } from './AuthCodeGenerator';

// ROADMAP #1 Phase 1.3 — the zero-setup path. After one-click provisioning the workspace already has
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, so generated auth must work on the FIRST build with
// nothing for the user to paste. That is the whole point: a login screen that needs configuration is
// just the old friction moved one step later.
describe('generateAuthCode — supabase (zero setup)', () => {
  const gen = () => generateAuthCode({ type: 'supabase' });

  it('emits a client module and asks for the Supabase SDK', () => {
    const r = gen();
    expect(r.files.map((f) => f.path)).toEqual(['src/lib/authClient.ts']);
    expect(r.dependencies).toEqual(['@supabase/supabase-js']);
  });

  it('reads the SAME env names the provisioner already wrote — no second convention to drift', () => {
    const code = gen().files[0].content;
    expect(code).toContain('VITE_SUPABASE_URL');
    expect(code).toContain('VITE_SUPABASE_ANON_KEY');
  });

  it('uses the ANON key only — the service-role key bypasses RLS and must never reach a browser', () => {
    const code = gen().files[0].content;
    expect(code).not.toContain('SERVICE_ROLE');
    expect(code).not.toContain('service_role');
    expect(code).toContain('safe in a browser bundle');
  });

  it('covers the whole login lifecycle, not just sign-in', () => {
    const code = gen().files[0].content;
    for (const fn of ['signUp', 'signIn', 'signOut', 'resetPassword', 'getSession']) {
      expect(code, fn).toContain(`export async function ${fn}`);
    }
    expect(code).toContain('export function onAuthChange');
  });

  it('surfaces "check your email" instead of pretending the user is signed in', () => {
    // With confirmation enabled, signUp returns a user but NO session. Reporting success there would
    // send someone to a logged-in screen they are not actually logged into.
    expect(gen().files[0].content).toContain('needsConfirmation');
  });

  it('warns that getSession must be AWAITED — the bug that logs a returning user out on refresh', () => {
    const r = gen();
    expect(r.files[0].content).toContain('asynchronously');
    expect(r.files[0].wiring).toContain('AWAIT getSession()');
  });

  it('never silently ships a login screen that cannot work', () => {
    // Missing config is loud in development rather than a login form that fails forever in silence.
    expect(gen().files[0].content).toContain('console.error');
  });

  it('unsubscribes from auth changes — an un-cleaned listener leaks on every mount', () => {
    expect(gen().files[0].content).toContain('unsubscribe');
  });
});

describe('generateAuthCode — the existing paths are untouched', () => {
  it('still defaults to the dependency-free jwt path', () => {
    const r = generateAuthCode();
    expect(r.dependencies).toEqual([]);
    expect(r.files.map((f) => f.path)).toContain('src/server/auth/jwt.ts');
  });

  it('an unknown type falls back to jwt — it never becomes supabase by accident', () => {
    expect(generateAuthCode({ type: 'nonsense' as never }).files.map((f) => f.path))
      .toContain('src/server/auth/jwt.ts');
  });

  it('firebase still emits its client helpers', () => {
    const r = generateAuthCode({ type: 'firebase' });
    expect(r.dependencies).toEqual(['firebase']);
    expect(r.files[0].path).toBe('src/lib/authClient.ts');
  });
});
