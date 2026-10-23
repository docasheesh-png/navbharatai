// ONE shared daily $ cap for EVERY Free-tier paid rung that lives OUTSIDE the FreeChain module
// (admin 2026-10-23, "Free user par bewajah paisa").
//
// ROOT CAUSE this fixes: FreeChain's $10/day owner budget (`FreeChain/spendCap.ts`) only guarded
// FreeChain's own DeepSeek rung. The legacy `buildFree` ladder (flash-lite → gpt-5-nano → flash), the
// `professional-free-fallback` universe (Teacher AI, Lawyer, Design, Debug, App-debug …), Doctor AI /
// SDA's free path and the Free vision chain all reached PAID models with no daily ceiling at all.
//
// This module does not invent a second budget. It reserves against the SAME Firestore authority
// (`FreeChainStore.reservePaid` → `free_chat_chain/paid_day_<IST day>`), so FreeChain + every legacy
// Free paid rung share ONE owner-funded total, the same 50/80/100% admin alerts, and the same
// "stricter configuration wins" policy document.
//
// Fail-CLOSED: no Firestore, a malformed ledger, an unknown model price or an exhausted cap all DENY
// the paid call. The caller then falls through silently (next rung, or the busy line in the user's
// language) — never a raw error, never an unbudgeted bill.
import { randomUUID } from 'node:crypto';
import { FreeChainStore } from '../AI/FreeChain/store';
import { NANO_USD, OWNER_PAID_DAILY_CEILING_NANO_USD, DEFAULT_PAID_CAP_NANO_USD, maximumCostNanoUsd, type PaidReservation } from '../AI/FreeChain/spendCap';
import { realRateFor } from '../AgentV3/providerRates';
import type { AIProvider, AIProviderResponse } from '../AI/Router/ProviderTypes';

/** The surfaces whose Free-tier paid calls draw on the shared cap (telemetry only). */
export type FreeTierPaidSurface = 'free-chat' | 'professional-free-fallback' | 'sda-free' | 'vision-free';

/** Every model a Free-tier paid rung may ever bill. Anything else is refused BEFORE dispatch. */
export const FREE_TIER_PAID_MODEL_ALLOWLIST: readonly string[] = Object.freeze([
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gpt-5-nano',
]);

/** Dear families a Free path must never reach, whatever an env override says. */
export function isForbiddenOnFreeTier(model: string): boolean {
  const m = String(model ?? '').toLowerCase();
  return /grok|gemini-[\d.]+-pro|claude|opus|sonnet|gpt-5(?!-nano)|o[134]-/.test(m);
}

export function isFreeTierPaidModelAllowed(model: string): boolean {
  return FREE_TIER_PAID_MODEL_ALLOWLIST.includes(String(model ?? '').trim()) && !isForbiddenOnFreeTier(model);
}

/** `FREE_TIER_PAID_DAILY_CAP_USD`, default 10, clamped to the owner ceiling ($17). Invalid → 0 (closed). */
export function freeTierPaidCapNanoUsd(env: NodeJS.ProcessEnv = process.env): number {
  const raw = String(env.FREE_TIER_PAID_DAILY_CAP_USD ?? '').trim();
  if (!raw) return DEFAULT_PAID_CAP_NANO_USD;
  if (!/^\d+(?:\.\d{1,9})?$/.test(raw)) return 0;
  const nano = Math.round(Number(raw) * NANO_USD);
  if (!Number.isFinite(nano) || nano < 0) return 0;
  return Math.min(nano, OWNER_PAID_DAILY_CEILING_NANO_USD);
}

interface PaidStore {
  reservePaid: FreeChainStore['reservePaid'];
  settlePaid: FreeChainStore['settlePaid'];
}
let storeOverride: PaidStore | null | undefined;
let defaultStore: PaidStore | null = null;
/** Tests inject a fake authority; `undefined` restores the real Firestore one. */
export function setFreeTierPaidStoreForTests(store: PaidStore | null | undefined): void { storeOverride = store; }
function store(): PaidStore | null {
  if (storeOverride !== undefined) return storeOverride;
  if (!defaultStore) { try { defaultStore = new FreeChainStore(); } catch { return null; } }
  return defaultStore;
}

/** The provider label the rate card expects for a Free paid model. */
function rateProvider(model: string): string { return model.startsWith('gpt-') ? 'OPENAI' : 'VERTEX'; }

/** Conservative maximum cost of one call, from the shared rate card. Null when it cannot be priced. */
export function quoteFreeTierPaidNanoUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  if (!isFreeTierPaidModelAllowed(model)) return null;
  try {
    const rate = realRateFor(rateProvider(model), model);
    const inNano = Math.ceil(rate.inputPerMTok * NANO_USD), outNano = Math.ceil(rate.outputPerMTok * NANO_USD);
    const quote = maximumCostNanoUsd(Math.max(1, Math.ceil(inputTokens)), Math.max(1, Math.ceil(outputTokens)), inNano, outNano);
    return quote > 0 ? quote : null;
  } catch { return null; }
}

