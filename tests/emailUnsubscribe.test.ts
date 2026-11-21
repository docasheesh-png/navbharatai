/**
 * Notification emails carry a working unsubscribe (admin 2026-11-21).
 *
 * The class locked here: "the platform mails a user about their own things with no way to stop it". Every
 * user-facing notification sender must go through prepareNotificationEmail (preference check + link + headers);
 * the census at the bottom fails when a NEW sender mails a user without it.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  unsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl, unsubscribeMail, unsubscribeSigningKey,
  mayEmail, setEmailPreference, prepareNotificationEmail, preferenceStops, type EmailPreferenceBackend,
} from '../src/server/lib/emailUnsubscribe';
import { sendAlertEmail } from '../src/server/lib/alertEmail';
import { registerEmailUnsubscribeRoutes, unsubscribePage } from '../src/server/routes/emailUnsubscribe';
import { notifyStoreApproval } from '../src/server/lib/storeApprovalNotify';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

const KEY = Buffer.alloc(32, 7);

function memoryBackend(seed: Record<string, unknown> = {}) {
  const store: Record<string, any> = { ...seed };
  const b: EmailPreferenceBackend = {
    read: async (uid) => store[uid],
    write: async (uid, category, unsubscribed) => {
      store[uid] = { ...(store[uid] ?? {}), unsubscribed: { ...(store[uid]?.unsubscribed ?? {}), [category]: unsubscribed } };
    },
  };
  return { store, backend: () => b };
}

describe('the signed link', () => {
  it('verifies only for its own uid and category', () => {
    const t = unsubscribeToken('u1', 'site-status', KEY);
    expect(verifyUnsubscribeToken('u1', 'site-status', t, KEY)).toBe(true);
    expect(verifyUnsubscribeToken('u2', 'site-status', t, KEY)).toBe(false);
    expect(verifyUnsubscribeToken('u1', 'store-updates', t, KEY)).toBe(false);
    expect(verifyUnsubscribeToken('u1', 'site-status', t + 'x', KEY)).toBe(false);
    expect(verifyUnsubscribeToken('u1', 'everything', t, KEY)).toBe(false);
    expect(verifyUnsubscribeToken('u1', 'site-status', t, null)).toBe(false);
  });
  it('production never signs with a key from source', () => {
    expect(unsubscribeSigningKey({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBeNull();
    expect(unsubscribeSigningKey({ NODE_ENV: 'production', SECRET_ENCRYPTION_KEY: 'k' } as NodeJS.ProcessEnv)).not.toBeNull();
    expect(unsubscribeUrl('u1', 'site-status', null)).toBeNull();
  });
  it('the mail carries a footer link and the one-click headers', () => {
    const m = unsubscribeMail('u1', 'database-status', KEY, 'https://navbharatai.com')!;
    expect(m.footerLine).toMatch(/Unsubscribe: https:\/\/navbharatai\.com\/api\/email\/unsubscribe\?u=u1&c=database-status&t=/);
    expect(m.headers['List-Unsubscribe']).toMatch(/^<https:\/\/navbharatai\.com\/api\/email\/unsubscribe\?/);
    expect(m.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
});

describe('the preference', () => {
  it('unsubscribing one category leaves the others', async () => {
    const { backend } = memoryBackend();
    await setEmailPreference('u1', 'site-status', true, backend);
    expect(await mayEmail('u1', 'site-status', backend)).toBe(false);
    expect(await mayEmail('u1', 'store-updates', backend)).toBe(true);
    await setEmailPreference('u1', 'site-status', false, backend);
    expect(await mayEmail('u1', 'site-status', backend)).toBe(true);
  });
  it('an unreadable preference means do not email — the bell still carries it', async () => {
    expect(await mayEmail('u1', 'site-status', () => ({ read: async () => { throw new Error('down'); }, write: async () => {} }))).toBe(false);
    expect(await mayEmail('u1', 'site-status', () => null)).toBe(false);
  });
  it('prepareNotificationEmail: null when unsubscribed or unsignable', async () => {
    const { backend } = memoryBackend({ u1: { unsubscribed: { 'site-status': true } } });
    expect(await prepareNotificationEmail('u1', 'site-status', { key: KEY, backend })).toBeNull();
    expect(await prepareNotificationEmail('u1', 'store-updates', { key: KEY, backend })).not.toBeNull();
    expect(await prepareNotificationEmail('u2', 'store-updates', { key: null, backend })).toBeNull();
    expect(preferenceStops(undefined, 'site-status')).toBe(false);
  });
});

describe('the mailer sends the headers to the provider', () => {
  it('headers ride in the request body; absent when none', async () => {
    const bodies: any[] = [];
    const fetchImpl = (async (_u: string, init: any) => { bodies.push(JSON.parse(init.body)); return { ok: true, text: async () => '' }; }) as unknown as typeof fetch;
    const cfg = { configured: true, reason: '', apiKey: 'k', from: 'a <a@b.c>', to: ['x@y.z'], endpoint: 'https://example.invalid' };
    await sendAlertEmail(cfg, 'hi', { fetchImpl, subject: 's', headers: { 'List-Unsubscribe': '<https://x>' } });
    await sendAlertEmail(cfg, 'hi', { fetchImpl, subject: 's' });
    expect(bodies[0].headers).toEqual({ 'List-Unsubscribe': '<https://x>' });
    expect(bodies[1]).not.toHaveProperty('headers');
  });
});

describe('the unsubscribe page', () => {
  const routes = captureRoutes(registerEmailUnsubscribeRoutes);
  const link = (uid: string, c: string) => ({ u: uid, c, t: unsubscribeToken(uid, c as never, unsubscribeSigningKey()!) });
  it('a bad link is refused and changes nothing', async () => {
    const res = mockRes();
    await routes.get('POST /api/email/unsubscribe')!(mockReq({ query: { u: 'u1', c: 'site-status', t: 'forged' }, body: {} }), res);
    expect(res.statusCode).toBe(400);
  });
  it('GET only shows a button (scanners open links); the page escapes what it prints', async () => {
    const res = mockRes();
    await routes.get('GET /api/email/unsubscribe')!(mockReq({ query: link('u1', 'site-status') }), res);
    // Under tests there is no database, so the preference is unreadable and the page offers "Subscribe again"
    // or "Unsubscribe" — either way it is a FORM, never a change made by the GET itself.
    expect(String(res.body)).toMatch(/<form method="post" action="\/api\/email\/unsubscribe\?u=u1&amp;c=site-status&amp;t=/);
    expect(unsubscribePage({ title: '<x>', message: '"m"' })).toContain('&lt;x&gt;');
  });
  it('POST without storage says it could not save, rather than claiming success', async () => {
    const res = mockRes();
    await routes.get('POST /api/email/unsubscribe')!(mockReq({ query: link('u1', 'site-status'), body: { 'List-Unsubscribe': 'One-Click' } }), res);
    expect(res.statusCode).toBe(503);
    expect(String(res.body)).toMatch(/could not be saved/);
  });
});

describe('a store-approval email names whose mail it is', () => {
  it('passes the uid to the mailer, so the unsubscribe link belongs to that account', async () => {
    const email = vi.fn(async () => true);
    await notifyStoreApproval('uid-9', 'My App', 'web' as never, { notify: async () => null, resolveEmail: async () => 'a@b.c', email });
    expect(email).toHaveBeenCalledWith('a@b.c', expect.any(String), expect.any(String), 'uid-9');
  });
});

describe('census: every user-facing notification email goes through the unsubscribe gate', () => {
  // A sender is any server file that calls sendAlertEmail. Each must either prepare the unsubscribe or be listed
  // here with the reason it may not have one.
  const EXEMPT: Record<string, string> = {
    'src/server/lib/monitorAlerts.ts': 'admin monitor alerts — mailed to the admin, not to users',
    'src/server/routes/appLock.ts': 'the App Lock security code the person just asked for — unsubscribing would stop them setting their PIN',
    'src/server/lib/alertEmail.ts': 'the mailer itself',
  };
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : (/\.ts$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : []);
  });
  it('no sender mails a user without prepareNotificationEmail', () => {
    const senders = walk('src/server').filter((p) => /sendAlertEmail\(/.test(readFileSync(p, 'utf8')));
    const unguarded = senders.filter((p) => !EXEMPT[p] && !/prepareNotificationEmail\(/.test(readFileSync(p, 'utf8')));
    expect(unguarded, 'Add prepareNotificationEmail (emailUnsubscribe.ts) or list the file in EXEMPT with why').toEqual([]);
    expect(senders.length).toBeGreaterThanOrEqual(5);
  });
});
