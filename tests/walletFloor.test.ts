import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  clampChargeToFloor, overdraftFloorInr,
  DEFAULT_OVERDRAFT_FLOOR_INR, MAX_OVERDRAFT_FLOOR_INR,
} from '../src/server/lib/walletFloor';
import { computeDebitedWallet, computeRolledUpDebit } from '../src/server/lib/walletDebit';
import { spendByFeature } from '../src/server/lib/walletFeature';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * THE FLOOR UNDER EVERY WALLET.
 *
 * Admin 2026-09-13, holding two real accounts — one at **−₹506.03** with 0 apps built, another at
 * **−₹1,198.41**: *"aise -500₹ har user ko diye to ham barbaad ho jayenge!!!"*
 *
 * Every START gate was already right. What had no bound was the SETTLEMENT: a build legitimately
 * allowed to begin at ₹1 could run its full wall-clock and debit whatever it had cost, in one go.
 */

describe('the floor value itself', () => {
  it('defaults to ₹50 with nothing set', () => {
    expect(overdraftFloorInr({} as NodeJS.ProcessEnv)).toBe(DEFAULT_OVERDRAFT_FLOOR_INR);
    expect(DEFAULT_OVERDRAFT_FLOOR_INR).toBe(50);
  });

  it('accepts what an operator actually types', () => {
    expect(overdraftFloorInr({ WALLET_OVERDRAFT_FLOOR_INR: '100' } as never)).toBe(100);
    expect(overdraftFloorInr({ WALLET_OVERDRAFT_FLOOR_INR: ' ₹100 ' } as never)).toBe(100);
    expect(overdraftFloorInr({ WALLET_OVERDRAFT_FLOOR_INR: '0' } as never)).toBe(0);
  });

  it('🔒 a MALFORMED value falls back to the default, never to "no limit"', () => {
    // Someone who wanted no limit would not be typing a number into a box called a floor, so an
    // unreadable value can never have meant unlimited.
    for (const bad of ['abc', '', '  ', '-20', 'lots']) {
      expect(overdraftFloorInr({ WALLET_OVERDRAFT_FLOOR_INR: bad } as never)).toBe(DEFAULT_OVERDRAFT_FLOOR_INR);
    }
  });

  it('🔴 the SETTING itself is capped — a typo cannot restore unbounded debt', () => {
    // `5000` in a Cloud Run box would otherwise silently reproduce the −₹1,198 account.
    expect(overdraftFloorInr({ WALLET_OVERDRAFT_FLOOR_INR: '5000' } as never)).toBe(MAX_OVERDRAFT_FLOOR_INR);
    expect(MAX_OVERDRAFT_FLOOR_INR).toBeLessThanOrEqual(500);
  });
});

describe('clampChargeToFloor — what the user pays, and what we eat', () => {
  it('an ordinary charge is untouched', () => {
    expect(clampChargeToFloor({ balanceInr: 250, billedInr: 12, floorInr: 50 }))
      .toEqual({ chargedInr: 12, absorbedInr: 0, clamped: false });
  });

  it('🔴 THE REPORTED CASE: a ₹556 charge on a ₹50 balance can no longer reach −₹506', () => {
    const out = clampChargeToFloor({ balanceInr: 50, billedInr: 556.03, floorInr: 50 });
    expect(out.chargedInr).toBe(100);        // 50 of theirs + 50 of floor
    expect(out.absorbedInr).toBe(456.03);    // ours, and recorded as ours
    expect(50 - out.chargedInr).toBe(-50);   // the balance lands exactly ON the floor, never past it
  });

  it('a wallet ALREADY at the floor is charged nothing more', () => {
    // This is what stops a second bad build compounding a first.
    const out = clampChargeToFloor({ balanceInr: -50, billedInr: 300, floorInr: 50 });
    expect(out).toEqual({ chargedInr: 0, absorbedInr: 300, clamped: true });
  });

  it('a wallet already PAST the floor is never pushed further', () => {
    const out = clampChargeToFloor({ balanceInr: -1198.41, billedInr: 200, floorInr: 50 });
    expect(out.chargedInr).toBe(0);
    expect(out.absorbedInr).toBe(200);
  });

  it('a zero floor means the balance may not go negative at all', () => {
    expect(clampChargeToFloor({ balanceInr: 10, billedInr: 40, floorInr: 0 }))
      .toMatchObject({ chargedInr: 10, absorbedInr: 30 });
  });

  it('a non-positive or nonsense charge is a no-op', () => {
    expect(clampChargeToFloor({ balanceInr: 5, billedInr: 0, floorInr: 50 }).chargedInr).toBe(0);
    expect(clampChargeToFloor({ balanceInr: 5, billedInr: NaN, floorInr: 50 }).absorbedInr).toBe(0);
  });
});

