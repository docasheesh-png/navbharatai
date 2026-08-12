// What the assistants (Professionals, Doctor AI, the Other-AI tools) actually cost us — and the one
// number that warns us before that changes.
//
// WHY THIS EXISTS. Every assistant turn starts on GLM-4.7-Flash, which is priced at ZERO in our rate
// card (providerRates.ts). So today a normal Professional-AI answer costs NavBharatAI ₹0 and the user
// ₹0, and only a FALLBACK turn — flash failed, rate-limited, or returned empty — reaches a rung that
// costs money (Gemini flash, Claude Haiku, Grok).
//
// That is a good position, and it is also a completely unmonitored dependency. Our "assistants are
// free" economics rest on a pricing decision made by a vendor we do not control. If flash stops being
// free, or its quota tightens, NOTHING BREAKS AND NOTHING COMPLAINS — every turn quietly routes to a
// paid rung and the bill moves while the product keeps working perfectly. That is the most dangerous
// shape a cost problem can have: correct behaviour, silent expense.
//
// The signal that catches it is not the rupee total (which drifts with traffic) but the FREE SHARE —
// what fraction of turns the free leader answered. That number is stable at ~1.0 while the arrangement
// holds and falls off a cliff the day it does not, regardless of how busy we are.
//
// ADMIN-ONLY. Model and provider names appear here on purpose; this is the forensic side of the
// White-Label Law (§3), and none of it may ever reach a user-facing surface.
//
// HONESTY. An UNMEASURED turn (the provider reported no tokens) is counted separately and never
// guessed at — it is neither "free" nor "paid", because we genuinely do not know. Folding it into the
// free bucket would flatter the very number this module exists to watch.
//
// Pure — no I/O, no clock. The caller supplies the day and persists the result.

import type { ChatTurnCost } from './chatSpend';

/** One assistant turn, as the caller already priced it, plus which rung answered. */
export interface AssistantTurn {
  /** Provider as the router reports it (GLM, VERTEX, GEMINI, GROK, ANTHROPIC …). Admin-only. */
  provider?: string;
  /** Exact model id that answered — what separates the free leader from a paid fallback. */
  model?: string;
  /** The priced turn from chatTurnCost(). */
  cost: ChatTurnCost;
}

export interface AssistantRungTotals {
  turns: number;
  realUsd: number;
  billedUsd: number;
}

