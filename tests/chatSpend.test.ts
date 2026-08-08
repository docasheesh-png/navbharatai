import { describe, it, expect } from 'vitest';
import { chatTurnCost, sumChatTurnCosts, type ChatTurnUsage } from '../src/server/lib/chatSpend';
import { tieredMarkupUsd } from '../src/server/AgentV3/providerRates';
import { readProviderUsage } from '../src/server/AI/Router/ProviderTypes';

// Everything outside the v5 builder — the 70+ professionals, Doctor AI, the Other-AI tools — was
// bounded by a daily MESSAGE COUNT and nothing else. Ten cheap questions and ten expensive ones
// counted the same, and nothing anywhere could answer "what does Professional AI cost us?", because
// the router's response carried no token usage at all. These tests are mostly about the line between
// a real measurement and a guess: we would rather bill nothing than bill a number we invented.

const USD_INR = 85;
const turn = (over: Partial<ChatTurnUsage> = {}): ChatTurnUsage => ({
  provider: 'GLM', model: 'glm-4.7', inputTokens: 1_000_000, outputTokens: 1_000_000, ...over,
});

describe('what a turn really costs', () => {
  it('prices the exact model that answered, not a blended provider rate', () => {
    // glm-4.7: $0.60 in / $2.20 out per million.
    const c = chatTurnCost(turn(), USD_INR);
    expect(c.measured).toBe(true);
    expect(c.realUsd).toBeCloseTo(2.8, 6);
  });

  it('a free model is genuinely free — the whole reason the cheap leader exists', () => {
    const c = chatTurnCost(turn({ model: 'glm-4.7-flash' }), USD_INR);
    expect(c.measured).toBe(true);   // measured…
    expect(c.realUsd).toBe(0);       // …and really costs nothing
    expect(c.billedInr).toBe(0);
  });

  it('bills through the same tiered markup a build uses, not a second money model', () => {
    // Real cost $2.80 → first $1 at 4x, the excess at 3x → $4 + $1.80*3 = $9.40.
    const c = chatTurnCost(turn(), USD_INR);
    expect(c.billedUsd).toBeCloseTo(9.4, 6);
    expect(c.billedInr).toBeCloseTo(799, 0);
  });

  it('scales down to a realistic single question without collapsing to nothing', () => {
    const c = chatTurnCost(turn({ inputTokens: 2_000, outputTokens: 700 }), USD_INR);
    expect(c.realUsd).toBeGreaterThan(0);
    expect(c.billedInr).toBeGreaterThan(0);
    expect(c.billedInr).toBeLessThan(1); // paise, not rupees — which is why the wallet carry matters
  });
});

describe('an unmeasured turn is never guessed at', () => {
  // Estimating tokens from string length would produce a number that LOOKS like a measurement and
  // would land on a real user's bill. An honest zero costs a little margin and keeps every ₹ we do
  // charge real — the same rule the build path follows when it cannot prove a cost.
  it('reports measured:false and charges nothing when the provider reported no usage', () => {
    for (const u of [null, undefined, {}, turn({ inputTokens: undefined, outputTokens: undefined })]) {
      const c = chatTurnCost(u as ChatTurnUsage, USD_INR);
      expect(c.measured).toBe(false);
      expect(c.billedInr).toBe(0);
      expect(c.realUsd).toBe(0);
    }
  });

  it('keeps "free model" and "unknown cost" as different answers', () => {
    // Both bill ₹0, but only one of them is a measurement — an admin reading the numbers needs to
    // know which is which.
    expect(chatTurnCost(turn({ model: 'glm-4.7-flash' }), USD_INR).measured).toBe(true);
    expect(chatTurnCost(turn({ inputTokens: 0, outputTokens: 0 }), USD_INR).measured).toBe(false);
  });

  it('ignores negative or nonsense token counts rather than trusting them', () => {
    const c = chatTurnCost(turn({ inputTokens: -5, outputTokens: NaN }), USD_INR);
    expect(c.measured).toBe(false);
  });

  it('a missing exchange rate bills ₹0 instead of NaN reaching a wallet', () => {
    const c = chatTurnCost(turn(), NaN);
    expect(c.billedInr).toBe(0);
    expect(c.realUsd).toBeGreaterThan(0); // our own cost is still known
  });
});

describe('a request that makes several model calls bills once', () => {
  it('adds the calls up', () => {
    const a = chatTurnCost(turn({ inputTokens: 1_000_000, outputTokens: 0 }), USD_INR);
    const b = chatTurnCost(turn({ inputTokens: 1_000_000, outputTokens: 0 }), USD_INR);
    const total = sumChatTurnCosts([a, b], USD_INR);
    expect(total.inputTokens).toBe(2_000_000);
    expect(total.realUsd).toBeCloseTo(a.realUsd * 2, 6);
  });

  it('still bills the measured part when only some calls reported usage', () => {
    const measured = chatTurnCost(turn(), USD_INR);
    const unknown = chatTurnCost(null, USD_INR);
    const total = sumChatTurnCosts([unknown, measured, unknown], USD_INR);
    expect(total.measured).toBe(true);
    expect(total.billedInr).toBeCloseTo(measured.billedInr, 2);
  });

  it('an empty list is unmeasured, not free', () => {
    expect(sumChatTurnCosts([], USD_INR).measured).toBe(false);
    expect(sumChatTurnCosts(null as unknown as [], USD_INR).measured).toBe(false);
  });
});

