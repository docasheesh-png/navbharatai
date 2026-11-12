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
  UNRENDERED_PREVIEW_ZERO_REASON,
  cheapestPublishedSurplusRate,
  decideSurplusStopTokenFloor,
  hasRealTokenCounts,
  isSurplusStopTokenFloorOn,
  maybeApplySurplusStopTokenFloor,
  publishedRateForSurplusModel,
  surplusStopAlreadyZeroedReason,
  surplusStopOwnFileCount,
  surplusStopTokenFloorAdminMessage,
  surplusTokenUsageFromLedger,
  tokenFloorCostUsd,
  type SurplusStopTokenFloorDecision,
  type SurplusStopTokenFloorFacts,
  type SurplusStopSettleFacts,
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

  it('both settle paths call the same decideSurplusStopTokenFloor helper with the same already-zeroed facts', () => {
    expect(route.split('decideSurplusStopTokenFloor(').length - 1).toBe(2);
    expect(route.split('maybeApplySurplusStopTokenFloor(').length - 1).toBe(0);
    expect(route).toContain('SURPLUS_STOP_COST_ESTIMATED');
    expect(route).toContain('surplusUnsettledAbsorbed');
    expect(route).toContain('realCostEstimated');
    expect(route).toContain('billingCtx.kitSeededFiles');
    expect(route).toContain('billingCtx.previewVerifiedFailed');
    // Each call site must pass the zeroing and own-file facts; a site that dropped them would drift.
    const calls = route.split('decideSurplusStopTokenFloor(').slice(1);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const body = call.slice(0, call.indexOf('});') + 3);
      expect(body).toMatch(/previewVerifiedFailed/);
      expect(body).toMatch(/expectsArtifacts/);
      expect(body).toMatch(/kitSeededFiles/);
      expect(body).toMatch(/preseededGolden/);
      expect(body).toMatch(/writtenFiles/);
    }
  });

  it('#4026 still absorbs unverifiable Surplus at ₹0 inside decideBuildBilledUsd — the floor is applied later, only at stop', () => {
    expect(route).toContain("surplus = { chargeUsd: '0', actualUsd: '0', absorbedUsd: '0' }");
    expect(route).toContain('surplusUnsettledAbsorbed = true');
  });

  it('ROUTING_AND_BILLING records the owner-approved 2026-11-11 exception, and the flag is a default-ON kill switch', () => {
    expect(routing).toMatch(/2026-11-11/);
    expect(routing).toMatch(/token-floor estimate|token floor estimate|floor estimate/i);
    expect(routing).toContain('decideSurplusStopTokenFloor');
    expect(routing).toMatch(/server-down/);
    expect(routing).toContain(FLAG);
    expect(envDoc).toContain(FLAG);
    expect(envDoc).toContain('decideSurplusStopTokenFloor');
    expect(envDoc).toMatch(/default ON/i);
    expect(envDoc).toMatch(/off/i);
    expect(envDoc).toMatch(/server-down|unrendered/);
  });
});

function mapOf(n: number, prefix: string, body = (i: number) => `${prefix}-${i}`): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < n; i++) m.set(`${prefix}${i}`, body(i));
  return m;
}

function world(over: Partial<SurplusStopSettleFacts> & { seedOnly?: boolean; kitOnly?: boolean } = {}): SurplusStopSettleFacts {
  const { seedOnly, kitOnly, ...facts } = over;
  let writtenFiles = facts.writtenFiles ?? mapOf(26, 'app');
  let preseededGolden = facts.preseededGolden ?? new Map<string, string>();
  let kitSeededFiles = facts.kitSeededFiles ?? new Map<string, string>();
  if (seedOnly) {
    writtenFiles = mapOf(12, 'seed');
    preseededGolden = new Map(writtenFiles);
  }
  if (kitOnly) {
    kitSeededFiles = mapOf(30, 'kit');
    writtenFiles = new Map(kitSeededFiles);
  }
  return {
    powerLevel: 'weak',
    surplusUnsettledAbsorbed: true,
    abortCause: 'user-stop',
    writtenFiles,
    kitSeededFiles,
    preseededGolden,
    previewProven: false,
    freeListed: false,
    usage: BR2279_TOKENS,
    editingExistingApp: false,
    expectsArtifacts: true,
    previewVerifiedFailed: false,
    emptyBuildOk: true,
    stoppedByUser: true,
    ...facts,
    writtenFiles: facts.writtenFiles ?? writtenFiles,
    kitSeededFiles: facts.kitSeededFiles ?? kitSeededFiles,
    preseededGolden: facts.preseededGolden ?? preseededGolden,
  };
}

