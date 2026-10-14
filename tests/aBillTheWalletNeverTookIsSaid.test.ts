/**
 * 🧬 A MONEY WORD THAT STATES SOMETHING THE SYSTEM NEVER CHECKED (build report 9c612cdb, Q-1036).
 *
 * `BuildBillingLabel.charged` was documented as *"this build's bill was set against the user's
 * wallet"* — a claim about the WALLET — while its value is `billing applies && bill > 0`, which is a
 * claim about the BILL. Two different facts, and the gap is not theoretical:
 *
 *   • At the settle, the debit runs under `if (userId && effectiveBilledUsd > 0 && billingActive)`.
 *     When `debitRes.ok` is false the failure goes to `console.error` and `walletDebit` stays null —
 *     and the billing record still said `charged`, about a bill the balance never paid.
 *   • The WATCHDOG path skips its debit whenever it cannot reproduce the settle's exact `buildRef`,
 *     deliberately, because a mismatch there could double-charge. Also recorded as `charged`.
 *
 * 🔑 THE FIX DOES NOT CHANGE `charged`, ON PURPOSE. Making it require a known debit would have made
 * every caller that cannot see one report "not charged" on a build that really was billed — one lie
 * traded for another, which the 2026-09-13 rule forbids outright. The wallet fact is reported BESIDE
 * it, and only where it is genuinely known: "we did not check" and "it did not happen" are different
 * facts, and only the second is a finding.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildBillingLabel, CHEAP_TIER_LABEL, BILLED_NOT_DEBITED_NOTE } from '../src/server/AgentV3/buildBillingLabel';

const read = (rel: string): string => readFileSync(join(__dirname, '..', rel), 'utf8');
const BILLED = { freeListed: false, cheapEnginesOnly: true, billingActive: true, billedUsd: 1.064709, billedInr: 103.24 };

describe('a bill the wallet never took is SAID, not implied', () => {
  it('a failed debit on a charged build is a finding, and it is on the label', () => {
    const l = buildBillingLabel({ ...BILLED, walletDebited: false });
    expect(l.charged).toBe(true);           // the bill really did apply
    expect(l.walletDebited).toBe(false);    // and the balance really did not pay it
    expect(l.billedButNotDebited).toBe(true);
    expect(l.userTier).toContain(BILLED_NOT_DEBITED_NOTE);
  });

  it('a debit that worked says so, and raises nothing', () => {
    const l = buildBillingLabel({ ...BILLED, walletDebited: true });
    expect(l.charged).toBe(true);
    expect(l.walletDebited).toBe(true);
    expect(l.billedButNotDebited).toBe(false);
    expect(l.userTier).not.toContain(BILLED_NOT_DEBITED_NOTE);
    expect(l.userTier).toBe(`${CHEAP_TIER_LABEL} · charged ₹103.24`);
  });

  it('"we did not check" is NOT "it did not happen" — an unknown accuses nobody', () => {
    const l = buildBillingLabel(BILLED); // the watchdog label: built before its own debit runs
    expect(l.charged).toBe(true);
    expect('walletDebited' in l).toBe(false); // absent, not false
    expect(l.billedButNotDebited).toBe(false);
    expect(l.userTier).not.toContain(BILLED_NOT_DEBITED_NOTE);
  });

  it('and omitting the fact is byte-for-byte the label this code produced before', () => {
    const { walletDebited, billedButNotDebited, ...rest } = buildBillingLabel(BILLED);
    expect(rest).toEqual({ userTier: `${CHEAP_TIER_LABEL} · charged ₹103.24`, charged: true });
    expect(walletDebited).toBeUndefined();
    expect(billedButNotDebited).toBe(false);
  });
});

describe('a bill of zero cannot be "owed and not taken"', () => {
  it('nothing to debit is not a missed debit, on any branch', () => {
    const zero = { ...BILLED, billedUsd: 0, billedInr: 0 };
    for (const walletDebited of [true, false, undefined]) {
      const l = buildBillingLabel({ ...zero, ...(walletDebited === undefined ? {} : { walletDebited }) });
      expect(l.charged).toBe(false);
      expect(l.billedButNotDebited).toBe(false);
      expect(l.userTier).not.toContain(BILLED_NOT_DEBITED_NOTE);
    }
  });

  it('a free-listed admin and a billing-off build are never "owed"', () => {
    for (const input of [
      { freeListed: true, cheapEnginesOnly: true, billingActive: false, billedUsd: 1, billedInr: 97, walletDebited: false },
      { freeListed: false, cheapEnginesOnly: false, billingActive: false, billedUsd: 3, billedInr: 291, walletDebited: false },
    ]) {
      const l = buildBillingLabel(input);
      expect(l.charged).toBe(false);
      expect(l.billedButNotDebited).toBe(false);
      expect(l.userTier).not.toContain(BILLED_NOT_DEBITED_NOTE);
    }
  });
});

describe('the note survives whichever branch the build took', () => {
  it('the paid branch carries it too, not only the Weak one', () => {
    const paid = buildBillingLabel({ freeListed: false, cheapEnginesOnly: false, billingActive: true, billedUsd: 2.5, billedInr: 242.43, walletDebited: false });
    expect(paid.billedButNotDebited).toBe(true);
    expect(paid.userTier).toBe(`paid · ${BILLED_NOT_DEBITED_NOTE}`);
  });
});

describe('source guards — the fact reaches the label from the one path that knows it', () => {
  const route = read('src/server/routes/agentv3.ts');
  const mod = read('src/server/AgentV3/buildBillingLabel.ts');

  it('the settle passes the real debit result', () => {
    expect(route).toContain('walletDebited: !!walletDebit && walletDebit.tokensDebited > 0,');
  });

  it('the watchdog label passes NOTHING, because it runs before its own debit', () => {
    // Its label is built at the earlier setBilling; the debit follows it. Claiming a fact there
    // would be inventing one — the whole defect this row is about.
    const watchdog = route.slice(route.indexOf('...buildBillingLabel({'), route.indexOf('...buildBillingLabel({') + 400);
    expect(watchdog).not.toContain('walletDebited');
  });

  it('`charged` is unchanged — the fix adds a fact, it does not redefine a money word', () => {
    expect(mod).toContain('const charged = !input.freeListed && input.billingActive && Number.isFinite(usd) && usd > 0;');
  });

  it('and the doc no longer claims the wallet moved', () => {
    const doc = mod.slice(0, mod.indexOf('charged: boolean;'));
    expect(doc).not.toMatch(/True when this build's bill was set against the user's wallet/);
    expect(mod).toContain('It is NOT a statement that the wallet moved');
  });
});
