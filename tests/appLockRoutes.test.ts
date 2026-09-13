/**
 * THE APP LOCK'S ENDPOINTS — status, send a code, set the PIN, unlock, and choose what is locked.
 *
 * `vaultPin.test.ts` proves the RULES. What it cannot see is whether these routes actually apply them,
 * and this lock has exactly one way to rot into theatre: a route that reads the record, compares the
 * PIN, and then forgets to WRITE the failed attempt back. The lock-out would disappear with nothing
 * failing — no error, no test, a green screen, and 10,000 guesses a second later somebody's Stripe key.
 *
 * So the cases below are about what reaches the STORE, not just what reaches the response.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import { hashPin, newSalt, writePinRecord, emptyPinRecord, MAX_PIN_ATTEMPTS, LOCKOUT_STEPS_MS, afterOtpSent, readPinRecord } from '../src/server/lib/vaultPin';
import { mintUnlockTicket, verifyUnlockTicket, unlockSecret } from '../src/server/lib/vaultTicket';
import { UNLOCK_TICKET_HEADER } from '../src/server/lib/vaultTicketHttp';
import { normaliseLockedAreas } from '../src/lib/appLockAreas';

process.env.VITEST = 'true';

const UID = 'owner_uid';
const PIN = '8274';

/** The one Firestore document this feature keeps, plus every write made to it. */
let STORE: Record<string, unknown> | null = null;
const WRITES: Array<Record<string, unknown>> = [];
const AUDIT: Array<Record<string, unknown>> = [];

vi.mock('../src/server/lib/serverDb', () => ({
  doc: (_db: any, col: string, id: string) => ({ col, id }),
  getDoc: async (ref: any) => ({
    exists: () => ref.col === 'user_vault_pin' && STORE !== null,
    data: () => STORE,
  }),
  setDoc: async (ref: any, data: any) => {
    if (ref.col !== 'user_vault_pin') return;
    WRITES.push(data);
    STORE = { ...(STORE ?? {}), ...data };
  },
  updateDoc: async () => { /* not exercised here */ },
  deleteDoc: async () => { /* not exercised here */ },
  collection: (_db: any, name: string) => ({ name }),
  addDoc: async (coll: any, data: any) => { AUDIT.push({ collection: coll?.name, ...data }); return { id: 'a' }; },
  getDocs: async () => ({ docs: [] }),
  query: (...a: any[]) => a,
  where: (...a: any[]) => a,
  getServerDb: () => ({}),
}));

/** The account's contact, which decides whether a code can be emailed at all. */
let CONTACT = { email: 'owner@example.com', emailVerified: true, phone: null as string | null };
vi.mock('../src/server/lib/authMiddleware', () => ({
  requireUserMatch: () => (_req: any, _res: any, next: any) => next(),
  trackDevice: () => (_req: any, _res: any, next: any) => next(),
  verifyFreshAuth: async () => ({ uid: UID, authTimeSec: Math.floor(Date.now() / 1000) }),
  resolveAccountContact: async () => CONTACT,
}));

/** The mailer. Captured rather than stubbed to true, so a test can read what was actually sent. */
let EMAIL_CONFIGURED = true;
let EMAIL_SENDS = 0;
let LAST_EMAIL: { to: string[]; message: string; subject?: string } | null = null;
vi.mock('../src/server/lib/alertEmail', () => ({
  resolveEmailConfig: () => ({ configured: EMAIL_CONFIGURED, reason: EMAIL_CONFIGURED ? '' : 'no key', apiKey: 'k', from: 'a@b.c', to: ['admin@x.y'], endpoint: 'https://e' }),
  sendAlertEmail: async (cfg: any, message: string, deps: any) => {
    EMAIL_SENDS += 1;
    LAST_EMAIL = { to: cfg.to, message, subject: deps?.subject };
    return { sent: true };
  },
}));

async function routes() {
  const { registerAppLockRoutes } = await import('../src/server/routes/appLock');
  return captureRoutes(registerAppLockRoutes as any);
}
const handler = async (key: string) => {
  const r = await routes();
  const h = r.get(key);
  if (!h) throw new Error(`route not registered: ${key} (have: ${[...r.keys()].join(', ')})`);
  return h;
};

