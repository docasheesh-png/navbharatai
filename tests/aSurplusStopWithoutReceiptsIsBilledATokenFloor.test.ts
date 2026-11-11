/**
 * BR2279 / owner 2026-11-11: when Surplus receipts cannot be settled, a Weak user-stop with
 * builder-written files and no proven preview is billed a FLOOR estimate from recorded tokens,
 * at real cost, no markup, no sandbox fee. Default ON; AGENTV3_BILL_SURPLUS_STOP_TOKEN_FLOOR=off
 * is the kill switch.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeDebitedWallet, debitWalletForBuild } from '../src/server/lib/walletDebit';
import { TOKENS_PER_RUPEE } from '../src/server/lib/payments';
import { buildBillingLabel, CHEAP_TIER_LABEL } from '../src/server/AgentV3/buildBillingLabel';
import { realRateCard } from '../src/server/AgentV3/providerRates';
import { decideCancelledBuildBill } from '../src/server/AgentV3/cancelledBuildBilling';
import {
  SURPLUS_STOP_TOKEN_FLOOR_FLAG,
  SURPLUS_VERIFIED_POLICY_MULTIPLIER,
  SURPLUS_STOP_COST_ESTIMATED,
  cheapestPublishedSurplusRate,
  hasRealTokenCounts,
  isSurplusStopTokenFloorOn,
  maybeApplySurplusStopTokenFloor,
  publishedRateForSurplusModel,
  surplusStopTokenFloorAdminMessage,
  surplusTokenUsageFromLedger,
  tokenFloorCostUsd,
  type SurplusStopTokenFloorFacts,
} from '../src/server/AgentV3/surplusStopTokenFloor';

/** Tokens recorded on BR2279 (build 82f2651a-…): providerTokens.SURPLUS + cacheReadInputTokens. */
export const BR2279_TOKENS = {
  inputTokens: 2_067_275,
  outputTokens: 21_031,
  cacheReadInputTokens: 1_344_752,
};

const FLAG = SURPLUS_STOP_TOKEN_FLOOR_FLAG;

const BASE: SurplusStopTokenFloorFacts = {
  powerLevel: 'weak',
  surplusUnsettledAbsorbed: true,
  abortCause: 'user-stop',
  builderWroteCount: 26,
  previewProven: false,
  freeListed: false,
  usage: BR2279_TOKENS,
};

afterEach(() => {
  delete process.env[FLAG];
});

function expectedBr2279Usd(): number {
  const pick = cheapestPublishedSurplusRate(BR2279_TOKENS);
  if (!pick) throw new Error('no rate');
  return Math.round(Math.min(pick.usd, pick.usd * SURPLUS_VERIFIED_POLICY_MULTIPLIER) * 1e6) / 1e6;
}

describe('the kill switch — default ON, explicit off restores ₹0', () => {
  it('unset, empty, and a typo all mean ON', () => {
    delete process.env[FLAG];
    expect(isSurplusStopTokenFloorOn()).toBe(true);
    expect(isSurplusStopTokenFloorOn({ ...process.env, [FLAG]: undefined })).toBe(true);
    expect(isSurplusStopTokenFloorOn({ [FLAG]: '' })).toBe(true);
    expect(isSurplusStopTokenFloorOn({ [FLAG]: '  ' })).toBe(true);
    expect(isSurplusStopTokenFloorOn({ [FLAG]: 'ture' })).toBe(true);
    expect(maybeApplySurplusStopTokenFloor(BASE)?.usd).toBeGreaterThan(0);
  });

  it('explicit off / false / 0 disables the estimate — BR2279-shaped stays ₹0', () => {
    for (const v of ['off', 'OFF', 'false', '0', 'no', 'disable']) {
      expect(maybeApplySurplusStopTokenFloor(BASE, { [FLAG]: v })).toBeNull();
    }
    process.env[FLAG] = 'off';
    expect(isSurplusStopTokenFloorOn()).toBe(false);
    expect(maybeApplySurplusStopTokenFloor(BASE)).toBeNull();
  });

  it('explicit on / true keeps it on', () => {
    for (const v of ['on', 'true', '1', 'yes']) {
      expect(maybeApplySurplusStopTokenFloor(BASE, { [FLAG]: v })?.usd).toBeGreaterThan(0);
    }
  });
});

