/**
 * The referral routes as they actually RUN.
 *
 * `referralRewards.test.ts` proves the arithmetic and `deviceIntegrity.test.ts` proves the gate.
 * Neither proves the WIRED path: that ₹100 of the right size lands in the right wallet, that the
 * step which blocks a second payment is really written, that a referrer with no verified friend is
 * really paid zero, and that a retry pays nothing. Money code must be provable, so this drives the
 * REAL handlers against a fake Firestore and asserts on what was WRITTEN.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

process.env.VITEST = 'true';

const DOCS: Record<string, any> = {};
const key = (col: string, id: string) => `${col}/${id}`;

/** What the device gate will say next. The routes call it; the tests decide its answer. */
let deviceAnswer: { verdict: string; deviceId: string | null; detail: string } =
  { verdict: 'verified', deviceId: 'a1b2c3d4e5f60718', detail: 'ok' };

vi.mock('../src/server/lib/serverDb', () => {
  const mkRef = (_db: any, col: string, id: string) => ({
    __col: col, __id: id, path: `${col}/${id}`,
    // `create()` is the uniqueness guarantee the code-minting path relies on: it must FAIL when the
    // document already exists, or two users could be handed the same code.
    create: async (data: any) => {
      const path = `${col}/${id}`;
      if (Object.prototype.hasOwnProperty.call(DOCS, path)) throw new Error('ALREADY_EXISTS');
      DOCS[path] = data;
    },
  });
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
    runTransaction: async (_db: any, fn: any) => fn({
      get: async (ref: any) => read(ref),
      set: (ref: any, data: any, opts?: any) => {
        DOCS[ref.path] = opts?.merge ? { ...(DOCS[ref.path] || {}), ...data } : data;
      },
      update: (ref: any, patch: any) => { DOCS[ref.path] = { ...(DOCS[ref.path] || {}), ...patch }; },
    }),
    collection: () => ({}), query: () => ({}), where: () => ({}), orderBy: () => ({}),
    limit: () => ({}), getDocs: async () => ({ docs: [] }), getServerDb: () => ({}),
  };
});

vi.mock('../src/server/lib/authMiddleware', () => ({
  requireUserMatch: () => (_req: any, _res: any, next: any) => next?.(),
  verifiedPhoneNumber: async () => null,
}));

vi.mock('../src/server/lib/deviceIntegrity', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, checkDeviceIntegrity: async () => deviceAnswer };
});

async function routes() {
  const { registerReferralRoutes } = await import('../src/server/routes/referral');
  return captureRoutes(registerReferralRoutes);
}
const GET_STATUS = async () => (await routes()).get('GET /api/referral/:userId')!;
const POST_REDEEM = async () => (await routes()).get('POST /api/referral/:userId/redeem')!;
const POST_CLAIM = async () => (await routes()).get('POST /api/referral/:userId/claim')!;

const tokensOf = (uid: string) => Number(DOCS[key('user_token_wallets', uid)]?.tokenBalance || 0);
const rupeesOf = (uid: string) => Number(DOCS[key('user_token_wallets', uid)]?.remaining_balance || 0);
const stepsOf = (uid: string) => (DOCS[key('user_referrals', uid)]?.paidSteps || []) as string[];

async function status(uid: string) {
  const res = mockRes();
  await (await GET_STATUS())(mockReq({ params: { userId: uid } }), res);
  return res.body as any;
}
async function redeem(uid: string, code: string, deviceId = 'a1b2c3d4e5f60718') {
  deviceAnswer = { verdict: 'verified', deviceId, detail: 'ok' };
  const res = mockRes();
  await (await POST_REDEEM())(mockReq({ params: { userId: uid }, body: { code, deviceId, integrityToken: 't' } }), res);
  return res;
}
async function claim(uid: string, step: string, deviceId = 'a1b2c3d4e5f60718') {
  deviceAnswer = { verdict: 'verified', deviceId, detail: 'ok' };
  const res = mockRes();
  await (await POST_CLAIM())(mockReq({ params: { userId: uid }, body: { step, deviceId, integrityToken: 't' } }), res);
  return res;
}
/** B completes everything, in the order the admin's own list describes. */
async function completeAllSteps(uid: string, deviceId = 'a1b2c3d4e5f60718') {
  for (const s of ['referral-code', 'email', 'github', 'mobile']) await claim(uid, s, deviceId);
}