/** Put a real PIN in the store, the way the set route would. */
function seedPin(pin = PIN, extra: Record<string, unknown> = {}) {
  const salt = newSalt();
  STORE = { user_id: UID, ...writePinRecord({ ...emptyPinRecord(), pinHash: hashPin(pin, salt), pinSalt: salt }), ...extra };
}

beforeEach(() => {
  STORE = null;
  WRITES.length = 0;
  AUDIT.length = 0;
  EMAIL_CONFIGURED = true;
  EMAIL_SENDS = 0;
  LAST_EMAIL = null;
  CONTACT = { email: 'owner@example.com', emailVerified: true, phone: null };
});

describe('GET /api/app-lock/:userId — what the screen is told, and what it is NOT told', () => {
  it('reports no PIN for a fresh account, and names the masked destination', async () => {
    const res = mockRes();
    await (await handler('GET /api/app-lock/:userId'))(mockReq({ params: { userId: UID } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ hasPin: false, locked: false, channel: 'email', attemptsLeft: MAX_PIN_ATTEMPTS });
    expect(res.body.destination).toBe('ow•••@example.com');
    // 🔒 Never the hash, never the salt, never a pending code. The status route is read by the browser.
    const json = JSON.stringify(res.body);
    for (const leak of ['pin_hash', 'pinHash', 'salt', 'otp_hash', 'otpHash']) {
      expect(json, leak).not.toContain(leak);
    }
  });

  it('is marked no-store, so a vault status is never written into a disk cache', async () => {
    const res = mockRes();
    await (await handler('GET /api/app-lock/:userId'))(mockReq({ params: { userId: UID } }), res);
    expect(String(res.headers['Cache-Control'] ?? res.headers['cache-control'])).toContain('no-store');
  });

  it('reports an existing PIN and a live lock-out', async () => {
    seedPin(PIN, { locked_until_ms: Date.now() + 120_000 });
    const res = mockRes();
    await (await handler('GET /api/app-lock/:userId'))(mockReq({ params: { userId: UID } }), res);
    expect(res.body.hasPin).toBe(true);
    expect(res.body.locked).toBe(true);
    expect(res.body.lockedForMs).toBeGreaterThan(100_000);
  });
});

describe('POST /otp — sending the code', () => {
  it('emails the ACCOUNT address, never the admin list, and never returns the code', async () => {
    const res = mockRes();
    await (await handler('POST /api/app-lock/:userId/otp'))(mockReq({ params: { userId: UID }, body: { purpose: 'create' } }), res);
    expect(res.statusCode).toBe(200);
    expect(EMAIL_SENDS).toBe(1);
    // The admin list is the mailer's DEFAULT recipient. Sending a user's vault code there would be a
    // disclosure to us and useless to them, so the route must override `to`.
    expect(LAST_EMAIL?.to).toEqual(['owner@example.com']);
    expect(LAST_EMAIL?.subject).toBe('NavBharatAI — your verification code');

    const code = LAST_EMAIL!.message.match(/\b(\d{6})\b/)?.[1];
    expect(code, 'the email must actually contain a code').toBeTruthy();
    // 🔴 The code may exist in the email and NOWHERE else the browser can see.
    expect(JSON.stringify(res.body)).not.toContain(code!);
    expect(JSON.stringify(STORE)).not.toContain(code!);
    expect(res.body).toMatchObject({ sent: true, channel: 'email', destination: 'ow•••@example.com' });
  });

  it('stores the hash BEFORE sending, so a delivered code always has something to check against', async () => {
    const res = mockRes();
    await (await handler('POST /api/app-lock/:userId/otp'))(mockReq({ params: { userId: UID }, body: {} }), res);
    expect(res.statusCode).toBe(200);
    expect(readPinRecord(STORE).otpHash).not.toBe('');
    expect(readPinRecord(STORE).otpExpiresAtMs).toBeGreaterThan(Date.now());
  });

  it('refuses a second code inside the cooldown', async () => {
    const h = await handler('POST /api/app-lock/:userId/otp');
    await h(mockReq({ params: { userId: UID }, body: {} }), mockRes());
    const res = mockRes();
    await h(mockReq({ params: { userId: UID }, body: {} }), res);
    expect(res.statusCode).toBe(429);
    expect(EMAIL_SENDS).toBe(1);
  });

  it('says so honestly when email is not configured — and sends nothing', async () => {
    EMAIL_CONFIGURED = false;
    const res = mockRes();
    await (await handler('POST /api/app-lock/:userId/otp'))(mockReq({ params: { userId: UID }, body: {} }), res);
    expect(res.statusCode).toBe(503);
    expect(EMAIL_SENDS).toBe(0);
    // No hash is stored either: a code nobody was sent must not become a code somebody could guess into.
    expect(STORE).toBeNull();
  });

  it('an account with only a mobile number is told the door that DOES work for it', async () => {
    CONTACT = { email: null, emailVerified: false, phone: '+919876543210' };
    const res = mockRes();
    await (await handler('POST /api/app-lock/:userId/otp'))(mockReq({ params: { userId: UID }, body: {} }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.channel).toBe('fresh-sign-in');
    expect(res.body.error).toMatch(/sign in again with your mobile number/i);
    expect(EMAIL_SENDS).toBe(0);
  });
});

describe('POST /pin — setting the PIN', () => {
  const setPin = () => handler('POST /api/app-lock/:userId/pin');

  it('refuses a weak PIN before anything else happens', async () => {
    const res = mockRes();
    await (await setPin())(mockReq({ params: { userId: UID }, body: { pin: '1234', otp: '000000' } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/too easy to guess/i);
    expect(STORE).toBeNull();
  });

  it('refuses without the right code, and COUNTS the wrong attempt', async () => {
    STORE = { user_id: UID, ...writePinRecord(afterOtpSent(emptyPinRecord(), '427391', 'create', Date.now())) };
    const res = mockRes();
    await (await setPin())(mockReq({ params: { userId: UID }, body: { pin: PIN, otp: '000000' } }), res);
    expect(res.statusCode).toBe(400);
    // 🔴 The attempt has to reach the store, or the five-try limit on the code does not exist.
    expect(readPinRecord(STORE).otpAttempts).toBe(1);
    expect(readPinRecord(STORE).pinHash).toBe('');
  });

  it('sets the PIN with the right code, burns the code, and hands back a real ticket', async () => {
    const h = await handler('POST /api/app-lock/:userId/otp');
    await h(mockReq({ params: { userId: UID }, body: { purpose: 'create' } }), mockRes());
    const code = LAST_EMAIL!.message.match(/\b(\d{6})\b/)![1];

    const res = mockRes();
    await (await setPin())(mockReq({ params: { userId: UID }, body: { pin: PIN, otp: code } }), res);
    expect(res.statusCode).toBe(200);
    expect(readPinRecord(STORE).pinHash).not.toBe('');
    expect(readPinRecord(STORE).otpHash, 'the code must be burnt').toBe('');
    // The ticket is the whole output: it must verify under the server's own secret, for THIS user.
    expect(verifyUnlockTicket(res.body.ticket, UID, Date.now(), unlockSecret())).toEqual({ method: 'pin' });
    expect(AUDIT.some((a) => a.action === 'pin-created')).toBe(true);
  });

  it('a reset CLEARS a lock-out — the owner just proved themselves more strongly than the PIN ever could', async () => {
    seedPin('1357', { locked_until_ms: Date.now() + 3600_000, lock_level: 3, fail_count: 2 });
    const h = await handler('POST /api/app-lock/:userId/otp');
    await h(mockReq({ params: { userId: UID }, body: { purpose: 'reset' } }), mockRes());
    const code = LAST_EMAIL!.message.match(/\b(\d{6})\b/)![1];

    const res = mockRes();
    await (await setPin())(mockReq({ params: { userId: UID }, body: { pin: PIN, otp: code } }), res);
    expect(res.statusCode).toBe(200);
    const after = readPinRecord(STORE);
    expect(after.lockedUntilMs).toBe(0);
    expect(after.lockLevel).toBe(0);
    expect(after.failCount).toBe(0);
    expect(AUDIT.some((a) => a.action === 'pin-reset')).toBe(true);
  });
});

describe('POST /unlock — the only place a PIN is ever compared', () => {
  const unlock = () => handler('POST /api/app-lock/:userId/unlock');

  it('opens the vault with the right PIN', async () => {
    seedPin();
    const res = mockRes();
    await (await unlock())(mockReq({ params: { userId: UID }, body: { pin: PIN } }), res);
    expect(res.statusCode).toBe(200);
    expect(verifyUnlockTicket(res.body.ticket, UID, Date.now(), unlockSecret())).toEqual({ method: 'pin' });
    expect(AUDIT.some((a) => a.action === 'unlock' && a.unlock_method === 'pin')).toBe(true);
  });

  it('🔴 PERSISTS every wrong attempt — the test that stops this lock becoming theatre', async () => {
    seedPin();
    const h = await unlock();
    for (let i = 1; i < MAX_PIN_ATTEMPTS; i++) {
      const res = mockRes();
      await h(mockReq({ params: { userId: UID }, body: { pin: '1357' } }), res);
      expect(res.statusCode, `attempt ${i}`).toBe(401);
      expect(readPinRecord(STORE).failCount, `attempt ${i} was not recorded`).toBe(i);
      expect(res.body.attemptsLeft).toBe(MAX_PIN_ATTEMPTS - i);
    }
    // The fifth one locks the vault, and the lock is in the STORE, not just in the reply.
    const res = mockRes();
    await h(mockReq({ params: { userId: UID }, body: { pin: '1357' } }), res);
    expect(res.statusCode).toBe(429);
    expect(readPinRecord(STORE).lockedUntilMs).toBeGreaterThan(Date.now());
    expect(res.body.lockedForMs).toBeGreaterThan(LOCKOUT_STEPS_MS[0] - 5_000);
  });

  it('refuses even the RIGHT PIN while locked out, and mints nothing', async () => {
    seedPin(PIN, { locked_until_ms: Date.now() + 600_000 });
    const res = mockRes();
    await (await unlock())(mockReq({ params: { userId: UID }, body: { pin: PIN } }), res);
    expect(res.statusCode).toBe(429);
    expect(res.body.ticket).toBeUndefined();
  });

  it('a correct PIN forgives the counter, so a forgetful owner is not punished for ever', async () => {
    seedPin(PIN, { fail_count: 3, lock_level: 2 });
    const res = mockRes();
    await (await unlock())(mockReq({ params: { userId: UID }, body: { pin: PIN } }), res);
    expect(res.statusCode).toBe(200);
    expect(readPinRecord(STORE).failCount).toBe(0);
    expect(readPinRecord(STORE).lockLevel).toBe(0);
  });

  it('tells the screen to set one up when there is no PIN yet, rather than failing as "wrong PIN"', async () => {
    const res = mockRes();
    await (await unlock())(mockReq({ params: { userId: UID }, body: { pin: PIN } }), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.needsSetup).toBe(true);
  });

  it('an empty or junk PIN is refused like any other wrong one — never accepted as "no PIN required"', async () => {
    seedPin();
    for (const bad of [undefined, '', '   ', 'abcd', '82740']) {
      STORE = { ...(STORE as object), fail_count: 0, locked_until_ms: 0 };
      const res = mockRes();
      await (await unlock())(mockReq({ params: { userId: UID }, body: { pin: bad } }), res);
      expect(res.statusCode, String(bad)).toBe(401);
    }
  });
});

describe('🔒 PUT /areas — the route that makes the App Lock more than a preference', () => {
  const areas = () => handler('PUT /api/app-lock/:userId/areas');
  const liveTicket = () => ({ [UNLOCK_TICKET_HEADER]: mintUnlockTicket(UID, Date.now(), unlockSecret()) });

  it('🔴 REFUSES WITHOUT THE PIN — this is the whole feature', async () => {
    // The attack it stops: somebody picks up an unlocked phone, opens Settings, and switches the lock
    // off. If this route accepted the request, every other test in this file would be decoration.
    seedPin();
    const res = mockRes();
    await (await areas())(mockReq({ params: { userId: UID }, body: { areas: ['api_keys'] } }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.needsUnlock).toBe(true);
    expect(readPinRecord(STORE).lockedAreas).toEqual(normaliseLockedAreas([]));
  });

  it('saves the chosen areas with a live ticket, in canonical order', async () => {
    seedPin();
    const res = mockRes();
    await (await areas())(mockReq({
      params: { userId: UID },
      headers: liveTicket(),
      body: { areas: ['settings', 'billing'] },
    }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.areas).toEqual(['api_keys', 'billing', 'settings']);
    expect(readPinRecord(STORE).lockedAreas).toEqual(['api_keys', 'billing', 'settings']);
    expect(AUDIT.some((a) => a.action === 'lock-areas-changed')).toBe(true);
  });

  it('🔒 CANNOT remove the API-keys lock, even asked directly', async () => {
    // "non removal ✅" is enforced here and in `normaliseLockedAreas`, not by a disabled checkbox — a
    // disabled input is a picture, and anyone can send the request the screen would have sent.
    seedPin();
    const res = mockRes();
    await (await areas())(mockReq({ params: { userId: UID }, headers: liveTicket(), body: { areas: [] } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.areas).toContain('api_keys');
    expect(readPinRecord(STORE).lockedAreas).toContain('api_keys');
  });

  it('drops an unknown area rather than storing it', async () => {
    // A stored id nothing checks would sit in the list looking like a lock that is on. A lock that lies
    // about itself is worse than no lock.
    seedPin();
    const res = mockRes();
    await (await areas())(mockReq({
      params: { userId: UID },
      headers: liveTicket(),
      body: { areas: ['billing', 'totally_made_up', 42, null] },
    }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.areas).toEqual(['api_keys', 'billing']);
  });

  it('reports what locking the whole Billing screen already covers', async () => {
    seedPin();
    const res = mockRes();
    await (await areas())(mockReq({ params: { userId: UID }, headers: liveTicket(), body: { areas: ['billing'] } }), res);
    expect(res.body.effectiveAreas).toEqual(expect.arrayContaining(['billing', 'subscription', 'wallet_recharge']));
    // And the list the SETTINGS screen renders is still only what the user actually ticked, so a tick
    // does not silently appear in a box they never touched.
    expect(res.body.areas).toEqual(['api_keys', 'billing']);
  });

  it('refuses before a PIN exists — locking screens with no PIN would strand the owner outside them', async () => {
    STORE = null;
    const res = mockRes();
    await (await areas())(mockReq({ params: { userId: UID }, headers: liveTicket(), body: { areas: ['settings'] } }), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.needsSetup).toBe(true);
  });

  it('refuses a ticket minted for ANOTHER user', async () => {
    seedPin();
    const res = mockRes();
    await (await areas())(mockReq({
      params: { userId: UID },
      headers: { [UNLOCK_TICKET_HEADER]: mintUnlockTicket('someone_else', Date.now(), unlockSecret()) },
      body: { areas: ['settings'] },
    }), res);
    expect(res.statusCode).toBe(401);
  });
});

describe('the status route reports the areas both ways', () => {
  it('sends what was ticked AND what is in force', async () => {
    seedPin('8274', { locked_areas: ['api_keys', 'billing'] });
    const res = mockRes();
    await (await handler('GET /api/app-lock/:userId'))(mockReq({ params: { userId: UID } }), res);
    expect(res.body.areas).toEqual(['api_keys', 'billing']);
    expect(res.body.effectiveAreas).toEqual(expect.arrayContaining(['subscription', 'wallet_recharge']));
  });

  it('a record with no area list reads as the DEFAULT, never as everything locked', async () => {
    seedPin();
    const res = mockRes();
    await (await handler('GET /api/app-lock/:userId'))(mockReq({ params: { userId: UID } }), res);
    expect(res.body.areas).toEqual(['api_keys']);
  });
});
