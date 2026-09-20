// The number that settles the "turn thinking off" argument: how often does a build leave rung 1?
//
// Locks the two properties that make the measurement worth trusting — an unrecognised model is never
// rounded into a rung, and a rung that was TRIED but delivered nothing is never counted as reached.

import { describe, it, expect } from 'vitest';
import { ladderDepthUsed, rungIndexFor, describeLadderDepth, type DeliveredSlice } from '../src/server/AgentV3/ladderDepth';
import { TIER_LADDERS } from '../src/server/AgentV3/tierLadder';

const WEAK = TIER_LADDERS.weak;
const STRONG = TIER_LADDERS.mini;

const slice = (provider: string, model: string | undefined, outputTokens: number): DeliveredSlice =>
  ({ provider, ...(model ? { model } : {}), usage: { outputTokens } });

describe('rungIndexFor', () => {
  it('matches a rung by its exact model id', () => {
    expect(rungIndexFor(slice('GLM', 'glm-4.7-flashx', 10), WEAK)).toBe(0);
    expect(rungIndexFor(slice('KIMI', 'kimi-k2.7-code', 10), WEAK)).toBe(1);
    expect(rungIndexFor(slice('GLM', 'glm-5.3', 10), WEAK)).toBe(2);
  });

  it('🔴 NEVER substring-matches a concrete id — glm-4.7-flash is not glm-4.7-flashx', () => {
    // The lead rung is `glm-4.7-flashx`. The older, cheaper `glm-4.7-flash` is a DIFFERENT model at a
    // different price; a loose match would report the wrong rung and the wrong conclusion.
    expect(rungIndexFor(slice('GLM', 'glm-4.7-flash', 10), WEAK)).toBeNull();
  });

  it('matches a Claude rung by family, because the rung names a family and the ledger an id', () => {
    const haiku = WEAK.findIndex((r) => r.model === 'haiku');
    expect(rungIndexFor(slice('CLAUDE_HAIKU', 'claude-3-5-haiku-20241022', 10), WEAK)).toBe(haiku);
    const sonnet = STRONG.findIndex((r) => r.model === 'sonnet');
    expect(rungIndexFor(slice('CLAUDE', 'claude-sonnet-4-6', 10), STRONG)).toBe(sonnet);
    const opus = STRONG.findIndex((r) => r.model === 'opus');
    expect(rungIndexFor(slice('CLAUDE_OPUS', 'claude-opus-4-8', 10), STRONG)).toBe(opus);
  });

  it('falls back to the provider ONLY when that provider holds exactly one rung', () => {
    // KIMI is rung 2 alone on weak, so a model-less Kimi slice is unambiguous.
    expect(rungIndexFor(slice('KIMI', undefined, 10), WEAK)).toBe(1);
    // GLM holds rung 1 AND rung 3 on weak — that is precisely the ambiguity `deliveredVia` could not
    // resolve, and it is why this module exists. Unknown beats a coin flip.
    expect(rungIndexFor(slice('GLM', undefined, 10), WEAK)).toBeNull();
  });

  it('never attributes the unbilled aux remainder', () => {
    expect(rungIndexFor(slice('other', 'glm-5.3', 10), WEAK)).toBeNull();
  });

  it('is case- and whitespace-tolerant about ids', () => {
    expect(rungIndexFor(slice('glm', ' GLM-5.3 ', 10), WEAK)).toBe(2);
  });
});

describe('ladderDepthUsed', () => {
  it('reports rung 1 when only the lead rung delivered', () => {
    const d = ladderDepthUsed([slice('GLM', 'glm-4.7-flashx', 4000)], WEAK);
    expect(d.depth).toBe(1);
    expect(d.rungCount).toBe(WEAK.length);
    expect(d.matched).toBe(1);
    expect(describeLadderDepth(d)).toContain('Finished on rung 1');
  });

  it('reports the DEEPEST rung, not the last one recorded', () => {
    const d = ladderDepthUsed(
      [
        slice('GLM', 'glm-5.3', 900), // rung 3
        slice('GLM', 'glm-4.7-flashx', 4000), // rung 1, recorded after
      ],
      WEAK,
    );
    expect(d.depth).toBe(3);
    expect(describeLadderDepth(d)).toContain('Fell to rung 3');
  });

  it('🔴 a rung that was TRIED and delivered nothing is not counted as reached', () => {
    // A rung that throws spends input and returns no output. Counting it would say "fell to rung 3"
    // about a build rung 3 never wrote a character of.
    const d = ladderDepthUsed(
      [slice('GLM', 'glm-4.7-flashx', 4000), slice('KIMI', 'kimi-k2.7-code', 0)],
      WEAK,
    );
    expect(d.depth).toBe(1);
  });

  it('leaves depth null rather than guessing when nothing matches', () => {
    const d = ladderDepthUsed([slice('VERTEX', 'gemini-2.5-flash', 500)], WEAK);
    expect(d.depth).toBeNull();
    expect(d.unmatched).toBe(1);
    expect(describeLadderDepth(d)).toContain('unknown');
  });

  it('counts a matched rung and an unmatched slice separately in the same build', () => {
    const d = ladderDepthUsed(
      [slice('GLM', 'glm-4.7-flashx', 4000), slice('VERTEX', 'gemini-2.5-flash', 200)],
      WEAK,
    );
    expect(d.depth).toBe(1);
    expect(d.matched).toBe(1);
    expect(d.unmatched).toBe(1);
    expect(describeLadderDepth(d)).toContain('unattributed');
  });

  it('is empty-safe', () => {
    const d = ladderDepthUsed([], WEAK);
    expect(d.depth).toBeNull();
    expect(d.matched).toBe(0);
    expect(d.unmatched).toBe(0);
  });

  it('tolerates a malformed usage figure without counting it', () => {
    const bad = { provider: 'GLM', model: 'glm-5.3', usage: { outputTokens: Number.NaN } } as DeliveredSlice;
    expect(ladderDepthUsed([bad], WEAK).depth).toBeNull();
  });
});
