import { describe, it, expect } from 'vitest';
import { userDatabaseContext, noDatabaseConnectedContext, DB_PROVIDER_MARKER } from '../src/server/AgentV3/userDatabaseContext';

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

describe('noDatabaseConnectedContext — proactive "connect your own DB" nudge', () => {
  const ctx = noDatabaseConnectedContext();

  it('directs the user to the dedicated Settings → Database screen', () => {
    expect(ctx).toContain('Settings → App Settings → Database');
  });

  it('makes the guidance conditional on the app actually needing persistence', () => {
    expect(ctx.toLowerCase()).toContain('only if');
    expect(ctx.toLowerCase()).toContain('does not need persistence');
  });

  it('requires the message in the USER\'S OWN language and names several Indian languages', () => {
    expect(ctx.toUpperCase()).toContain("USER'S OWN LANGUAGE");
    for (const lang of ['Hindi', 'Tamil', 'Bengali', 'Marathi', 'Telugu']) {
      expect(ctx).toContain(lang);
    }
    expect(ctx.toLowerCase()).toContain('never default to english');
  });

  it('forbids using a NavBharatAI database and forbids faking persistence', () => {
    expect(ctx).toContain('NavBharatAI database');
    expect(ctx.toLowerCase()).toContain('will not');
    expect(ctx.toLowerCase()).toContain('temporary');
  });

  it('lists the supported providers so the user knows their options', () => {
    for (const p of ['Supabase', 'Firebase', 'MongoDB', 'Neon', 'Appwrite']) {
      expect(ctx).toContain(p);
    }
  });

  it('never leaks a NavBharatAI AI-vendor/model name', () => {
    expect(ctx).not.toMatch(/\b(glm|kimi|claude|anthropic|sonnet|opus|gemini|grok|openai)\b/i);
  });
});