describe('BR2279-shaped fixture is charged a small at-cost estimate', () => {
  it('picks glm-5.3-flash, the cheapest defensible Surplus-universe card, and charges only that real cost', () => {
    const d = maybeApplySurplusStopTokenFloor(BASE);
    expect(d).not.toBeNull();
    expect(d!.rateModel).toBe('glm-5.3-flash');
    expect(d!.candidate).toBe('glm-5.3-flash');
    expect(d!.fallback).toBe(false);
    const flash = realRateCard()['glm-5.3-flash'];
    expect(d!.rate.inputPerMTok).toBe(flash.inputPerMTok);
    expect(d!.rate.outputPerMTok).toBe(flash.outputPerMTok);
    expect(d!.rate.cacheReadPerMTok).toBe(flash.cacheReadPerMTok);
    expect(d!.usd).toBe(expectedBr2279Usd());
    expect(d!.usd).toBeGreaterThan(0);
    expect(d!.usd).toBeLessThan(1); // a floor, not a 10× or markup bill
    // 10× would be the verified policy; stop is at cost, so we stay at 1×.
    expect(d!.usd).toBeLessThan(d!.ceilingUsd);
    expect(d!.usd * SURPLUS_VERIFIED_POLICY_MULTIPLIER).toBeCloseTo(d!.ceilingUsd, 5);
    // No markup (4× on the first dollar would be ~$0.64 if this were a normal Weak bill).
    expect(d!.usd).toBeCloseTo(tokenFloorCostUsd(BR2279_TOKENS, flash), 6);
  });

  it('the stop rules, given that floor as the decided and real cost, charge it in full at cost (files-saved, no preview)', () => {
    const d = maybeApplySurplusStopTokenFloor(BASE)!;
    const bill = decideCancelledBuildBill({
      abortCause: 'user-stop',
      filesWritten: 26,
      preseededUnchanged: 0,
      appRendered: false,
      decidedBilledUsd: d.usd,
      realCostUsd: d.usd,
      sandboxUsd: 0,
    });
    expect(bill.applies).toBe(true);
    expect(bill.delivery).toBe('files-saved');
    expect(bill.billedUsd).toBe(d.usd);
    expect(bill.userMessage).toBeTruthy();
  });

  it('the user-facing label says the charge is estimated', () => {
    const d = maybeApplySurplusStopTokenFloor(BASE)!;
    const inr = Math.round(d.usd * 85 * 100) / 100;
    const l = buildBillingLabel({
      freeListed: false,
      cheapEnginesOnly: true,
      billingActive: true,
      billedUsd: d.usd,
      billedInr: inr,
      walletDebited: true,
      estimated: true,
    });
    expect(l.charged).toBe(true);
    expect(l.userTier).toBe(`${CHEAP_TIER_LABEL} · charged ₹${inr.toFixed(2)} · estimated`);
    expect(l.userTier).toMatch(/estimated/);
  });

  it('the admin event names the tokens, the rate, and the estimate', () => {
    const d = maybeApplySurplusStopTokenFloor(BASE)!;
    const msg = surplusStopTokenFloorAdminMessage(d);
    expect(SURPLUS_STOP_COST_ESTIMATED).toBe('SURPLUS_STOP_COST_ESTIMATED');
    expect(msg).toContain(d.usd.toFixed(6));
    expect(msg).toContain('glm-5.3-flash');
    expect(msg).toContain(`input=${BR2279_TOKENS.inputTokens}`);
    expect(msg).toContain(`output=${BR2279_TOKENS.outputTokens}`);
    expect(msg).toContain(`cacheRead=${BR2279_TOKENS.cacheReadInputTokens}`);
    expect(msg).toMatch(/No sandbox fee, no markup/);
  });
});

