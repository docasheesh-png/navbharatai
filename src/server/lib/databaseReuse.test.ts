import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  databasesInVault, appHasOwnDatabase, reusableDatabase, reusedDatabaseNote, DATABASE_ENV_KEYS,
} from './databaseReuse';
import type { VaultSecretRow } from './secretScope';

/**
 * ONE USER'S APP MUST NOT SEE ANOTHER OF THEIR APPS' DATA.
 *
 * The zero-setup database wrote its keys SHARED, so a landing page built on Tuesday silently carried
 * the Postgres connection string — password included — of the shop database built on Monday. These
 * tests defend the fix AND the thing that makes the fix shippable: an app that asks for a database is
 * handed the one the user already has, so closing the leak does not cost them a free project slot.
 */

const row = (name: string, value: string, workspaceId: string | null, createdAt: number | null = null): VaultSecretRow =>
  ({ name, value, workspaceId, createdAt });

/** A complete database as provisioning writes it. */
const dbRows = (scope: string | null, tag: string, at: number | null = null): VaultSecretRow[] => [
  row('ENGINEER_DB_PROVIDER', 'supabase', scope, at),
  row('VITE_SUPABASE_URL', `https://${tag}.supabase.co`, scope, at),
  row('VITE_SUPABASE_ANON_KEY', `anon-${tag}`, scope, at),
  row('DATABASE_URL', `postgres://u:p@pooler/${tag}`, scope, at),
  row('DIRECT_URL', `postgres://u:p@direct/${tag}`, scope, at),
];

describe('databasesInVault', () => {
  it('finds one database per app', () => {
    const found = databasesInVault([...dbRows('app-a', 'aaa'), ...dbRows('app-b', 'bbb')]);
    expect(found.map((d) => d.workspaceId).sort()).toEqual(['app-a', 'app-b']);
  });

  it('🔒 reads ONLY database keys — a reuse path must never carry a Stripe secret', () => {
    const found = databasesInVault([...dbRows('app-a', 'aaa'), row('STRIPE_SECRET_KEY', 'sk_live', 'app-a')]);
    expect(Object.keys(found[0].env).sort()).toEqual([...DATABASE_ENV_KEYS].sort());
    expect(JSON.stringify(found)).not.toContain('sk_live');
  });

  it('🔒 an INCOMPLETE set is not a database — offering it would wire an app to nothing', () => {
    expect(databasesInVault([row('DATABASE_URL', 'postgres://x', 'app-a')])).toEqual([]);
    expect(databasesInVault([row('VITE_SUPABASE_URL', 'https://x.supabase.co', 'app-a')])).toEqual([]);
  });

  it('a frontend-only database counts — no connection string is not "no database"', () => {
    const found = databasesInVault([
      row('VITE_SUPABASE_URL', 'https://x.supabase.co', 'app-a'),
      row('VITE_SUPABASE_ANON_KEY', 'anon-x', 'app-a'),
    ]);
    expect(found).toHaveLength(1);
  });

  it('an empty value is not a value', () => {
    expect(databasesInVault([
      row('VITE_SUPABASE_URL', '  ', 'app-a'),
      row('VITE_SUPABASE_ANON_KEY', 'anon-x', 'app-a'),
    ])).toEqual([]);
  });

  it('within one app, the newest row of a name wins', () => {
    const found = databasesInVault([
      ...dbRows('app-a', 'old', 1000),
      row('VITE_SUPABASE_ANON_KEY', 'anon-rotated', 'app-a', 5000),
    ]);
    expect(found[0].env.VITE_SUPABASE_ANON_KEY).toBe('anon-rotated');
  });

  it('a shared database (written before scoping existed) is found, with a null scope', () => {
    expect(databasesInVault(dbRows(null, 'legacy'))[0].workspaceId).toBeNull();
  });

  it('survives junk rather than throwing', () => {
    expect(databasesInVault(null)).toEqual([]);
    expect(databasesInVault(undefined)).toEqual([]);
  });
});

