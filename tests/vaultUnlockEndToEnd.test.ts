/**
 * THE WHOLE LOCK, END TO END, WITH A REAL KEY PAIR.
 *
 * The other suites test the pieces. This one drives the actual sequence a phone goes through —
 * challenge → sign with a private key → unlock → spend the ticket on a reveal — and then breaks each
 * step in turn to prove the refusal is real rather than incidental.
 *
 * It matters because the pieces can all be individually correct and still be wired together wrongly:
 * a route that forgets to check the userVerified flag, or verifies the signature against the wrong
 * bytes, passes every unit test of `deviceUnlock.ts` and ships an unlocked vault.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateKeyPairSync, createSign, createHash, type KeyObject } from 'crypto';
import { captureRoutes, mockReq, mockRes, type MockResponse } from './helpers/routeTestUtils';
import { encrypt } from '../src/server/lib/secrets';

process.env.VITEST = 'true';
// No VAULT_LOCK_ORIGINS is set here on purpose. The built-in defaults already accept
// https://navbharatai.com, so the suite exercises the SHIPPING configuration — and setting a process
// env var in one test file leaks into every other file sharing the worker, which is its own bug class.

const UID = 'owner_uid';
const RP_ID = 'navbharatai.com';
const CRED_ID = 'credential-abc123';

interface Row { user_id: string; secret_name?: string; encrypted_secret_value?: string; deleted?: boolean }
const SECRETS: Record<string, Row> = {};
const CREDS: Record<string, Record<string, unknown>> = {};
const ADDED: Array<Record<string, unknown>> = [];

vi.mock('../src/server/lib/serverDb', () => ({
  doc: (_db: any, col: string, id: string) => ({ id, col }),
  getDoc: async (ref: any) => {
    const store = ref.col === 'user_device_credentials' ? CREDS : SECRETS;
    return { exists: () => Object.prototype.hasOwnProperty.call(store, ref.id), data: () => store[ref.id] };
  },
  setDoc: async (ref: any, data: any) => { CREDS[ref.id] = data; },
  updateDoc: async (ref: any, patch: any) => {
    const store = ref.col === 'user_device_credentials' ? CREDS : SECRETS;
    if (store[ref.id]) Object.assign(store[ref.id] as object, patch);
  },
  deleteDoc: async (ref: any) => { delete SECRETS[ref.id]; },
  collection: (_db: any, name: string) => ({ name }),
  addDoc: async (coll: any, data: any) => { ADDED.push({ collection: coll?.name, ...data }); return { id: 'x' }; },
  getDocs: async (q: any) => {
    // The only listing queries in play are "this user's device credentials" and "this user's secrets".
    // The mock's query() carries the collection name through so both can be answered from one function.
    if (q?.name === 'user_device_credentials') {
      return { docs: Object.entries(CREDS).map(([id, data]) => ({ id, data: () => data })) };
    }
    return { docs: Object.entries(SECRETS).map(([id, data]) => ({ id, data: () => data })) };
  },
  query: (ref: any) => ref,
  where: () => ({}),
  getServerDb: () => ({}),
}));

const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const spkiB64url = (keys.publicKey.export({ format: 'der', type: 'spki' }) as Buffer)
  .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** authenticatorData with a real rpIdHash. `uv` controls the flag the whole feature hinges on. */
function authData(opts: { uv?: boolean; counter?: number; rpId?: string; attested?: boolean } = {}): Buffer {
  const rpIdHash = createHash('sha256').update(opts.rpId ?? RP_ID, 'utf8').digest();
  const tail = Buffer.alloc(5);
  tail[0] = (0x01 /* userPresent */) | (opts.uv === false ? 0 : 0x04) | (opts.attested ? 0x40 : 0);
  tail.writeUInt32BE(opts.counter ?? 0, 1);
  const head = Buffer.concat([rpIdHash, tail]);
  if (!opts.attested) return head;
  const id = Buffer.from(CRED_ID, 'utf8');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(id.length, 0);
  return Buffer.concat([head, Buffer.alloc(16), len, id]);
}

function clientData(type: 'webauthn.create' | 'webauthn.get', challenge: string, origin = 'https://navbharatai.com'): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge: b64url(Buffer.from(challenge, 'utf8')), origin }), 'utf8');
}

function sign(priv: KeyObject, ad: Buffer, cd: Buffer): Buffer {
  const s = createSign('SHA256');
  s.update(Buffer.concat([ad, createHash('sha256').update(cd).digest()]));
  s.end();
  return s.sign(priv);
}

async function handlers() {
  const { registerSecretsRoutes } = await import('../src/server/routes/secrets');
  const routes = captureRoutes(registerSecretsRoutes);
  return {
    challenge: routes.get('POST /api/secrets/:userId/lock/challenge')!,
    register: routes.get('POST /api/secrets/:userId/lock/register')!,
    unlock: routes.get('POST /api/secrets/:userId/unlock')!,
    reveal: routes.get('POST /api/secrets/:userId/reveal')!,
  };
}

