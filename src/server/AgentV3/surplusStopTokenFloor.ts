/**
 * OWNER-APPROVED (2026-11-11) token-floor estimate for one narrow billing leak (BR2279).
 *
 * 🔴 THE LEAK. When Surplus receipts cannot be settled, `decideBuildBilledUsd` absorbs that spend at
 * ₹0 (#4026) and refuses to invent a cost. A user who then STOPS a Weak/Surplus build after their
 * own files were written, with no proven running preview, should have been charged at real cost
 * (`cancelledBuildBilling` "files-saved" / at-cost). With the decided bill already $0, the stop
 * rule cannot invent a charge — so ~13 minutes and 26 files of Surplus work were free.
 *
 * 🔑 THE EXCEPTION. This module may apply a FLOOR estimate, at real cost with no markup and no
 * sandbox fee, only when every gate below holds. It prices the report's real token counts at the
 * cheapest published rate among Surplus-universe models that have a defensible card in
 * `providerRates.ts`. Cache-read tokens are billed at that card's cache rate, or not at all if
 * the card has no cache line. The estimate is capped at 10× itself (the verified Surplus policy
 * is 10× actual). Missing or zero tokens stay ₹0, exactly as today.
 *
 * ⚠️ DEFAULT ON, KILL SWITCH OFF. `AGENTV3_BILL_SURPLUS_STOP_TOKEN_FLOOR` unset/empty means ON;
 * an explicit `off` restores the #4026 ₹0 absorb with no estimate. Owner t338u, 2026-11-11.
 *
 * PURE over the facts it is given (the flag is read at call time). No I/O.
 */

import { SURPLUS_OBSERVATION_CANDIDATES } from '../AI/SurplusRegistry/config';
import { envFlag, parseEnvFlag } from '../lib/envFlag';
import { realRateCard } from './providerRates';
import type { BilledUsage, TokenRate } from './pricing';
import { builderWrittenCount } from './gameKitSeed';
import { preseededUnchangedCount } from './cancelledBuildBilling';
import { zeroBillReasonFor } from './zeroBillReason';

export const SURPLUS_STOP_TOKEN_FLOOR_FLAG = 'AGENTV3_BILL_SURPLUS_STOP_TOKEN_FLOOR';

/** The verified Surplus receipt policy charges 10× actual (`receiptPolicy.ts`, admin 2026-10-30). */
export const SURPLUS_VERIFIED_POLICY_MULTIPLIER = 10;

/** Unset, empty, or an unrecognised typo ⇒ ON. Only an explicit off/false/0 disables it. */
export function isSurplusStopTokenFloorOn(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env === process.env) return envFlag(SURPLUS_STOP_TOKEN_FLOOR_FLAG, true);
  return parseEnvFlag(env[SURPLUS_STOP_TOKEN_FLOOR_FLAG]) ?? true;
}

