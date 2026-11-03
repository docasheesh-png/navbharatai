/**
 * Admin 2026-11-03: "kis provider me <email> use hua hai, woh bhi likh dena". The code cannot know which login an
 * account was opened with, so the admin records it on the API Providers page. Locked here: only real emails or a
 * clear are accepted, only for providers the page knows, the email is never written to the audit log, and a
 * storage failure is never shown as "no login recorded".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: () => state.db }));
import { ApiProviderAccountInputError, normalizeAccountEmail, readApiProviderAccounts, writeApiProviderAccount, API_PROVIDER_ACCOUNTS_COLLECTION } from '../src/server/lib/apiProviderAccounts';

function fakeDb(opts: { fail?: boolean } = {}) {
  const docs = new Map<string, any>();
  const db = {
    docs,
    collection: (name: string) => {
      expect(name).toBe(API_PROVIDER_ACCOUNTS_COLLECTION);
      return {
        get: async () => { if (opts.fail) throw new Error('down'); return { docs: [...docs].map(([id, d]) => ({ id, data: () => d })) }; },
        doc: (id: string) => ({ set: async (d: any) => { docs.set(id, d); }, delete: async () => { docs.delete(id); } }),
      };
    },
  };
  return db;
}
afterEach(() => { state.db = null; });

describe('a login is an email, or a clear', () => {
  it('accepts and lower-cases an email; empty clears; anything else is refused with a sentence', () => {
    expect(normalizeAccountEmail(' Owner.Name093@Gmail.com ')).toBe('owner.name093@gmail.com');
    expect(normalizeAccountEmail('')).toBeNull();
    expect(normalizeAccountEmail(null)).toBeNull();
    for (const bad of ['not-an-email', 'a@b', '<script>@x.com', 'x'.repeat(250) + '@x.com', 42]) {
      expect(() => normalizeAccountEmail(bad)).toThrow(ApiProviderAccountInputError);
    }
  });
});

describe('the record', () => {
  it('saves, reads back and clears — only for providers the page knows', async () => {
    state.db = fakeDb();
    await writeApiProviderAccount('glm', 'owner@example.com', () => 7);
    await writeApiProviderAccount('e2b', 'other@example.com');
    expect(await readApiProviderAccounts()).toEqual({ glm: 'owner@example.com', e2b: 'other@example.com' });
    await writeApiProviderAccount('glm', '');
    expect(await readApiProviderAccounts()).toEqual({ e2b: 'other@example.com' });
    await expect(writeApiProviderAccount('../evil', 'a@example.com')).rejects.toThrow(ApiProviderAccountInputError);
  });
  it('a stray doc for an unknown id is never shown', async () => {
    state.db = fakeDb();
    state.db.docs.set('not-a-provider', { accountEmail: 'x@example.com' });
    expect(await readApiProviderAccounts()).toEqual({});
  });
  it('🔒 storage failure throws (the route then says "could not be loaded", never "not recorded")', async () => {
    state.db = fakeDb({ fail: true });
    await expect(readApiProviderAccounts()).rejects.toThrow();
    state.db = null;
    await expect(readApiProviderAccounts()).rejects.toThrow();
  });
  it('🔒 the route audits the provider, never the email, and keeps balances when logins fail', () => {
    const route = readFileSync('src/server/routes/apiProvidersAdmin.ts', 'utf8');
    const auditLines = route.split('\n').filter((l) => l.includes("audit('ADMIN_API_PROVIDER_ACCOUNT"));
    expect(auditLines.length).toBe(2);
    for (const l of auditLines) expect(l).not.toMatch(/accountEmail|saved\b(?! \?)|rawEmail/);
    expect(route).toContain('accountsAvailable: accounts !== null');
  });
});
