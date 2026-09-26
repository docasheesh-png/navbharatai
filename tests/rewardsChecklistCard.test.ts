import { describe, it, expect, vi, beforeEach } from 'vitest';
import { referralSurfaceFor, readyReferralSteps } from '../src/lib/referralClaim';
import { rewardsChecklistModel, REWARD_STEP_NAMES, type RewardChecklistInput } from '../src/lib/rewardsChecklist';
import { buildChecklist } from '../src/lib/referralChecklist';

/**
 * The rewards checklist pinned first in the notifications panel (admin 2026-09-26), and the rules that
 * decide when a reward is claimed without anybody pressing a button.
 *
 * Money is on this card, so each rule is asserted as the WRONG thing it prevents: a "Complete" button
 * that sends somebody to finish a step they already finished, a website row that could never pay, a
 * claim fired twice by two screens, and a Gmail-login grant that locks a user out of their referral code.
 */

const rows = (claimed: string[], steps = ['referral-code', 'email', 'mobile', 'github']) =>
  buildChecklist(steps.map((step) => ({ step, claimed: claimed.includes(step), rupees: 100 })));

const input = (over: Partial<RewardChecklistInput> = {}): RewardChecklistInput => ({
  enabled: true, surface: 'android', rows: rows([]),
  emailVerified: false, phoneVerified: false, githubLinked: false, referred: false, webCapRupees: null,
  ...over,
});

describe('which rule set a platform gets', () => {
  it('only Android carries the device check; the website and the iOS shell get the web rules', () => {
    expect(referralSurfaceFor('android')).toBe('android');
    expect(referralSurfaceFor('ANDROID ')).toBe('android');
    expect(referralSurfaceFor('web')).toBe('web');
    expect(referralSurfaceFor('ios')).toBe('web');
    expect(referralSurfaceFor(undefined)).toBe('web');
  });
});

describe('what is ready to be paid right now', () => {
  const facts = (over = {}) => ({
    steps: [
      { step: 'referral-code' as const, claimed: false }, { step: 'email' as const, claimed: false },
      { step: 'mobile' as const, claimed: false }, { step: 'github' as const, claimed: false },
    ],
    emailVerified: false, phoneVerified: false, githubLinked: false, referred: false, ...over,
  });

  it('⚡ Gmail login: a verified email on Android is ready the moment the user signs in', () => {
    expect(readyReferralSteps(facts({ emailVerified: true }), 'android')).toEqual(['email']);
  });

  it('only steps that are DONE and not yet claimed, in the admin’s order', () => {
    const f = facts({ emailVerified: true, phoneVerified: true, githubLinked: true, referred: true });
    expect(readyReferralSteps(f, 'android')).toEqual(['referral-code', 'email', 'mobile', 'github']);
    const claimedSome = { ...f, steps: f.steps.map((s) => ({ ...s, claimed: s.step === 'email' })) };
    expect(readyReferralSteps(claimedSome, 'android')).toEqual(['referral-code', 'mobile', 'github']);
  });

  it('🔒 on the website nothing is ready until the mobile is verified — a github link alone sends no request', () => {
    expect(readyReferralSteps(facts({ githubLinked: true }), 'web')).toEqual([]);
    expect(readyReferralSteps(facts({ githubLinked: true, phoneVerified: true }), 'web')).toEqual(['mobile', 'github']);
  });
});

