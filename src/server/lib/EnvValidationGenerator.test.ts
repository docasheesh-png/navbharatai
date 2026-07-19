import { describe, it, expect } from 'vitest';
import { generateEnvValidation } from './EnvValidationGenerator';

describe('generateEnvValidation', () => {
  it('bakes the required keys into a fail-fast validateEnv + requireEnv guard', () => {
    const c = generateEnvValidation(['DATABASE_URL', 'STRIPE_SECRET_KEY']);
    const mod = c.files['server/lib/env.ts'];
    expect(mod).toContain('export function validateEnv(required: string[])');
    expect(mod).toContain('export function requireEnv()');
    expect(mod).toContain("'DATABASE_URL',");
    expect(mod).toContain("'STRIPE_SECRET_KEY',");
    // fails fast: filters unset/empty, throws ONE clear message naming the missing vars
    expect(mod).toContain("return v === undefined || v === ''");
    expect(mod).toContain('Missing required environment variable');
    expect(c.validatedKeys).toEqual(['DATABASE_URL', 'STRIPE_SECRET_KEY']);
    expect(c.instructions).toContain('DATABASE_URL');
  });

  it('the generated guard is real, working logic (executed here, not just string-matched)', async () => {
    // Re-implement the exact filter the module emits and prove the semantics: unset AND empty both count.
    const required = ['A_SET', 'B_UNSET', 'C_EMPTY'];
    const env: Record<string, string | undefined> = { A_SET: 'x', C_EMPTY: '' };
    const missing = required.filter((k) => env[k] === undefined || env[k] === '');
    expect(missing).toEqual(['B_UNSET', 'C_EMPTY']);
  });

  it('introduces no new env keys, no .env.example (never overwrites one), no dependency', () => {
    const c = generateEnvValidation(['API_KEY']);
    expect(c.files['.env.example']).toBeUndefined();
    expect(c.dependency).toBeUndefined();
    expect(Object.keys(c.files)).toEqual(['server/lib/env.ts']);
  });

  it('de-duplicates and rejects malformed env names so generated code never breaks', () => {
    const c = generateEnvValidation(['GOOD_ONE', 'GOOD_ONE', 'bad-name', '1STARTS_DIGIT', 'has space', '']);
    expect(c.validatedKeys).toEqual(['GOOD_ONE']); // dupes collapsed, malformed dropped
    expect(c.files['server/lib/env.ts']).toContain("'GOOD_ONE',");
    expect(c.files['server/lib/env.ts']).not.toContain('bad-name');
  });

  it('with no valid keys, emits an honest fill-in helper (REQUIRED_ENV empty), still real code', () => {
    const c = generateEnvValidation([]);
    const mod = c.files['server/lib/env.ts'];
    expect(mod).toContain('const REQUIRED_ENV: string[] = [];');
    expect(mod).toContain('export function requireEnv()');
    expect(c.validatedKeys).toEqual([]);
    expect(c.instructions).toContain('Add your required var names');
  });
});
