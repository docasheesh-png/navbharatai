import { afterEach, describe, expect, it } from 'vitest';
import { mirroredCreditPatch } from '../src/server/lib/walletMirror';
import { adminBuildRemaining, checkPlanPayable, paidSpendableTokens } from '../src/server/lib/giftSpend';
import { maskWalletForView } from '../src/server/lib/freeProgram';
import { readWalletBalanceInr } from '../src/server/AgentV3/WalletBalance';
import { setFreeProgramPausedHint } from '../src/server/lib/freeProgramHint';
import { computeDebitedWallet, computeRolledUpDebit, computeRolledUpRelease } from '../src/server/lib/walletDebit';
import { hasEverPaid } from '../src/server/AgentV3/FreeTierBuildRouting';
import { enforceFreeProgramPause } from '../src/server/lib/freeProgramGate';

const NOW = '2026-10-26T00:00:00.000Z';
const empty = { tokenBalance: 0, remaining_balance: 0, giftTokensRemaining: 0, totalMoneySpent: 0, walletLedger: [] };
const grant = (w: Record<string, any>, n: number) => ({ ...w, ...mirroredCreditPatch(w, n, 'admin-build') });
afterEach(() => setFreeProgramPausedHint(null));

describe('explicit admin app-building credit survives the free-program pause', () => {
  it('reproduces the old collision and fixes explicit grants without reclassifying old gifts', async () => {
    setFreeProgramPausedHint(true);
    const old = { ...empty, ...mirroredCreditPatch(empty, 100_000, 'gift') };
    expect(maskWalletForView(old, true).tokenBalance).toBe(0);
    const w = grant(empty, 100_000);
    expect(maskWalletForView(w, true).tokenBalance).toBe(100_000);
    expect(maskWalletForView(w, true).remaining_balance).toBe(1_000);
    expect(await readWalletBalanceInr(async () => w, 'synthetic-user', 'build')).toBe(1_000);
    expect(await readWalletBalanceInr(async () => w, 'synthetic-user')).toBe(0);
    expect(hasEverPaid(w)).toBe(false);
    expect(checkPlanPayable(w, 1)).not.toBeNull();
  });
  it('admits an explicit grant before opening any build work; old gifts still fail', async () => {
    let next = 0;
    let status = 0;
    const deps = { paused: async () => true, uid: async () => 'synthetic-user', email: async () => null,
      isFreeListed: () => false, wallet: async () => grant(empty, 100_000) };
    const res = { status(n: number) { status = n; return this; }, json() { return this; } };
    await enforceFreeProgramPause(deps)({} as never, res as never, () => { next++; });
    expect(next).toBe(1); expect(status).toBe(0);
    await enforceFreeProgramPause({ ...deps, wallet: async () => ({ ...empty, ...mirroredCreditPatch(empty, 100_000, 'gift') }) })({} as never, res as never, () => { next++; });
    expect(next).toBe(1); expect(status).toBe(402);
  });
  it('spends admin credit before paid money and never revives it on a later recharge', () => {
    setFreeProgramPausedHint(true);
    const w = grant({ ...empty, tokenBalance: 500, remaining_balance: 5, totalMoneySpent: 5 }, 1_000);
    const r = computeDebitedWallet(w, { feature: 'build', adminCreditEligible: true, billedInr: 10, buildRef: 'build-1', description: 'App building' }, NOW);
    expect(r.wallet.tokenBalance).toBe(500);
    expect(adminBuildRemaining(r.wallet)).toBe(0);
    expect(paidSpendableTokens(r.wallet)).toBe(500);
    expect(computeDebitedWallet(r.wallet, { feature: 'build', adminCreditEligible: true, billedInr: 10, buildRef: 'build-1', description: 'App building' }, NOW).applied).toBe(false);
    const topped = { ...r.wallet, ...mirroredCreditPatch(r.wallet, 200, 'paid') };
    expect(adminBuildRemaining(topped)).toBe(0);
    expect(paidSpendableTokens(topped)).toBe(700);
  });
  it('an admin revocation removes admin gift, not the paid portion of a mixed wallet', () => {
    const w = grant({ ...empty, tokenBalance: 100, remaining_balance: 1, totalMoneySpent: 1 }, 100);
    const revoked = grant(w, -50);
    expect(revoked.tokenBalance).toBe(150);
    expect(revoked.giftTokensRemaining).toBe(50);
    expect(adminBuildRemaining(revoked)).toBe(50);
    expect(paidSpendableTokens(revoked)).toBe(100);
  });
  it('non-build usage cannot eat admin credit while the free program is paused', async () => {
    const paused = true;
    setFreeProgramPausedHint(paused);
    const w = grant({ ...empty, tokenBalance: 100, remaining_balance: 1, totalMoneySpent: 1 }, 1_000);
    expect(await readWalletBalanceInr(async () => w, 'synthetic-user')).toBe(1);
    const r = computeDebitedWallet(w, { feature: 'hosting', billedInr: 50, buildRef: 'hosting-1', description: 'Hosting' }, NOW);
    expect(r.tokensDebited).toBe(100);
    expect(adminBuildRemaining(r.wallet)).toBe(1_000);
    expect(r.wallet.tokenBalance).toBe(1_000);
    const hold = computeRolledUpDebit(r.wallet, { feature: 'image', billedInr: 0.005, rollupRef: 'images', description: 'Image', allOrNothing: true, holdId: 'h1', floorInr: 0 }, NOW);
    expect(hold.refused).toBe(true);
    expect(computeRolledUpRelease(hold.wallet, { rollupRef: 'images', holdId: 'h1', description: 'Image' }, NOW).applied).toBe(false);
  });
  it('resuming the program preserves historical gift eligibility for other AI usage', async () => {
    setFreeProgramPausedHint(false);
    const w = grant({ ...empty, ...mirroredCreditPatch(empty, 200, 'gift') }, 1000);
    expect(await readWalletBalanceInr(async () => w, 'synthetic-user')).toBe(2);
    const r = computeDebitedWallet(w, { feature: 'doctor', billedInr: 2, buildRef: 'doctor-1', description: 'Doctor AI' }, NOW);
    expect(r.wallet.tokenBalance).toBe(1000);
    expect(adminBuildRemaining(r.wallet)).toBe(1000);
  });
  it('a build overrun cannot consume old paused gifts behind the admin credit', () => {
    setFreeProgramPausedHint(true);
    const old = { ...empty, ...mirroredCreditPatch(empty, 4_000, 'gift') };
    const w = grant(old, 100);
    const r = computeDebitedWallet(w, { feature: 'build', adminCreditEligible: true, billedInr: 100, buildRef: 'build-overrun', description: 'App building' }, NOW);
    expect(r.tokensDebited).toBe(100);
    expect(r.wallet.tokenBalance).toBe(4_000);
    expect(r.wallet.giftTokensRemaining).toBe(4_000);
    expect(adminBuildRemaining(r.wallet)).toBe(0);
    expect(maskWalletForView(r.wallet, true).tokenBalance).toBe(0);
  });
  it('paid-only hosting refuses admin credit even with the program resumed', () => {
    setFreeProgramPausedHint(false);
    const w = grant(empty, 100_000);
    const r = computeDebitedWallet(w, { feature: 'hosting-plan', spends: 'paid-only', billedInr: 1, buildRef: 'plan-1', description: 'Hosting plan' }, NOW);
    expect(r.refused).toBe(true); expect(r.applied).toBe(false); expect(r.wallet).toBe(w);
  });
  it('a balance deduction persists the subset clamp, so a later paid credit cannot restore it', () => {
    const w = grant(empty, 100);
    const reversed = { ...w, ...mirroredCreditPatch(w, -100, 'paid') };
    expect(adminBuildRemaining(reversed)).toBe(0);
    const topped = { ...reversed, ...mirroredCreditPatch(reversed, 100, 'paid') };
    expect(adminBuildRemaining(topped)).toBe(0);
    expect(paidSpendableTokens(topped)).toBe(100);
  });
  it('shows only explicitly attributed admin movements, not paused ordinary gift history', () => {
    const w = { ...grant(empty, 100), walletLedger: [
      { type: 'purchase', amountCoinsOrTokens: 4000, description: 'Old promotion' },
      { type: 'admin_adjustment', amountCoinsOrTokens: 100, adminBuildTokensDelta: 100, description: 'Build credit' },
    ] };
    const view = maskWalletForView(w, true);
    expect(view.walletLedger).toEqual([w.walletLedger[1]]);
    expect(view.ledgerOpeningTokens).toBeUndefined();
  });
});

