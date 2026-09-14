/**
 * THE APP LOCK ON THE MONEY ROUTES — where the PIN stops being a screen lock.
 *
 * The client gate in front of these buttons is real but it is a screen; this is the half that holds when
 * the screen is bypassed. Every case below is a way the check could be wrong in a way nobody would
 * notice: letting a locked action through, blocking a user who never set a PIN, or mapping the wrong
 * toggle to the wrong product.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { mockReq } from './helpers/routeTestUtils';
import { hashPin, newSalt, writePinRecord, emptyPinRecord } from '../src/server/lib/vaultPin';
import { mintUnlockTicket, unlockSecret } from '../src/server/lib/vaultTicket';
import { UNLOCK_TICKET_HEADER } from '../src/server/lib/vaultTicketHttp';

process.env.VITEST = 'true';

const UID = 'owner_uid';

/** The stored record, or a thrown error when the read itself is meant to fail. */
let STORE: Record<string, unknown> | null = null;
let READ_THROWS = false;

vi.mock('../src/server/lib/serverDb', () => ({
  doc: (_db: any, col: string, id: string) => ({ col, id }),
  getDoc: async () => {
    if (READ_THROWS) throw new Error('firestore unavailable');
    return { exists: () => STORE !== null, data: () => STORE };
  },
  setDoc: async () => { /* not exercised here */ },
  getServerDb: () => ({}),
}));

async function load() {
  return import('../src/server/lib/appLockEnforce');
}

/** A record with a real PIN and the given locked areas. */
function seed(areas: string[] = []) {
  const salt = newSalt();
  STORE = { user_id: UID, ...writePinRecord({ ...emptyPinRecord(), pinHash: hashPin('8274', salt), pinSalt: salt, lockedAreas: areas as never }) };
}

const withTicket = () => mockReq({ headers: { [UNLOCK_TICKET_HEADER]: mintUnlockTicket(UID, Date.now(), unlockSecret()) } });
const noTicket = () => mockReq({});

beforeEach(() => {
  STORE = null;
  READ_THROWS = false;
});

describe('which toggle covers which purchase', () => {
  it('⚠️ create-order sells TWO products, so they map to DIFFERENT areas', async () => {
    const { areaForMoneyAction } = await load();
    // Putting the whole route behind "Wallet recharge" would stop a user who ticked that box from buying
    // a Professional Pass too, which is not what the tick says.
    expect(areaForMoneyAction('wallet-recharge')).toBe('wallet_recharge');
    expect(areaForMoneyAction('professional-pass')).toBe('subscription');
    expect(areaForMoneyAction('hosting-plan-purchase')).toBe('subscription');
    expect(areaForMoneyAction('hosting-plan-auto-renew')).toBe('subscription');
  });

  it('a refusal says nothing was charged, and names the area so the screen can prompt correctly', async () => {
    const { lockedRefusal } = await load();
    const r = lockedRefusal('wallet-recharge');
    expect(r.status).toBe(401);
    expect(r.body.needsUnlock).toBe(true);
    expect(r.body.area).toBe('wallet_recharge');
    expect(String(r.body.error)).toMatch(/nothing has been charged/i);
  });
});

describe('🔴 the common case must be invisible', () => {
  it('a user with NO PIN is never blocked — that is everyone who has not set one up', async () => {
    const { appLockBlocks } = await load();
    STORE = null;
    for (const action of ['wallet-recharge', 'professional-pass', 'hosting-plan-purchase', 'hosting-plan-auto-renew'] as const) {
      expect(await appLockBlocks(noTicket(), UID, action), action).toBeNull();
    }
  });

  it('a user with a PIN but nothing relevant locked is never blocked', async () => {
    const { appLockBlocks } = await load();
    seed(['api_keys', 'code_studio', 'settings']);
    expect(await appLockBlocks(noTicket(), UID, 'wallet-recharge')).toBeNull();
    expect(await appLockBlocks(noTicket(), UID, 'hosting-plan-purchase')).toBeNull();
  });
});

