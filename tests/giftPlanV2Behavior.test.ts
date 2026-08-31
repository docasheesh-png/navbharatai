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
  it('credits ₹250 and spends the mailbox', async () => {
    const { wallet } = await signUp('u1', 'amit@gmail.com');
    expect(wallet.tokenBalance).toBe(25_000);
    expect(wallet.freeGiftedTokens).toBe(25_000);
    expect(wallet.giftPlan).toBe('v2');
    expect(markers().filter((m) => m.includes('gift_email'))).toHaveLength(1);
    // No phone was verified, so no number was spent.
    expect(markers().filter((m) => m.includes('gift_phone'))).toHaveLength(0);
  });

  it('THE REAL LEAK: a Gmail alias gets NOTHING the second time', async () => {
    await signUp('u1', 'amit@gmail.com');
    expect(tokensOf('u1')).toBe(25_000);
    // Same inbox, three spellings, three separate Firebase accounts.
    for (const [uid, email] of [['u2', 'amit+1@gmail.com'], ['u3', 'a.m.i.t@gmail.com'], ['u4', 'AMIT@googlemail.com']] as const) {
      const { wallet } = await signUp(uid, email);
      expect(wallet.tokenBalance, `${email} must not be gifted again`).toBe(0);
    }
    expect(markers().filter((m) => m.includes('gift_email'))).toHaveLength(1);
  });

  it('a genuinely different person is still gifted', async () => {
    await signUp('u1', 'amit@gmail.com');
    const { wallet } = await signUp('u2', 'sunita@gmail.com');
    expect(wallet.tokenBalance).toBe(25_000);
  });
});

describe('door 2 — phone OTP sign-up', () => {
  it('credits the full ₹500 at once and spends BOTH identities', async () => {
    phoneOnToken = '+919876543210';
    const { wallet } = await signUp('p1', 'amit@gmail.com');
    expect(wallet.tokenBalance).toBe(50_000);
    expect(wallet.phoneVerifiedGift).toBe(true);
    expect(markers().filter((m) => m.includes('gift_phone'))).toHaveLength(1);
    // The mailbox is spent too — otherwise the ₹250 tier could be taken again on it.
    expect(markers().filter((m) => m.includes('gift_email'))).toHaveLength(1);
  });

  it('the same handset in another spelling is not a second person', async () => {
    phoneOnToken = '+919876543210';
    await signUp('p1', 'a@gmail.com');
    phoneOnToken = '09876543210'; // same number, different form
    const { wallet } = await signUp('p2', 'b@gmail.com');
    expect(wallet.tokenBalance).toBe(0);
  });
});

describe('the claim — email account tops up to ₹500', () => {
  it('adds exactly the missing ₹250 and records it', async () => {
    await signUp('u1', 'amit@gmail.com');
    phoneOnToken = '+919876543210';
    const res = mockRes();
    await (await claimBonus())(mockReq({ params: { userId: 'u1' } }), res);

    expect(res.body.ok).toBe(true);
    expect(res.body.granted).toBe(25_000);
    expect(tokensOf('u1')).toBe(50_000);
    expect(DOCS[key('user_token_wallets', 'u1')].freeGiftedTokens).toBe(50_000);
    expect(markers().filter((m) => m.includes('gift_phone'))).toHaveLength(1);
  });

  it('a second claim on the same account pays nothing', async () => {
    await signUp('u1', 'amit@gmail.com');
    phoneOnToken = '+919876543210';
    await (await claimBonus())(mockReq({ params: { userId: 'u1' } }), mockRes());
    const res2 = mockRes();
    await (await claimBonus())(mockReq({ params: { userId: 'u1' } }), res2);
    expect(res2.body.granted).toBe(0);
    expect(tokensOf('u1')).toBe(50_000); // unchanged, and never reduced
  });

  it('refuses honestly, and as a 200, when no phone is on the token', async () => {
    await signUp('u1', 'amit@gmail.com');
    phoneOnToken = null;
    const res = mockRes();
    await (await claimBonus())(mockReq({ params: { userId: 'u1' } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/verify your phone/i);
    expect(tokensOf('u1')).toBe(25_000);
  });
});

describe('THE ₹750 HOLE — the whole point of the design', () => {
  it('one number cannot be paid through both doors', async () => {
    // 1. Sign up by phone → ₹500, the number is spent.
    phoneOnToken = '+919876543210';
    await signUp('p1', 'first@gmail.com');
    expect(tokensOf('p1')).toBe(50_000);

    // 2. A SECOND account on a genuinely new mailbox → ₹250 is legitimate.
    phoneOnToken = null;
    await signUp('u2', 'second@outlook.com');
    expect(tokensOf('u2')).toBe(25_000);

    // 3. Verify it with the SAME number. This is the leak. It must pay ZERO.
    phoneOnToken = '+91 98765-43210'; // same handset, typed differently
    const res = mockRes();
    await (await claimBonus())(mockReq({ params: { userId: 'u2' } }), res);

    expect(res.body.granted).toBe(0);
    expect(res.body.message).toMatch(/already claimed/i);
    expect(tokensOf('u2')).toBe(25_000);
    // ₹500 + ₹250, never ₹750.
    expect(tokensOf('p1') + tokensOf('u2')).toBe(75_000);
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
    expect(res.body.message).toMatch(/already received its full/i);
    expect(tokensOf('old')).toBe(65_000); // not reduced to the ₹500 total
  });

  it('a pre-switch wallet keeps its weekly ladder', async () => {
    // No `giftPlan` stamp ⇒ the ladder still applies and a next-credit date is still shown.
    DOCS[key('user_token_wallets', 'legacy')] = {
      userId: 'legacy', tokenBalance: 25_000, freeGiftedTokens: 25_000,
      createdAt: new Date().toISOString(), lastWeeklyTopUpAt: new Date().toISOString(), walletLedger: [],
    };
    const res = mockRes();
    await (await readWallet())(mockReq({ params: { userId: 'legacy' }, query: {} }), res);
    expect(res.body.freeGift.plan).toBeUndefined();
    expect(res.body.freeGift.nextCreditAt).toBeTruthy();
  });

  it('a v2 wallet is shown what it can CLAIM, never a date that will not arrive', async () => {
    await signUp('u1', 'amit@gmail.com');
    const res = mockRes();
    await (await readWallet())(mockReq({ params: { userId: 'u1' }, query: {} }), res);
    expect(res.body.freeGift.plan).toBe('v2');
    expect(res.body.freeGift.nextCreditAt).toBeNull();
    expect(res.body.freeGift.phoneBonusClaimable).toBe(25_000);
  });
});

describe('the kill switch really reverts', () => {
  it('with the flag off, a new wallet takes the legacy path and no marker is written', async () => {
    process.env.WALLET_GIFT_V2 = 'off';
    const { wallet } = await signUp('u1', 'amit+1@gmail.com');
    expect(wallet.tokenBalance).toBe(25_000);   // legacy welcome bonus
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