describe('merging explicit grants preserves settled money and source of funds', () => {
  it('does not subtract already-consumed admin tokens twice', async () => {
    const { mergeWallets } = await import('../src/server/lib/accountMerge');
    setFreeProgramPausedHint(true);
    const granted = grant(empty, 1_000);
    const used = computeDebitedWallet(granted, { feature: 'build', adminCreditEligible: true, billedInr: 2, buildRef: 'before-merge', description: 'App building' }, NOW).wallet;
    const other = { ...empty, tokenBalance: 500, remaining_balance: 5, totalTokensPurchased: 500, totalMoneySpent: 5 };
    const merged = mergeWallets(used, other, NOW).wallet;
    expect(merged.tokenBalance).toBe(1_300);
    expect(adminBuildRemaining(merged)).toBe(800);
    expect(paidSpendableTokens(merged)).toBe(500);
  });
  it('does not resurrect a reversed balance from lifetime purchase counters, and debt carries', async () => {
    const { mergeWallets } = await import('../src/server/lib/accountMerge');
    const granted = grant(empty, 1_000);
    const refunded = { ...empty, tokenBalance: 0, remaining_balance: 0, totalTokensPurchased: 500, totalMoneySpent: 5 };
    expect(mergeWallets(granted, refunded, NOW).wallet.tokenBalance).toBe(1_000);
    const debt = { ...empty, tokenBalance: -200, remaining_balance: -2, totalTokensUsed: 200 };
    const merged = mergeWallets(granted, debt, NOW).wallet;
    expect(merged.tokenBalance).toBe(800);
    expect(adminBuildRemaining(merged)).toBe(800);
  });
});

