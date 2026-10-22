import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * THE FREE PROGRAM PAUSE (admin 2026-10-22): "navbharatai pro ka free token system band karna hoga — paise nahi
 * hai. Free Chat chalne do. Purane token hide kar do, 'free trial ended' likh kar aaye wallet me."
 *
 * Every door through which NavBharatAI gives something away asks the ONE switch (lib/freeProgram.ts). This suite
 * proves the switch's safe defaults, the wallet mask, and — behaviourally — the doors that spend money, plus a
 * census that fails if a door loses the check.
 */

const wallet = { current: null as Record<string, unknown> | null };
vi.mock('../src/server/AgentV3/WalletBalance', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/AgentV3/WalletBalance')>()),
  firestoreWalletReader: () => async () => wallet.current,
  readWalletBalanceInr: async () => 100,
}));
vi.mock('../src/server/lib/serverDb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/lib/serverDb')>()),
  getServerDb: () => ({}),
}));
vi.mock('../src/server/professionals/ProfessionalPassStore', () => ({
  professionalPassStore: { getStatus: async () => ({ active: false, expiresAt: null, plan: null }) },
}));
vi.mock('../src/server/professionals/ProfessionalUsageStore', () => ({
  professionalUsageStore: { getTodayCount: async () => 0, increment: async () => 1 },
  professionalExamUsageStore: { getTodayCount: async () => 0, increment: async () => 1 },
  istDayKey: () => '2026-10-22',
}));

const fp = await import('../src/server/lib/freeProgram');
const { gateProfessionalTurn, gateProfessionalExam } = await import('../src/server/professionals/passGate');
const { gateToolAction } = await import('../src/server/tools/toolGate');
const { reserveImage } = await import('../src/server/lib/imageHold');

const NEVER_PAID = { userId: 'u1', tokenBalance: 50000, remaining_balance: 500, total_balance: 500, freeGiftedTokens: 50000, giftTokensRemaining: 50000, totalMoneySpent: 0, walletLedger: [{ id: 'gift-1' }] };
const PAID = { ...NEVER_PAID, totalMoneySpent: 200 };
const savedEnv = { ...process.env };
let paused = true;

beforeEach(() => {
  paused = true;
  wallet.current = NEVER_PAID;
  vi.spyOn(fp.freeProgramStore, 'read').mockImplementation(async () => ({ paused, updatedAt: null }));
  process.env.AI_WALLET_SPEND = 'on';
  process.env.PROFESSIONAL_FREE_QUOTA = 'on';
  process.env.PROFESSIONAL_PAID_ENABLED = 'true';
});
afterEach(() => { vi.restoreAllMocks(); process.env = { ...savedEnv }; });

describe('the switch fails SAFE: absent, unreadable or unknown all mean PAUSED', () => {
  it('only a stored paused:false is live', () => {
    expect(fp.freeProgramState(undefined).paused).toBe(true);
    expect(fp.freeProgramState({}).paused).toBe(true);
    expect(fp.freeProgramState({ paused: 'no' }).paused).toBe(true);
    expect(fp.freeProgramState({ paused: false }).paused).toBe(false);
  });
  it('a store with no value yet answers paused; an unreadable backend answers paused and flags it', async () => {
    const store = new fp.FreeProgramStore(() => ({ read: async () => { throw new Error('down'); }, write: async () => undefined }), Date.now, () => true);
    expect(store.pausedNow()).toBe(true);
    const r = await store.read();
    expect(r.paused).toBe(true);
    expect(r.unavailable).toBe(true);
  });
  it('a missing document reads as paused; a saved resume reads as live and is remembered', async () => {
    let doc: unknown = undefined;
    const store = new fp.FreeProgramStore(() => ({ read: async () => doc, write: async (n) => { doc = n; } }), Date.now, () => true);
    expect((await store.read()).paused).toBe(true);
    await store.setPaused(false);
    expect(store.pausedNow()).toBe(false);
    expect((await store.read()).paused).toBe(false);
  });
  it('a failed save throws — never a fake success', async () => {
    const store = new fp.FreeProgramStore(() => ({ read: async () => ({}), write: async () => { throw new Error('nope'); } }), Date.now, () => true);
    await expect(store.setPaused(false)).rejects.toThrow();
  });
});

