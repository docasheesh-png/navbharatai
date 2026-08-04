import { describe, it, expect } from 'vitest';
import {
  decideAiCharge, aiWalletSpendEnabled, aiSpendRollupRef, AI_SPEND_LEDGER_LABEL,
} from '../src/server/lib/aiTurnCharge';
import { computeRolledUpDebit, TOKEN_CARRY_FIELD } from '../src/server/lib/walletDebit';
import { walletTooEmptyForTurn } from '../src/server/professionals/passGate';
import { TOKENS_PER_RUPEE } from '../src/server/lib/payments';
import type { ChatTurnUsage } from '../src/server/lib/chatSpend';

// ONE WALLET (admin: "user unhin 50,000 token se kharch kare, har jagah"). The gifted balance was only
// ever spent by v5 builds; every assistant was bounded by a daily MESSAGE COUNT instead. Ten cheap
// questions and ten expensive ones cost the user the same while costing us completely different
// amounts, and someone holding ₹600 of credit could be told to buy a Pass while their balance sat
// untouched. These tests are about who must never be charged, and about not inventing an amount.

const USD_INR = 85;
const ON = { AI_WALLET_SPEND: 'on' } as NodeJS.ProcessEnv;
const paid: ChatTurnUsage = { provider: 'GLM', model: 'glm-4.7', inputTokens: 500_000, outputTokens: 200_000 };
const free: ChatTurnUsage = { provider: 'GLM', model: 'glm-4.7-flash', inputTokens: 5_000, outputTokens: 900 };

