import { describe, it, expect } from 'vitest';
import { generateDbConfig, isDbProvider } from './DbConfigGenerator';

describe('generateDbConfig — BYO database connection wiring', () => {
  it('supabase: a real client module + VITE_ env keys + dependency + honest instructions', () => {
    const c = generateDbConfig('supabase');
    expect(c.files['src/lib/supabase.ts']).toContain("createClient");
    expect(c.files['src/lib/supabase.ts']).toContain('VITE_SUPABASE_URL');
    expect(c.files['.env.example']).toContain('VITE_SUPABASE_URL=');
    expect(c.files['.env.example']).toContain('VITE_SUPABASE_ANON_KEY=');
    expect(c.envKeys).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']);
    expect(c.dependency).toEqual({ name: '@supabase/supabase-js', version: '^2' });
    expect(c.instructions).toContain('never stores');
  });

  it('neon: a serverless sql client keyed off DATABASE_URL', () => {
    const c = generateDbConfig('neon');
    expect(c.files['src/lib/db.ts']).toContain("from '@neondatabase/serverless'");
    expect(c.files['src/lib/db.ts']).toContain('DATABASE_URL');
    expect(c.envKeys).toEqual(['DATABASE_URL']);
    expect(c.dependency.name).toBe('@neondatabase/serverless');
  });

  it('postgres: a pg Pool keyed off DATABASE_URL', () => {
    const c = generateDbConfig('postgres');
    expect(c.files['src/lib/db.ts']).toContain('new Pool');
    expect(c.dependency).toEqual({ name: 'pg', version: '^8' });
  });

  it('firebase: initializeApp + getFirestore + all VITE_FIREBASE_* keys', () => {
    const c = generateDbConfig('firebase');
    expect(c.files['src/lib/firebase.ts']).toContain('initializeApp');
    expect(c.files['src/lib/firebase.ts']).toContain('getFirestore');
    expect(c.envKeys).toContain('VITE_FIREBASE_PROJECT_ID');
    expect(c.envKeys).toHaveLength(5);
    expect(c.dependency.name).toBe('firebase');
  });

  it('every provider blanks its secret values in .env.example (never a baked-in credential)', () => {
    for (const p of ['supabase', 'neon', 'postgres', 'firebase'] as const) {
      const env = generateDbConfig(p).files['.env.example'];
      // every declared key is present as `KEY=` with an EMPTY value (a template, not a real secret).
      for (const k of generateDbConfig(p).envKeys) expect(env).toContain(`${k}=\n`);
    }
  });

  it('throws on an unknown provider (the tool layer guards with isDbProvider first)', () => {
    // @ts-expect-error invalid provider
    expect(() => generateDbConfig('mongo')).toThrow();
  });
});

describe('isDbProvider', () => {
  it('accepts the four supported providers and rejects anything else', () => {
    for (const p of ['supabase', 'neon', 'firebase', 'postgres']) expect(isDbProvider(p)).toBe(true);
    for (const p of ['mongo', '', null, undefined, 42]) expect(isDbProvider(p)).toBe(false);
  });
});
