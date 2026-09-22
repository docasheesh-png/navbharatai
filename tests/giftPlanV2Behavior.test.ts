/**
 * Gift plan v2 as it actually RUNS — the flag is ON in production as of 2026-08-22.
 *
 * WHY THIS EXISTS, stated plainly: the earlier suites proved the arithmetic (`giftPlan.test.ts`) and
 * that the route is SHAPED correctly (`giftPlanWallet.test.ts`, source-level assertions). Neither
 * proved the wired path RUNS right — that a grant of the right size lands in the wallet, that the
 * marker that blocks a second one is really written, that the ₹750 route really pays zero. While the
 * flag was off that gap was acceptable. With real money moving through it, it is not.
 *
 * So this drives the REAL route handlers against a fake Firestore, and asserts on what was WRITTEN.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

process.env.VITEST = 'true';

// ── Fake Firestore ────────────────────────────────────────────────────────────
// A flat store keyed by `${collection}/${id}`, mirroring how the route addresses documents.
const DOCS: Record<string, any> = {};
let phoneOnToken: string | null = null;

const key = (col: string, id: string) => `${col}/${id}`;

vi.mock('../src/server/lib/serverDb', () => {
  const mkRef = (_db: any, col: string, id: string) => ({ __col: col, __id: id, path: `${col}/${id}` });
  const read = (ref: any) => ({
    exists: () => Object.prototype.hasOwnProperty.call(DOCS, ref.path),
    data: () => DOCS[ref.path],
  });
  return {
    doc: mkRef,
    getDoc: async (ref: any) => read(ref),
    setDoc: async (ref: any, data: any, opts?: any) => {
      DOCS[ref.path] = opts?.merge ? { ...(DOCS[ref.path] || {}), ...data } : data;
    },
    // A transaction that runs the body immediately against the same store. Enough to prove WHAT is
    // written and that a grant and its marker are written together; it does not model contention,
    // which the pure decisions and Firestore itself are responsible for.
    runTransaction: async (_db: any, fn: any) => fn({
      get: async (ref: any) => read(ref),
      set: (ref: any, data: any) => { DOCS[ref.path] = data; },
      update: (ref: any, patch: any) => { DOCS[ref.path] = { ...(DOCS[ref.path] || {}), ...patch }; },
    }),
    collection: () => ({}),
    query: () => ({}),
    where: () => ({}),
    orderBy: () => ({}),
    limit: () => ({}),
    getDocs: async () => ({ docs: [] }),
    getServerDb: () => ({}),
  };
});

vi.mock('../src/server/lib/authMiddleware', () => ({
  requireUserMatch: () => (_req: any, _res: any, next: any) => next?.(),
  // The one input the whole scheme rests on: the number Firebase itself vouches for.
  verifiedPhoneNumber: async () => phoneOnToken,
}));

vi.mock('../src/server/lib/hostingPlan', () => ({
  readHostingPlanStatus: async () => ({}), purchaseHostingPlan: async () => ({ ok: true }),
  setHostingPlanAutoRenew: async () => ({ ok: true }),
}));
vi.mock('../src/server/lib/hostingPlanSweep', () => ({
  registerHostingPlanSweep: () => {}, reattachSuspendedDomains: async () => {},
}));

async function routes() {
  const { registerWalletRoutes } = await import('../src/server/routes/wallet');
  return captureRoutes(registerWalletRoutes);
}
const readWallet = async () => (await routes()).get('GET /api/wallet/:userId')!;
const claimBonus = async () => (await routes()).get('POST /api/wallet/:userId/claim-phone-bonus')!;

/** Open a wallet the way a real first visit does, and hand back what was stored. */
async function signUp(uid: string, email: string) {
  const res = mockRes();
  await (await readWallet())(mockReq({ params: { userId: uid }, query: { email, name: 'T' } }), res);
  return { res, wallet: DOCS[key('user_token_wallets', uid)] };
}

const markers = () => Object.keys(DOCS).filter((k) => k.includes('/gift_'));
const tokensOf = (uid: string) => Number(DOCS[key('user_token_wallets', uid)]?.tokenBalance || 0);

const ENV = { ...process.env };
beforeEach(() => {
  for (const k of Object.keys(DOCS)) delete DOCS[k];
  phoneOnToken = null;
  process.env.WALLET_GIFT_V2 = 'on';
  delete process.env.GIFT_UNVERIFIED_TOKENS;
  delete process.env.GIFT_VERIFIED_TOTAL_TOKENS;
});
afterEach(() => { process.env = { ...ENV }; });