/** Upper-bound token estimate for text (Devanagari can be ~1 token/char, so never divide by 4). */
export function estimateTextTokens(...texts: Array<string | undefined>): number {
  return texts.reduce((n, t) => n + Math.ceil(String(t ?? '').length / 2), 0) + 64;
}

export class FreeTierPaidCapError extends Error {
  // 402 is a 4xx outside the breaker's health list: a budget refusal never cools the provider down
  // for Pro/Professional users who share the provider name.
  readonly status = 402;
  constructor(readonly surface: FreeTierPaidSurface, readonly model: string) {
    super(`free-tier paid budget refused ${model} (${surface})`);
    this.name = 'FreeTierPaidCapError';
  }
}

export interface FreeTierPaidHold { reservation: PaidReservation; model: string }

/**
 * Reserve ONE physical Free-tier paid call against the shared owner budget. Null = do not dispatch.
 * Per-user fairness is already the Free answer allowance's job (#3906), so the per-user counter here
 * is not a second limit; the GLOBAL total is.
 */
export async function reserveFreeTierPaid(input: { surface: FreeTierPaidSurface; model: string; inputTokens: number; outputTokens: number }): Promise<FreeTierPaidHold | null> {
  const cap = freeTierPaidCapNanoUsd();
  const quote = quoteFreeTierPaidNanoUsd(input.model, input.inputTokens, input.outputTokens);
  const authority = store();
  if (!authority || cap <= 0 || quote === null || quote > cap) {
    console.warn(`[FREE_PAID_CAP] refused ${input.model} on ${input.surface} (cap/price/store unavailable)`);
    return null;
  }
  const reservation = await authority.reservePaid({ requestId: `free-tier:${input.surface}:${randomUUID()}`,
    uid: `free-tier-shared:${input.surface}`, maxCostNanoUsd: quote, capNanoUsd: cap, perUserLimit: Number.MAX_SAFE_INTEGER })
    .catch(() => null);
  if (!reservation || !reservation.mayDispatch) {
    console.warn(`[FREE_PAID_CAP] daily Free-tier paid budget reached — ${input.model} on ${input.surface} skipped`);
    return null;
  }
  return { reservation, model: input.model };
}

/** Settle with the provider-reported usage. Missing usage leaves the full hold booked (conservative). */
export async function settleFreeTierPaid(hold: FreeTierPaidHold | null, usage?: { inputTokens?: number; outputTokens?: number } | null): Promise<void> {
  if (!hold || !usage || !Number.isInteger(usage.inputTokens) || !Number.isInteger(usage.outputTokens)) return;
  const actual = quoteFreeTierPaidNanoUsd(hold.model, usage.inputTokens!, usage.outputTokens!);
  if (actual === null) return;
  await store()?.settlePaid(hold.reservation, actual).catch(() => false);
}

/** Gemini `usageMetadata` → usage (thinking tokens are billed as output). */
export function geminiUsage(um: any): { inputTokens?: number; outputTokens?: number } | undefined {
  if (!um || !Number.isInteger(um.promptTokenCount) || !Number.isInteger(um.candidatesTokenCount)) return undefined;
  return { inputTokens: um.promptTokenCount, outputTokens: um.candidatesTokenCount + (Number.isInteger(um.thoughtsTokenCount) ? um.thoughtsTokenCount : 0) };
}

/** Output ceiling assumed for a hold when the call itself sets none (2.5 models may think). */
export const FREE_TIER_PAID_OUTPUT_QUOTE = 8192;

/**
 * Wrap a slotted Free-tier paid rung so EVERY dispatch (execute AND stream) is budgeted at the source.
 * Registration-time decoration means a new caller of the Free ladder cannot forget the cap.
 */
export function cappedFreeTierRung(base: AIProvider, surface: FreeTierPaidSurface): AIProvider {
  const model = base.pinnedModel ?? '';
  const reserve = async (prompt: string, system?: string) => {
    const hold = await reserveFreeTierPaid({ surface, model, inputTokens: estimateTextTokens(prompt, system), outputTokens: FREE_TIER_PAID_OUTPUT_QUOTE });
    if (!hold) throw new FreeTierPaidCapError(surface, model);
    return hold;
  };
  return {
    ...base,
    execute: async (prompt, schema, modelOverride, systemPrompt, images): Promise<AIProviderResponse> => {
      const hold = await reserve(prompt, systemPrompt);
      const response = await base.execute(prompt, schema, modelOverride, systemPrompt, images);
      await settleFreeTierPaid(hold, response.usage);
      return response;
    },
    executeStream: base.executeStream
      ? async (prompt, systemPrompt, onChunk, m, signal) => { await reserve(prompt, systemPrompt); return base.executeStream!(prompt, systemPrompt, onChunk, m, signal); }
      : undefined,
  };
}

export { isFreeTierUniverse, freeBusyMessage } from './freeBusyMessage';