describe('neighbours stay ₹0 or unchanged', () => {
  it('missing or zero tokens stay ₹0', () => {
    expect(hasRealTokenCounts({ inputTokens: 0, outputTokens: 0 })).toBe(false);
    expect(maybeApplySurplusStopTokenFloor({ ...BASE, usage: { inputTokens: 0, outputTokens: 0 } })).toBeNull();
    expect(maybeApplySurplusStopTokenFloor({ ...BASE, usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 } })).toBeNull();
  });

  it('an empty build (already zeroed, or 0 builder files) stays ₹0', () => {
    expect(maybeApplySurplusStopTokenFloor({ ...BASE, builderWroteCount: 0 })).toBeNull();
    expect(maybeApplySurplusStopTokenFloor({
      ...BASE,
      alreadyZeroedReason: 'empty build (0 files produced) — never charged',
    })).toBeNull();
  });

  it('a non-stop failure, watchdog, cap, or unexplained abort stays ₹0', () => {
    for (const cause of ['watchdog', 'advisory-cap', 'cost-cap', 'unknown', 'engine', 'reaper', 'deploy-drain']) {
      expect(maybeApplySurplusStopTokenFloor({ ...BASE, abortCause: cause })).toBeNull();
    }
  });

  it('a seen-running preview does not invent an estimate — the full-bill path is unchanged', () => {
    expect(maybeApplySurplusStopTokenFloor({ ...BASE, previewProven: true })).toBeNull();
  });

  it('a verified (settled) Surplus receipt is not rewritten', () => {
    expect(maybeApplySurplusStopTokenFloor({ ...BASE, surplusUnsettledAbsorbed: false })).toBeNull();
  });

  it('an admin/tester free-listed user stays ₹0', () => {
    expect(maybeApplySurplusStopTokenFloor({ ...BASE, freeListed: true })).toBeNull();
  });

  it('a non-Surplus / non-Weak tier is unchanged', () => {
    for (const powerLevel of ['off', 'mini', 'medium', 'max', '']) {
      expect(maybeApplySurplusStopTokenFloor({ ...BASE, powerLevel })).toBeNull();
    }
  });

  it('an unverified edit of an existing app stays free under the stop rules', () => {
    expect(maybeApplySurplusStopTokenFloor({ ...BASE, editingExistingApp: true })).toBeNull();
  });

  it('an unrendered-preview zeroing reason is not overridden', () => {
    expect(maybeApplySurplusStopTokenFloor({
      ...BASE,
      alreadyZeroedReason: 'preview did not render on verification — "preview is EARNED", so free',
    })).toBeNull();
  });
});

describe('the estimate is never above the verified policy and never a $0 flash line', () => {
  it('is <= 10× the same actual-cost estimate, for this fixture and a sweep of token mixes', () => {
    const mixes = [
      BR2279_TOKENS,
      { inputTokens: 1_000, outputTokens: 500, cacheReadInputTokens: 0 },
      { inputTokens: 50_000, outputTokens: 8_000, cacheReadInputTokens: 40_000 },
      { inputTokens: 10, outputTokens: 1, cacheReadInputTokens: 10 },
    ];
    for (const usage of mixes) {
      const d = maybeApplySurplusStopTokenFloor({ ...BASE, usage });
      expect(d).not.toBeNull();
      expect(d!.usd).toBeLessThanOrEqual(d!.ceilingUsd);
      expect(d!.usd).toBeLessThanOrEqual(d!.usd * SURPLUS_VERIFIED_POLICY_MULTIPLIER + 1e-12);
    }
  });

  it('is the cheapest of every Surplus-universe model that has a published card — never a dearer one, never free flash', () => {
    const d = maybeApplySurplusStopTokenFloor(BASE)!;
    const flash0 = realRateCard()['glm-flash'];
    expect(flash0.inputPerMTok).toBe(0);
    expect(d.rateModel).not.toBe('glm-flash');
    expect(d.usd).toBeGreaterThan(tokenFloorCostUsd(BR2279_TOKENS, flash0));
    const glm5 = publishedRateForSurplusModel('glm-5.3')!;
    const sonnet = publishedRateForSurplusModel('claude-sonnet-5')!;
    expect(d.usd).toBeLessThanOrEqual(tokenFloorCostUsd(BR2279_TOKENS, glm5.rate) + 1e-12);
    expect(d.usd).toBeLessThanOrEqual(tokenFloorCostUsd(BR2279_TOKENS, sonnet.rate) + 1e-12);
  });

  it('does not invent a DeepSeek rate for deepseek-v4.1-flash (the verified flash SKU is a different id)', () => {
    expect(publishedRateForSurplusModel('deepseek-v4.1-flash')).toBeNull();
    expect(publishedRateForSurplusModel('qwen3-coder')).toBeNull();
    expect(publishedRateForSurplusModel('minimax-m2.5')).toBeNull();
  });

  it('cache-read tokens are free when the chosen card has no cache line, not billed at the input rate', () => {
    const rate = { inputPerMTok: 1, outputPerMTok: 2 }; // no cacheReadPerMTok
    const withCache = tokenFloorCostUsd({ inputTokens: 1_000_000, outputTokens: 0, cacheReadInputTokens: 1_000_000 }, rate);
    const none = tokenFloorCostUsd({ inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 }, rate);
    expect(withCache).toBe(0);
    expect(none).toBe(0);
    const half = tokenFloorCostUsd({ inputTokens: 1_000_000, outputTokens: 0, cacheReadInputTokens: 500_000 }, rate);
    expect(half).toBe(0.5); // 500k fresh input at $1/M; 500k cache omitted
  });
});