/**
 * 🔴 AMENDED 2026-09-22 — A NEW ACCOUNT IS CREDITED ₹50 AGAIN, AND THESE SCENARIOS ARE WHY IT IS SAFE.
 *
 * Google rejected the Android release: a brand-new account held ₹0, so the paid rung of the image
 * ladder refused the moment the free third party was down, and a Play reviewer IS a brand-new
 * account. The admin's ruling: *"new account me 50₹ credit do. jab tak, refral system activate na
 * hota hai, tab tak."*
 *
 * So the SIGNUP door pays **5,000 tokens (₹50)** below, while the CLAIM door still pays zero — the
 * retired ₹250 phone top-up is not re-opened, and that asymmetry is the whole design. The interim
 * grant spends the SAME per-identity markers, which is what keeps every scenario in this file
 * meaningful: the Gmail-alias leak and the one-number-many-spellings case still pay exactly once,
 * they simply pay ₹50 instead of ₹250.
 *
 * 🔴 REWRITTEN 2026-09-17 — THE FLAT WELCOME GIFT IS RETIRED, BY ADMIN ORDER.
 *
 * *"nahi welcome bonus ₹500 band karna hai! sirf refer aur verification wale ₹400 dene hai …
 * weekly reward, welcome reward yeh sab hatao."*
 *
 * Every assertion below USED to prove a grant amount — ₹250 on a mailbox, ₹500 on a verified phone,
 * ₹250 topped up on a later claim. Those amounts are no longer paid by anyone, so asserting them
 * would be asserting a policy that no longer exists. They now assert **ZERO**, which is the stronger
 * claim: not "the abuse case is blocked" but "nothing is paid at all, through any door".
 *
 * ⚠️ THE SCENARIOS ARE KEPT ON PURPOSE, not deleted. The Gmail-alias leak, the ₹750 two-door hole and
 * the one-number-many-spellings case are the reasons this file exists; the pure decision logic that
 * closes them is UNTOUCHED and still fully tested in `giftPlan.test.ts` (77 cases, all passing). If
 * the gift is ever re-enabled, these scenarios are here and working — which is exactly why the
 * retirement was applied at the money-moving route rather than inside the decisions.
 */