describe('the wallet mask: gifted tokens are hidden, never deleted', () => {
  it('a never-paid wallet reads 0, with no reward history and "free trial ended" — and the input is untouched', () => {
    const before = JSON.stringify(NEVER_PAID);
    const v = fp.maskWalletForView({ ...NEVER_PAID }, true) as Record<string, unknown>;
    expect(v.tokenBalance).toBe(0);
    expect(v.remaining_balance).toBe(0);
    expect(v.freeGiftedTokens).toBe(0);
    expect(v.walletLedger).toEqual([]);
    expect(v.freeTrialEnded).toBe(true);
    expect(JSON.stringify(NEVER_PAID)).toBe(before);
  });
  it('a wallet that has ever paid is shown its OWN money only — see payAndUseOnlyWhilePaused.test.ts', () => {
    const v = fp.maskWalletForView({ ...PAID }, true) as Record<string, unknown>;
    expect(v.freeTrialEnded).toBeUndefined();
    expect(v.giftTokensRemaining).toBe(0);
  });
  it('when the program is live nothing is masked', () => {
    expect(fp.maskWalletForView({ ...NEVER_PAID }, false)).toEqual(NEVER_PAID);
  });
  it('both spellings of lifetime money count as "paid"', () => {
    expect((fp.maskWalletForView({ ...NEVER_PAID, totalMoneySpent: undefined, total_money_spent: 99 }, true) as { freeTrialEnded?: boolean }).freeTrialEnded).toBeUndefined();
  });
});

