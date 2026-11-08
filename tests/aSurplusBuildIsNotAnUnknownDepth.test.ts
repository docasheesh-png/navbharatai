// A BUILD THAT RAN ON SURPLUS IS NOT "LADDER DEPTH UNKNOWN" (autopsy 61279465, 2026-11-04).
// The report said "Ladder depth unknown — 40 delivered slice(s) named a model no rung of this tier claims" about a
// Weak build admitted to Surplus (qwen3-coder) for every one of its 39 calls. That is a known routing fact.
import { describe, it, expect } from 'vitest';
import { ladderDepthUsed, describeLadderDepth, type DeliveredSlice } from '../src/server/AgentV3/ladderDepth';
import { tierLadder } from '../src/server/AgentV3/tierLadder';

const weak = tierLadder('weak').rungs;
const slice = (provider: string, model: string, outputTokens: number): DeliveredSlice => ({ provider, model, usage: { outputTokens } });

describe('slices from an engine outside the ladder are named', () => {
  it('THE REPORTED BUILD: 40 Surplus slices → "the ladder was not used", with the engine named', () => {
    const d = ladderDepthUsed(Array.from({ length: 40 }, () => slice('SURPLUS', 'qwen3-coder', 200)), weak);
    expect(d.offLadder).toEqual({ SURPLUS: 40 });
    expect(describeLadderDepth(d, 2)).toBe('The ladder was not used — every delivered slice came from an engine outside it by design: SURPLUS (40).');
  });
  it('a real unknown model is still unknown', () => {
    const d = ladderDepthUsed([slice('MYSTERY', 'x-1', 10)], weak);
    expect(d.offLadder).toBeUndefined();
    expect(describeLadderDepth(d)).toMatch(/^Ladder depth unknown/);
  });
  it('a ladder build with a Surplus tail names both', () => {
    const r1 = weak[0];
    const d = ladderDepthUsed([slice(r1.provider, r1.model, 10), slice('SURPLUS', 'qwen3-coder', 10)], weak);
    expect(describeLadderDepth(d)).toContain('SURPLUS (1) outside the ladder');
    expect(describeLadderDepth(d)).not.toContain('unattributed');
  });
});