it('a projected short history reports unknown, never a fabricated reconciliation', async () => {
  const { buildWalletStatement } = await import('../src/server/lib/walletStatement');
  const w = { ...grant(empty, 100_000), ledgerOpeningTokens: 0, walletLedger: [
    { type: 'usage', amountCoinsOrTokens: -100, adminBuildTokensDelta: -100, description: 'App building' },
  ] };
  const view = maskWalletForView(w, true);
  expect(buildWalletStatement(view).verdict).toBe('unknown');
  expect(buildWalletStatement(view).notes.join(' ')).toContain('admin-credit movements');
});

it('tracked merge arithmetic equals the legacy welcome policy on consistent wallets', async () => {
  const { mergeWallets } = await import('../src/server/lib/accountMerge');
  const { welcomeBonusTokens } = await import('../src/server/lib/payments');
  const welcome = welcomeBonusTokens();
  const make = (paid: number, used: number, hasWelcome: boolean) => ({
    tokenBalance: paid + (hasWelcome ? welcome : 0) - used,
    totalTokensPurchased: paid + (hasWelcome ? welcome : 0), totalTokensUsed: used,
    remaining_balance: (paid + (hasWelcome ? welcome : 0) - used) / 100,
    totalMoneySpent: paid / 100,
    walletLedger: hasWelcome ? [{ type: 'purchase', description: 'Welcome Bonus: credited', amountCoinsOrTokens: welcome }] : [],
  });
  for (const aWelcome of [false, true]) for (const bWelcome of [false, true]) {
    for (const aPaid of [0, 100, 50_000]) for (const bPaid of [0, 500, 60_000]) {
      for (const aUsed of [0, 100, 100_000]) for (const bUsed of [0, 1000, 120_000]) {
        const a = make(aPaid, aUsed, aWelcome); const b = make(bPaid, bUsed, bWelcome);
        const legacy = mergeWallets(a, b, NOW).wallet;
        const tracked = mergeWallets({ ...a, adminBuildTokensRemaining: 0 }, b, NOW).wallet;
        expect(tracked.tokenBalance).toBe(legacy.tokenBalance);
        expect(tracked.remaining_balance).toBe(legacy.remaining_balance);
        expect(tracked.adminBuildTokensRemaining).toBe(0);
        expect(tracked.giftTokensRemaining).toBeGreaterThanOrEqual(0);
        expect(tracked.giftTokensRemaining).toBeLessThanOrEqual(Math.max(0, tracked.tokenBalance));
      }
    }
  }
});

it('fractional holds fail closed on tracked wallets without minting purchased funds; integer holds retain usage', () => {
  setFreeProgramPausedHint(false);
  const w = grant({ ...empty, tokenBalance: 1, remaining_balance: 0.01, totalMoneySpent: 0.01 }, 100);
  const fractional = { feature: 'image' as const, billedInr: 0.005, rollupRef: 'image-bucket', description: 'Image', allOrNothing: true, floorInr: 0, holdId: 'half-token' };
  const blocked = computeRolledUpDebit(w, fractional, NOW);
  expect(blocked.refusalReason).toBe('fractional-hold-provenance');
  expect(blocked.applied).toBe(false); expect(blocked.wallet).toBe(w);
  const held = computeRolledUpDebit(w, { ...fractional, billedInr: 0.01, holdId: 'whole-token' }, NOW);
  expect(held.applied).toBe(true);
  expect(adminBuildRemaining(held.wallet)).toBe(100);
  const released = computeRolledUpRelease(held.wallet, { rollupRef: 'image-bucket', holdId: 'whole-token', description: 'Image' }, NOW);
  expect(released.wallet.tokenBalance).toBe(101);
  expect(adminBuildRemaining(released.wallet)).toBe(100);
  expect(paidSpendableTokens(released.wallet)).toBe(1);
});

