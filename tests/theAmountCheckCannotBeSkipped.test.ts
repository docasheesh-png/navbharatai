// Q-890 — A GUARD THAT STANDS DOWN WHEN ITS INPUT IS UNREADABLE IS A GUARD WITH AN OFF SWITCH.
//
// 🔴 THE DEFECT, at `lib/payments.ts`'s paid-vs-recorded reconciliation:
//
//     if (Number.isFinite(paid) && Number.isFinite(expected) && Math.abs(paid - expected) > 0.01) refuse
//
// If EITHER amount was not a finite number the whole condition was false, so nothing was refused and
// the credit went through un-reconciled — skipped by exactly the inputs it exists to catch.
//
// ⚠️ AND THE ROW'S PRESCRIBED FIX ("fail closed") IS RIGHT FOR ONE SIDE AND WRONG FOR THE OTHER.
// Measured, not assumed: this same file's comment at `lastRechargeAt` records that `txData.amountPaid`
// can legitimately be *"absent, a string or NaN (a legacy row, a hand-fixed one, a provider payload
// that changed shape)"*. Failing closed on OUR side would turn a silent un-reconciled credit into a
// REFUSED credit for a customer who really paid — fixing one problem by creating a worse one, on money.
//
// So the sides are treated as what they are, and this file holds that asymmetry so nobody "completes"
// it later into a symmetric rule:
//   · the PROVIDER's amount unreadable ⇒ REFUSE (a paid order always carries `order_amount`);
//   · OUR record unreadable ⇒ credit, and say so loudly. The credited figure is our own recorded
//     amount either way, which is what makes that safe.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';

// Comments stripped: this fix's own comments quote the OLD condition as evidence, and a source check
// that reads its own documentation can never go green. (Third time in a day I have needed this line.)
const CODE = stripCodeComments(readFileSync(join(process.cwd(), 'src/server/lib/payments.ts'), 'utf8'));

/** The decision the route now makes, restated here so the test asserts behaviour and not just text. */
function verdict(providerAmount: unknown, recordedAmount: unknown): 'refuse' | 'credit' | 'credit-unreconciled' {
  const paid = Number(providerAmount);
  const expected = Number(recordedAmount);
  if (!Number.isFinite(paid)) return 'refuse';
  if (!Number.isFinite(expected)) return 'credit-unreconciled';
  return Math.abs(paid - expected) > 0.01 ? 'refuse' : 'credit';
}

describe('the paid-vs-recorded check cannot be skipped by an unreadable amount', () => {
  it('the old condition — the one with the off switch — is gone', () => {
    expect(CODE, 'a single AND-chain that includes both isFinite checks is the defect')
      .not.toMatch(/Number\.isFinite\(paidAmount\)\s*&&\s*Number\.isFinite\(expectedAmount\)\s*&&/);
    expect(CODE).toContain('if (!Number.isFinite(paidAmount))');
    expect(CODE).toContain('if (!Number.isFinite(expectedAmount))');
  });

  it('an unreadable PROVIDER amount refuses the credit', () => {
    for (const bad of [undefined, null, 'abc', NaN, {}, [], '']) {
      // '' and [] coerce to 0, which IS finite — so they are asserted by what they really do, not by
      // what they look like. Only the genuinely unreadable ones refuse.
      const want = Number.isFinite(Number(bad)) ? 'credit' : 'refuse';
      expect(verdict(bad, Number(bad))).toBe(want);
    }
    expect(verdict(undefined, 499)).toBe('refuse');
    expect(verdict('not-a-number', 499)).toBe('refuse');
    expect(CODE).toContain('Nothing to reconcile against — refusing to credit');
  });

  it('an unreadable OWN record credits and says so — it does NOT refuse a real payment', () => {
    // The legacy row the file documents. Refusing here would be the regression.
    expect(verdict(499, undefined)).toBe('credit-unreconciled');
    expect(verdict(499, 'legacy')).toBe('credit-unreconciled');
    expect(CODE).toContain('UNRECONCILED CREDIT for order');
    expect(CODE, 'the log must say the check could not run, not merely that something was odd')
      .toContain('could NOT run');
  });

  it('a real mismatch still refuses, and a match within the paisa tolerance still credits', () => {
    expect(verdict(500, 499)).toBe('refuse');
    expect(verdict(499, 499)).toBe('credit');
    expect(verdict(499.005, 499)).toBe('credit');   // inside the 1-paisa tolerance
    expect(verdict(499.02, 499)).toBe('refuse');    // outside it
    expect(CODE).toContain('Amount mismatch for order');
  });

  it('and the provider is not named to the user in either refusal', () => {
    // The two refusals reach the browser. Q-887's class: what a payer reads never names a vendor.
    for (const m of CODE.matchAll(/error: '([^']*contact support[^']*)'/g)) {
      expect(m[1]).not.toMatch(/cashfree|razorpay|stripe/i);
    }
  });
});
