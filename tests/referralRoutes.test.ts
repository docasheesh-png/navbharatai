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
  // A real-enough `where`/`getDocs` so the Earning list's own query can be tested against the SAME
  // fake store the rest of this file writes into — filtering by field equality only, which is all
  // the referral routes ever ask for.
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
    collection: (_db: any, col: string) => ({ __col: col }),
    query: (ref: any, ...constraints: any[]) => ({ __col: ref.__col, constraints }),
    where: (field: string, op: string, value: any) => ({ __where: { field, op, value } }),
    orderBy: () => ({}),
    limit: (n: number) => ({ __limit: n }),
    getDocs: async (q: any) => {
      const col = q.__col;
      const constraints = q.constraints || [];
      const wheres = constraints.filter((c: any) => c.__where).map((c: any) => c.__where);
      const limitC = constraints.find((c: any) => typeof c.__limit === 'number');
      let entries = Object.entries(DOCS).filter(([path]) => path.startsWith(`${col}/`));
      entries = entries.filter(([, data]: any) => wheres.every((w: any) => (data || {})[w.field] === w.value));
      if (limitC) entries = entries.slice(0, limitC.__limit);
      return { docs: entries.map(([path, data]) => ({ id: path.slice(col.length + 1), data: () => data })) };
    },
    getServerDb: () => ({}),
  };
});

/**
 * What FIREBASE says about the account. The claim route asks this — never the request body — so
 * these values are what decide whether a step is genuinely done.
 */
let account = { email: 'u@example.com', emailVerified: true, phone: '+919876543210', providers: ['google.com', 'github.com'] };

/**
 * A per-UID override on top of the shared `account` above, for tests that need several DIFFERENT
 * friends' emails visible at once (the Earning list). Every existing test that mutates `account`
 * directly keeps working unchanged — a uid with no entry here just falls back to it.
 */
let accountsByUid: Record<string, typeof account> = {};