describe('reading usage off whatever shape the provider sent', () => {
  it('understands the three field conventions in use', () => {
    expect(readProviderUsage({ prompt_tokens: 10, completion_tokens: 4 })).toEqual({ inputTokens: 10, outputTokens: 4 });     // OpenAI-compatible (GLM, Grok)
    expect(readProviderUsage({ input_tokens: 10, output_tokens: 4 })).toEqual({ inputTokens: 10, outputTokens: 4 });         // Anthropic
    expect(readProviderUsage({ promptTokenCount: 10, candidatesTokenCount: 4 })).toEqual({ inputTokens: 10, outputTokens: 4 }); // Gemini / Vertex
  });

  it('returns nothing at all when the payload carries no usage', () => {
    for (const bad of [null, undefined, {}, 'usage', 42, { totalTokens: 9 }]) {
      expect(readProviderUsage(bad)).toBeUndefined();
    }
  });

  it('accepts a half-reported payload rather than discarding what we do know', () => {
    expect(readProviderUsage({ prompt_tokens: 10 })).toEqual({ inputTokens: 10, outputTokens: 0 });
  });

  it('treats a negative count as not reported', () => {
    expect(readProviderUsage({ prompt_tokens: -1, completion_tokens: -2 })).toBeUndefined();
  });
});

/**
 * THE MARKUP IS APPLIED ONCE, TO THE REQUEST TOTAL (defect found in the pre-launch audit, 2026-08-07).
 *
 * `sumChatTurnCosts` used to add up each turn's ALREADY-MARKED-UP `billedUsd`. `tieredMarkupUsd` is a
 * CONCAVE curve — the first $1 of real cost at 4×, everything above it at 3× — so marking each call up
 * separately handed every call its own cheap-rate first dollar. The threshold was granted N times
 * instead of once, and the error was always in the same direction: THE USER WAS OVERCHARGED, by more
 * the more calls the request made. The App Debugger, which fans out over batches of files, was the
 * worst case; `aiTurnCharge.ts` had documented the correct behaviour in its own comment while the code
 * did the opposite.
 *
 * Caught before AI_WALLET_SPEND was ever switched on, so no user was ever billed by it. These exist so
 * it cannot return once real money is moving.
 */
describe('the tiered markup applies to the request total, not to each call', () => {
  // Derived from the SAME curve the code uses — a hardcoded dollar figure would be silently invalidated
  // by an env rate change (AGENTV3_MARKUP_SMALL / _LARGE / _THRESHOLD_USD are all tunable).
  const costOf = (realUsd: number) => ({
    measured: true, realUsd, billedUsd: tieredMarkupUsd(realUsd),
    billedInr: Math.round(tieredMarkupUsd(realUsd) * USD_INR * 100) / 100,
    inputTokens: 10, outputTokens: 10,
  });

  it('three calls that TOGETHER cross the threshold are priced as one request of their total', () => {
    const total = sumChatTurnCosts([costOf(0.5), costOf(0.5), costOf(0.5)], USD_INR);
    expect(total.realUsd).toBeCloseTo(1.5, 10);
    expect(total.billedUsd).toBeCloseTo(tieredMarkupUsd(1.5), 10);
  });

  it('and that is strictly CHEAPER than the old per-call sum — this is the overcharge, gone', () => {
    const calls = [costOf(0.5), costOf(0.5), costOf(0.5)];
    const oldWay = calls.reduce((a, c) => a + c.billedUsd, 0);
    expect(sumChatTurnCosts(calls, USD_INR).billedUsd).toBeLessThan(oldWay);
  });

  it('a single call is unchanged — the fix must not move the common case', () => {
    const one = costOf(0.3);
    expect(sumChatTurnCosts([one], USD_INR).billedUsd).toBeCloseTo(one.billedUsd, 10);
  });

  it('ten sub-token calls are ONE honest charge, not ten roundings', () => {
    const tiny = Array.from({ length: 10 }, () => costOf(0.0001));
    expect(sumChatTurnCosts(tiny, USD_INR).billedUsd).toBeCloseTo(tieredMarkupUsd(0.001), 10);
  });

  it('a missing or broken exchange rate yields ₹0, never NaN on someone\'s bill', () => {
    expect(sumChatTurnCosts([costOf(0.5)], 0).billedInr).toBe(0);
    expect(Number.isNaN(sumChatTurnCosts([costOf(0.5)], NaN).billedInr)).toBe(false);
  });
});