export interface AssistantSpendDay {
  /** Calendar day, YYYY-MM-DD, supplied by the caller (server clock — never a device's). */
  date: string;
  turns: number;
  /** Turns a MEASURED, genuinely zero-cost model answered. The number this module watches. */
  freeTurns: number;
  /** Turns that cost real money. */
  paidTurns: number;
  /** Turns the provider reported no usage for — unknown, deliberately not counted either way. */
  unmeasuredTurns: number;
  realUsd: number;
  billedUsd: number;
  /** Per model id, so a shift shows WHICH rung absorbed it, not just that one happened. */
  perModel: Record<string, AssistantRungTotals>;
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const num = (v: unknown): number => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

/** A stable bucket key. Unknown models are kept apart rather than merged into a real one. */
export function rungKey(turn: AssistantTurn): string {
  const model = String(turn.model ?? '').trim().toLowerCase();
  if (model) return model;
  const provider = String(turn.provider ?? '').trim().toLowerCase();
  return provider || 'unknown';
}

/** An empty day — distinct from "no data", which the caller represents with null. */
export function emptyAssistantSpendDay(date: string): AssistantSpendDay {
  return {
    date, turns: 0, freeTurns: 0, paidTurns: 0, unmeasuredTurns: 0,
    realUsd: 0, billedUsd: 0, perModel: {},
  };
}

/**
 * Fold one turn into the day. Pure — returns a new day, never mutates the input.
 *
 * A turn is FREE only when it was measured AND cost nothing. The two conditions are separate on
 * purpose: "the model is free" and "the provider told us nothing" look identical in a rupee total and
 * mean opposite things to whoever reads this.
 */
export function foldAssistantTurn(
  day: AssistantSpendDay | null | undefined,
  date: string,
  turn: AssistantTurn,
): AssistantSpendDay {
  const base = day && day.date === date ? day : emptyAssistantSpendDay(date);
  const measured = !!turn.cost?.measured;
  const realUsd = measured ? num(turn.cost.realUsd) : 0;
  const billedUsd = measured ? num(turn.cost.billedUsd) : 0;

  const key = rungKey(turn);
  const prev = base.perModel[key] ?? { turns: 0, realUsd: 0, billedUsd: 0 };

  return {
    date,
    turns: base.turns + 1,
    freeTurns: base.freeTurns + (measured && realUsd === 0 ? 1 : 0),
    paidTurns: base.paidTurns + (measured && realUsd > 0 ? 1 : 0),
    unmeasuredTurns: base.unmeasuredTurns + (measured ? 0 : 1),
    realUsd: round6(base.realUsd + realUsd),
    billedUsd: round6(base.billedUsd + billedUsd),
    perModel: {
      ...base.perModel,
      [key]: {
        turns: prev.turns + 1,
        realUsd: round6(prev.realUsd + realUsd),
        billedUsd: round6(prev.billedUsd + billedUsd),
      },
    },
  };
}

/**
 * The share of MEASURED turns the free leader answered, 0..1.
 *
 * Unmeasured turns are excluded from both halves rather than assumed — a day of nothing but unmeasured
 * turns has no free share to report, so it returns null and the caller says so instead of printing a
 * confident 0% (which would read as "flash died today").
 */
export function freeShare(day: AssistantSpendDay | null | undefined): number | null {
  if (!day) return null;
  const measured = num(day.freeTurns) + num(day.paidTurns);
  if (measured === 0) return null;
  return Math.round((day.freeTurns / measured) * 1000) / 1000;
}

export type AssistantSpendStatus = 'healthy' | 'watch' | 'shifted' | 'unknown';

export interface AssistantSpendVerdict {
  status: AssistantSpendStatus;
  /** 0..1, or null when nothing measurable happened. */
  freeShare: number | null;
  /** Plain admin-facing sentence. Never shown to a user (it names rungs). */
  message: string;
}

/**
 * Below this free share, the free-leader arrangement is no longer carrying normal traffic.
 * Deliberately generous: flash legitimately fails sometimes, and a tripwire that cries on ordinary
 * jitter is one an admin learns to ignore.
 */
export const FREE_SHARE_WATCH = 0.9;
export const FREE_SHARE_SHIFTED = 0.5;

/**
 * Too few turns to conclude anything. Without this, one fallback on a two-turn morning reads as a 50%
 * collapse — a false alarm that would train the admin to distrust this number.
 */
export const MIN_TURNS_FOR_VERDICT = 20;

/** Read the day and say, honestly, whether the free-assistant arrangement still holds. Pure. */
export function assistantSpendVerdict(day: AssistantSpendDay | null | undefined): AssistantSpendVerdict {
  const share = freeShare(day);
  const measured = day ? num(day.freeTurns) + num(day.paidTurns) : 0;

  if (share === null || measured < MIN_TURNS_FOR_VERDICT) {
    return {
      status: 'unknown',
      freeShare: share,
      message: `Not enough measured assistant turns yet (${measured}) to judge the free-model share.`,
    };
  }
  const pct = Math.round(share * 100);
  if (share >= FREE_SHARE_WATCH) {
    return {
      status: 'healthy',
      freeShare: share,
      message: `${pct}% of assistant turns were served by the free model — assistants are costing us essentially nothing.`,
    };
  }
  if (share >= FREE_SHARE_SHIFTED) {
    return {
      status: 'watch',
      freeShare: share,
      message:
        `Only ${pct}% of assistant turns were served by the free model (normally ~100%). Paid fallback rungs are `
        + 'absorbing real traffic — check whether the free tier is rate-limiting or has stopped being free.',
    };
  }
  return {
    status: 'shifted',
    freeShare: share,
    message:
      `Just ${pct}% of assistant turns were served by the free model. The assistants are now running mostly on `
      + 'PAID rungs, so their cost has moved from ~zero to real money without anything appearing broken.',
  };
}