it.each([false, true])('a fractional purchase never uses admin credit via build carry (purchase first=%s)', (purchaseFirst) => {
  setFreeProgramPausedHint(true);
  const w = grant({ ...empty, tokenBalance: 1, remaining_balance: 0.01, totalMoneySpent: 0.01 }, 100);
  const buy = { feature: 'hosting-plan' as const, spends: 'paid-only' as const, billedInr: 0.005, buildRef: 'fractional-buy', description: 'Purchase' };
  const build = { feature: 'build' as const, adminCreditEligible: true, billedInr: 0.005, buildRef: 'fractional-build', description: 'App building' };
  const first = computeDebitedWallet(w, purchaseFirst ? buy : build, NOW).wallet;
  const second = computeDebitedWallet(first, purchaseFirst ? build : buy, NOW).wallet;
  // Neither independent half-token liability has reached a whole token yet. Their sources cannot
  // cross just because the two operations happened next to one another.
  expect(adminBuildRemaining(second)).toBe(100);
  expect(paidSpendableTokens(second)).toBe(1);
});

it.each([false, true])('Normal/Strong settlement never spends typed admin credits (paused=%s)', (paused) => {
  setFreeProgramPausedHint(paused);
  const ordinary = { ...empty, ...mirroredCreditPatch(empty, 100, 'gift') };
  const w = grant({ ...ordinary, tokenBalance: 201, remaining_balance: 2.01, totalMoneySpent: 1.01 }, 100);
  const r = computeDebitedWallet(w, { feature: 'build', adminCreditEligible: false, billedInr: 10, floorInr: 0, buildRef: 'normal', description: 'Normal build' }, NOW);
  expect(adminBuildRemaining(r.wallet)).toBe(100);
  expect(r.tokensDebited).toBe(paused ? 101 : 201);
  expect(r.absorbedInr).toBeGreaterThan(0);
});

it('purpose carry conserves mixed direct and rollup liabilities without using admin for cash-only work', () => {
  setFreeProgramPausedHint(true);
  let w: Record<string, any> = grant({ ...empty, tokenBalance: 2, remaining_balance: 0.02, totalMoneySpent: 0.02 }, 100);
  const buy = (id: string) => ({ feature: 'hosting-plan' as const, spends: 'paid-only' as const, billedInr: 0.005, buildRef: id, description: 'Purchase' });
  const build = (id: string) => ({ feature: 'build' as const, adminCreditEligible: true, billedInr: 0.005, floorInr: 0, buildRef: id, description: 'Weak build' });
  w = computeDebitedWallet(w, buy('p1'), NOW).wallet;
  w = computeDebitedWallet(w, build('b1'), NOW).wallet;
  expect(w.tokenCarry).toBe(1);
  w = computeRolledUpDebit(w, { feature: 'doctor', billedInr: 0.005, floorInr: 0, rollupRef: 'ordinary', description: 'Ordinary usage' }, NOW).wallet;
  expect(paidSpendableTokens(w)).toBe(1); expect(adminBuildRemaining(w)).toBe(100);
  w = computeDebitedWallet(w, build('b2'), NOW).wallet;
  expect(paidSpendableTokens(w)).toBe(1); expect(adminBuildRemaining(w)).toBe(99);
  expect(w.tokenCarry).toBe(0);
  const before = w;
  const refused = computeDebitedWallet(w, { ...buy('unfunded'), billedInr: 0.02 }, NOW);
  expect(refused.refused).toBe(true); expect(refused.applied).toBe(false); expect(refused.wallet).toBe(before);
});

