import { describe, it, expect } from 'vitest';
import { userAuthContext, AUTH_PROVIDER_MARKER } from '../src/server/AgentV3/userAuthContext';

describe('userAuthContext — connected-auth instruction for the builder', () => {
  it('returns empty when no auth provider is connected', () => {
    expect(userAuthContext({})).toBe('');
    expect(userAuthContext(null)).toBe('');
    expect(userAuthContext(undefined)).toBe('');
    expect(userAuthContext({ SOME_OTHER_KEY: 'x' })).toBe('');
  });

  it('emits a Clerk block naming the exact env vars + SDK when connected', () => {
    const ctx = userAuthContext({
      [AUTH_PROVIDER_MARKER]: 'clerk',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_x',
      CLERK_SECRET_KEY: 'sk_test_x',
    });
    expect(ctx).toContain('CONNECTED AUTHENTICATION');
    expect(ctx).toContain('Clerk');
    expect(ctx).toContain('@clerk/clerk-react');
    expect(ctx).toContain('VITE_CLERK_PUBLISHABLE_KEY');
    expect(ctx).toContain('DO NOT BUILD YOUR OWN');
  });

  it('emits an Auth0 block with its exact env vars', () => {
    const ctx = userAuthContext({
      [AUTH_PROVIDER_MARKER]: 'auth0',
      VITE_AUTH0_DOMAIN: 'my.eu.auth0.com',
      VITE_AUTH0_CLIENT_ID: 'abc123',
    });
    expect(ctx).toContain('Auth0');
    expect(ctx).toContain('VITE_AUTH0_DOMAIN');
    expect(ctx).toContain('@auth0/auth0-react');
  });

  it('infers Clerk from its auth-specific env vars even without the marker', () => {
    const ctx = userAuthContext({ VITE_CLERK_PUBLISHABLE_KEY: 'pk_x', CLERK_SECRET_KEY: 'sk_x' });
    expect(ctx).toContain('Clerk');
  });

  it('does NOT infer Supabase/Firebase auth from shared DB keys (needs the explicit marker)', () => {
    // A DB-only Supabase connection must not be mistaken for a separate auth choice.
    expect(userAuthContext({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'ey' })).toBe('');
    expect(userAuthContext({ VITE_FIREBASE_API_KEY: 'AIza', VITE_FIREBASE_PROJECT_ID: 'p' })).toBe('');
  });

  it('DOES emit Supabase auth when the explicit marker is present', () => {
    const ctx = userAuthContext({
      [AUTH_PROVIDER_MARKER]: 'supabase',
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'ey',
    });
    expect(ctx).toContain('Supabase Auth');
    expect(ctx).toContain('VITE_SUPABASE_URL');
    // Coherence line: DB for data, this for auth.
    expect(ctx.toLowerCase()).toContain('database for data');
  });

  it('a marker with no credentials yet still guides with an honest "set" note', () => {
    const ctx = userAuthContext({ [AUTH_PROVIDER_MARKER]: 'clerk' });
    expect(ctx).toContain('Clerk');
    expect(ctx.toLowerCase()).toContain('set vite_clerk_publishable_key');
  });

  it('ignores an unknown provider marker with no recognizable env vars', () => {
    expect(userAuthContext({ [AUTH_PROVIDER_MARKER]: 'totally-unknown-auth' })).toBe('');
  });

  it("never leaks a NavBharatAI AI-vendor name", () => {
    const ctx = userAuthContext({ [AUTH_PROVIDER_MARKER]: 'clerk', VITE_CLERK_PUBLISHABLE_KEY: 'pk', CLERK_SECRET_KEY: 'sk' });
    expect(ctx).not.toMatch(/\b(glm|kimi|claude|anthropic|sonnet|opus|gemini|grok|openai)\b/i);
  });
});
