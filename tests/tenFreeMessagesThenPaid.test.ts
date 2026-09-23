import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * "10 free, then paid" — the professionals' daily allowance (admin 2026-09-23).
 *
 * Admin, verbatim: *"professional ai me din ke 10 message free honge, fir paid hoga. aapne sabke liye
 * sab free kar diya. teacher ai ka exam mode me only 5 questions per day free ho, baaki sab paid."*
 *
 * WHAT WAS WRONG, so the tests below read as the failure they lock out:
 *  1. The allowance rode on `PROFESSIONAL_PAID_ENABLED` — the switch for SELLING a Pass — which was
 *     never set, so nothing was ever counted. Every answer went to the paid chain from message one.
 *  2. The code default was 50, not 10.
 *  3. Nothing told the charge that a counted free message was free: switching the counter on alone
 *     would have billed the "free" messages too.
 *  4. The empty-wallet refusal ran BEFORE the allowance, so a new user with ₹0 was refused the free
 *     messages they had not used yet.
 *  5. Over the allowance was a BLOCK, not a charge — "then paid" did not exist.
 *  6. Exam mode spent a chat message per paper however many questions it held, and was CHARGED even
 *     when the paper came back unusable.
 */

const state = {
  passActive: false,
  used: 0,
  examUsed: 0,
  balance: 100 as number | null,
};

vi.mock('../src/server/professionals/ProfessionalPassStore', () => ({
  professionalPassStore: { getStatus: async () => ({ active: state.passActive, expiresAt: null, plan: null }) },
}));
vi.mock('../src/server/professionals/ProfessionalUsageStore', () => ({
  professionalUsageStore: { getTodayCount: async () => state.used, increment: async () => state.used + 1 },
  professionalExamUsageStore: { getTodayCount: async () => state.examUsed, increment: async () => state.examUsed + 1 },
  istDayKey: () => '2026-09-23',
}));
vi.mock('../src/server/AgentV3/WalletBalance', () => ({
  readWalletBalanceInr: async () => state.balance,
  firestoreWalletReader: () => ({}),
}));
vi.mock('../src/server/lib/serverDb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/lib/serverDb')>()),
  getServerDb: () => ({}),
}));

const { gateProfessionalTurn, gateProfessionalExam, examPaperCharge } = await import('../src/server/professionals/passGate');
const { decideProfessionalAccess, splitExamQuestions } = await import('../src/server/professionals/access');
const { decideAiCharge, decideAiChargeForTurns, billableFractionOf } = await import('../src/server/lib/aiTurnCharge');
const {
  professionalFreeQuotaEnabled, professionalFreeDailyLimit, professionalExamFreeDailyQuestions,
} = await import('../src/server/professionals/professionalPaid');

const UID = 'student-1';
const EMAIL = 'student@example.com';
const savedEnv = { ...process.env };

beforeEach(() => {
  state.passActive = false;
  state.used = 0;
  state.examUsed = 0;
  state.balance = 100;
  delete process.env.PROFESSIONAL_FREE_QUOTA;
  delete process.env.PROFESSIONAL_PAID_ENABLED;
  delete process.env.PROFESSIONAL_FREE_DAILY_LIMIT;
  delete process.env.PROFESSIONAL_EXAM_FREE_QUESTIONS;
  delete process.env.AGENTV3_FREE_LIST;
  process.env.AI_WALLET_SPEND = 'on';
});
afterEach(() => { process.env = { ...savedEnv }; });

describe('the allowance is ON by default and is the admin\'s numbers', () => {
  it('counts without the Pass switch, and `off` is the revert', () => {
    expect(professionalFreeQuotaEnabled()).toBe(true);
    process.env.PROFESSIONAL_FREE_QUOTA = 'off';
    expect(professionalFreeQuotaEnabled()).toBe(false);
    // The Pass switch still implies counting.
    process.env.PROFESSIONAL_PAID_ENABLED = 'true';
    expect(professionalFreeQuotaEnabled()).toBe(true);
  });

  it('10 messages and 5 exam questions a day', () => {
    expect(professionalFreeDailyLimit()).toBe(10);
    expect(professionalExamFreeDailyQuestions()).toBe(5);
  });
});

