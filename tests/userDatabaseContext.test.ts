import { describe, it, expect } from 'vitest';
import { userDatabaseContext, DB_PROVIDER_MARKER } from '../src/server/AgentV3/userDatabaseContext';

describe('userDatabaseContext — connected-DB instruction for the builder', () => {
  it('returns empty when no database is connected', () => {
    expect(userDatabaseContext({})).toBe('');
    expect(userDatabaseContext(null)).toBe('');
    expect(userDatabaseContext(undefined)).toBe('');
    expect(userDatabaseContext({ SOME_OTHER_KEY: 'x' })).toBe('');
  });

  it('emits a Supabase block naming the exact env vars + SDK when connected', () => {
    const ctx = userDatabaseContext({
      [DB_PROVIDER_MARKER]: 'supabase',
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'eyJ...',
    });
    expect(ctx).toContain('CONNECTED DATABASE');
    expect(ctx).toContain('Supabase');
    expect(ctx).toContain('@supabase/supabase-js');
    expect(ctx).toContain('VITE_SUPABASE_URL');
    expect(ctx).toContain('VITE_SUPABASE_ANON_KEY');
    expect(ctx).toContain('DO NOT CREATE A NEW ONE');
  });

  it('only names the env vars actually populated (partial credentials)', () => {
    const ctx = userDatabaseContext({
      [DB_PROVIDER_MARKER]: 'firebase',
      VITE_FIREBASE_API_KEY: 'AIza...',
      VITE_FIREBASE_PROJECT_ID: 'proj',
      // other firebase vars left blank
    });
    expect(ctx).toContain('Firebase');
    expect(ctx).toContain('VITE_FIREBASE_API_KEY');
    expect(ctx).toContain('VITE_FIREBASE_PROJECT_ID');
    expect(ctx).not.toContain('VITE_FIREBASE_STORAGE_BUCKET'); // blank → not named
  });

  it('infers the provider from populated env vars even without the marker', () => {
    const ctx = userDatabaseContext({ MONGODB_URI: 'mongodb+srv://u:p@c.net/db' });
    expect(ctx).toContain('MongoDB');
    expect(ctx).toContain('MONGODB_URI');
  });

  it('treats a bare DATABASE_URL as a connected (other/postgres) database', () => {
    const ctx = userDatabaseContext({ DATABASE_URL: 'postgresql://u:p@ep.neon.tech/db' });
    expect(ctx).toContain('CONNECTED DATABASE');
    expect(ctx).toContain('DATABASE_URL');
  });

  it('a marker with no credentials yet still guides to the provider with an honest "set" note', () => {
    const ctx = userDatabaseContext({ [DB_PROVIDER_MARKER]: 'supabase' });
    expect(ctx).toContain('Supabase');
    expect(ctx.toLowerCase()).toContain('set vite_supabase_url'.toLowerCase());
  });

  it('ignores an unknown provider marker with no recognizable env vars', () => {
    expect(userDatabaseContext({ [DB_PROVIDER_MARKER]: 'totally-unknown-db' })).toBe('');
  });

  it('never leaks a NavBharatAI AI-vendor name (it only names the user\'s own DB provider)', () => {
    const ctx = userDatabaseContext({ [DB_PROVIDER_MARKER]: 'neon', DATABASE_URL: 'postgresql://u:p@ep/db' });
    expect(ctx).not.toMatch(/\b(glm|kimi|claude|anthropic|gemini|grok|openai)\b/i);
    expect(ctx).toContain('Neon');
  });
});
