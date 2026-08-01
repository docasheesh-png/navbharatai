import { describe, it, expect } from 'vitest';
import { chatTurnCost, sumChatTurnCosts, type ChatTurnUsage } from '../src/server/lib/chatSpend';
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
    const total = sumChatTurnCosts([a, b]);
    expect(total.inputTokens).toBe(2_000_000);
    expect(total.realUsd).toBeCloseTo(a.realUsd * 2, 6);
  });

  it('still bills the measured part when only some calls reported usage', () => {
    const measured = chatTurnCost(turn(), USD_INR);
    const unknown = chatTurnCost(null, USD_INR);
    const total = sumChatTurnCosts([unknown, measured, unknown]);
    expect(total.measured).toBe(true);
    expect(total.billedInr).toBeCloseTo(measured.billedInr, 2);
  });

  it('an empty list is unmeasured, not free', () => {
    expect(sumChatTurnCosts([]).measured).toBe(false);
    expect(sumChatTurnCosts(null as unknown as []).measured).toBe(false);
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
