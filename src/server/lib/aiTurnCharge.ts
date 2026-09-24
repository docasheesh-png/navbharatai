// ONE WALLET, SPENT EVERYWHERE (admin 2026-08-01: "user unhin 50,000 token se kharch kare, har jagah").
//
// The gifted balance was only ever spent by v5 builds. Professional AI, Doctor AI and the Other-AI
// tools were bounded by a daily MESSAGE COUNT instead — which is not the same limit and not the same
// promise. Ten cheap questions and ten expensive ones cost a user the same, while costing NavBharatAI
// completely different amounts, and a user with ₹600 of gifted credit could exhaust ten free messages
// and be told to buy a Pass while their balance sat untouched.
//
// This makes the wallet the single currency. Anything that costs NavBharatAI money draws the wallet
// down; anything that costs nothing — an answer served by the free flash model — draws nothing and so
// stays free by itself. There are no per-feature quotas left to tune: THE PRICE OF THE THING IS THE
// LIMIT.
//
// WHAT IS DELIBERATELY NOT CHARGED:
//   • An UNMEASURED turn (the provider reported no tokens). chatSpend.ts refuses to guess, so there is
//     no honest amount to charge — see its header. We eat it.
//   • A free-listed admin/test account, and a user holding a Professional Pass: the Pass IS the
//     payment, so charging the wallet on top would bill them twice for one thing.
//   • Anything at all while the flag is off, which is the default.
//
// Off by default. `AI_WALLET_SPEND=on` is what makes any of it real, so this ships and bakes long
// before it moves a single rupee of anyone's balance.

import { chatTurnCost, sumChatTurnCosts, type ChatTurnUsage, type ChatTurnCost } from './chatSpend';
import { debitWalletRolledUp } from './walletDebit';
import { featureLabel, featureRollupRef, type WalletFeature } from './walletFeature';

/** The master switch. Off unless explicitly enabled, so shipping this changes nothing by itself. */
export function aiWalletSpendEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AI_WALLET_SPEND || '').toLowerCase() === 'on';
}

export interface AiChargeContext {
  /**
   * WHICH assistant is spending (admin 2026-09-13).
   *
   * 🔴 Before this, all four assistant surfaces — Doctor AI, Professionals, the AI tools and a
   * published app's own assistant — shared ONE daily bucket called "NavBharatAI assistants", so a
   * user whose balance had drained could not be told what had drained it, and the admin could not
   * see which feature people actually use. It defaults to 'tools' only because the tool gate was the
   * first caller; every live caller names its own.
   */
  feature?: WalletFeature;
  /** Server-VERIFIED uid. Never a client-claimed field — it decides whose money moves. */
  userId: string | null;
  /** True for an admin/test free-list account. */
  isFreeListed?: boolean;
  /** True when the user holds an active Professional Pass, which already paid for this. */
  hasActivePass?: boolean;
  /**
   * The share of this request's real cost the user is charged, 0…1 (admin 2026-09-23). Omitted means
   * 1 — the whole cost, exactly as before. `0` is a turn the daily free allowance covers (one of the
   * 10 free professional messages), which must never move the wallet. A fraction is an exam paper
   * that is partly free: 2 free questions of a 10-question paper is `0.8`. An unreadable value means
   * 1, because a bug in the arithmetic must not quietly make paid work free — and it cannot overcharge
   * either, since nothing above 1 is honoured.
   */
  billableFraction?: number;
}

/** The charged share, clamped to 0…1; anything unreadable is the whole cost (today's behaviour). */
export function billableFractionOf(ctx: AiChargeContext): number {
  const f = ctx.billableFraction;
  if (typeof f !== 'number' || !Number.isFinite(f)) return 1;
  return Math.min(1, Math.max(0, f));
}

export type AiChargeReason =
  | 'disabled'      // flag off — today's behaviour
  | 'anonymous'     // no verified user to charge
  | 'free-list'     // admin/test account
  | 'pass'          // already paid for by the Professional Pass
  | 'free-allowance' // inside the day's free allowance — the free messages are free
  | 'unmeasured'    // the provider reported no usage; we refuse to invent one
  | 'free-model'    // measured, and genuinely cost nothing
  | 'charge';       // a real, measured cost to draw from the wallet

export interface AiChargeDecision {
  charge: boolean;
  reason: AiChargeReason;
  /** ₹ to debit. Always 0 unless `charge`. */
  billedInr: number;
  cost: ChatTurnCost;
}

/**
 * Decide whether this turn draws from the wallet, and by how much. PURE — no I/O, no clock.
 *
 * Order matters: the flag short-circuits first so a disabled gate is a perfect no-op with zero reads,
 * then the tiers that must never be charged, and only then the measurement. Note that 'free-model' and
 * 'unmeasured' both charge nothing but are kept apart: one is a fact about the model, the other is an
 * admission that we do not know — and only the second one is costing us money silently.
 */