/** How the normal settle reads the facts (locals in the route). */
function floorFromNormalSettle(w: SurplusStopSettleFacts, env?: NodeJS.ProcessEnv) {
  return decideSurplusStopTokenFloor({
    powerLevel: w.powerLevel,
    surplusUnsettledAbsorbed: w.surplusUnsettledAbsorbed,
    abortCause: w.abortCause,
    writtenFiles: w.writtenFiles,
    kitSeededFiles: w.kitSeededFiles,
    preseededGolden: w.preseededGolden,
    previewProven: w.previewProven,
    freeListed: w.freeListed,
    usage: w.usage,
    editingExistingApp: w.editingExistingApp,
    expectsArtifacts: w.expectsArtifacts,
    previewVerifiedFailed: w.previewVerifiedFailed,
    emptyBuildOk: w.emptyBuildOk,
    stoppedByUser: w.stoppedByUser,
  }, env);
}

/** How the deadline finalizer reads the same facts (via billingCtx copies). */
function floorFromFinalizer(w: SurplusStopSettleFacts, env?: NodeJS.ProcessEnv) {
  const billingCtx = {
    kitSeededFiles: w.kitSeededFiles,
    preseededGolden: w.preseededGolden,
    expectsArtifacts: w.expectsArtifacts,
    previewVerifiedFailed: w.previewVerifiedFailed,
  };
  return decideSurplusStopTokenFloor({
    powerLevel: w.powerLevel,
    surplusUnsettledAbsorbed: w.surplusUnsettledAbsorbed,
    abortCause: w.abortCause,
    writtenFiles: w.writtenFiles,
    kitSeededFiles: billingCtx.kitSeededFiles,
    preseededGolden: billingCtx.preseededGolden,
    previewProven: w.previewProven,
    freeListed: w.freeListed,
    usage: w.usage,
    editingExistingApp: w.editingExistingApp,
    expectsArtifacts: billingCtx.expectsArtifacts === true,
    previewVerifiedFailed: billingCtx.previewVerifiedFailed === true,
    emptyBuildOk: w.emptyBuildOk,
    stoppedByUser: w.abortCause === 'user-stop',
  }, env);
}

/** The review's bug: writtenFiles.size, no already-zeroed / previewVerifiedFailed facts. */
function floorFromBuggyFinalizer(w: SurplusStopSettleFacts, env?: NodeJS.ProcessEnv) {
  return maybeApplySurplusStopTokenFloor({
    powerLevel: w.powerLevel,
    surplusUnsettledAbsorbed: w.surplusUnsettledAbsorbed,
    abortCause: w.abortCause,
    builderWroteCount: w.writtenFiles.size,
    previewProven: w.previewProven,
    freeListed: w.freeListed,
    usage: w.usage,
    editingExistingApp: w.editingExistingApp,
  }, env);
}

function snapshot(d: SurplusStopTokenFloorDecision | null) {
  if (!d) return null;
  return { usd: d.usd, rateModel: d.rateModel, fallback: d.fallback, input: d.usage.inputTokens, output: d.usage.outputTokens };
}

function assertFloorParity(w: SurplusStopSettleFacts, env?: NodeJS.ProcessEnv) {
  expect(snapshot(floorFromFinalizer(w, env)), 'finalizer drifted from the normal settle').toEqual(snapshot(floorFromNormalSettle(w, env)));
}