describe('🔒 the floor is enforced at the DEBIT, so no caller can bypass it', () => {
  const wallet = (tokens: number) => ({ tokenBalance: tokens, remaining_balance: tokens / 100, walletLedger: [] });
  const now = '2026-09-13T00:00:00.000Z';

  it('a build debit stops at the floor and records what we absorbed', () => {
    const out = computeDebitedWallet(
      wallet(5000), // ₹50
      { billedInr: 556.03, buildRef: 'b1', description: 'NavBharatAI Pro build', feature: 'build', floorInr: 50 },
      now,
    );
    expect(out.wallet.tokenBalance).toBe(-5000); // exactly −₹50
    const row = out.wallet.walletLedger[0];
    expect(row.absorbedInr).toBeCloseTo(456.03, 2);
  });

  it('a rolled-up assistant debit obeys the same floor', () => {
    // Many small charges in one day add up exactly like one large one.
    const out = computeRolledUpDebit(
      wallet(100), // ₹1
      { billedInr: 400, rollupRef: 'ai_2026-09-13_doctor', description: 'Doctor AI', feature: 'doctor', floorInr: 50 },
      now,
    );
    expect(out.wallet.tokenBalance).toBe(-5000);
    expect(out.wallet.walletLedger[0].absorbedInr).toBeGreaterThan(0);
  });

  it('🔴 A CALLER THAT FORGETS THE FLOOR STILL GETS ONE', () => {
    // "Unset" must not be the single input that restores unbounded debt — that is the bug.
    const out = computeDebitedWallet(
      wallet(100),
      { billedInr: 5000, buildRef: 'b2', description: 'forgot the floor' },
      now,
    );
    expect(out.wallet.tokenBalance).toBe(-DEFAULT_OVERDRAFT_FLOOR_INR * 100);
  });

  it('⚠️ the CARRY follows what was charged, not what was owed', () => {
    // Carrying the absorbed part would quietly re-bill the rupees we just said we would eat.
    const out = computeDebitedWallet(
      wallet(0),
      { billedInr: 999, buildRef: 'b3', description: 'x', floorInr: 50 },
      now,
    );
    expect(out.wallet.tokenCarry ?? 0).toBeLessThan(1);
    expect(out.wallet.tokenBalance).toBe(-5000);
  });

  it('the breakdown reports our loss SEPARATELY from the user’s spending', () => {
    const out = computeDebitedWallet(
      wallet(5000),
      { billedInr: 556.03, buildRef: 'b4', description: 'build', feature: 'build', floorInr: 50 },
      now,
    );
    const b = spendByFeature(out.wallet.walletLedger);
    expect(b.absorbedInr).toBeCloseTo(456.03, 2);
    expect(b.rows[0].inr).toBe(100);   // what the USER was charged
    expect(b.totalInr).toBe(100);      // our loss is never added to their total
  });
});

describe('the wiring', () => {
  const walletDebit = read('src/server/lib/walletDebit.ts');

  it('both debit paths clamp before converting to tokens', () => {
    expect(walletDebit.split('floorCharge(w, tx.billedInr, tx.floorInr)').length - 1).toBe(2);
    expect(walletDebit).toContain('inrToDebitTokens(floored.chargedInr)');
    expect(walletDebit).not.toMatch(/inrToDebitTokens\(tx\.billedInr\)/);
  });

  it('the configured floor reaches production from the I/O layer', () => {
    expect(walletDebit.split('overdraftFloorInr()').length - 1).toBe(2);
  });

  it('the admin screen shows what we absorbed', () => {
    expect(read('src/components/AdminDashboard.tsx')).toContain('NavBharatAI absorbed');
  });
});