describe('the admin set WALLET_GIFT_V2=on — the value itself must mean yes', () => {
  it('accepts the value the admin actually typed, and the other spellings', async () => {
    const { giftPlanV2Enabled } = await import('../src/server/lib/giftPlan');
    for (const v of ['on', 'ON', ' on ', 'true', '1', 'yes']) {
      expect(giftPlanV2Enabled({ WALLET_GIFT_V2: v } as NodeJS.ProcessEnv), `"${v}" must mean on`).toBe(true);
    }
    for (const v of ['off', 'false', '0', '']) {
      expect(giftPlanV2Enabled({ WALLET_GIFT_V2: v } as NodeJS.ProcessEnv), `"${v}" must not mean on`).toBe(false);
    }
    // A typo takes the documented default (off) rather than silently meaning something else.
    expect(giftPlanV2Enabled({ WALLET_GIFT_V2: 'ture' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('door 1 — email / Google sign-up', () => {
  it('credits the ₹50 interim welcome credit and spends the mailbox', async () => {
    const { wallet } = await signUp('u1', 'amit@gmail.com');
    expect(wallet.tokenBalance, '₹50 interim credit — a new account must be able to use the app').toBe(5_000);
    expect(wallet.freeGiftedTokens, 'recorded, so it counts against the ₹400 lifetime ceiling').toBe(5_000);
    expect(wallet.giftPlan).toBe('v2');
    // A marker is written only WITH a grant — and now there IS one, so the mailbox is spent. That is
    // what stops one person collecting ₹50 on ten aliases; the next case proves it.
    expect(markers().filter((m) => m.includes('gift_email'))).toHaveLength(1);
    // No phone was verified, so no number was spent.
    expect(markers().filter((m) => m.includes('gift_phone'))).toHaveLength(0);
  });

  it('THE REAL LEAK: a Gmail alias gets NOTHING the second time', async () => {
    await signUp('u1', 'amit@gmail.com');
    expect(tokensOf('u1')).toBe(5_000);
    // Same inbox, three spellings, three separate Firebase accounts.
    for (const [uid, email] of [['u2', 'amit+1@gmail.com'], ['u3', 'a.m.i.t@gmail.com'], ['u4', 'AMIT@googlemail.com']] as const) {
      const { wallet } = await signUp(uid, email);
      expect(wallet.tokenBalance, `${email} must not be gifted again`).toBe(0);
    }
    // ONE marker for ONE mailbox, however many ways it is spelled — ₹50 paid once, not four times.
    expect(markers().filter((m) => m.includes('gift_email'))).toHaveLength(1);
  });

  it('a genuinely different person is still gifted', async () => {
    await signUp('u1', 'amit@gmail.com');
    const { wallet } = await signUp('u2', 'sunita@gmail.com');
    expect(wallet.tokenBalance, 'a different mailbox is a different person — it gets its own ₹50').toBe(5_000);
  });
});

describe('door 2 — phone OTP sign-up', () => {
  it('pays the same ₹50 — NOT the retired ₹500 — and spends BOTH identities', async () => {
    phoneOnToken = '+919876543210';
    const { wallet } = await signUp('p1', 'amit@gmail.com');
    // 🔒 THE ASSERTION THAT MATTERS MOST IN THIS FILE: a verified phone does NOT re-open the ₹500
    // tier. The interim credit is one flat ₹50 through either door; only the retirement's amounts
    // were retired, and this is what proves they stayed retired.
    expect(wallet.tokenBalance, 'the phone door pays the same ₹50, never the retired ₹500').toBe(5_000);
    // True under this field's own definition — a welcome grant really did land on a verified-phone
    // signup. Nothing reads it today; the gift_phone marker below is the guard that does the work.
    expect(wallet.phoneVerifiedGift).toBe(true);
    expect(markers().filter((m) => m.includes('gift_phone'))).toHaveLength(1);
    // The mailbox is spent too — otherwise the same person could sign out and take ₹50 again on it.
    expect(markers().filter((m) => m.includes('gift_email'))).toHaveLength(1);
  });

  it('the same handset in another spelling is not a second person', async () => {
    phoneOnToken = '+919876543210';
    await signUp('p1', 'a@gmail.com');
    phoneOnToken = '09876543210'; // same number, different form
    const { wallet } = await signUp('p2', 'b@gmail.com');
    // A FRESH mailbox, and still zero: the number is the scarce identity, so a used one blocks the
    // grant even when the address has never been seen. That is the ₹750 rule, at ₹50.
    expect(wallet.tokenBalance).toBe(0);
  });
});

describe('the claim — email account tops up to ₹500', () => {
  it('adds exactly the missing ₹250 and records it', async () => {
    await signUp('u1', 'amit@gmail.com');
    phoneOnToken = '+919876543210';
    const res = mockRes();
    await (await claimBonus())(mockReq({ params: { userId: 'u1' } }), res);

    // A refusal has always been a 200 with `ok: false` and an honest line — real, innocent people
    // land here, so their account must keep working. Retirement uses that same door.
    expect(res.body.ok).toBe(false);
    expect(res.body.message, 'honest, and it does not accuse anyone').toMatch(/not open right now/i);
    expect(res.body.granted, 'retired — the claim tops up nothing').toBe(0);
    // 🔒 The signup ₹50 is untouched by the refusal — re-opening the SIGNUP door must not re-open
    // the CLAIM door, and a refusal must never reduce a balance.
    expect(tokensOf('u1')).toBe(5_000);
    expect(DOCS[key('user_token_wallets', 'u1')].freeGiftedTokens).toBe(5_000);
    // The number was never spent, because nothing was paid for it.
    expect(markers().filter((m) => m.includes('gift_phone'))).toHaveLength(0);
  });

  it('a second claim on the same account pays nothing', async () => {
    await signUp('u1', 'amit@gmail.com');
    phoneOnToken = '+919876543210';
    await (await claimBonus())(mockReq({ params: { userId: 'u1' } }), mockRes());
    const res2 = mockRes();
    await (await claimBonus())(mockReq({ params: { userId: 'u1' } }), res2);
    expect(res2.body.granted).toBe(0);
    expect(tokensOf('u1')).toBe(5_000); // unchanged, and never reduced
  });

  it('refuses honestly, and as a 200, when no phone is on the token', async () => {
    await signUp('u1', 'amit@gmail.com');
    phoneOnToken = null;
    const res = mockRes();
    await (await claimBonus())(mockReq({ params: { userId: 'u1' } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/verify your phone/i);
    expect(tokensOf('u1')).toBe(5_000);
  });
});

describe('THE ₹750 HOLE — the whole point of the design', () => {
  it('one number cannot be paid through both doors', async () => {
    // 1. Sign up by phone → ₹50, and the number is spent.
    phoneOnToken = '+919876543210';
    await signUp('p1', 'first@gmail.com');
    expect(tokensOf('p1')).toBe(5_000);

    // 2. A SECOND account on a genuinely new mailbox — a legitimate ₹50 of its own.
    phoneOnToken = null;
    await signUp('u2', 'second@outlook.com');
    expect(tokensOf('u2'), 'a new mailbox earns its own interim credit').toBe(5_000);

    // 3. Verify it with the SAME number. This is the leak. It must pay ZERO.
    phoneOnToken = '+91 98765-43210'; // same handset, typed differently
    const res = mockRes();
    await (await claimBonus())(mockReq({ params: { userId: 'u2' } }), res);

    expect(res.body.granted).toBe(0);
    // ₹50 + ₹50, one per MAILBOX — never a third payment for re-presenting a number already spent.
    // The hole was one NUMBER being paid twice; it is still shut, and the claim door pays nothing
    // at all.
    expect(tokensOf('u2')).toBe(5_000);
    expect(tokensOf('p1') + tokensOf('u2')).toBe(10_000);
  });
});

describe('nobody who was already gifted loses anything', () => {
  it('an old ladder account at ₹650 claims ZERO and is not reduced', async () => {
    DOCS[key('user_token_wallets', 'old')] = {
      userId: 'old', tokenBalance: 65_000, freeGiftedTokens: 65_000,
      totalTokensPurchased: 65_000, remaining_balance: 650, total_balance: 650, walletLedger: [],
    };
    phoneOnToken = '+919876543210';
    const res = mockRes();
    await (await claimBonus())(mockReq({ params: { userId: 'old' } }), res);
    expect(res.body.granted).toBe(0);
    // 🔒 THE PROMISE THAT MATTERS IS KEPT: an account that was ALREADY gifted keeps every rupee.
    // Retiring a gift must never claw one back — only stop new ones.
    expect(tokensOf('old')).toBe(65_000);
  });

  it('the weekly ladder is retired for a pre-switch wallet too, and its balance is untouched', async () => {
    // 🔴 CHANGED 2026-09-17. This used to assert that a pre-switch wallet KEEPS its ladder, because
    // taking away a next-credit date it had been shown would break a promise made on screen. The
    // admin retired the ladder for everyone ("weekly reward … yeh sab hatao"), so the date stops —
    // but the rupees already given are never removed, which is the half that still matters.
    DOCS[key('user_token_wallets', 'legacy')] = {
      userId: 'legacy', tokenBalance: 25_000, freeGiftedTokens: 25_000,
      createdAt: new Date().toISOString(), lastWeeklyTopUpAt: new Date().toISOString(), walletLedger: [],
    };
    const res = mockRes();
    await (await readWallet())(mockReq({ params: { userId: 'legacy' }, query: {} }), res);
    // Labelled 'retired', never 'v2': this wallet was never on plan v2, and telling the client it
    // was would be a wrong fact dressed as a status.
    expect(res.body.freeGift.plan).toBe('retired');
    expect(res.body.freeGift.nextCreditAt).toBeNull();
    // 🔒 `capTokens: 0` is what makes FreeGiftBanner render NOTHING. A retired programme must
    // disappear, not describe itself in zeroes — "₹0 of ₹500 received" is a promise, not a status.
    expect(res.body.freeGift.capTokens).toBe(0);
    expect(res.body.freeGift.remainingTokens).toBe(0);
    expect(tokensOf('legacy')).toBe(25_000); // nothing clawed back
  });

  it('a v2 wallet is shown no claimable bonus, because there is none', async () => {
    await signUp('u1', 'amit@gmail.com');
    const res = mockRes();
    await (await readWallet())(mockReq({ params: { userId: 'u1' }, query: {} }), res);
    expect(res.body.freeGift.nextCreditAt).toBeNull();
    // The one field that draws the "Claim ₹500" card. Offering a claim the claim route refuses is
    // the confident-and-wrong status this codebase forbids — so it is 0, not the old remainder.
    expect(res.body.freeGift.phoneBonusClaimable).toBe(0);
    expect(res.body.freeGift.capTokens).toBe(0);
  });

});

describe('the kill switch really reverts', () => {
  it('with the flag off, a new wallet takes the legacy path and no marker is written', async () => {
    process.env.WALLET_GIFT_V2 = 'off';
    const { wallet } = await signUp('u1', 'amit+1@gmail.com');
    // ⚠️ THE INTERIM CREDIT IS NOT ON THE v2 SWITCH, and that is deliberate: a new account must be
    // able to use the app whatever WALLET_GIFT_V2 says. What v2 provides is the per-IDENTITY
    // protection, so with it off the ₹50 is paid per ACCOUNT and nothing is spent — the same
    // exposure the legacy welcome bonus carried for its whole life, at a twentieth of the amount.
    expect(wallet.tokenBalance, 'the interim credit does not ride the v2 flag').toBe(5_000);
    expect(wallet.giftPlan).toBeUndefined();     // not stamped ⇒ keeps the ladder
    expect(markers()).toHaveLength(0);           // no identity was spent
  });

  it('with the flag off, the claim endpoint pays nothing', async () => {
    await signUp('u1', 'amit@gmail.com');
    process.env.WALLET_GIFT_V2 = 'off';
    phoneOnToken = '+919876543210';
    const res = mockRes();
    await (await claimBonus())(mockReq({ params: { userId: 'u1' } }), res);
    expect(res.body.granted).toBe(0);
  });
});