it('ordinary resumed carry cannot move into Weak admin spending', () => {
  setFreeProgramPausedHint(false);
  const ordinary = { ...empty, ...mirroredCreditPatch(empty, 1, 'gift') };
  let w: Record<string, any> = grant(ordinary, 100);
  w = computeDebitedWallet(w, { feature: 'build', billedInr: 0.005, floorInr: 0, buildRef: 'normal-half', description: 'Normal' }, NOW).wallet;
  w = computeDebitedWallet(w, { feature: 'build', adminCreditEligible: true, billedInr: 0.005, floorInr: 0, buildRef: 'weak-half', description: 'Weak' }, NOW).wallet;
  expect(w.ordinaryGiftTokenCarry).toBe(0.5); expect(w.adminEligibleTokenCarry).toBe(0.5);
  expect(w.tokenBalance).toBe(101); expect(adminBuildRemaining(w)).toBe(100);
});

it('merge preserves 0.75 + 0.75 carry, caps payment to eligible funds, and retains unpaid tail', async () => {
  const { mergeWallets } = await import('../src/server/lib/accountMerge');
  setFreeProgramPausedHint(true);
  const a = { ...grant(empty, 100), tokenCarry: 0.75 };
  const b = { ...empty, tokenBalance: 1, remaining_balance: 0.01, totalMoneySpent: 0.01, tokenCarry: 0.75 };
  const merged = mergeWallets(a, b, NOW).wallet;
  expect(merged.tokenCarry).toBe(1.5); expect(merged.cashRequiredTokenCarry).toBe(1.5);
  const beforeObligation = merged.tokenBalance - merged.tokenCarry;
  const r = computeDebitedWallet(merged, { feature: 'hosting-plan', spends: 'paid-only', billedInr: 0.005, buildRef: 'pay-tail', description: 'Purchase' }, NOW);
  expect(r.applied).toBe(true); expect(r.tokensDebited).toBe(1); expect(r.debitedInr).toBe(0.01);
  expect(r.wallet.tokenCarry).toBe(1); expect(adminBuildRemaining(r.wallet)).toBe(100);
  expect(r.wallet.tokenBalance - r.wallet.tokenCarry).toBe(beforeObligation - 0.5);
  const blocked = computeDebitedWallet(r.wallet, { feature: 'hosting-plan', spends: 'paid-only', billedInr: 0.005, buildRef: 'no-paid', description: 'Purchase' }, NOW);
  expect(blocked.refused).toBe(true); expect(blocked.wallet).toBe(r.wallet);
});

it('integer hold/release is exact and carry-neutral even when merged liabilities exceed one', async () => {
  const { mergeWallets } = await import('../src/server/lib/accountMerge');
  setFreeProgramPausedHint(false);
  const w = { ...grant({ ...empty, tokenBalance: 2, remaining_balance: 0.02, totalMoneySpent: 0.02 }, 100), cashRequiredTokenCarry: 1.5, ordinaryGiftTokenCarry: 0.75, adminEligibleTokenCarry: 0.25, tokenCarry: 2.5 };
  const held = computeRolledUpDebit(w, { feature: 'image', billedInr: 0.01, rollupRef: 'hold', holdId: 'integer', allOrNothing: true, floorInr: 0, description: 'Image' }, NOW);
  expect(held.tokensDebited).toBe(1); expect(held.wallet.tokenCarry).toBe(2.5);
  expect(() => mergeWallets(held.wallet, empty, NOW)).toThrow('pending wallet reservations');
  const released = computeRolledUpRelease(held.wallet, { rollupRef: 'hold', holdId: 'integer', description: 'Image' }, NOW);
  expect(released.tokensReturned).toBe(1); expect(released.wallet.tokenBalance).toBe(w.tokenBalance);
  expect(released.wallet.tokenCarry).toBe(2.5); expect(adminBuildRemaining(released.wallet)).toBe(100);
  expect(computeRolledUpRelease(released.wallet, { rollupRef: 'hold', holdId: 'integer', description: 'Image' }, NOW).applied).toBe(false);
});

it('first admin provenance activation refuses outstanding legacy holds instead of rewriting their refund model', () => {
  setFreeProgramPausedHint(false);
  const old = { ...empty, ...mirroredCreditPatch(empty, 100, 'gift') };
  const held = computeRolledUpDebit(old, { feature: 'image', billedInr: 0.005, holdId: 'legacy-half', rollupRef: 'legacy', allOrNothing: true, floorInr: 0, description: 'Image' }, NOW);
  expect(held.applied).toBe(true);
  expect(() => grant(held.wallet, 100)).toThrow('Finish pending wallet reservations');
  const released = computeRolledUpRelease(held.wallet, { holdId: 'legacy-half', rollupRef: 'legacy', description: 'Image' }, NOW);
  expect(adminBuildRemaining(grant(released.wallet, 100))).toBe(100);
});