describe('messages: the first 10 are free, every one after is paid', () => {
  it('a free message is on the free chain and charged NOTHING', async () => {
    state.used = 3;
    const g = await gateProfessionalTurn(UID, EMAIL);
    expect(g.allow).toBe(true);
    if (!g.allow) return;
    expect(g.tier).toBe('free');
    expect(g.countsAgainstFree).toBe(true);
    expect(g.billableFraction).toBe(0);
    expect(g.remainingFree).toBe(6);
  });

  it('an EMPTY wallet does not take away the free messages', async () => {
    state.used = 0;
    state.balance = 0;
    const g = await gateProfessionalTurn(UID, EMAIL);
    expect(g.allow).toBe(true);
    if (g.allow) expect(g.tier).toBe('free');
  });

  it('the 11th answer is ALLOWED and charged its whole cost — not blocked', async () => {
    state.used = 10;
    const g = await gateProfessionalTurn(UID, EMAIL);
    expect(g.allow).toBe(true);
    if (!g.allow) return;
    expect(g.tier).toBe('paid');
    expect(g.countsAgainstFree).toBe(false);
    expect(g.billableFraction).toBe(1);
  });

  it('past the allowance with an empty wallet: refused, and the refusal says the free ones are used', async () => {
    state.used = 10;
    state.balance = 0;
    const g = await gateProfessionalTurn(UID, EMAIL);
    expect(g.allow).toBe(false);
    if (g.allow) return;
    expect(g.status).toBe(402);
    expect(g.body.code).toBe('wallet_empty');
    expect(g.body.freeUsedUp).toBe(true);
    expect(String(g.body.error)).toContain('10 free messages come back tomorrow');
  });

  it('an unreadable balance past the allowance fails OPEN, like every other wallet gate', async () => {
    state.used = 10;
    state.balance = null;
    const g = await gateProfessionalTurn(UID, EMAIL);
    expect(g.allow).toBe(true);
  });

  it('without wallet spending, "then paid" cannot be charged — so it is the honest block, not a free answer', async () => {
    delete process.env.AI_WALLET_SPEND;
    state.used = 10;
    const g = await gateProfessionalTurn(UID, EMAIL);
    expect(g.allow).toBe(false);
    if (!g.allow) expect(g.body.code).toBe('professional_paywall');
  });

  it('an anonymous caller is asked to sign in (an anonymous allowance cannot be counted)', async () => {
    const g = await gateProfessionalTurn(null, null);
    expect(g.allow).toBe(false);
    if (!g.allow) { expect(g.status).toBe(401); expect(g.body.code).toBe('login_required'); }
  });

  it('the free-list and a Pass holder are unlimited', async () => {
    state.used = 99;
    process.env.AGENTV3_FREE_LIST = UID;
    const a = await gateProfessionalTurn(UID, EMAIL);
    expect(a.allow && a.tier === 'paid').toBe(true);
    delete process.env.AGENTV3_FREE_LIST;
    state.passActive = true;
    const b = await gateProfessionalTurn(UID, EMAIL);
    expect(b.allow && b.hasActivePass).toBe(true);
  });

  it('PROFESSIONAL_FREE_QUOTA=off is the previous behaviour exactly', async () => {
    process.env.PROFESSIONAL_FREE_QUOTA = 'off';
    state.used = 0;
    const g = await gateProfessionalTurn(UID, EMAIL);
    expect(g.allow && g.tier === 'paid' && g.billableFraction === 1 && !g.countsAgainstFree).toBe(true);
    state.balance = 0;
    const r = await gateProfessionalTurn(UID, EMAIL);
    expect(r.allow).toBe(false);
  });
});

describe('the pure decision: `paid` is opt-in, so the AI tools keep their block', () => {
  const base = { enabled: true, signedIn: true, isFreeListed: false, hasActivePass: false, usedToday: 10, freeDailyLimit: 10 };
  it('default is still a block', () => {
    expect(decideProfessionalAccess(base)).toMatchObject({ action: 'block', reason: 'free-quota-exhausted' });
  });
  it('`paid` allows, counts nothing', () => {
    expect(decideProfessionalAccess({ ...base, overQuota: 'paid' })).toMatchObject({ action: 'allow', reason: 'paid-after-free', countsAgainstFree: false });
  });
  it('inside the allowance `paid` changes nothing', () => {
    expect(decideProfessionalAccess({ ...base, usedToday: 4, overQuota: 'paid' })).toMatchObject({ reason: 'within-free-quota', countsAgainstFree: true });
  });
});