describe('both settle points agree: server-down preview and seed-only must stay ₹0', () => {
  it('a server-down preview (previewVerifiedFailed, preview not proven, ok still true) is ₹0 at both points, and logs no estimate event', () => {
    const w = world({
      previewVerifiedFailed: true,
      previewProven: false,
      emptyBuildOk: true, // the review's race: verification failed, the build still ok
    });
    expect(w.writtenFiles.size).toBe(26);
    expect(surplusStopAlreadyZeroedReason({
      expectsArtifacts: true,
      builderWroteCount: 26,
      previewVerifiedFailed: true,
    })).toBe(UNRENDERED_PREVIEW_ZERO_REASON);
    expect(floorFromNormalSettle(w)).toBeNull();
    expect(floorFromFinalizer(w)).toBeNull();
    // A recorded event is only written when the helper returns a decision.
    expect(floorFromNormalSettle(w) && SURPLUS_STOP_COST_ESTIMATED).toBeFalsy();
    expect(floorFromFinalizer(w) && SURPLUS_STOP_COST_ESTIMATED).toBeFalsy();
  });

  it('the pre-fix finalizer would have charged the BR2279 floor for that server-down race', () => {
    const w = world({ previewVerifiedFailed: true, previewProven: false, emptyBuildOk: true });
    const leaked = floorFromBuggyFinalizer(w);
    expect(leaked).not.toBeNull();
    expect(leaked!.usd).toBeGreaterThan(0);
    expect(leaked!.usd).toBeCloseTo(0.159237, 6);
  });

  it('a seed-only stop (unchanged starter) is ₹0 and logs no SURPLUS_STOP_COST_ESTIMATED at both points', () => {
    const w = world({ seedOnly: true });
    expect(w.writtenFiles.size).toBe(12);
    expect(surplusStopOwnFileCount(w.writtenFiles, w.kitSeededFiles, w.preseededGolden)).toBe(0);
    expect(floorFromNormalSettle(w)).toBeNull();
    expect(floorFromFinalizer(w)).toBeNull();
    expect(floorFromNormalSettle(w) && SURPLUS_STOP_COST_ESTIMATED).toBeFalsy();
    expect(floorFromFinalizer(w) && SURPLUS_STOP_COST_ESTIMATED).toBeFalsy();
    // The pre-fix finalizer counted writtenFiles.size and would have logged the event.
    expect(floorFromBuggyFinalizer(w)).not.toBeNull();
  });

  it('kit-only (unchanged game-kit seed) is also 0 own files at both points', () => {
    const w = world({ kitOnly: true });
    expect(surplusStopOwnFileCount(w.writtenFiles, w.kitSeededFiles, w.preseededGolden)).toBe(0);
    expect(floorFromNormalSettle(w)).toBeNull();
    expect(floorFromFinalizer(w)).toBeNull();
  });
});

describe('parity: both settle points give identical floor decisions across the neighbour matrix', () => {
  const cases: Array<{ name: string; world: SurplusStopSettleFacts; env?: NodeJS.ProcessEnv }> = [
    { name: 'BR2279-shaped charge', world: world() },
    { name: 'server-down preview, ok true', world: world({ previewVerifiedFailed: true, emptyBuildOk: true }) },
    { name: 'seed-only starter', world: world({ seedOnly: true }) },
    { name: 'kit-only seed', world: world({ kitOnly: true }) },
    { name: 'empty written', world: world({ writtenFiles: new Map() }) },
    { name: 'missing tokens', world: world({ usage: { inputTokens: 0, outputTokens: 0 } }) },
    { name: 'non-stop watchdog', world: world({ abortCause: 'watchdog' }) },
    { name: 'seen-running preview', world: world({ previewProven: true }) },
    { name: 'verified receipt', world: world({ surplusUnsettledAbsorbed: false }) },
    { name: 'admin-free', world: world({ freeListed: true }) },
    { name: 'non-Weak', world: world({ powerLevel: 'off' }) },
    { name: 'unverified edit', world: world({ editingExistingApp: true }) },
    { name: 'explicit off', world: world(), env: { [FLAG]: 'off' } },
    { name: 'import turn, no artifacts expected', world: world({ expectsArtifacts: false, previewVerifiedFailed: true }) },
  ];

  it.each(cases)('$name', ({ world: w, env }) => {
    assertFloorParity(w, env);
  });

  it('a mutation that drops the finalizer already-zeroed facts fails this parity check', () => {
    const serverDown = world({ previewVerifiedFailed: true, emptyBuildOk: true });
    const seed = world({ seedOnly: true });
    expect(() => expect(snapshot(floorFromBuggyFinalizer(serverDown))).toEqual(snapshot(floorFromNormalSettle(serverDown)))).toThrow();
    expect(() => expect(snapshot(floorFromBuggyFinalizer(seed))).toEqual(snapshot(floorFromNormalSettle(seed)))).toThrow();
    // The fixed finalizer still matches.
    assertFloorParity(serverDown);
    assertFloorParity(seed);
  });
});