vi.mock('../src/server/lib/authMiddleware', () => ({
  requireUserMatch: () => (_req: any, _res: any, next: any) => next?.(),
  verifiedPhoneNumber: async () => null,
  resolveAccountContact: async (uid: string) => accountsByUid[uid] ?? account,
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
const GET_REFERRED = async () => (await routes()).get('GET /api/referral/:userId/referred')!;

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
async function referred(uid: string) {
  const res = mockRes();
  await (await GET_REFERRED())(mockReq({ params: { userId: uid } }), res);
  return res.body as any;
}

const ENV = { ...process.env };
beforeEach(() => {
  for (const k of Object.keys(DOCS)) delete DOCS[k];
  deviceAnswer = { verdict: 'verified', deviceId: 'a1b2c3d4e5f60718', detail: 'ok' };
  account = { email: 'u@example.com', emailVerified: true, phone: '+919876543210', providers: ['google.com', 'github.com'] };
  accountsByUid = {};
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

async function webClaim(uid: string) {
  // The web path branches BEFORE the device check, so no integrity token is needed; `step` must still
  // be a valid step to pass the shared validation, but the web reconciliation ignores which one.
  const res = mockRes();
  await (await POST_CLAIM())(mockReq({ params: { userId: uid }, body: { step: 'mobile', platform: 'web' } }), res);
  return res;
}

describe('the WEBSITE path — mobile + github, capped ₹200, held until a real mobile', () => {
  it('credits ₹200 and records BOTH steps when mobile is verified and github linked', async () => {
    account = { email: 'u@example.com', emailVerified: true, phone: '+919876543210', providers: ['google.com', 'github.com'] };
    const r = await webClaim('W');
    expect(r.body.granted).toBe(20_000); // ₹200
    expect(tokensOf('W')).toBe(20_000);
    expect(new Set(stepsOf('W'))).toEqual(new Set(['mobile', 'github']));
    expect(DOCS[key('user_referrals', 'W')].webGiftedTokens).toBe(20_000);
  });

  it('🔒 NO MOBILE VERIFY → ₹0, nothing written, even with github linked', async () => {
    account = { email: 'u@example.com', emailVerified: true, phone: '', providers: ['google.com', 'github.com'] };
    const r = await webClaim('W');
    expect(r.body.granted).toBe(0);
    expect(tokensOf('W')).toBe(0);
    expect(stepsOf('W')).toEqual([]);
  });

  it('mobile verified but github not linked pays ₹100 for the mobile alone', async () => {
    account = { email: 'u@example.com', emailVerified: true, phone: '+919876543210', providers: ['google.com'] };
    const r = await webClaim('W');
    expect(r.body.granted).toBe(10_000); // ₹100
    expect(stepsOf('W')).toEqual(['mobile']);
  });

  it('is idempotent — a second web claim after ₹200 pays nothing', async () => {
    account = { email: 'u@example.com', emailVerified: true, phone: '+919876543210', providers: ['google.com', 'github.com'] };
    await webClaim('W');
    const again = await webClaim('W');
    expect(again.body.granted).toBe(0);
    expect(tokensOf('W')).toBe(20_000); // still exactly ₹200
  });

  it('never grants the Android-only steps on the web — the web tops out at ₹200, never ₹300+', async () => {
    account = { email: 'u@example.com', emailVerified: true, phone: '+919876543210', providers: ['google.com', 'github.com'] };
    await webClaim('W');
    expect(stepsOf('W')).not.toContain('email');        // gmail-login is Android-only
    expect(stepsOf('W')).not.toContain('referral-code'); // the code is Android-only
    expect(tokensOf('W')).toBe(20_000);
  });

  it('🔗 a friend verifying on the WEB pays the REFERRER too — ₹25 each for mobile + github = ₹50', async () => {
    // A refers B (B redeems on Android — the website has no code-entry box). B then verifies on the web.
    const code = (await status('A')).code;
    await redeem('B', code, 'bbbbbbbbbbbbbbbb');
    account = { email: 'b@example.com', emailVerified: true, phone: '+919000000000', providers: ['google.com', 'github.com'] };
    await webClaim('B');
    expect(tokensOf('B')).toBe(20_000);                                        // B's own ₹200
    expect(Number(DOCS[key('user_referrals', 'A')]?.earnedTokens || 0)).toBe(5_000); // A's ₹50, mobile-anchored
  });
  it('📱 the website status shows ONLY the two web steps, with the ₹200 web cap', async () => {
    const res = mockRes();
    await (await GET_STATUS())(mockReq({ params: { userId: 'W' }, query: { platform: 'web' } }), res);
    const body = res.body as any;
    expect(body.platform).toBe('web');
    expect(body.steps.map((s: any) => s.step).sort()).toEqual(['github', 'mobile']);
    expect(body.webCapRupees).toBe(200);
    expect(body.canRedeem).toBe(false); // no code-entry on the website
  });

  it('📱 the app status shows all four steps to a new user, and offers the code box', async () => {
    const s = await status('N');
    expect(s.platform).toBe('android');
    expect(s.steps.map((x: any) => x.step)).toContain('referral-code');
    expect(s.canRedeem).toBe(true);
  });

  it('📱 "refer only for new user": once a real verification is earned with no code, the refer row disappears', async () => {
    await claim('O', 'mobile', 'cccccccccccccccc');
    const s = await status('O');
    expect(s.canRedeem).toBe(false);
    expect(s.steps.map((x: any) => x.step)).not.toContain('referral-code');
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
    // Now refused by the PROOF check before the transaction, with an actionable message rather than
    // a silent `granted: 0` — the earlier behaviour told the user nothing about what to do next.
    const r = await claim('B', 'email');
    expect(r.body.granted).toBe(10_000);
    const c = await claim('B', 'referral-code');
    expect(c.statusCode).toBe(409);
    expect(c.body.message).toMatch(/referral code first/i);
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

describe('🔴 A CLAIM IS A REQUEST, NOT A FACT — the ₹400 hole, closed', () => {
  /**
   * The first version of the claim route proved WHO was asking (the device) and WHETHER anything was
   * owed (the paid-steps list) — and never asked whether the step had been done at all. Any caller
   * on a genuine Android phone could POST all four steps having verified nothing and collect ₹400
   * per device. Each case below is that attack, one step at a time.
   */
  it('refuses the EMAIL step when Firebase says the mailbox is not verified', async () => {
    account = { ...account, emailVerified: false };
    const r = await claim('B', 'email');
    expect(r.statusCode).toBe(409);
    expect(r.body.message).toMatch(/verify your email/i);
    expect(tokensOf('B')).toBe(0);
  });

  it('refuses the EMAIL step when there is no mailbox at all', async () => {
    account = { ...account, email: '', emailVerified: true };
    expect((await claim('B', 'email')).statusCode).toBe(409);
    expect(tokensOf('B')).toBe(0);
  });

  it('refuses the MOBILE step when Firebase holds no verified number', async () => {
    account = { ...account, phone: '' };
    const r = await claim('B', 'mobile');
    expect(r.statusCode).toBe(409);
    expect(r.body.message).toMatch(/verify your mobile/i);
    expect(tokensOf('B')).toBe(0);
  });

  it('refuses the GITHUB step when github.com is not among the linked providers', async () => {
    account = { ...account, providers: ['google.com'] };
    const r = await claim('B', 'github');
    expect(r.statusCode).toBe(409);
    expect(r.body.message).toMatch(/connect your github/i);
    expect(tokensOf('B')).toBe(0);
  });

  it('refuses the REFERRAL-CODE step when no code was ever applied', async () => {
    const r = await claim('B', 'referral-code');
    expect(r.statusCode).toBe(409);
    expect(tokensOf('B')).toBe(0);
  });

  it('THE WHOLE ATTACK: a real device, nothing verified, claims all four — and gets ₹0', async () => {
    account = { email: '', emailVerified: false, phone: '', providers: [] };
    for (const step of ['referral-code', 'email', 'github', 'mobile']) await claim('B', step);
    expect(tokensOf('B')).toBe(0);
    expect(stepsOf('B')).toEqual([]);
  });

  it('an UNREADABLE account proves nothing — it never reads as "yes"', async () => {
    // resolveAccountContact returns an empty contact on every failure, by design.
    account = { email: null as any, emailVerified: false, phone: null as any, providers: [] };
    expect((await claim('B', 'email')).statusCode).toBe(409);
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

  it('refuses an EXISTING user — "old ko never": a real verification before the code disqualifies', async () => {
    const code = (await status('A')).code;
    await claim('B', 'mobile', 'bbbbbbbbbbbbbbbb'); // B already earned a real verification first
    const res = await redeem('B', code, 'bbbbbbbbbbbbbbbb');
    expect(res.statusCode).toBe(409);
  });

  it('🔴 the automatic Gmail-login grant does NOT make a user "old" — the code can still be applied after it', async () => {
    // Gmail-login (email) is claimed on sign-in, before anyone could type a code. Under the old
    // "no paid steps" rule this made EVERY Android user un-referrable; it must not.
    const code = (await status('A')).code;
    await claim('B', 'email', 'bbbbbbbbbbbbbbbb');
    const res = await redeem('B', code, 'bbbbbbbbbbbbbbbb');
    expect(res.statusCode).toBe(200);
    expect(DOCS[key('user_referrals', 'B')].referrerUserId).toBe('A');
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

describe('the Earning list — who used my code, and how far each has got', () => {
  it('OFF is today’s behaviour: an empty, honest list', async () => {
    delete process.env.REFERRAL_REWARDS;
    const r = await referred('A');
    expect(r.enabled).toBe(false);
    expect(r.friends).toEqual([]);
  });

  it('a referrer with nobody yet sees an empty list, not an error', async () => {
    await status('A');
    const r = await referred('A');
    expect(r.ok).toBe(true);
    expect(r.count).toBe(0);
    expect(r.friends).toEqual([]);
  });

  it('lists a friend who only redeemed the code, at 0 of 3', async () => {
    const code = (await status('A')).code;
    await redeem('B', code, 'bbbbbbbbbbbbbbbb');
    const r = await referred('A');
    expect(r.count).toBe(1);
    expect(r.friends[0]).toMatchObject({
      emailVerified: false, phoneVerified: false, githubLinked: false, completedCount: 0,
    });
  });

  it('reports each friend’s EMAIL and exactly how many of the three steps are done', async () => {
    const code = (await status('A')).code;
    accountsByUid['B'] = { email: 'friend.b@example.com', emailVerified: true, phone: '+911111111111', providers: ['google.com'] };
    await redeem('B', code, 'bbbbbbbbbbbbbbbb');
    await claim('B', 'email', 'bbbbbbbbbbbbbbbb');
    await claim('B', 'mobile', 'bbbbbbbbbbbbbbbb'); // github not done

    const r = await referred('A');
    expect(r.count).toBe(1);
    expect(r.friends[0]).toMatchObject({
      email: 'friend.b@example.com',
      emailVerified: true, phoneVerified: true, githubLinked: false, completedCount: 2,
    });
  });

  it('never lists somebody else’s friends — the query is scoped to MY code alone', async () => {
    const codeA = (await status('A')).code;
    const codeX = (await status('X')).code;
    await redeem('B', codeA, 'bbbbbbbbbbbbbbbb');
    await redeem('C', codeX, 'cccccccccccccccc');

    const a = await referred('A');
    expect(a.count).toBe(1);

    const x = await referred('X');
    expect(x.count).toBe(1);
  });

  it('lists MULTIPLE friends, each with their own email and their own progress', async () => {
    const code = (await status('A')).code;
    accountsByUid['B'] = { email: 'b@example.com', emailVerified: true, phone: '', providers: [] };
    accountsByUid['C'] = { email: 'c@example.com', emailVerified: true, phone: '+912222222222', providers: ['github.com'] };
    await redeem('B', code, 'bbbbbbbbbbbbbbbb');
    await redeem('C', code, 'cccccccccccccccc');
    await claim('B', 'email', 'bbbbbbbbbbbbbbbb');
    await claim('C', 'email', 'cccccccccccccccc');
    await claim('C', 'mobile', 'cccccccccccccccc');
    await claim('C', 'github', 'cccccccccccccccc');

    const r = await referred('A');
    expect(r.count).toBe(2);
    const byEmail = Object.fromEntries(r.friends.map((f: any) => [f.email, f]));
    expect(byEmail['b@example.com'].completedCount).toBe(1);
    expect(byEmail['c@example.com'].completedCount).toBe(3);
  });

  it('agrees exactly with the money — completedCount never disagrees with what the referrer was paid', async () => {
    const code = (await status('A')).code;
    await redeem('B', code, 'bbbbbbbbbbbbbbbb');
    await completeAllSteps('B', 'bbbbbbbbbbbbbbbb'); // referral-code + email + github + mobile

    const r = await referred('A');
    // referral-code does not count toward the 3 that pay the referrer.
    expect(r.friends[0].completedCount).toBe(3);
    expect(tokensOf('A')).toBe(7_500); // ₹75 — exactly 3 × ₹25, matching the list
  });

  it('is READ-ONLY — calling it moves no money and needs no device proof', async () => {
    const code = (await status('A')).code;
    await redeem('B', code, 'bbbbbbbbbbbbbbbb');
    deviceAnswer = { verdict: 'not-verified', deviceId: null, detail: 'emulator' };
    const r = await referred('A');
    expect(r.ok).toBe(true);
    expect(tokensOf('A')).toBe(0);
  });
});
