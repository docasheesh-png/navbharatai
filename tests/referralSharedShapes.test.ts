import { describe, it, expect } from 'vitest';
import { normalizeReferralCode, CODE_ALPHABET, CODE_LENGTH, mintReferralCode } from '../src/server/lib/referralCode';
import { normalizeReferralCodeClient } from '../src/lib/referralCodeClient';
import { ALL_STEPS } from '../src/server/lib/referralRewards';
import { STEP_ORDER } from '../src/lib/referralStepNames';

/**
 * TWO HAND-KEPT COPIES THAT MUST NOT DRIFT.
 *
 * The client cannot import the server modules — they read `process.env`, and pulling one into the
 * browser bundle is how a bundle acquires a Node shim, or worse, how a money rule ends up evaluated
 * where a user can reach it. So the step NAMES and the code NORMALISER exist twice.
 *
 * Duplication is exactly the defect this repo has paid for repeatedly (four copies of safeRelPath
 * that drifted; retired model ids in five files). Where a genuinely shared module is not possible,
 * the cheapest honest substitute is a test that fails the moment the copies disagree — which is what
 * this file is.
 *
 * The failure it prevents is not theoretical in either direction: a client stricter than the server
 * refuses a code the user could really have used, and a client looser than the server sends them
 * into a dead end with no explanation.
 */

describe('the step names agree', () => {
  it('are the same four steps, in the same order', () => {
    expect([...STEP_ORDER]).toEqual([...ALL_STEPS]);
  });
});

describe('the code normalisers agree', () => {
  const cases: unknown[] = [
    // Real codes, and the ways a human mangles one.
    'ABCDEF', 'abcdef', ' ABCDEF ', 'ABC-DEF', 'ABC DEF', 'ABC_DEF', 'a b c d e f',
    // The ambiguous glyphs the alphabet deliberately excludes — a typo, never a silent remap.
    'ABC0EF', 'ABCOEF', 'ABC1EF', 'ABCIEF', 'ABCLEF',
    // Wrong lengths and junk.
    '', '   ', 'ABCDE', 'ABCDEFG', 'ABCD!F', '123456', null, undefined, 42, {}, [],
  ];

  it('return the same answer for every input, valid and invalid', () => {
    for (const input of cases) {
      expect(
        normalizeReferralCodeClient(input),
        `disagreement on ${JSON.stringify(input)} — the client and server normalisers have drifted`,
      ).toBe(normalizeReferralCode(input));
    }
  });

  it('agree on every code the server can actually mint', () => {
    // The strongest version of the check: generate real codes and confirm the client accepts them.
    for (let i = 0; i < 200; i++) {
      const bytes = new Uint8Array(CODE_LENGTH);
      for (let b = 0; b < CODE_LENGTH; b++) bytes[b] = (i * 37 + b * 11) % 256;
      const code = mintReferralCode(() => bytes);
      expect(code).toHaveLength(CODE_LENGTH);
      expect(normalizeReferralCodeClient(code)).toBe(code);
      expect(normalizeReferralCode(code)).toBe(code);
    }
  });

  it('the alphabet itself excludes every confusable glyph', () => {
    // The support-ticket class this alphabet exists to remove: a reader who cannot tell 0 from O.
    for (const ch of '01OIL') expect(CODE_ALPHABET, ch).not.toContain(ch);
    expect(CODE_ALPHABET.length).toBe(31);
  });
});