const ENV = { ...process.env };
beforeEach(() => {
  for (const k of Object.keys(DOCS)) delete DOCS[k];
  deviceAnswer = { verdict: 'verified', deviceId: 'a1b2c3d4e5f60718', detail: 'ok' };
  process.env.REFERRAL_REWARDS = 'on';
});
afterEach(() => { process.env = { ...ENV }; vi.resetModules(); });

describe('the master switch', () => {
  it('OFF is today’s behaviour: no code, no money, nothing written', async () => {
    delete process.env.REFERRAL_REWARDS;
    const s = await status('A');
    expect(s.enabled).toBe(false);
    expect(s.code).toBeNull();
    const r = await claim('A', 'email');
    expect(r.body.granted).toBe(0);
    expect(Object.keys(DOCS)).toHaveLength(0);
  });
});

describe('the referral code', () => {
  it('is minted by the SERVER, stored, and stable across reads', async () => {
    const first = await status('A');
    expect(first.code).toMatch(/^[A-Z2-9]{6}$/);
    const second = await status('A');
    expect(second.code).toBe(first.code);
    // Stored where a redemption can find it — a code nothing can resolve is the deleted fake feature.
    expect(DOCS[key('referral_codes', first.code)].userId).toBe('A');
  });

  it('never contains a character a reader could confuse', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 40; i++) {
      for (const k of Object.keys(DOCS)) delete DOCS[k];
      codes.add((await status(`u${i}`)).code);
    }
    for (const c of codes) expect(c, c).not.toMatch(/[01OIL]/);
  });

  it('never leaks who the owner is — the deleted version printed their mailbox', async () => {
    const s = await status('amit.sharma@gmail.com');
    expect(s.code.toLowerCase()).not.toContain('amit');
  });
});

describe('🔒 the device gate guards every paying route', () => {
  it('refuses a claim when the device is not verified, and writes nothing', async () => {
    deviceAnswer = { verdict: 'not-verified', deviceId: null, detail: 'emulator' };
    const res = mockRes();
    await (await POST_CLAIM())(mockReq({ params: { userId: 'B' }, body: { step: 'email' } }), res);
    expect(res.statusCode).toBe(403);
    expect(tokensOf('B')).toBe(0);
  });

  it('refuses a redemption the same way', async () => {
    await status('A');
    const code = (await status('A')).code;
    deviceAnswer = { verdict: 'unavailable', deviceId: null, detail: 'google down' };
    const res = mockRes();
    await (await POST_REDEEM())(mockReq({ params: { userId: 'B' }, body: { code } }), res);
    expect(res.statusCode).toBe(403);
    expect(DOCS[key('user_referrals', 'B')]?.referrerUserId).toBeUndefined();
  });

  it('an OUTAGE tells the user their account is fine — it is our fault, not theirs', async () => {
    deviceAnswer = { verdict: 'unavailable', deviceId: null, detail: 'google down' };
    const res = mockRes();
    await (await POST_CLAIM())(mockReq({ params: { userId: 'B' }, body: { step: 'email' } }), res);
    expect(res.body.message).toMatch(/account is fine/i);
  });
});