async function freshChallenge(): Promise<string> {
  const h = await handlers();
  const res = mockRes();
  await h.challenge(mockReq({ params: { userId: UID } }), res);
  return (res.body as { challenge: string }).challenge;
}

/** Register the device once, the way the browser would. Returns nothing; the credential is in CREDS. */
async function registerDevice(): Promise<MockResponse> {
  const h = await handlers();
  const challenge = await freshChallenge();
  const ad = authData({ attested: true });
  const cd = clientData('webauthn.create', challenge);
  const res = mockRes();
  await h.register(mockReq({
    params: { userId: UID },
    body: { credentialId: CRED_ID, publicKeySpki: spkiB64url, alg: -7, clientDataJSON: b64url(cd), authenticatorData: b64url(ad) },
  }), res);
  return res;
}

/** Produce an assertion and ask the unlock route about it. */
async function tryUnlock(opts: { uv?: boolean; counter?: number; origin?: string; rpId?: string; signWith?: KeyObject; challenge?: string } = {}) {
  const h = await handlers();
  const challenge = opts.challenge ?? (await freshChallenge());
  const ad = authData({ uv: opts.uv, counter: opts.counter, rpId: opts.rpId });
  const cd = clientData('webauthn.get', challenge, opts.origin);
  const res = mockRes();
  await h.unlock(mockReq({
    params: { userId: UID },
    body: {
      mode: 'device',
      credentialId: CRED_ID,
      clientDataJSON: b64url(cd),
      authenticatorData: b64url(ad),
      signature: b64url(sign(opts.signWith ?? keys.privateKey, ad, cd)),
    },
  }), res);
  return res;
}

beforeEach(() => {
  for (const k of Object.keys(SECRETS)) delete SECRETS[k];
  for (const k of Object.keys(CREDS)) delete CREDS[k];
  ADDED.length = 0;
  SECRETS['s1'] = { user_id: UID, secret_name: 'OPENAI_API_KEY', encrypted_secret_value: encrypt('sk-proj-REAL-VALUE') };
});

describe('the happy path — a registered device opens the vault and reads a key', () => {
  it('registers, unlocks, and the ticket then works on the reveal route', async () => {
    const reg = await registerDevice();
    expect(reg.statusCode).toBe(200);
    expect(CREDS[`${UID}__${CRED_ID}`]).toMatchObject({ user_id: UID, credential_id: CRED_ID, alg: -7 });

    const unlocked = await tryUnlock();
    expect(unlocked.statusCode).toBe(200);
    const ticket = (unlocked.body as { ticket: string; method: string }).ticket;
    expect((unlocked.body as { method: string }).method).toBe('device-lock');

    const h = await handlers();
    const revealed = mockRes();
    await h.reveal(mockReq({ params: { userId: UID }, headers: { 'x-vault-unlock': ticket } }), revealed);
    expect(revealed.statusCode).toBe(200);
    expect((revealed.body as Array<{ secret_value: string }>)[0].secret_value).toBe('sk-proj-REAL-VALUE');
  });

  it('🔒 stores only the PUBLIC key — no private material ever reaches the database', async () => {
    await registerDevice();
    const stored = JSON.stringify(CREDS[`${UID}__${CRED_ID}`]);
    expect(stored).not.toContain('PRIVATE');
    expect(stored).toContain(spkiB64url);
  });
});