describe('the master switch', () => {
  it('is off unless explicitly turned on, so shipping this moves nobody’s money', () => {
    expect(aiWalletSpendEnabled({})).toBe(false);
    expect(aiWalletSpendEnabled({ AI_WALLET_SPEND: 'true' } as NodeJS.ProcessEnv)).toBe(false); // only 'on'
    expect(aiWalletSpendEnabled({ AI_WALLET_SPEND: 'ON' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('charges nothing at all while off, however expensive the turn was', () => {
    const d = decideAiCharge({ userId: 'u1' }, paid, USD_INR, {});
    expect(d.charge).toBe(false);
    expect(d.reason).toBe('disabled');
    expect(d.billedInr).toBe(0);
  });
});

describe('who must never be charged', () => {
  it('an anonymous caller — there is no wallet to draw from', () => {
    expect(decideAiCharge({ userId: null }, paid, USD_INR, ON).reason).toBe('anonymous');
  });

  it('an admin/test account', () => {
    expect(decideAiCharge({ userId: 'u1', isFreeListed: true }, paid, USD_INR, ON).reason).toBe('free-list');
  });

  it('a Professional Pass holder — the Pass IS the payment', () => {
    // Charging the wallet on top would bill them twice for one thing.
    expect(decideAiCharge({ userId: 'u1', hasActivePass: true }, paid, USD_INR, ON).reason).toBe('pass');
  });

  it('a turn the provider never reported — we eat it rather than invent a number', () => {
    const d = decideAiCharge({ userId: 'u1' }, { provider: 'GROK', model: 'grok-4' }, USD_INR, ON);
    expect(d.reason).toBe('unmeasured');
    expect(d.billedInr).toBe(0);
  });

  it('a genuinely free model — measured, and it really cost nothing', () => {
    const d = decideAiCharge({ userId: 'u1' }, free, USD_INR, ON);
    expect(d.reason).toBe('free-model');
    expect(d.charge).toBe(false);
  });

  it('keeps free-model and unmeasured apart even though both charge ₹0', () => {
    // Only one of them is costing us money silently, and an admin reading this needs to tell which.
    expect(decideAiCharge({ userId: 'u1' }, free, USD_INR, ON).reason).toBe('free-model');
    expect(decideAiCharge({ userId: 'u1' }, null, USD_INR, ON).reason).toBe('unmeasured');
  });
});

describe('a real, measured cost draws the wallet down', () => {
  it('charges what the turn actually cost', () => {
    const d = decideAiCharge({ userId: 'u1' }, paid, USD_INR, ON);
    expect(d.charge).toBe(true);
    expect(d.reason).toBe('charge');
    expect(d.billedInr).toBeGreaterThan(0);
    expect(d.billedInr).toBe(d.cost.billedInr);
  });
});

describe('the ledger bucket', () => {
  it('is one row per user per day, so a chatty day is one readable line', () => {
    const morning = Date.parse('2026-08-02T04:00:00.000Z');
    const evening = Date.parse('2026-08-02T21:30:00.000Z');
    expect(aiSpendRollupRef(morning)).toBe(aiSpendRollupRef(evening));
    expect(aiSpendRollupRef(Date.parse('2026-08-03T04:00:00.000Z'))).not.toBe(aiSpendRollupRef(morning));
  });

  it('is dated on the SERVER, so a user changing their device clock cannot move it', () => {
    expect(aiSpendRollupRef(Date.parse('2026-08-02T23:59:59.000Z'))).toBe('ai_2026-08-02');
  });

  it('never names a vendor', () => {
    const label = AI_SPEND_LEDGER_LABEL.toLowerCase();
    for (const vendor of ['glm', 'kimi', 'claude', 'gemini', 'grok', 'anthropic', 'vertex', 'openai']) {
      expect(label).not.toContain(vendor);
    }
  });
});

describe('rolling many small charges into one ledger row', () => {
  const FUNDED = { tokenBalance: 10_000, totalTokensUsed: 0, remaining_balance: 100, walletLedger: [] as any[] };
  const T = '2026-08-02T10:00:00.000Z';
  const charge = (w: Record<string, any>, inr: number) =>
    computeRolledUpDebit(w, { billedInr: inr, rollupRef: 'ai_2026-08-02', description: 'NavBharatAI assistants' }, T);

  it('keeps ONE row however many turns the user takes', () => {
    // Fifty rows of ₹0.02 each would fill the 500-entry ledger in a fortnight and push the user's
    // PURCHASE history off the end — someone checking "did my ₹250 arrive?" would find only chat noise.
    let w: Record<string, any> = { ...FUNDED };
    for (let i = 0; i < 30; i++) w = charge(w, 0.5).wallet;
    expect(w.walletLedger).toHaveLength(1);
    expect(w.walletLedger[0].rollupRef).toBe('ai_2026-08-02');
  });

  it('the single row shows the running total for the day', () => {
    let w: Record<string, any> = { ...FUNDED };
    w = charge(w, 1).wallet;
    w = charge(w, 2).wallet;
    expect(w.walletLedger[0].amountCoinsOrTokens).toBe(-3 * TOKENS_PER_RUPEE);
    expect(w.walletLedger[0].description).toContain('₹3.00');
  });

  it('the balance moves by THIS charge, not by the row total — the accumulation is display only', () => {
    let w: Record<string, any> = { ...FUNDED };
    w = charge(w, 1).wallet;
    w = charge(w, 2).wallet;
    expect(w.tokenBalance).toBe(10_000 - 300); // 10000 − 100 − 200, never 10000 − 100 − 300
    expect(w.remaining_balance).toBe(97);
  });

  it('a different day opens its own row and leaves yesterday’s alone', () => {
    let w: Record<string, any> = { ...FUNDED };
    w = charge(w, 1).wallet;
    w = computeRolledUpDebit(w, { billedInr: 2, rollupRef: 'ai_2026-08-03', description: 'NavBharatAI assistants' }, T).wallet;
    expect(w.walletLedger).toHaveLength(2);
    expect(w.walletLedger[0].amountCoinsOrTokens).toBe(-100);
    expect(w.walletLedger[1].amountCoinsOrTokens).toBe(-200);
  });

  it('carries the sub-token remainder exactly like a build charge does', () => {
    // Ten ₹0.001 turns owe exactly one token between them — not ten.
    let w: Record<string, any> = { ...FUNDED };
    for (let i = 0; i < 10; i++) w = charge(w, 0.001).wallet;
    expect(w.tokenBalance).toBe(10_000 - 1);
    expect(w[TOKEN_CARRY_FIELD]).toBeCloseTo(0, 6);
  });

  it('refuses a charge with no bucket, and a non-positive amount', () => {
    expect(computeRolledUpDebit(FUNDED, { billedInr: 1, rollupRef: '', description: 'x' }, T).applied).toBe(false);
    expect(charge(FUNDED, 0).applied).toBe(false);
    expect(charge(FUNDED, NaN).applied).toBe(false);
  });

  it('leaves the rest of the wallet untouched', () => {
    const { wallet } = charge({ ...FUNDED, hasVishwakarmaPass: true, keepMe: 'yes' }, 1);
    expect(wallet.hasVishwakarmaPass).toBe(true);
    expect(wallet.keepMe).toBe('yes');
  });
});

describe('refusing a turn on an empty wallet', () => {
  it('refuses at zero and below — a chat turn has no later gate to catch the overdraft', () => {
    // A build can overdraw because the NEXT pre-flight gate blocks it. Nothing catches a chat turn
    // afterwards, so unbounded free usage is the alternative.
    expect(walletTooEmptyForTurn(0)).toBe(true);
    expect(walletTooEmptyForTurn(-5)).toBe(true);
  });

  it('allows any real balance through, however small', () => {
    expect(walletTooEmptyForTurn(0.01)).toBe(false);
    expect(walletTooEmptyForTurn(650)).toBe(false);
  });

  it('allows the turn when the balance cannot be read at all', () => {
    // Fail-open, matching the build gate: refusing on a Firestore blip would deny a paying user their
    // assistant over an infrastructure hiccup, and the debit still records the debt honestly.
    expect(walletTooEmptyForTurn(null)).toBe(false);
  });
});