describe('the charge: a free message never moves the wallet', () => {
  const usage = { provider: 'GLM', model: 'glm-4.7', inputTokens: 500_000, outputTokens: 200_000 };
  const ctx = { userId: UID, feature: 'professionals' as const };

  it('fraction 0 is `free-allowance` even when the answer really cost something', () => {
    const full = decideAiCharge(ctx, usage, 90);
    expect(full.charge).toBe(true);
    const free = decideAiCharge({ ...ctx, billableFraction: 0 }, usage, 90);
    expect(free).toMatchObject({ charge: false, reason: 'free-allowance', billedInr: 0 });
    expect(decideAiChargeForTurns({ ...ctx, billableFraction: 0 }, [usage], 90).reason).toBe('free-allowance');
  });

  it('a fraction charges exactly that share; omitted is the whole cost', () => {
    const full = decideAiCharge(ctx, usage, 90);
    const part = decideAiCharge({ ...ctx, billableFraction: 0.25 }, usage, 90);
    expect(part.billedInr).toBeCloseTo(full.billedInr * 0.25, 10);
  });

  it('an unreadable fraction is the whole cost, and nothing above 1 is honoured', () => {
    expect(billableFractionOf({ userId: UID })).toBe(1);
    expect(billableFractionOf({ userId: UID, billableFraction: Number.NaN })).toBe(1);
    expect(billableFractionOf({ userId: UID, billableFraction: 7 })).toBe(1);
    expect(billableFractionOf({ userId: UID, billableFraction: -3 })).toBe(0);
  });
});

describe('exam mode: 5 free QUESTIONS a day, separate from the messages', () => {
  it('splits a paper instead of judging it whole', () => {
    expect(splitExamQuestions(10, 0, 5)).toEqual({ free: 5, paid: 5 });
    expect(splitExamQuestions(10, 3, 5)).toEqual({ free: 2, paid: 8 });
    expect(splitExamQuestions(4, 0, 5)).toEqual({ free: 4, paid: 0 });
    expect(splitExamQuestions(10, 9, 5)).toEqual({ free: 0, paid: 10 });
  });

  it('prices what was DELIVERED — an empty paper spends and charges nothing', () => {
    expect(examPaperCharge(0, 5)).toEqual({ freeUsed: 0, billableFraction: 0 });
    expect(examPaperCharge(10, 5)).toEqual({ freeUsed: 5, billableFraction: 0.5 });
    expect(examPaperCharge(3, 5)).toEqual({ freeUsed: 3, billableFraction: 0 });
    expect(examPaperCharge(8, 0)).toEqual({ freeUsed: 0, billableFraction: 1 });
  });

  it('a paper inside the free questions is on the free chain and needs no balance', async () => {
    state.balance = 0;
    const g = await gateProfessionalExam(UID, EMAIL, 5);
    expect(g.allow).toBe(true);
    if (g.allow) { expect(g.tier).toBe('free'); expect(g.freeQuestions).toBe(5); }
  });

  it('the exam does not read the MESSAGE counter — 10 messages used still leaves 5 free questions', async () => {
    state.used = 10;
    state.balance = 0;
    const g = await gateProfessionalExam(UID, EMAIL, 5);
    expect(g.allow).toBe(true);
  });

  it('a partly-paid paper with an empty wallet is refused and names the paper that would be free', async () => {
    state.examUsed = 3;
    state.balance = 0;
    const g = await gateProfessionalExam(UID, EMAIL, 10);
    expect(g.allow).toBe(false);
    if (g.allow) return;
    expect(g.body.code).toBe('wallet_empty');
    expect(g.body.freeQuestionsLeft).toBe(2);
    expect(String(g.body.error)).toContain('a paper of 2 or fewer is free');
  });

  it('past the free questions with a balance, the paper is paid', async () => {
    state.examUsed = 5;
    const g = await gateProfessionalExam(UID, EMAIL, 10);
    expect(g.allow).toBe(true);
    if (g.allow) { expect(g.tier).toBe('paid'); expect(g.freeQuestions).toBe(0); }
  });
});

describe('the exam screen says what THIS paper costs before Start is pressed', async () => {
  const { examCostLine } = await import('../src/components/professionals/examView');
  it('free, partly free, all paid — and nothing when uncounted', () => {
    expect(examCostLine(5, 5, true)).toBe('This paper is free — 5 free questions left today.');
    expect(examCostLine(10, 2, true)).toBe('2 of these 10 are free today; the other 8 are paid from your balance.');
    expect(examCostLine(10, 0, true)).toBe("Today's free questions are used — this paper is paid from your balance.");
    expect(examCostLine(10, 2, false)).toBe('Only 2 free questions left today — set 2 or fewer.');
    expect(examCostLine(10, null, true)).toBeNull();
  });
});