describe('the new user earns ₹400', () => {
  it('pays ₹100 a step and moves BOTH views of the wallet', async () => {
    await claim('B', 'email');
    expect(tokensOf('B')).toBe(10_000);
    // The ₹ view must move with the token view — walletMirror exists because two writers moved one.
    expect(rupeesOf('B')).toBe(100);
    expect(stepsOf('B')).toEqual(['email']);
  });

  it('🔒 A RETRY PAYS NOTHING — the payment and its record are one write', async () => {
    await claim('B', 'email');
    await claim('B', 'email');
    await claim('B', 'email');
    expect(tokensOf('B')).toBe(10_000);
    expect(stepsOf('B')).toEqual(['email']);
  });

  it('reaches exactly ₹400 across the four steps, in any order', async () => {
    await status('A');
    await redeem('B', (await status('A')).code);
    await completeAllSteps('B');
    expect(tokensOf('B')).toBe(40_000);
    expect(rupeesOf('B')).toBe(400);
  });

  it('refuses the referral-code step to somebody who never redeemed one', async () => {
    const r = await claim('B', 'email');
    expect(r.body.granted).toBe(10_000);
    const c = await claim('B', 'referral-code');
    expect(c.body.granted).toBe(0);
    expect(c.body.reason).toBe('not-referred');
    expect(tokensOf('B')).toBe(10_000);
  });

  it('records the credit as GIFT money, so it can never buy a hosting plan', async () => {
    await claim('B', 'email');
    const w = DOCS[key('user_token_wallets', 'B')];
    expect(w.giftTokensRemaining).toBe(10_000);
    expect(w.freeGiftedTokens).toBe(10_000);
    expect(w.walletLedger[0].moneySpent).toBe(0);
  });

  it('refuses a step that is not one of the four', async () => {
    const res = mockRes();
    await (await POST_CLAIM())(mockReq({ params: { userId: 'B' }, body: { step: 'free-money' } }), res);
    expect(res.statusCode).toBe(400);
    expect(tokensOf('B')).toBe(0);
  });
});

describe('🔒 the referrer — rules 2, 3 and 4 as they actually run', () => {
  /** A refers B, on two different handsets. */
  async function pairAB() {
    const code = (await status('A')).code;
    // A is seen on her own device, so the device-level self-referral check has something to compare.
    await claim('A', 'email', 'aaaaaaaaaaaaaaaa');
    await redeem('B', code, 'bbbbbbbbbbbbbbbb');
    return code;
  }

  it('RULE 2: redeeming the code alone pays the referrer NOTHING', async () => {
    await pairAB();
    expect(tokensOf('A')).toBe(10_000); // only her own email step
  });

  it('RULE 3: email + github without B’s mobile still pays A nothing', async () => {
    await pairAB();
    await claim('B', 'email', 'bbbbbbbbbbbbbbbb');
    await claim('B', 'github', 'bbbbbbbbbbbbbbbb');
    expect(tokensOf('A')).toBe(10_000);
    expect(DOCS[key('user_referrals', 'B')]?.referrerPaidSteps ?? []).toEqual([]);
  });

  it('RULE 3: B’s mobile releases the held rungs — A receives exactly ₹75', async () => {
    await pairAB();
    await claim('B', 'email', 'bbbbbbbbbbbbbbbb');
    await claim('B', 'github', 'bbbbbbbbbbbbbbbb');
    await claim('B', 'mobile', 'bbbbbbbbbbbbbbbb');
    expect(tokensOf('A')).toBe(10_000 + 7_500);
    expect(Number(DOCS[key('user_referrals', 'A')].earnedTokens)).toBe(7_500);
  });

  it('A repeated claim never pays the referrer twice', async () => {
    await pairAB();
    await completeAllSteps('B', 'bbbbbbbbbbbbbbbb');
    await completeAllSteps('B', 'bbbbbbbbbbbbbbbb');
    expect(Number(DOCS[key('user_referrals', 'A')].earnedTokens)).toBe(7_500);
  });

  it('the referrer’s ledger line never names the friend', async () => {
    await pairAB();
    await completeAllSteps('B', 'bbbbbbbbbbbbbbbb');
    const lines = DOCS[key('user_token_wallets', 'A')].walletLedger as Array<{ description: string }>;
    expect(lines.some((l) => /Referral reward/.test(l.description))).toBe(true);
    expect(lines.every((l) => !l.description.includes('B'))).toBe(true);
  });

  it('RULE 4: the ₹1,500 cap really stops the money', async () => {
    const code = (await status('A')).code;
    DOCS[key('user_referrals', 'A')] = { ...DOCS[key('user_referrals', 'A')], earnedTokens: 150_000 };
    await redeem('B', code, 'bbbbbbbbbbbbbbbb');
    await completeAllSteps('B', 'bbbbbbbbbbbbbbbb');
    expect(tokensOf('A')).toBe(0);
    expect(Number(DOCS[key('user_referrals', 'A')].earnedTokens)).toBe(150_000);
  });

  it('the status screen reports the cap honestly', async () => {
    await status('A');
    DOCS[key('user_referrals', 'A')].earnedTokens = 150_000;
    const s = await status('A');
    expect(s.earnedRupees).toBe(1500);
    expect(s.capRupees).toBe(1500);
    expect(s.capReached).toBe(true);
  });
});