export function decideAiCharge(
  ctx: AiChargeContext,
  usage: ChatTurnUsage | null | undefined,
  usdInr: number,
  env: NodeJS.ProcessEnv = process.env,
): AiChargeDecision {
  const cost = chatTurnCost(usage, usdInr);
  const no = (reason: AiChargeReason): AiChargeDecision => ({ charge: false, reason, billedInr: 0, cost });

  if (!aiWalletSpendEnabled(env)) return no('disabled');
  if (!ctx.userId) return no('anonymous');
  if (ctx.isFreeListed) return no('free-list');
  if (ctx.hasActivePass) return no('pass');
  const fraction = billableFractionOf(ctx);
  if (fraction <= 0) return no('free-allowance');
  if (!cost.measured) return no('unmeasured');
  if (cost.billedInr <= 0) return no('free-model');

  // Not rounded: the debit carries the sub-token remainder, so a small share of a small cost is
  // deferred, never inflated to the next paisa.
  return { charge: true, reason: 'charge', billedInr: cost.billedInr * fraction, cost };
}

/**
 * The ledger bucket a turn rolls into: one row per user per DAY, so a chatty day is a single readable
 * line rather than fifty ₹0.02 entries burying the user's purchase history.
 *
 * UTC is used on purpose — the boundary only has to be consistent, and a server-side date cannot be
 * moved by a user changing their device clock (the same reasoning as the free gift ladder).
 */
export function aiSpendRollupRef(nowMs: number): string {
  const d = new Date(Number.isFinite(nowMs) ? nowMs : 0);
  return `ai_${d.toISOString().slice(0, 10)}`;
}

/** Ledger text for the bucket. NavBharatAI's own words — never a vendor name (white-label law §2). */
export const AI_SPEND_LEDGER_LABEL = 'NavBharatAI assistants';

/**
 * The same decision for a request that made SEVERAL model calls — the App Debugger fans out over
 * batches of files, so one action can be a dozen calls.
 *
 * They are summed FIRST and charged once, which is not the same as charging each: a request of ten
 * calls each costing a fraction of a token is one honest charge here, rather than ten decisions that
 * individually round to nothing. It also means the tiered markup applies to the request's real total,
 * exactly as a build's does.
 */
export function decideAiChargeForTurns(
  ctx: AiChargeContext,
  usages: Array<ChatTurnUsage | null | undefined>,
  usdInr: number,
  env: NodeJS.ProcessEnv = process.env,
): AiChargeDecision {
  const cost = sumChatTurnCosts((usages || []).map((u) => chatTurnCost(u, usdInr)), usdInr);
  const no = (reason: AiChargeReason): AiChargeDecision => ({ charge: false, reason, billedInr: 0, cost });

  if (!aiWalletSpendEnabled(env)) return no('disabled');
  if (!ctx.userId) return no('anonymous');
  if (ctx.isFreeListed) return no('free-list');
  if (ctx.hasActivePass) return no('pass');
  const fraction = billableFractionOf(ctx);
  if (fraction <= 0) return no('free-allowance');
  if (!cost.measured) return no('unmeasured');
  if (cost.billedInr <= 0) return no('free-model');

  // Not rounded: the debit carries the sub-token remainder, so a small share of a small cost is
  // deferred, never inflated to the next paisa.
  return { charge: true, reason: 'charge', billedInr: cost.billedInr * fraction, cost };
}

export interface AiChargeResult extends AiChargeDecision {
  /** True when the wallet was actually debited. */
  debited: boolean;
  tokensDebited: number;
}

/**
 * Charge one answered turn, if it should be charged at all.
 *
 * Call this AFTER the user has their answer. A failure here must never cost the user their reply — a
 * money-path error is logged loudly and swallowed, exactly like the build debit. The reverse (charging
 * before answering) would risk taking money for a turn that then failed.
 */
export async function chargeForAiTurn(
  db: any,
  ctx: AiChargeContext,
  usage: ChatTurnUsage | null | undefined,
  usdInr: number,
  nowMs: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AiChargeResult> {
  return applyAiCharge(db, ctx, decideAiCharge(ctx, usage, usdInr, env), nowMs);
}

/** The multi-call form — one charge for every model call a single request made. See above. */
export async function chargeForAiTurns(
  db: any,
  ctx: AiChargeContext,
  usages: Array<ChatTurnUsage | null | undefined>,
  usdInr: number,
  nowMs: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AiChargeResult> {
  return applyAiCharge(db, ctx, decideAiChargeForTurns(ctx, usages, usdInr, env), nowMs);
}

async function applyAiCharge(
  db: any,
  ctx: AiChargeContext,
  decision: AiChargeDecision,
  nowMs: number,
): Promise<AiChargeResult> {
  if (!decision.charge || !ctx.userId) return { ...decision, debited: false, tokensDebited: 0 };

  // ONE BUCKET PER FEATURE PER DAY. The ledger stays bounded exactly as before (a handful of rows a
  // day at the very most), and the wallet history finally says "Doctor AI" instead of a word that
  // covered four different products.
  const feature: WalletFeature = ctx.feature ?? 'tools';
  const res = await debitWalletRolledUp(db, ctx.userId, {
    billedInr: decision.billedInr,
    rollupRef: featureRollupRef(feature, nowMs),
    description: featureLabel(feature) || AI_SPEND_LEDGER_LABEL,
    feature,
  }).catch(() => ({ ok: false as const, error: 'debit threw' }));

  if (!res.ok) {
    console.error(`[AI SPEND] Wallet debit FAILED for user ${ctx.userId}: ${res.error} — the turn was served but not charged.`);
    return { ...decision, debited: false, tokensDebited: 0 };
  }
  return { ...decision, debited: true, tokensDebited: res.tokensDebited };
}