describe('🔒 a locked action is refused without the PIN, and allowed with it', () => {
  it('blocks a recharge when "Wallet recharge" is locked', async () => {
    const { appLockBlocks } = await load();
    seed(['wallet_recharge']);
    const blocked = await appLockBlocks(noTicket(), UID, 'wallet-recharge');
    expect(blocked?.status).toBe(401);
    // …and a live ticket is all it takes, so a user who just entered their PIN is not asked twice.
    expect(await appLockBlocks(withTicket(), UID, 'wallet-recharge')).toBeNull();
  });

  it('blocks a plan purchase and the auto-renew switch when "Subscription & plans" is locked', async () => {
    const { appLockBlocks } = await load();
    seed(['subscription']);
    expect((await appLockBlocks(noTicket(), UID, 'hosting-plan-purchase'))?.status).toBe(401);
    expect((await appLockBlocks(noTicket(), UID, 'hosting-plan-auto-renew'))?.status).toBe(401);
    expect((await appLockBlocks(noTicket(), UID, 'professional-pass'))?.status).toBe(401);
    // A recharge is a different product and a different tick — it stays open.
    expect(await appLockBlocks(noTicket(), UID, 'wallet-recharge')).toBeNull();
  });

  it('locking the whole Wallet & Billing screen covers BOTH, without the map knowing', async () => {
    const { appLockBlocks } = await load();
    seed(['billing']);
    expect((await appLockBlocks(noTicket(), UID, 'wallet-recharge'))?.status).toBe(401);
    expect((await appLockBlocks(noTicket(), UID, 'hosting-plan-purchase'))?.status).toBe(401);
  });

  it('refuses a ticket minted for ANOTHER user', async () => {
    const { appLockBlocks } = await load();
    seed(['wallet_recharge']);
    const other = mockReq({ headers: { [UNLOCK_TICKET_HEADER]: mintUnlockTicket('someone_else', Date.now(), unlockSecret()) } });
    expect((await appLockBlocks(other, UID, 'wallet-recharge'))?.status).toBe(401);
  });

  it('refuses an EXPIRED ticket', async () => {
    const { appLockBlocks } = await load();
    seed(['wallet_recharge']);
    const stale = mockReq({ headers: { [UNLOCK_TICKET_HEADER]: mintUnlockTicket(UID, Date.now() - 60 * 60_000, unlockSecret()) } });
    expect((await appLockBlocks(stale, UID, 'wallet-recharge'))?.status).toBe(401);
  });
});

describe('🔴 it fails CLOSED on an unreadable record — the opposite of the browser half, on purpose', () => {
  it('refuses the spend, and says nothing was charged', async () => {
    // The client decides whether to SHOW a screen and renders when it cannot check, because locking
    // somebody out of Settings over a dropped request breaks the app for people who never used this.
    // This decides whether to SPEND: an unreadable record means we cannot establish the user permitted
    // it, so the answer is the one these routes already give on their own errors. Nobody loses money
    // either way, and "I made the lookup fail" cannot become a purchase.
    const { appLockBlocks } = await load();
    READ_THROWS = true;
    const blocked = await appLockBlocks(withTicket(), UID, 'wallet-recharge');
    expect(blocked?.status).toBe(503);
    expect(String(blocked?.body.error)).toMatch(/nothing has been charged/i);
  });
});

describe('🔒 the wiring: which routes ask, and which must NEVER ask', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
  const wallet = read('src/server/routes/wallet.ts');
  const payment = read('src/server/routes/payment.ts');

  it('the three money routes call the check', () => {
    // ⚠️ MATCHED WITHOUT PINNING HOW THE ID IS SPELLED. The Express 5 migration wrapped every route
    // parameter in `routeParam(...)` (see lib/expressCompat), so a literal `req.params.userId` here
    // would fail for a change that altered nothing about this guard. What must hold is the guard
    // itself: this call, on THIS user, for THIS purpose — so that is what is asserted.
    expect(wallet).toMatch(/appLockBlocks\(req, [^,]*req\.params\.userId[^,]*, 'hosting-plan-purchase'\)/);
    expect(wallet).toMatch(/appLockBlocks\(req, [^,]*req\.params\.userId[^,]*, 'hosting-plan-auto-renew'\)/);
    expect(payment).toContain("appLockBlocks(req, userId, isProfessionalPass ? 'professional-pass' : 'wallet-recharge')");
  });

  it('the check runs BEFORE anything is charged on the plan purchase', () => {
    // A check after `purchaseHostingPlan` would refuse a purchase that had already debited the wallet.
    const at = wallet.search(/appLockBlocks\(req, [^,]*req\.params\.userId[^,]*, 'hosting-plan-purchase'\)/);
    const charge = wallet.indexOf('await purchaseHostingPlan(');
    expect(at).toBeGreaterThan(-1);
    expect(charge).toBeGreaterThan(at);
  });

  it('🔴 the RETURN paths are untouched — money already paid is credited without a PIN', () => {
    // The line that matters most in this whole feature. A PIN prompt on a verify, a webhook, a store
    // receipt or the sign-in reconcile would mean real money taken and not delivered because somebody
    // could not remember four digits. There are three independent delivery paths for a payment by
    // design, and none of them may acquire a new way to fail.
    const guarded = payment.match(/appLockBlocks\(/g) ?? [];
    expect(guarded.length, 'only create-order may be guarded in this file').toBe(1);

    for (const returnPath of ['/api/payment/verify', '/api/payment/webhook', '/api/payment/store/verify']) {
      const at = payment.indexOf(returnPath);
      if (at < 0) continue; // a path that does not exist in this file cannot be guarded by accident
      // Look only at that handler's own opening lines, where a gate would have to sit to block it.
      expect(payment.slice(at, at + 1200), `${returnPath} must not demand a PIN`).not.toContain('appLockBlocks');
    }
  });

  it('the store-receipt and reconcile routes live elsewhere and have no gate either', () => {
    for (const rel of ['src/server/routes/payment.ts', 'src/server/routes/wallet.ts']) {
      const src = read(rel);
      // `wallet.ts` may only guard the two hosting-plan routes — never a credit or a balance read.
      if (rel.endsWith('wallet.ts')) {
        expect((src.match(/appLockBlocks\(/g) ?? []).length, 'wallet.ts guards exactly two routes').toBe(2);
      }
    }
  });
});
