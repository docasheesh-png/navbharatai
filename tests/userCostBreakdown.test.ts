/**
 * Fix 67 / anonymization guard (admin rule 2026-07-15): the USER-facing cost breakdown must NEVER
 * reveal which backend AI did the work — no provider or model name may ever appear in it. To the user,
 * NavBharatAI did everything. These tests lock that guarantee + the user-facing tier naming.
 */
import { describe, it, expect } from 'vitest';
import { userCostBreakdown } from '../src/server/routes/agentv3';

const FORBIDDEN = /glm|kimi|claude|sonnet|opus|haiku|gemini|vertex|grok|anthropic|moonshot|z\.?ai|bedrock/i;

describe('userCostBreakdown — provider-anonymous by construction', () => {
  it('maps every power level to a user-facing tier name (never a model/provider name)', () => {
    expect(userCostBreakdown({ inputTokens: 1, outputTokens: 1 }, 1, 'weak', 87).tier).toBe('Weak');
    expect(userCostBreakdown({ inputTokens: 1, outputTokens: 1 }, 1, 'off', 87).tier).toBe('Normal');
    expect(userCostBreakdown({ inputTokens: 1, outputTokens: 1 }, 1, 'mini', 87).tier).toBe('Strong');
    expect(userCostBreakdown({ inputTokens: 1, outputTokens: 1 }, 1, 'medium', 87).tier).toBe('Powerful');
    expect(userCostBreakdown({ inputTokens: 1, outputTokens: 1 }, 1, 'max', 87).tier).toBe('Full Team');
  });

  it('always brands the engine as NavBharatAI', () => {
    expect(userCostBreakdown({ inputTokens: 5, outputTokens: 5 }, 2, 'off', 87).engine).toBe('NavBharatAI Pro v5.0');
  });

  it('the ENTIRE serialized breakdown contains no backend AI name (the anonymization guarantee)', () => {
    for (const power of ['weak', 'off', 'mini', 'medium', 'max'] as const) {
      const bd = userCostBreakdown({ inputTokens: 123456, outputTokens: 7890 }, 1.81, power, 87);
      expect(JSON.stringify(bd)).not.toMatch(FORBIDDEN);
    }
  });

  it('carries the real bill: billedInr = billedUsd × rate, tokens preserved, negatives clamped', () => {
    const bd = userCostBreakdown({ inputTokens: 200, outputTokens: 50 }, 1.808, 'off', 87);
    expect(bd.inputTokens).toBe(200);
    expect(bd.outputTokens).toBe(50);
    expect(bd.billedInr).toBeCloseTo(1.808 * 87, 2);
    const neg = userCostBreakdown({ inputTokens: -5, outputTokens: -5 }, 1, 'off', -3);
    expect(neg.inputTokens).toBe(0);
    expect(neg.billedInr).toBe(0);
  });

  it('the shape exposes NO provider-detail / margin fields (only anonymized keys)', () => {
    const bd = userCostBreakdown({ inputTokens: 1, outputTokens: 1 }, 1, 'off', 87);
    // An ALLOWLIST, so a new user-facing field is a decision rather than an accident. The two added on
    // 2026-08-22 are `livePreviewSeconds` / `livePreviewInr`: a NavBharatAI CATEGORY ("live preview" —
    // the words the Preview tab already shows), not vendor detail. §1 of the White-Label Law allows an
    // itemised breakdown in our own terms and forbids one by vendor/model, and a separate test asserts
    // no vendor name can appear in this object.
    expect(Object.keys(bd).sort()).toEqual(
      ['billedInr', 'billedUsd', 'engine', 'inputTokens', 'livePreviewInr', 'livePreviewSeconds', 'outputTokens', 'tier', 'usdInrRate'].sort(),
    );
    expect(bd).not.toHaveProperty('perProvider');
    expect(bd).not.toHaveProperty('baseModel');
    expect(bd).not.toHaveProperty('realCostUsd');
  });
});
