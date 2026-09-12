// SHOULD A STREAMED TURN RACE TWO PROVIDERS? — a question nobody had asked, answered per universe.
//
// ── WHAT THE RACE ACTUALLY DOES (money audit, 2026-09-12) ────────────────────────────────────────
// `AIRouter.routeStream` starts the top TWO providers CONCURRENTLY and serves whichever speaks first.
// The loser's output is discarded — but the call was made, so the loser is BILLED IN FULL. A raced
// turn therefore costs TWO models, always, and buys exactly one thing with the second: latency.
//
// 🔴 ON THE FREE UNIVERSE THAT WAS A PERMANENT, UNCHOSEN COST. The free ladder's leader is
// `glm-flash` at ₹0 and its second rung was `gemini-2.5-pro` at $10/MTok out — so EVERY free chat
// turn, successful or not, also paid for a gemini-2.5-pro call. Not on fallback. Always. Free chat
// is not wallet-charged, so all of it was ours, and nobody ever decided to buy it: the race was a
// latency optimisation written for the paid path that the free path silently inherited.
//
// 🔒 THE RULE: A RACE IS A PURCHASE OF SPEED, SO IT BELONGS WHERE SOMEONE IS PAYING.
// PRO and PROFESSIONAL keep racing — those users bought the product, and speed is part of it. FREE
// runs its ladder SEQUENTIALLY: the ₹0 leader alone, and the next rung only if that one actually
// fails. The cost of the second model is paid only when the first did not deliver.
//
// ⚠️ WHAT IT COSTS THE FREE USER, PLAINLY: when the free leader is SLOW (not failing — slow), nothing
// else is running beside it to overtake it, so the reply starts later than it used to. That is the
// trade, it is real, and it is the one the admin chose on being shown the duplicate bill. The
// grounding status shipped in #2826 is what keeps that wait visible rather than blank.
//
// REVERSIBLE WITHOUT A DEPLOY: `AI_STREAM_RACE=all` restores racing everywhere (the old behaviour),
// `AI_STREAM_RACE=off` stops it everywhere including the paid tiers. Unset = the rule above.
//
// PURE — no I/O, no router, no clock.

/** Universes that are allowed to spend a second model's call to save a second of latency. */
const PAID_UNIVERSES = new Set(['pro', 'professional']);

/**
 * May this universe race two providers on a streamed turn? PURE.
 *
 * An UNRECOGNISED universe is treated as NOT paid — the safe side is the one that cannot silently
 * double a bill for a caller nobody has classified yet.
 */
export function shouldRaceStreams(universe: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const override = String(env.AI_STREAM_RACE ?? '').trim().toLowerCase();
  if (override === 'all') return true;
  if (override === 'off') return false;
  return PAID_UNIVERSES.has(String(universe ?? '').trim().toLowerCase());
}