describe('🔒 attribution — the chain machine, blocked where the money is', () => {
  it('refuses a MALFORMED code before it ever touches the store', async () => {
    // Wrong length, or a character the alphabet does not contain. Never mapped to a nearby valid
    // code: silently turning a typo into somebody else's code would credit the wrong person.
    for (const bad of ['', 'ABC', 'ABCDEFGH', 'ABC0EF', 'ABC1EF', 'ABCOEF']) {
      const res = await redeem('B', bad);
      expect(res.statusCode, bad).toBe(400);
    }
  });

  it('refuses a WELL-FORMED code that belongs to nobody', async () => {
    // Takes the attribution path rather than the malformed one — a different refusal for a
    // different reason, and the user is told plainly to check the spelling.
    const res = await redeem('B', 'ZZZZZZ');
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(/not recognised/i);
    expect(DOCS[key('user_referrals', 'B')]?.referrerUserId).toBeUndefined();
  });

  it('refuses SELF-REFERRAL ON THE SAME DEVICE — accounts are free, handsets are not', async () => {
    const code = (await status('A')).code;
    await claim('A', 'email', 'samedevice000000');
    // A's own second account, on A's own phone.
    const res = await redeem('A2', code, 'samedevice000000');
    expect(res.statusCode).toBe(409);
    expect(DOCS[key('user_referrals', 'A2')]?.referrerUserId).toBeUndefined();
  });

  it('refuses a DEVICE that has already been somebody’s referred friend', async () => {
    const code = (await status('A')).code;
    await redeem('B', code, 'onedevice0000000');
    const res = await redeem('C', code, 'onedevice0000000');
    expect(res.statusCode).toBe(409);
  });

  it('refuses a second code on an account that already has one', async () => {
    const codeA = (await status('A')).code;
    const codeX = (await status('X')).code;
    await redeem('B', codeA, 'bbbbbbbbbbbbbbbb');
    const res = await redeem('B', codeX, 'bbbbbbbbbbbbbbbb');
    expect(res.statusCode).toBe(409);
    expect(DOCS[key('user_referrals', 'B')].referrerUserId).toBe('A');
  });

  it('refuses an EXISTING user — "old ko never"', async () => {
    const code = (await status('A')).code;
    await claim('B', 'email', 'bbbbbbbbbbbbbbbb'); // B already earned before hearing about the code
    const res = await redeem('B', code, 'bbbbbbbbbbbbbbbb');
    expect(res.statusCode).toBe(409);
  });

  it('the refusal never tells a prober which marker caught them', async () => {
    const code = (await status('A')).code;
    await claim('A', 'email', 'samedevice000000');
    const self = await redeem('A2', code, 'samedevice000000');
    await redeem('B', code, 'otherdevice00000');
    const used = await redeem('C', code, 'otherdevice00000');
    expect(self.body.message).toBe(used.body.message);
  });
});

describe('the whole journey, end to end', () => {
  it('one referred friend costs ₹475 — B gets ₹400, A gets ₹75', async () => {
    const code = (await status('A')).code;
    await redeem('B', code, 'bbbbbbbbbbbbbbbb');
    await completeAllSteps('B', 'bbbbbbbbbbbbbbbb');
    expect(tokensOf('B')).toBe(40_000);
    expect(tokensOf('A')).toBe(7_500);
    expect((tokensOf('A') + tokensOf('B')) / 100).toBe(475);
  });

  it('an ORGANIC user with no code gets ₹300 — three steps, no code step', async () => {
    for (const s of ['email', 'github', 'mobile']) await claim('B', s);
    expect(tokensOf('B')).toBe(30_000);
  });
});