export function roundUsd(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function isFreeOrEmptyRate(rate: TokenRate): boolean {
  return !(rate.inputPerMTok > 0) && !(rate.outputPerMTok > 0);
}

/**
 * Price tokens at a published card. Cache-read is billed at the card's cache rate, or omitted
 * entirely when the card has no cache line — we do not fall back to the full input rate.
 * Cache-write, when present, is a share of input and uses its own line or the input rate
 * (the owner brief only special-cased cache-read).
 */
export function tokenFloorCostUsd(usage: BilledUsage, rate: TokenRate): number {
  const input = Math.max(0, usage.inputTokens || 0);
  const read = Math.min(input, Math.max(0, usage.cacheReadInputTokens ?? 0));
  const write = Math.min(input - read, Math.max(0, usage.cacheCreationInputTokens ?? 0));
  const cacheRate = typeof rate.cacheReadPerMTok === 'number' && Number.isFinite(rate.cacheReadPerMTok)
    ? rate.cacheReadPerMTok
    : 0;
  const writeRate = typeof rate.cacheWritePerMTok === 'number' && Number.isFinite(rate.cacheWritePerMTok)
    ? rate.cacheWritePerMTok
    : rate.inputPerMTok;
  return (
    ((input - read - write) / 1_000_000) * rate.inputPerMTok +
    (read / 1_000_000) * cacheRate +
    (write / 1_000_000) * writeRate +
    (Math.max(0, usage.outputTokens || 0) / 1_000_000) * rate.outputPerMTok
  );
}

/**
 * A defensible published rate for a Surplus-universe model id, or null when this repo has no
 * card we are willing to use. Unknown DeepSeek SKUs are deliberately NOT given the verified
 * `deepseek-flash` line (`realRateFor` refuses that inheritance). Qwen, MiniMax and GPT-5.6
 * have no published card here.
 */
export function publishedRateForSurplusModel(model: string): { model: string; rate: TokenRate } | null {
  const m = String(model ?? '').toLowerCase();
  if (!m) return null;
  const card = realRateCard();
  // 5.3-flash BEFORE the generic 5.x family: "flash" in the name is not the flagship price.
  if (/glm-?5[.\-]?3.*flash/.test(m) || m === 'glm-5.3-flash') {
    return { model: 'glm-5.3-flash', rate: card['glm-5.3-flash'] };
  }
  if (/glm-?5/.test(m)) return { model: 'glm-5', rate: card['glm-5'] };
  if (m.includes('sonnet')) return { model: 'sonnet', rate: card.sonnet };
  return null;
}

export interface SurplusFloorRatePick {
  model: string;
  candidate: string;
  rate: TokenRate;
  usd: number;
  fallback: boolean;
}

/**
 * The cheapest published rate among Surplus observation candidates that have a defensible card.
 * If none do, the lowest verified positive rate in `providerRates` for a comparable open model
 * (never the $0 flash promotional line).
 */
export function cheapestPublishedSurplusRate(usage: BilledUsage): SurplusFloorRatePick | null {
  let best: SurplusFloorRatePick | null = null;
  const consider = (candidate: string, model: string, rate: TokenRate, fallback: boolean) => {
    if (isFreeOrEmptyRate(rate)) return;
    const usd = tokenFloorCostUsd(usage, rate);
    if (!Number.isFinite(usd) || usd < 0) return;
    if (!best || usd < best.usd) best = { model, candidate, rate, usd, fallback };
  };
  for (const candidate of SURPLUS_OBSERVATION_CANDIDATES) {
    const pub = publishedRateForSurplusModel(candidate);
    if (pub) consider(candidate, pub.model, pub.rate, false);
  }
  if (best) return best;
  for (const [name, rate] of Object.entries(realRateCard())) {
    consider(name, name, rate, true);
  }
  return best;
}

/** Sum token counts recorded on Surplus ledger entries. Cache shares stay shares of input. */
export function surplusTokenUsageFromLedger(entries: ReadonlyArray<{ provider: string; usage: BilledUsage }>): BilledUsage {
  const usage: BilledUsage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
  for (const e of entries) {
    if ((e.provider ?? '').toUpperCase() !== 'SURPLUS') continue;
    usage.inputTokens += Math.max(0, e.usage.inputTokens || 0);
    usage.outputTokens += Math.max(0, e.usage.outputTokens || 0);
    usage.cacheReadInputTokens = (usage.cacheReadInputTokens ?? 0) + Math.max(0, e.usage.cacheReadInputTokens ?? 0);
    usage.cacheCreationInputTokens = (usage.cacheCreationInputTokens ?? 0) + Math.max(0, e.usage.cacheCreationInputTokens ?? 0);
  }
  return usage;
}

export function hasRealTokenCounts(usage: BilledUsage | null | undefined): boolean {
  if (!usage) return false;
  return Math.max(0, usage.inputTokens || 0) > 0 || Math.max(0, usage.outputTokens || 0) > 0;
}

export interface SurplusStopTokenFloorFacts {
  /** Override for tests; default reads the kill switch (ON when unset). */
  enabled?: boolean;
  powerLevel: string | null | undefined;
  surplusUnsettledAbsorbed: boolean;
  abortCause: string;
  /** Files the user is holding that are not the untouched platform template. */
  builderWroteCount: number;
  previewProven: boolean;
  freeListed: boolean;
  usage: BilledUsage;
  /**
   * A prior zeroing rule already explained this ₹0 bill (empty build, unrendered preview, …).
   * The floor must not override those paths.
   */
  alreadyZeroedReason?: string | null;
  /** Unverified edits of an existing app stay free under the stop rules. */
  editingExistingApp?: boolean;
}

export interface SurplusStopTokenFloorDecision {
  usd: number;
  ceilingUsd: number;
  usage: BilledUsage;
  rateModel: string;
  candidate: string;
  rate: TokenRate;
  fallback: boolean;
}

export function maybeApplySurplusStopTokenFloor(
  facts: SurplusStopTokenFloorFacts,
  env: NodeJS.ProcessEnv = process.env,
): SurplusStopTokenFloorDecision | null {
  const enabled = facts.enabled ?? isSurplusStopTokenFloorOn(env);
  if (!enabled) return null;
  if (String(facts.powerLevel ?? '') !== 'weak') return null;
  if (facts.surplusUnsettledAbsorbed !== true) return null;
  if (facts.abortCause !== 'user-stop') return null;
  if (!(facts.builderWroteCount > 0)) return null;
  if (facts.previewProven === true) return null;
  if (facts.freeListed === true) return null;
  if (facts.editingExistingApp === true) return null;
  if (String(facts.alreadyZeroedReason ?? '').trim()) return null;
  if (!hasRealTokenCounts(facts.usage)) return null;
  const pick = cheapestPublishedSurplusRate(facts.usage);
  if (!pick || !(pick.usd > 0)) return null;
  const usd = roundUsd(pick.usd);
  const ceilingUsd = roundUsd(pick.usd * SURPLUS_VERIFIED_POLICY_MULTIPLIER);
  const charged = roundUsd(Math.min(usd, ceilingUsd));
  if (!(charged > 0)) return null;
  return {
    usd: charged,
    ceilingUsd,
    usage: {
      inputTokens: Math.max(0, facts.usage.inputTokens || 0),
      outputTokens: Math.max(0, facts.usage.outputTokens || 0),
      cacheReadInputTokens: Math.max(0, facts.usage.cacheReadInputTokens ?? 0),
      cacheCreationInputTokens: Math.max(0, facts.usage.cacheCreationInputTokens ?? 0),
    },
    rateModel: pick.model,
    candidate: pick.candidate,
    rate: pick.rate,
    fallback: pick.fallback,
  };
}

/** Admin-only diagnostic. Names the rate and the tokens; never shown to an end user. */
export function surplusStopTokenFloorAdminMessage(d: SurplusStopTokenFloorDecision): string {
  const u = d.usage;
  return (
    `Estimated Surplus stop charge from recorded token counts (receipts unsettled): `
    + `$${d.usd.toFixed(6)} at ${d.rateModel} `
    + `(in $${d.rate.inputPerMTok}/M, out $${d.rate.outputPerMTok}/M`
    + (typeof d.rate.cacheReadPerMTok === 'number' ? `, cache $${d.rate.cacheReadPerMTok}/M` : ', cache not billed')
    + `) · tokens input=${u.inputTokens} output=${u.outputTokens} cacheRead=${u.cacheReadInputTokens ?? 0}`
    + (d.fallback ? ' · fallback open-model rate' : '')
    + ` · capped at 10× estimated actual ($${d.ceilingUsd.toFixed(6)}). No sandbox fee, no markup.`
  );
}

export const SURPLUS_STOP_COST_ESTIMATED = 'SURPLUS_STOP_COST_ESTIMATED';

/** Same wording the normal settle writes when `zeroBillForUnrenderedPreview` fires (including a dead preview server). */
export const UNRENDERED_PREVIEW_ZERO_REASON =
  'preview did not render on verification — "preview is EARNED", so free';

/**
 * Files the user is holding that are the builder's work, not our untouched starter and not an
 * unchanged game-kit seed. Seed-only and kit-only are 0, so neither settle point can invent a
 * floor estimate (or log SURPLUS_STOP_COST_ESTIMATED) for them.
 */
export function surplusStopOwnFileCount(
  written: ReadonlyMap<string, string>,
  kitSeeded: ReadonlyMap<string, string> | null | undefined,
  preseededGolden: Iterable<[string, string]> | null | undefined,
): number {
  const builderWrote = builderWrittenCount(written, kitSeeded ?? new Map());
  return Math.max(0, builderWrote - preseededUnchangedCount(preseededGolden, written));
}

/** Empty-build and unrendered / server-down preview reasons, matching the normal settle. */
export function surplusStopAlreadyZeroedReason(input: {
  expectsArtifacts: boolean;
  /** `builderWrittenCount` (kit-unchanged excluded), NOT the seed-only subtraction. */
  builderWroteCount: number;
  previewVerifiedFailed: boolean;
  emptyBuildOk?: boolean;
  stoppedByUser?: boolean;
}): string | undefined {
  if (input.expectsArtifacts && input.builderWroteCount === 0) {
    return zeroBillReasonFor({
      ok: input.emptyBuildOk === true,
      stoppedByUser: input.stoppedByUser === true,
    });
  }
  if (input.expectsArtifacts && input.previewVerifiedFailed === true) {
    return UNRENDERED_PREVIEW_ZERO_REASON;
  }
  return undefined;
}

export interface SurplusStopSettleFacts {
  powerLevel: string | null | undefined;
  surplusUnsettledAbsorbed: boolean;
  abortCause: string;
  writtenFiles: ReadonlyMap<string, string>;
  kitSeededFiles?: ReadonlyMap<string, string> | null;
  preseededGolden?: Iterable<[string, string]> | null;
  previewProven: boolean;
  freeListed: boolean;
  usage: BilledUsage;
  editingExistingApp?: boolean;
  expectsArtifacts: boolean;
  /** The server's own preview verification failed, including a dead preview server (ok may still be true). */
  previewVerifiedFailed: boolean;
  /** `result.ok` / deadline-finalizer `ok` — only used to word the empty-build reason. */
  emptyBuildOk?: boolean;
  stoppedByUser?: boolean;
  enabled?: boolean;
}

/**
 * THE ONE FLOOR DECISION for both billing points. Own-file count, empty-build and
 * unrendered / server-down preview zeroing are computed here, so the deadline finalizer
 * cannot invent a charge the normal settle would have already zeroed.
 */
export function decideSurplusStopTokenFloor(
  facts: SurplusStopSettleFacts,
  env: NodeJS.ProcessEnv = process.env,
): SurplusStopTokenFloorDecision | null {
  const builderWrote = builderWrittenCount(facts.writtenFiles, facts.kitSeededFiles ?? new Map());
  return maybeApplySurplusStopTokenFloor({
    enabled: facts.enabled,
    powerLevel: facts.powerLevel,
    surplusUnsettledAbsorbed: facts.surplusUnsettledAbsorbed,
    abortCause: facts.abortCause,
    builderWroteCount: surplusStopOwnFileCount(facts.writtenFiles, facts.kitSeededFiles, facts.preseededGolden),
    previewProven: facts.previewProven,
    freeListed: facts.freeListed,
    usage: facts.usage,
    alreadyZeroedReason: surplusStopAlreadyZeroedReason({
      expectsArtifacts: facts.expectsArtifacts,
      builderWroteCount: builderWrote,
      previewVerifiedFailed: facts.previewVerifiedFailed,
      emptyBuildOk: facts.emptyBuildOk,
      stoppedByUser: facts.stoppedByUser,
    }),
    editingExistingApp: facts.editingExistingApp,
  }, env);
}