describe('each step, broken in turn — the refusals are real', () => {
  beforeEach(async () => { await registerDevice(); });

  it('🔒 refuses an assertion signed by a DIFFERENT key', async () => {
    const impostor = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const res = await tryUnlock({ signWith: impostor.privateKey });
    expect(res.statusCode).toBe(401);
  });

  it('🔒 refuses when the device did NOT verify the person (no face / fingerprint / PIN)', async () => {
    // The single most important case. A tap-only authenticator satisfies WebAuthn but is not a LOCK, and
    // accepting it would turn the whole feature into a button that says "unlocked".
    const res = await tryUnlock({ uv: false });
    expect(res.statusCode).toBe(401);
  });

  it('🔒 refuses an assertion collected by another ORIGIN — the anti-phishing check', async () => {
    const res = await tryUnlock({ origin: 'https://navbharatai.com.evil.example' });
    expect(res.statusCode).toBe(401);
  });

  it('🔒 refuses an assertion made for another SITE (wrong rpId)', async () => {
    const res = await tryUnlock({ rpId: 'evil.example' });
    expect(res.statusCode).toBe(401);
  });

  it('🔒 refuses a REPLAYED challenge we never issued', async () => {
    const res = await tryUnlock({ challenge: 'made-up-challenge.999.abc' });
    expect(res.statusCode).toBe(401);
  });

  it('🔒 refuses an unknown credential id — an unregistered device cannot open the vault', async () => {
    const h = await handlers();
    const challenge = await freshChallenge();
    const ad = authData();
    const cd = clientData('webauthn.get', challenge);
    const res = mockRes();
    await h.unlock(mockReq({
      params: { userId: UID },
      body: { mode: 'device', credentialId: 'some-other-device', clientDataJSON: b64url(cd), authenticatorData: b64url(ad), signature: b64url(sign(keys.privateKey, ad, cd)) },
    }), res);
    expect(res.statusCode).toBe(401);
  });

  it('every refusal uses the SAME message, so the endpoint cannot be probed', async () => {
    const messages = new Set<string>();
    for (const res of [await tryUnlock({ uv: false }), await tryUnlock({ origin: 'https://evil.example' }), await tryUnlock({ challenge: 'nope.1.2' })]) {
      messages.add(String((res.body as { error?: string })?.error ?? ''));
    }
    expect(messages.size).toBe(1);
  });

  it('records a refused attempt, so repeated failures are visible later', async () => {
    await tryUnlock({ uv: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(ADDED.some((a) => a.action === 'unlock-refused')).toBe(true);
  });
});

describe('the signature counter advances, so a cloned device is caught', () => {
  it('accepts a rising counter and then refuses a replay of the older one', async () => {
    await registerDevice();
    expect((await tryUnlock({ counter: 5 })).statusCode).toBe(200);
    expect(CREDS[`${UID}__${CRED_ID}`].sign_counter).toBe(5);
    // The same assertion arriving again (counter 5) is exactly what a clone would send.
    expect((await tryUnlock({ counter: 5 })).statusCode).toBe(401);
    expect((await tryUnlock({ counter: 6 })).statusCode).toBe(200);
  });

  it('still works for a phone that always reports zero', async () => {
    // Most platform authenticators never count. Refusing them would lock out the devices this is FOR.
    await registerDevice();
    expect((await tryUnlock({ counter: 0 })).statusCode).toBe(200);
    expect((await tryUnlock({ counter: 0 })).statusCode).toBe(200);
  });
});

describe('registration itself is guarded', () => {
  it('🔒 refuses to register a device whose lock did not verify the person', async () => {
    // Otherwise the vault would accept a credential that can never prove anything, and the user would
    // discover it only when every later unlock failed.
    const h = await handlers();
    const challenge = await freshChallenge();
    const ad = authData({ uv: false, attested: true });
    const cd = clientData('webauthn.create', challenge);
    const res = mockRes();
    await h.register(mockReq({
      params: { userId: UID },
      body: { credentialId: CRED_ID, publicKeySpki: spkiB64url, alg: -7, clientDataJSON: b64url(cd), authenticatorData: b64url(ad) },
    }), res);
    expect(res.statusCode).toBe(400);
    expect(CREDS[`${UID}__${CRED_ID}`]).toBeUndefined();
  });

  it('refuses an algorithm the server cannot verify, instead of storing a key it will always reject', async () => {
    const h = await handlers();
    const challenge = await freshChallenge();
    const ad = authData({ attested: true });
    const cd = clientData('webauthn.create', challenge);
    const res = mockRes();
    await h.register(mockReq({
      params: { userId: UID },
      body: { credentialId: CRED_ID, publicKeySpki: spkiB64url, alg: -8 /* EdDSA */, clientDataJSON: b64url(cd), authenticatorData: b64url(ad) },
    }), res);
    expect(res.statusCode).toBe(400);
    expect(CREDS[`${UID}__${CRED_ID}`]).toBeUndefined();
  });

  it('re-registering the SAME device replaces its row rather than piling up duplicates', async () => {
    await registerDevice();
    await registerDevice();
    expect(Object.keys(CREDS)).toHaveLength(1);
  });
});

describe('the account fallback', () => {
  it('opens the vault and says which proof was given', async () => {
    const h = await handlers();
    const res = mockRes();
    await h.unlock(mockReq({ params: { userId: UID }, body: { mode: 'account' } }), res);
    expect(res.statusCode).toBe(200);
    expect((res.body as { method: string }).method).toBe('account-reauth');
  });

  it('its ticket is accepted by the reveal route too — one gate, two doors', async () => {
    const h = await handlers();
    const unlocked = mockRes();
    await h.unlock(mockReq({ params: { userId: UID }, body: { mode: 'account' } }), unlocked);
    const revealed = mockRes();
    await h.reveal(mockReq({ params: { userId: UID }, headers: { 'x-vault-unlock': (unlocked.body as { ticket: string }).ticket } }), revealed);
    expect(revealed.statusCode).toBe(200);
  });
});