describe('appHasOwnDatabase', () => {
  it('true only for the app the database belongs to', () => {
    const rows = dbRows('app-a', 'aaa');
    expect(appHasOwnDatabase(rows, 'app-a')).toBe(true);
    expect(appHasOwnDatabase(rows, 'app-b')).toBe(false);
  });

  it('🔒 a SHARED database is not "this app has its own"', () => {
    // Otherwise a legacy user would never be moved onto the scoped model, and the leak would live on.
    expect(appHasOwnDatabase(dbRows(null, 'legacy'), 'app-a')).toBe(false);
  });

  it('no workspace is never true', () => {
    expect(appHasOwnDatabase(dbRows('app-a', 'aaa'), '')).toBe(false);
  });
});

describe('reusableDatabase', () => {
  it('offers another app’s database to an app that has none', () => {
    const found = reusableDatabase(dbRows('app-a', 'aaa'), 'app-b');
    expect(found?.workspaceId).toBe('app-a');
    expect(found?.env.VITE_SUPABASE_URL).toBe('https://aaa.supabase.co');
  });

  it('🔒 never offers an app its OWN database back — that would be a no-op dressed as an answer', () => {
    expect(reusableDatabase(dbRows('app-a', 'aaa'), 'app-a')).toBeNull();
  });

  it('picks the newest when the user has several', () => {
    const rows = [...dbRows('app-a', 'older', 1000), ...dbRows('app-b', 'newer', 9000)];
    expect(reusableDatabase(rows, 'app-c')?.workspaceId).toBe('app-b');
  });

  it('a dated database beats an undated one', () => {
    const rows = [...dbRows('app-a', 'undated', null), ...dbRows('app-b', 'dated', 5)];
    expect(reusableDatabase(rows, 'app-c')?.workspaceId).toBe('app-b');
  });

  it('nothing to reuse is null — the honest cue to create a real project', () => {
    expect(reusableDatabase([], 'app-a')).toBeNull();
    expect(reusableDatabase(dbRows('app-a', 'aaa'), '')).toBeNull();
  });
});

describe('reusedDatabaseNote', () => {
  it('names the app it came from', () => {
    const note = reusedDatabaseNote('Kirana Billing');
    expect(note).toContain('Kirana Billing');
    expect(note).toMatch(/no new project/i);
  });

  it('🔒 says something true when the name is unknown, rather than inventing one', () => {
    for (const unknown of [null, undefined, '', '   ']) {
      const note = reusedDatabaseNote(unknown);
      expect(note).toMatch(/already made/i);
      expect(note).not.toContain('undefined');
      expect(note).not.toContain('null');
    }
  });
});

describe('🔒 the wiring — a decision nobody calls is not a fix', () => {
  const flow = readFileSync(resolve(__dirname, 'supabaseProvisionFlow.ts'), 'utf8');
  const route = readFileSync(resolve(__dirname, '../routes/supabaseIntegration.ts'), 'utf8');

  it('a provisioned database is SCOPED to the app it was made for', () => {
    expect(flow).toContain('saveUserSecrets(uid, env, input.workspaceId)');
  });

  it('reuse is checked BEFORE a project is created, so no slot is spent needlessly', () => {
    const reuseAt = flow.indexOf('reusableDatabase(');
    const createAt = flow.indexOf('createProject(');
    expect(reuseAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(-1);
    expect(reuseAt).toBeLessThan(createAt);
  });

  it('🔒 an app that already has its own database is never quietly handed a different one', () => {
    expect(flow).toContain('appHasOwnDatabase(rows, workspace)');
  });

  it('forceNew skips reuse, so "keep this app separate" is genuinely possible', () => {
    expect(flow).toContain('!input.forceNew');
    expect(route).toContain('forceNew: body.forceNew === true');
  });

  it('🔒 a reuse is reported as a reuse, never as "created"', () => {
    expect(route).toContain('reused: true');
    expect(route).toContain('reusedDatabaseNote');
  });

  it('🔒 a reuse claims no schema work it did not do', () => {
    const branch = flow.slice(flow.indexOf('reused: true'), flow.indexOf('reused: true') + 900);
    expect(branch).toContain('schemaApplied: null');
    expect(branch).not.toContain('schemaApplied: true');
  });
});
