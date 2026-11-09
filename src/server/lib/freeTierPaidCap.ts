// ONE shared daily $ cap for EVERY Free-tier paid rung that lives OUTSIDE the FreeChain module
// (admin 2026-10-23, "Free user par bewajah paisa").
//
// ROOT CAUSE this fixes: FreeChain's $10/day owner budget (`FreeChain/spendCap.ts`) only guarded
// FreeChain's own DeepSeek rung. The legacy `buildFree` ladder (gpt-5-nano → flash-lite → flash), the
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
import type { AIProvider, AIProviderResponse, ProviderUsage } from '../AI/Router/ProviderTypes';
import { completeStreamUsage, vertexStreamUsage } from '../AI/Router/streamUsage';

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
  const quote = priceFreeTierPaidNanoUsd(model, inputTokens, outputTokens, 1);
  return quote !== null && quote > 0 ? quote : null;
}
function priceFreeTierPaidNanoUsd(model: string, inputTokens: number, outputTokens: number, minimumTokens: number): number | null {
  if (!isFreeTierPaidModelAllowed(model)) return null;
  try {
    const rate = realRateFor(rateProvider(model), model);
    const inNano = Math.ceil(rate.inputPerMTok * NANO_USD), outNano = Math.ceil(rate.outputPerMTok * NANO_USD);
    const quote = maximumCostNanoUsd(Math.max(minimumTokens, Math.ceil(inputTokens)), Math.max(minimumTokens, Math.ceil(outputTokens)), inNano, outNano);
    return quote >= 0 ? quote : null;
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
// Exact server-minted objects only. A copied/reused receipt never proves a new undispatched call.
const undispatchedHolds = new WeakSet<FreeTierPaidHold>();

/**
 * Reserve ONE physical Free-tier paid call against the shared owner budget. Null = do not dispatch.
 * Per-user fairness is already the Free answer allowance's job (#3906), so the per-user counter here
 * is not a second limit; the GLOBAL total is.
 */
export async function reserveFreeTierPaid(input: { surface: FreeTierPaidSurface; model: string; inputTokens: number; outputTokens: number }): Promise<FreeTierPaidHold | null> {
  const cap = freeTierPaidCapNanoUsd();
  const quote = quoteFreeTierPaidNanoUsd(input.model, input.inputTokens, input.outputTokens);
  const authority = store();
  if (!authority || quote === null) {
    console.warn(`[FREE_PAID_CAP] refused ${input.model} on ${input.surface} (cap/price/store unavailable)`);
    return null;
  }
  const reservation = await authority.reservePaid({ uncappedRollout: true, requestId: `free-tier:${input.surface}:${randomUUID()}`,
    uid: `free-tier-shared:${input.surface}`, maxCostNanoUsd: quote, capNanoUsd: cap, perUserLimit: Number.MAX_SAFE_INTEGER })
    .catch(() => null);
  if (!reservation || !reservation.mayDispatch) {
    console.warn(`[FREE_PAID_CAP] daily Free-tier paid budget reached — ${input.model} on ${input.surface} skipped`);
    return null;
  }
  const hold = { reservation, model: input.model };
  undispatchedHolds.add(hold);
  return hold;
}

/** Settle with the provider-reported usage. Missing usage leaves the full hold booked (conservative). */
export async function settleFreeTierPaid(hold: FreeTierPaidHold | null, usage?: { inputTokens?: number; outputTokens?: number } | null): Promise<void> {
  const complete = completeStreamUsage(usage?.inputTokens, usage?.outputTokens);
  if (!hold || !complete) return;
  const actual = priceFreeTierPaidNanoUsd(hold.model, complete.inputTokens, complete.outputTokens, 0);
  if (actual === null) return;
  await store()?.settlePaid(hold.reservation, actual).catch(() => false);
}

/** Gemini `usageMetadata` → usage (thinking tokens are billed as output). */
export function geminiUsage(um: any): { inputTokens?: number; outputTokens?: number } | undefined {
  return vertexStreamUsage(um);
}

/** Output ceiling assumed for a hold when the call itself sets none (2.5 models may think). */
export const FREE_TIER_PAID_OUTPUT_QUOTE = 8192;

/**
 * A confirmed hold with no adapter entry has a provable zero physical cost, not measured zero tokens.
 * Only this private pre-dispatch branch may close it. Once adapter entry occurs, cancellation or
 * missing usage remains uncertain and keeps the full hold. The existing store fences owner/day,
 * retains its replay tombstone, and never refunds the request counter or any user wallet.
 */
async function abortBeforePaidDispatch(hold: FreeTierPaidHold, signal: AbortSignal): Promise<never> {
  try { await store()?.settlePaid(hold.reservation, 0); }
  catch { /* Unconfirmed cleanup retains the conservative hold; never invent a refund. */ }
  throw signal.reason;
}

/** Own the adapter-entry boundary; cancellation can release only this exact, unused server hold. */
export async function dispatchWithFreeTierPaidHold<T>(hold: FreeTierPaidHold | null, signal: AbortSignal | undefined, dispatch: () => Promise<T>): Promise<T> {
  if (hold) {
    if (!undispatchedHolds.delete(hold)) throw new Error('Paid hold is not available for dispatch');
    if (signal?.aborted) return abortBeforePaidDispatch(hold, signal);
  }
  signal?.throwIfAborted();
  // Marked consumed synchronously above. A throw, rejection or abort after entry never refunds it.
  return dispatch();
}

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
    execute: async (prompt, schema, modelOverride, systemPrompt, images, signal): Promise<AIProviderResponse> => {
      signal?.throwIfAborted();
      const hold = await reserve(prompt, systemPrompt);
      const response = await dispatchWithFreeTierPaidHold(hold, signal, () => base.execute(prompt, schema, modelOverride, systemPrompt, images, signal));
      await settleFreeTierPaid(hold, response.usage);
      return response;
    },
    executeStream: base.executeStream
      ? async (prompt, systemPrompt, onChunk, m, signal, onUsage) => {
        signal?.throwIfAborted();
        const hold = await reserve(prompt, systemPrompt);
        let reported: ProviderUsage | undefined;
        const content = await dispatchWithFreeTierPaidHold(hold, signal, () => base.executeStream!(prompt, systemPrompt, onChunk, m, signal,
          usage => { reported = completeStreamUsage(usage?.inputTokens, usage?.outputTokens); }));
        // A rejected/aborted stream, missing receipt, or failed settlement retains the hold.
        // Completion text alone never proves zero cost. Existing reservations are untouched.
        if (!signal?.aborted && reported) {
          await settleFreeTierPaid(hold, reported);
          onUsage?.(reported);
        }
        return content;
      }
      : undefined,
  };
}

export { isFreeTierUniverse, freeBusyMessage } from './freeBusyMessage';
