/**
 * The report must say what happened — autopsy `f152c1ab`, 2026-09-20.
 *
 * Three findings from one build report, all the same kind of defect: the engine behaved correctly
 * and then DESCRIBED ITSELF WRONGLY. The fifth absolute rule calls this out by name — fixing the
 * code is not enough when the reporting still misleads the next reader.
 *
 *   1. `LADDER_DEPTH` said *"Fell to rung 2 of 5"* for a build that OPENED on rung 2 and fell
 *      nowhere. An admin reading it hunts a rung-1 failure that never happened.
 *   2. The per-call log recorded `model: "kimi"` — a vendor FAMILY — while the same report's
 *      manifest carried the real id, `kimi-k2.7-code`. Two ids in that family differ 2× in price.
 *   3. ONE skip was announced TWICE, in the same millisecond, with two different reasons — one of
 *      which was false for that build.
 */
import { describe, it, expect } from 'vitest';
import { describeLadderDepth } from '../src/server/AgentV3/ladderDepth';
import { openingRung, TIER_LADDERS } from '../src/server/AgentV3/tierLadder';
import { answeringModel, looksLikeFamilyLabelOnly } from '../src/server/AgentV3/answeringModel';
import { contractSkipReason } from '../src/server/AgentV3/SimpleBuilder';

describe('1 — "fell" is a claim about movement', () => {
  /** The reported build: Weak ladder, routed COMPLEX, so it opened past the cheap flash rung. */
  const weak = TIER_LADDERS.weak;

  it('a complex build opens on rung 2, not rung 1', () => {
    expect(openingRung(weak, { complex: true })).toBe(2);
    expect(openingRung(weak, { heal: true })).toBe(2);
    expect(openingRung(weak, { complex: false })).toBe(1);
    expect(openingRung(weak)).toBe(1);
  });

  it('does NOT say "fell" when the build finished where it opened', () => {
    const line = describeLadderDepth({ depth: 2, rungCount: 5, matched: 1, unmatched: 0 }, 2);
    // The exact sentence the report printed, and why it misled.
    expect(line).not.toContain('Fell to rung 2');
    expect(line).toContain('opened');
    expect(line).toContain('fell no further');
  });

  it('still says "fell" when the build really did move down', () => {
    const line = describeLadderDepth({ depth: 3, rungCount: 5, matched: 2, unmatched: 0 }, 2);
    expect(line).toContain('Fell to rung 3');
    expect(line).toContain('from rung 2, where it opened');
  });

  it('an ordinary rung-1 build reads exactly as it always did', () => {
    expect(describeLadderDepth({ depth: 1, rungCount: 5, matched: 1, unmatched: 0 }, 1))
      .toContain('Finished on rung 1 of 5');
    // An older caller that passes no opening rung keeps the historical meaning.
    expect(describeLadderDepth({ depth: 2, rungCount: 5, matched: 1, unmatched: 0 }))
      .toContain('Fell to rung 2 of 5');
  });

  it('says nothing it cannot know when no slice could be attributed', () => {
    expect(describeLadderDepth({ depth: null, rungCount: 5, matched: 0, unmatched: 0 }, 2))
      .toContain('unknown');
  });
});

describe('2 — a per-call record names a MODEL, not a vendor', () => {
  it('prefers the model that actually answered', () => {
    expect(answeringModel({ answered: 'kimi-k2.7-code', planned: 'glm-4.7-flashx', family: 'KIMI' }))
      .toBe('kimi-k2.7-code');
  });

  it('falls back to the PLANNED id before the family — a planned id can be checked, a family cannot', () => {
    expect(answeringModel({ planned: 'claude-haiku-4-5-20251001', family: 'CLAUDE_HAIKU' }))
      .toBe('claude-haiku-4-5-20251001');
  });

  it('uses the family only when nothing better exists, and never invents an id', () => {
    expect(answeringModel({ family: 'KIMI' })).toBe('KIMI');
    expect(answeringModel({})).toBe('unknown');
    expect(answeringModel({ answered: '   ', planned: '', family: 'GLM' })).toBe('GLM');
  });

  it('recognises the shape the report actually printed', () => {
    // What the reported build recorded for both of its calls.
    expect(looksLikeFamilyLabelOnly('kimi')).toBe(true);
    expect(looksLikeFamilyLabelOnly('glm')).toBe(true);
    // Every real id this platform runs carries a version separator.
    for (const id of [
      'kimi-k2.7-code',
      'kimi-k2.7-code-highspeed',
      'glm-4.7-flashx',
      'claude-haiku-4-5-20251001',
      'gemini-2.5-flash-lite',
      'nvidia/nemotron-3-super-120b-a12b',
    ]) {
      expect(looksLikeFamilyLabelOnly(id), id).toBe(false);
    }
  });
});

describe('3 — one skip, one sentence', () => {
  it('an UNAFFORDABLE contract is announced once, with the affordability reason', () => {
    const reason = contractSkipReason({ shareContract: true, contractCapMs: 40_000, affordable: false });
    expect(reason).toContain('not both');
    // The reported build printed BOTH sentences at the same millisecond. This one is not the other.
    expect(reason).not.toContain('planning used the time it needed');
  });

  it('a COLLAPSED cap gets its own, different and correct, reason', () => {
    const reason = contractSkipReason({ shareContract: true, contractCapMs: 0, affordable: false });
    expect(reason).toContain('planning used the time it needed');
    expect(reason).not.toContain('not both');
  });

  it('says nothing when the pass is running, or when it is switched off', () => {
    expect(contractSkipReason({ shareContract: true, contractCapMs: 40_000, affordable: true })).toBeNull();
    expect(contractSkipReason({ shareContract: false, contractCapMs: 40_000, affordable: false })).toBeNull();
    expect(contractSkipReason({ shareContract: false, contractCapMs: 0, affordable: false })).toBeNull();
  });

  it('the two reasons can never both describe one build', () => {
    for (const capMs of [0, 1, 40_000]) {
      for (const affordable of [true, false]) {
        const reason = contractSkipReason({ shareContract: true, contractCapMs: capMs, affordable });
        if (reason === null) continue;
        const both = reason.includes('not both') && reason.includes('planning used the time it needed');
        expect(both, `cap=${capMs} affordable=${affordable}`).toBe(false);
      }
    }
  });
});