describe('the card', () => {
  it('shows nothing when the programme is off or the server sent no rows — never a list of zeroes', () => {
    expect(rewardsChecklistModel(input({ enabled: false }))).toBeNull();
    expect(rewardsChecklistModel(input({ rows: [] }))).toBeNull();
  });

  it('uses the admin’s names: Referral code, Gmail login, Mobile verification, GitHub link', () => {
    const m = rewardsChecklistModel(input())!;
    expect(m.rows.map((r) => r.name)).toEqual([
      REWARD_STEP_NAMES['referral-code'], 'Gmail login', 'Mobile verification', 'GitHub link',
    ]);
  });

  it('a claimed step is a green tick with no button; an unfinished one is "Complete →"', () => {
    const m = rewardsChecklistModel(input({ rows: rows(['email']), emailVerified: true }))!;
    expect(m.rows.find((r) => r.step === 'email')!.state).toBe('done');
    expect(m.rows.find((r) => r.step === 'mobile')!.state).toBe('complete');
    expect(m.pendingRupees).toBe(300);
    expect(m.headline).toBe('₹300 free credit waiting for you');
  });

  it('🔴 a step that is DONE but not yet paid shows Claim — never "Complete", which would be a dead end', () => {
    const m = rewardsChecklistModel(input({ phoneVerified: true }))!;
    expect(m.rows.find((r) => r.step === 'mobile')!.state).toBe('claim');
  });

  it('"Complete →" goes to the profile’s Verifications — except the referral code, which lives in the Wallet', () => {
    const m = rewardsChecklistModel(input())!;
    expect(m.rows.find((r) => r.step === 'referral-code')!.target).toBe('wallet');
    for (const s of ['email', 'mobile', 'github'] as const) expect(m.rows.find((r) => r.step === s)!.target).toBe('profile');
  });

  it('📱 the website card has only its two rows, says why, and tells GitHub to wait for the mobile', () => {
    const m = rewardsChecklistModel(input({
      surface: 'web', rows: rows([], ['mobile', 'github']), githubLinked: true, webCapRupees: 200,
    }))!;
    expect(m.rows.map((r) => r.step)).toEqual(['mobile', 'github']);
    expect(m.rows.find((r) => r.step === 'github')!.state).toBe('complete');
    expect(m.rows.find((r) => r.step === 'github')!.hint).toMatch(/mobile first/i);
    expect(m.surfaceNote).toMatch(/up to ₹200/);
  });

  it('all claimed collapses to one line, and still says what was earned', () => {
    const m = rewardsChecklistModel(input({ rows: rows(['referral-code', 'email', 'mobile', 'github']) }))!;
    expect(m.allDone).toBe(true);
    expect(m.headline).toBe('All rewards claimed — ₹400 earned');
  });
});

// ── The automatic claim ─────────────────────────────────────────────────────────────────────────
const claimReadySteps = vi.fn(async () => 100);
let heldCode: string | null = null;
vi.mock('../src/lib/referralClaim', async (orig) => ({
  ...(await orig() as object),
  claimReadySteps: (...a: unknown[]) => claimReadySteps(...(a as [])),
}));
vi.mock('../src/lib/pendingReferralCode', async (orig) => ({
  ...(await orig() as object),
  heldReferralCode: () => heldCode,
}));

describe('the automatic claim', () => {
  beforeEach(() => { claimReadySteps.mockClear(); heldCode = null; });

  it('claims each new set of ready steps ONCE, however many screens load the progress', async () => {
    const { autoClaimIfReady } = await import('../src/hooks/useReferralProgress');
    await autoClaimIfReady('u-once', 'android', ['email']);
    await autoClaimIfReady('u-once', 'android', ['email']); // a second screen, same facts
    expect(claimReadySteps).toHaveBeenCalledTimes(1);
    await autoClaimIfReady('u-once', 'android', ['mobile']); // a NEW fact (mobile verified later)
    expect(claimReadySteps).toHaveBeenCalledTimes(2);
  });

  it('🔴 waits while a referral code typed on the sign-in screen is still unapplied — and does not burn the attempt', async () => {
    const { autoClaimIfReady } = await import('../src/hooks/useReferralProgress');
    heldCode = 'ABC234';
    expect(await autoClaimIfReady('u-held', 'android', ['mobile'])).toBe(0);
    expect(claimReadySteps).not.toHaveBeenCalled();
    heldCode = null;
    await autoClaimIfReady('u-held', 'android', ['mobile']); // the next refresh tries again
    expect(claimReadySteps).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when nothing is ready', async () => {
    const { autoClaimIfReady } = await import('../src/hooks/useReferralProgress');
    expect(await autoClaimIfReady('u-none', 'web', [])).toBe(0);
    expect(claimReadySteps).not.toHaveBeenCalled();
  });
});
