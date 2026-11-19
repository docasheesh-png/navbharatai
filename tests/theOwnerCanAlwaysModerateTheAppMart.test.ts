// THE OWNER CAN ALWAYS MODERATE THE APP MART (owner 2026-11-18, with a screenshot: Browse / Publish / My apps and no
// fourth tab — "yeh system pahle tha, ab band ho gaya pata nahi kyu").
//
// The CLASS: two admin lists that drifted apart. "Admin Panel" is shown for the signed admin session (password + MFA);
// the App Mart's Review tab and every moderation route asked only `NAV_STORE_ADMINS`. After #4191 removed the
// `AGENTV3_FREE_LIST` fallback — correctly — an owner signed in with an account outside that one env list had the
// panel and no Review tab. Store authority is now ONE decision, `storeAdminRequest`: the admin session OR the explicit
// allowlist, never a free-build grant. A census fails when a route asks the email list alone again.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Request } from 'express';
import { storeAdminRequest } from '../src/server/lib/storeAdminPermission';
import { adminSessionSigningKey, mintAdminToken } from '../src/server/lib/adminAuth';
import { withStoreAdminSession } from '../src/lib/storeAdminHeaders';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';

const KEY = 'b2'.repeat(32);
const saved = { key: process.env.ADMIN_SESSION_SIGNING_KEY, pass: process.env.ADMIN_PASSWORD, user: process.env.ADMIN_USERNAME, store: process.env.NAV_STORE_ADMINS, free: process.env.AGENTV3_FREE_LIST };
const restore = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
beforeEach(() => {
  process.env.ADMIN_SESSION_SIGNING_KEY = KEY;
  process.env.ADMIN_PASSWORD = 'panel-pass-for-tests';
  process.env.ADMIN_USERNAME = 'owner';
  process.env.NAV_STORE_ADMINS = 'reviewer@example.test';
  process.env.AGENTV3_FREE_LIST = 'free@example.test';
});
afterEach(() => {
  restore('ADMIN_SESSION_SIGNING_KEY', saved.key); restore('ADMIN_PASSWORD', saved.pass); restore('ADMIN_USERNAME', saved.user);
  restore('NAV_STORE_ADMINS', saved.store); restore('AGENTV3_FREE_LIST', saved.free);
});
const req = (headers: Record<string, string> = {}) => ({ headers, query: {} } as unknown as Request);
const session = () => mintAdminToken(adminSessionSigningKey(), 'owner', Date.now());

describe('1 · who may moderate', () => {
  it('the screenshot: an owner with an admin session, signed in with an account outside NAV_STORE_ADMINS → allowed', () => {
    expect(storeAdminRequest(req({ 'x-admin-token': session() }), 'owner-other@example.test')).toBe(true);
  });
  it('a listed reviewer without the panel session → allowed', () => {
    expect(storeAdminRequest(req(), 'reviewer@example.test')).toBe(true);
  });
  it('a free-build grant is still no authority, and nor is a forged or expired session', () => {
    expect(storeAdminRequest(req(), 'free@example.test')).toBe(false);
    expect(storeAdminRequest(req({ 'x-admin-token': 'forged.token' }), 'free@example.test')).toBe(false);
    expect(storeAdminRequest(req({ 'x-admin-token': mintAdminToken(adminSessionSigningKey(), 'owner', Date.now() - 400 * 24 * 3600_000) }), null)).toBe(false);
    expect(storeAdminRequest(req(), null)).toBe(false);
  });
});

describe('2 · the client sends the session to the store, only when there is one', () => {
  const store = (v: string | null) => ({ getItem: () => v });
  it('adds x-admin-token when a session is stored, and changes nothing otherwise', () => {
    expect(withStoreAdminSession({ Authorization: 'Bearer t' }, store('sess'))).toEqual({ Authorization: 'Bearer t', 'x-admin-token': 'sess' });
    expect(withStoreAdminSession({ Authorization: 'Bearer t' }, store(null))).toEqual({ Authorization: 'Bearer t' });
  });
});

describe('3 · CENSUS: every store, social and gallery route asks the one decision', () => {
  const read = (p: string) => stripCodeComments(readFileSync(resolve(__dirname, '..', p), 'utf8'));
  for (const file of ['src/server/routes/navStore.ts', 'src/server/routes/appMartSocial.ts', 'src/server/routes/gallery.ts']) {
    it(`${file} never gates on the email list alone`, () => {
      const code = read(file);
      expect(code).not.toMatch(/isStoreAdmin\(identityGrantEmail/);
      expect(code).toMatch(/storeAdminRequest\(req, identityGrantEmail/);
    });
  }
  it('the App Mart screen, its social client and the gallery queue send the session', () => {
    const mart = read('src/components/ide/NavAppStore.tsx');
    expect(mart).not.toMatch(/fetch\(['`]\/api\/nav-store[^)]*authedHeaders\(/);
    expect(mart).toMatch(/fetch\('\/api\/nav-store\/status',\s*\{\s*headers:\s*await storeHeaders\(\)(?:\s*,\s*signal:\s*controller\.signal)?\s*\}\)/);
    expect(read('src/components/ide/appMart/appMartSocialApi.ts')).toContain('withStoreAdminSession(');
    expect(read('src/components/panels/GalleryPanel.tsx')).toContain('galleryReviewApi(async () => withStoreAdminSession(');
  });
});
