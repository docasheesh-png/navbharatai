/**
 * Q-3703 — saved app signing keys leave with the account (the admin's decision (a), 2026-11-27), and the user is
 * warned, with a working download, BEFORE they can confirm.
 *
 * What this locks:
 *   1. The server tells the screen the REAL keys (metadata only), per user; an unreadable store is a 502, never [].
 *   2. The download hands back the user's OWN key (file bytes + passwords), audited, and never another user's.
 *   3. A build signing during the erase cannot leave a 'used' event behind, and nothing re-creates the key row.
 *   4. The warning renders only when keys exist (or the check failed), and blocks the delete until acknowledged.
 *   5. The client download decodes the real bytes and saves them through the one delivery helper.
 * The erase itself (keys + events, only the departing user's) is locked in `aCredentialDiesWithTheAccount.test.ts`
 * and the order (keys before events) in `nativeRowsAndExpiredShares.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { captureRoutes, mockRes } from './helpers/routeTestUtils';
import { NativeBuildFirestore } from './helpers/nativeBuildFirestore';

const who = { uid: 'user-a' as string | null };
vi.mock('../src/server/lib/authMiddleware', () => ({
  verifyFirebaseIdentity: async () => (who.uid ? { uid: who.uid, email: null, emailVerified: false } : null),
}));
vi.mock('../src/server/lib/mobileBuild/nativeBuildRunner', async (orig) => {
  const real = await orig<typeof import('../src/server/lib/mobileBuild/nativeBuildRunner')>();
  return { ...real, startNativeBuildSweeper: () => {} };
});
const delivered: Array<{ name: string; bytes: Uint8Array }> = [];
vi.mock('../src/lib/downloadFile', async (orig) => {
  const real = await orig<typeof import('../src/lib/downloadFile')>();
  return {
    ...real,
    deliverFile: async (name: string, blob: Blob) => { delivered.push({ name, bytes: new Uint8Array(await blob.arrayBuffer()) }); return 'downloaded' as const; },
  };
});
vi.mock('../src/lib/authHeaders', () => ({ authedHeaders: async (extra?: Record<string, string>) => ({ ...(extra || {}), Authorization: 'Bearer t' }) }));

import * as store from '../src/server/lib/mobileBuild/nativeBuildStore';
import { registerMobileBuildRoutes } from '../src/server/routes/mobileBuilds';
import { SigningKeysNotice, signingKeysAllowDelete, type SigningKeysState, type SigningKeysNoticeProps } from '../src/components/settings/DangerZone';
import { isExportedKeyAnswer, isKeyListAnswer, type SigningKeyMeta } from '../src/lib/mobileBuildClient';
import { downloadSigningKey } from '../src/lib/signingKeyDownload';

const ENV = { SECRET_ENCRYPTION_KEY: 'unit-test-key-0123456789abcdef!!' };
const routes = captureRoutes(registerMobileBuildRoutes);
const call = async (key: string, req: Record<string, unknown> = {}) => {
  const res = mockRes() as any;
  const handler = routes.get(key);
  if (!handler) throw new Error(`no route ${key}`);
  await handler({ headers: {}, query: {}, params: {}, body: {}, ...req }, res);
  return res;
};
const KEY = (pw: string) => ({ keystore: Buffer.from(`KEYSTORE-${pw}`), storePassword: `store-${pw}`, keyPassword: `key-${pw}`, alias: 'upload', certSha256: 'AB:CD', source: 'generated' as const });

let db: NativeBuildFirestore;
beforeEach(() => {
  Object.assign(process.env, ENV);
  db = new NativeBuildFirestore();
  store.setNativeBuildDbForTests(db as any);
  who.uid = 'user-a';
  delivered.length = 0;
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('1. the screen is told the real keys, per user', () => {
  it('lists only the caller\'s keys, metadata only — never a sealed blob or a password', async () => {
    await store.saveKey('user-a', 'com.a.one', KEY('a1'), { replace: false });
    await store.saveKey('user-a', 'com.a.two', KEY('a2'), { replace: false });
    await store.saveKey('user-b', 'com.b.app', KEY('b'), { replace: false });
    const res = await call('GET /api/mobile-builds/signing-keys');
    expect(res.statusCode).toBe(200);
    expect(isKeyListAnswer(res.body)).toBe(true);
    expect(res.body.keys.map((k: SigningKeyMeta) => k.appId).sort()).toEqual(['com.a.one', 'com.a.two']);
    const text = JSON.stringify(res.body);
    for (const secret of ['Sealed', 'store-a1', 'key-a1', 'KEYSTORE', 'user-a', 'com.b.app']) expect(text).not.toContain(secret);
  });

  it('a user with no keys gets an empty list; an unreadable store is a 502, never an empty list', async () => {
    expect((await call('GET /api/mobile-builds/signing-keys')).body).toEqual({ keys: [] });
    store.setNativeBuildDbForTests(null);
    const res = await call('GET /api/mobile-builds/signing-keys');
    expect(res.statusCode).toBe(502);
    expect(res.body.keys).toBeUndefined();
  });
});

describe('2. the download hands back the user\'s OWN key, audited', () => {
  it('returns the real keystore bytes and both passwords, and records an "exported" event', async () => {
    await store.saveKey('user-a', 'com.a.one', KEY('a1'), { replace: false });
    const res = await call('POST /api/mobile-builds/signing-key/export', { body: { appId: 'com.a.one' } });
    expect(res.statusCode).toBe(200);
    expect(isExportedKeyAnswer(res.body)).toBe(true);
    expect(Buffer.from(res.body.keystore.base64, 'base64').toString()).toBe('KEYSTORE-a1');
    expect(res.body.keystore).toMatchObject({ storePassword: 'store-a1', keyPassword: 'key-a1', keyAlias: 'upload', sha256Fingerprint: 'AB:CD' });
    expect(db.rows(store.KEY_EVENTS).map((e) => e.event)).toEqual(['generated', 'exported']);
  });

  it('user A can never download user B\'s key — answered exactly like a missing one', async () => {
    await store.saveKey('user-b', 'com.b.app', KEY('b'), { replace: false });
    const res = await call('POST /api/mobile-builds/signing-key/export', { body: { appId: 'com.b.app' } });
    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('store-b');
    expect(db.rows(store.KEY_EVENTS).map((e) => e.event)).toEqual(['generated']);
  });

  it('refuses a malformed app id and a signed-out caller', async () => {
    expect((await call('POST /api/mobile-builds/signing-key/export', { body: { appId: '../x' } })).statusCode).toBe(400);
    who.uid = null;
    expect((await call('POST /api/mobile-builds/signing-key/export', { body: { appId: 'com.a.one' } })).statusCode).toBe(401);
  });
});

describe('3. a build signing during the erase cannot outlive it', () => {
  it('a key erased before the build opens it: no plaintext, no event, no row re-created', async () => {
    await store.saveKey('user-a', 'com.a.one', KEY('a1'), { replace: false });
    // The account erase: keys, then events (DataRetentionManager order).
    for (const r of db.rows(store.KEYS)) await db.collection(store.KEYS).doc(r.id as string).delete();
    db.data.get(store.KEY_EVENTS)?.clear();
    expect(await store.openKeyForSigning('user-a', 'com.a.one', 'nb_x')).toBeNull();
    expect(db.rows(store.KEYS)).toEqual([]);
    expect(db.rows(store.KEY_EVENTS)).toEqual([]);
  });

  it('the "used" event is written in the same transaction that sees the key — erased mid-read, nothing is written', async () => {
    await store.saveKey('user-a', 'com.a.one', KEY('a1'), { replace: false });
    db.data.get(store.KEY_EVENTS)?.clear();
    const id = store.signingKeyId('user-a', 'com.a.one');
    // The erase lands between the build's read and its commit: the transaction re-runs and finds no key.
    const realRun = db.runTransaction.bind(db);
    let erased = false;
    (db as any).runTransaction = (fn: (tx: any) => Promise<unknown>) => realRun(async (tx: any) => {
      const out = await fn(tx);
      if (!erased) { erased = true; await db.collection(store.KEYS).doc(id).delete(); }
      return out;
    });
    expect(await store.openKeyForSigning('user-a', 'com.a.one', 'nb_x')).toBeNull();
    expect(db.rows(store.KEYS)).toEqual([]);
    expect(db.rows(store.KEY_EVENTS)).toEqual([]);
  });

  it('with the key present, a signing still works and is audited as before', async () => {
    await store.saveKey('user-a', 'com.a.one', KEY('a1'), { replace: false });
    const plain = await store.openKeyForSigning('user-a', 'com.a.one', 'nb_x');
    expect(plain?.keystore.toString()).toBe('KEYSTORE-a1');
    expect(db.rows(store.KEY_EVENTS).map((e) => [e.event, e.buildId])).toEqual([['generated', null], ['used', 'nb_x']]);
    expect(db.rows(store.KEYS)[0].lastUsedAt).toEqual(expect.any(String));
  });
});

const META: SigningKeyMeta = { appId: 'com.a.one', alias: 'upload', certSha256: 'AB:CD', source: 'generated', createdAt: '2026-11-27T00:00:00Z', lastUsedAt: null };
const notice = (state: SigningKeysState, over: Partial<SigningKeysNoticeProps> = {}) => renderToStaticMarkup(createElement(SigningKeysNotice, {
  state, acknowledged: false, onAcknowledge: () => {}, onDownload: () => {}, downloading: null, downloaded: {}, failures: {}, ...over,
}));

describe('4. the warning follows real state and holds the delete', () => {
  it('renders NOTHING when the server confirmed there are no keys', () => {
    expect(notice({ status: 'ready', keys: [] })).toBe('');
  });

  it('with keys: says forever, names each app, offers its download, and asks for an acknowledgement', () => {
    const html = notice({ status: 'ready', keys: [META, { ...META, appId: 'com.a.two' }] });
    expect(html).toContain('Deleting your account deletes your 2 Google Play signing keys forever');
    expect(html).toContain('can never publish an update to that app under the same Google Play listing');
    expect(html).toContain('com.a.one');
    expect(html).toContain('com.a.two');
    expect(html.match(/Download key/g)).toHaveLength(2);
    expect(html).toContain('I understand that my saved signing keys are deleted forever');
    expect(html).toContain('text-danger');
  });

  it('a failed check is said as a failure, never read as "no keys"', () => {
    const html = notice({ status: 'error', sentence: 'Your saved signing keys could not be checked right now.' });
    expect(html).toContain('We could not check whether you have saved Google Play signing keys');
    expect(html).toContain('I understand');
  });

  it('after a download, the passwords the key file needs are on screen', () => {
    const html = notice({ status: 'ready', keys: [META] }, { downloaded: { 'com.a.one': { message: 'Downloaded com.a.one-upload.keystore.', key: { base64: 'eA==', storePassword: 'sp-1', keyPassword: 'kp-1', keyAlias: 'upload', sha256Fingerprint: 'AB:CD' } } } });
    expect(html).toContain('sp-1');
    expect(html).toContain('kp-1');
    expect(html).toContain('Downloaded com.a.one-upload.keystore.');
  });

  it('the delete is held while checking, and with keys or a failed check until acknowledged', () => {
    expect(signingKeysAllowDelete({ status: 'loading' }, true)).toBe(false);
    expect(signingKeysAllowDelete({ status: 'ready', keys: [] }, false)).toBe(true);
    expect(signingKeysAllowDelete({ status: 'ready', keys: [META] }, false)).toBe(false);
    expect(signingKeysAllowDelete({ status: 'ready', keys: [META] }, true)).toBe(true);
    expect(signingKeysAllowDelete({ status: 'error', sentence: 'x' }, false)).toBe(false);
    expect(signingKeysAllowDelete({ status: 'error', sentence: 'x' }, true)).toBe(true);
  });
});

describe('5. the client download saves the real bytes', () => {
  it('posts the app id, decodes the keystore and saves it under the app\'s keystore name', async () => {
    const seen: Array<{ url: string; body: string }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ key: META, keystore: { base64: Buffer.from('KEYSTORE-a1').toString('base64'), storePassword: 'sp', keyPassword: 'kp', keyAlias: 'upload', sha256Fingerprint: 'AB:CD' } }), { status: 200 });
    });
    const r = await downloadSigningKey('com.a.one');
    expect(seen).toEqual([{ url: '/api/mobile-builds/signing-key/export', body: JSON.stringify({ appId: 'com.a.one' }) }]);
    expect(r).toMatchObject({ ok: true, saved: true, message: 'Downloaded com.a.one-upload.keystore.' });
    expect(delivered).toHaveLength(1);
    expect(delivered[0].name).toBe('com.a.one-upload.keystore');
    expect(Buffer.from(delivered[0].bytes).toString()).toBe('KEYSTORE-a1');
  });

  it('a refusal or a malformed body saves nothing and says so', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'No saved key for that app.' }), { status: 404 }));
    expect(await downloadSigningKey('com.a.one')).toEqual({ ok: false, sentence: 'No saved key for that app.' });
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ key: META, keystore: { base64: '' } }), { status: 200 }));
    expect((await downloadSigningKey('com.a.one')).ok).toBe(false);
    expect(delivered).toHaveLength(0);
  });
});