describe('the doors: a never-paid account gets nothing free while paused; a paying one is untouched', () => {
  it('Professionals and Doctor AI: refused with the free-trial-ended answer', async () => {
    const g = await gateProfessionalTurn('u1', null, 'professionals');
    expect(g.allow).toBe(false);
    if (!g.allow) { expect(g.status).toBe(402); expect(g.body.code).toBe(fp.FREE_TRIAL_ENDED_CODE); expect(g.body.error).toBe(fp.FREE_TRIAL_ENDED_MESSAGE); }
    const e = await gateProfessionalExam('u1', null, 5);
    expect(e.allow).toBe(false);
  });
  it('Professionals: a paying account is allowed as before; so is a never-paid one when the program is live', async () => {
    wallet.current = PAID;
    expect((await gateProfessionalTurn('u1', null, 'professionals')).allow).toBe(true);
    wallet.current = NEVER_PAID; paused = false;
    expect((await gateProfessionalTurn('u1', null, 'professionals')).allow).toBe(true);
  });
  it('tools and images: refused for a never-paid account, with the same answer', async () => {
    for (const bucket of ['ai_tool', 'image'] as const) {
      const g = await gateToolAction('u1', null, bucket, 'image-generation');
      expect(g.allow, bucket).toBe(false);
      if (!g.allow) { expect(g.status).toBe(402); expect(g.body.code).toBe(fp.FREE_TRIAL_ENDED_CODE); }
    }
  });
  it('tools and images: a paying account passes the pause', async () => {
    wallet.current = PAID;
    const g = await gateToolAction('u1', null, 'image', 'image-generation');
    expect(!g.allow && g.body.code === fp.FREE_TRIAL_ENDED_CODE).toBe(false);
  });
  it('a picture: refused BEFORE a slot is taken or a price held', async () => {
    const calls: string[] = [];
    const deps = {
      increment: async () => { calls.push('increment'); return 1; }, decrement: async () => undefined,
      hold: async () => { calls.push('hold'); return { ok: false, error: 'x' } as never; },
      release: async () => ({ ok: true, released: false }) as never, settle: async () => undefined,
      now: () => Date.now(), newId: () => 'id', everPaid: async () => false,
    };
    process.env.AI_IMAGE_PRICING = 'on';
    const r = await reserveImage({ uid: 'u1', freeListed: false, priceShown: true }, deps as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('free_trial_ended');
    expect(calls).toEqual([]);
    const paid = await reserveImage({ uid: 'u1', freeListed: false, priceShown: true }, { ...deps, everPaid: async () => true } as never);
    expect(paid.ok).toBe(true);
  });
});

describe('census: every door asks the switch', () => {
  const read = (p: string) => readFileSync(p, 'utf8');
  it('the Pro build route refuses a never-paid account before the engine check', () => {
    const src = read('src/server/routes/agentv3.ts');
    const at = src.indexOf('AGENTV3_FREE_PROGRAM_PAUSED_REFUSAL');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(src.indexOf('if (!tierEngineAvailable(powerLevelReqEffective))'));
    expect(src.slice(at - 600, at + 400)).toMatch(/freeProgramPaused\(\)[\s\S]*hasEverPaid/);
  });
  it('the referral ladder is live only while the program is not paused', () => {
    const src = read('src/server/routes/referral.ts');
    expect(src).toContain('referralRewardsEnabled() && !freeProgramPausedNow()');
    expect(src).not.toMatch(/[^!]referralRewardsEnabled\(\)\s*\)/); // no call site bypasses rewardsLive
  });
  it('coupons and admin promo codes are refused while paused — after the purchased-gift-code branch', () => {
    const src = read('src/server/routes/payment.ts');
    const gate = src.indexOf('FREE PROGRAM PAUSED');
    expect(gate).toBeGreaterThan(src.indexOf('if (looksLikeGiftCode(code))'));
    expect(gate).toBeLessThan(src.indexOf('const value = couponValueInr(code)'));
  });
  it('the wallet routes mask the balance, the statement and the transactions', () => {
    const src = read('src/server/routes/wallet.ts');
    expect((src.match(/maskWalletForView\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
  it('the browser hears about it through the public flags, defaulting to PAUSED', async () => {
    const { parsePublicFlags, PUBLIC_FLAGS_OFF } = await import('../src/lib/publicFlags');
    expect(PUBLIC_FLAGS_OFF.freeProgramPaused).toBe(true);
    expect(parsePublicFlags(null).freeProgramPaused).toBe(true);
    expect(parsePublicFlags({ freeProgramPaused: false }).freeProgramPaused).toBe(false);
  });
});

describe('APPS INSTALLED BEFORE THE PAUSE (admin 2026-10-22: "bina install kiye old app me bhi free trial band ho jaye")', () => {
  // The phone apps are bundled: an old install cannot be given new screens, only new ANSWERS. So the pause is
  // enforced and spoken by the server in the shapes those old bundles already read.
  it('the masked wallet keeps every key an old wallet screen reads, as numbers, so nothing renders as NaN or blank', () => {
    const v = fp.maskWalletForView({ ...NEVER_PAID }, true) as Record<string, unknown>;
    for (const k of ['tokenBalance', 'remaining_balance', 'total_balance', 'totalMoneySpent', 'userId']) expect(k in v, k).toBe(true);
    expect(typeof v.tokenBalance).toBe('number');
    expect(Array.isArray(v.walletLedger)).toBe(true);
  });
  it('the refusal carries a plain `error` sentence, which is all an old build screen prints', async () => {
    const g = await gateToolAction('u1', null, 'ai_tool', 'image-generation');
    expect(!g.allow && typeof g.body.error === 'string' && g.body.error.length > 10).toBe(true);
  });
  it('the notification row has exactly the fields an old notifications panel draws, is read, and names no money or program', () => {
    const n = fp.freeTrialEndedNotification(1_700_000_000_000);
    expect(Object.keys(n).sort()).toEqual(['action', 'createdAt', 'id', 'message', 'read']);
    expect(n.read).toBe(true);
    expect(n.message).toBe(fp.FREE_TRIAL_ENDED_MESSAGE);
    expect(n.message).not.toMatch(/referral|reward|bonus|gift|paused|pause/i);
  });
  it('the notifications route adds the row only for a never-paid account while paused', () => {
    const src = readFileSync('src/server/routes/notifications.ts', 'utf8');
    expect(src).toMatch(/freeProgramPaused\(\)[\s\S]*hasEverPaid\(wallet\)[\s\S]*freeTrialEndedNotification/);
  });
  it('the referral status route still answers old apps with the disabled shape they already understand', () => {
    const src = readFileSync('src/server/routes/referral.ts', 'utf8');
    expect(src).toContain("return res.json({ ok: true, enabled: false, code: null, steps: [], earnedTokens: 0 });");
  });
});