describe('ledger tokens and wallet debit', () => {
  it('sums only Surplus entries, keeping cache as a share of input', () => {
    const usage = surplusTokenUsageFromLedger([
      { provider: 'SURPLUS', usage: { inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 40 } },
      { provider: 'SURPLUS', usage: { inputTokens: 50, outputTokens: 5, cacheReadInputTokens: 10 } },
      { provider: 'GLM', usage: { inputTokens: 9_999, outputTokens: 9_999, cacheReadInputTokens: 9_999 } },
    ]);
    expect(usage).toEqual({ inputTokens: 150, outputTokens: 15, cacheReadInputTokens: 50, cacheCreationInputTokens: 0 });
  });

  it('the same buildRef is debited once (idempotent), for the floor INR amount', async () => {
    const d = maybeApplySurplusStopTokenFloor(BASE)!;
    const billedInr = Math.round(d.usd * 85 * 100) / 100;
    const T = '2026-11-11T00:00:00.000Z';
    const funded = { tokenBalance: 10_000 * TOKENS_PER_RUPEE, totalTokensUsed: 0, remaining_balance: 10_000, walletLedger: [] };
    const tx = { billedInr, buildRef: 'br2279_floor_1', description: 'NavBharatAI Pro build' };
    const first = computeDebitedWallet(funded, tx, T);
    expect(first.tokensDebited).toBeGreaterThan(0);
    const again = computeDebitedWallet(first.wallet, tx, T);
    expect(again.tokensDebited).toBe(0);
    expect(again.wallet.tokenBalance).toBe(first.wallet.tokenBalance);
    expect(again.wallet.walletLedger).toHaveLength(1);

    const docs: Record<string, any> = {
      'user_token_wallets/u1': {
        userId: 'u1', tokenBalance: 10_000 * TOKENS_PER_RUPEE, totalTokensUsed: 0,
        remaining_balance: 10_000, walletLedger: [],
      },
    };
    const db = {
      doc: (path: string) => path,
      runTransaction: async (fn: any) => fn({
        get: async (ref: string) => ({ exists: !!docs[ref], data: () => docs[ref], id: ref, ref }),
        set: (ref: string, value: any) => { docs[ref] = value; },
        update: (ref: string, value: any) => { docs[ref] = { ...docs[ref], ...value }; },
        delete: (ref: string) => { delete docs[ref]; },
      }),
    } as any;
    const firstDb = await debitWalletForBuild(db, 'u1', tx);
    expect(firstDb.ok).toBe(true);
    expect(firstDb.tokensDebited).toBeGreaterThan(0);
    const againDb = await debitWalletForBuild(db, 'u1', tx);
    expect(againDb.ok).toBe(true);
    expect(againDb.tokensDebited).toBe(0);
    expect(againDb.tokenBalance).toBe(firstDb.tokenBalance);
  });
});

describe('the route and the docs carry the same rule at both billing points', () => {
  const root = join(__dirname, '..');
  const route = readFileSync(join(root, 'src/server/routes/agentv3.ts'), 'utf8');
  const routing = readFileSync(join(root, 'docs/claude/ROUTING_AND_BILLING.md'), 'utf8');
  const envDoc = readFileSync(join(root, 'docs/claude/ENV_REGISTRY.md'), 'utf8');

  it('both settle paths call maybeApplySurplusStopTokenFloor, so they cannot diverge', () => {
    const hits = route.split('maybeApplySurplusStopTokenFloor(').length - 1;
    expect(hits).toBeGreaterThanOrEqual(2);
    expect(route).toContain('SURPLUS_STOP_COST_ESTIMATED');
    expect(route).toContain('surplusUnsettledAbsorbed');
    expect(route).toContain('realCostEstimated');
  });

  it('#4026 still absorbs unverifiable Surplus at ₹0 inside decideBuildBilledUsd — the floor is applied later, only at stop', () => {
    expect(route).toContain("surplus = { chargeUsd: '0', actualUsd: '0', absorbedUsd: '0' }");
    expect(route).toContain('surplusUnsettledAbsorbed = true');
  });

  it('ROUTING_AND_BILLING records the owner-approved 2026-11-11 exception, and the flag is a default-ON kill switch', () => {
    expect(routing).toMatch(/2026-11-11/);
    expect(routing).toMatch(/token-floor estimate|token floor estimate|floor estimate/i);
    expect(routing).toContain(FLAG);
    expect(envDoc).toContain(FLAG);
    expect(envDoc).toMatch(/default ON/i);
    expect(envDoc).toMatch(/off/i);
  });
});
