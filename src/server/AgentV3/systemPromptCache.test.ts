import { describe, it, expect } from 'vitest';
import { splitCachedSystem, SYSTEM_BLOCK_SEPARATOR as SEP } from './systemPromptCache';

const STATIC = 'STATIC ARCHITECT BUILD RULES\n(large body)';

describe('splitCachedSystem (cache-prefix optimization — pure)', () => {
  it('splits volatile prefix blocks off the static body (the common case)', () => {
    const dateBlock = 'Today is 2026-07-19.';
    const prefBlock = 'User prefers Vite + Tailwind.';
    // The route prepends blocks to the head: [pref, date, STATIC] joined by the separator.
    const final = `${prefBlock}${SEP}${dateBlock}${SEP}${STATIC}`;
    const { system, preamble } = splitCachedSystem(final, STATIC);
    expect(system).toBe(STATIC); // static body becomes the stable cache prefix
    expect(preamble).toBe(`${prefBlock}${SEP}${dateBlock}`); // volatile prefix, trailing sep trimmed
  });

  it('returns an empty preamble when nothing was prepended (system already pure static)', () => {
    const { system, preamble } = splitCachedSystem(STATIC, STATIC);
    expect(system).toBe(STATIC);
    expect(preamble).toBe('');
  });

  it('handles a single prepended block and trims exactly one trailing separator', () => {
    const final = `ONE BLOCK${SEP}${STATIC}`;
    const { system, preamble } = splitCachedSystem(final, STATIC);
    expect(system).toBe(STATIC);
    expect(preamble).toBe('ONE BLOCK');
  });

  it('is a SAFE no-op when the final system does not end with the static body (never corrupts)', () => {
    const weird = `${STATIC}\n\nTRAILING MUTATION`;
    const { system, preamble } = splitCachedSystem(weird, STATIC);
    expect(system).toBe(weird); // unchanged
    expect(preamble).toBe('');
  });

  it('is a no-op for an empty static body', () => {
    expect(splitCachedSystem('anything', '')).toEqual({ system: 'anything', preamble: '' });
  });

  it('round-trips: re-joining preamble + separator + system reproduces the original', () => {
    const final = `A${SEP}B${SEP}${STATIC}`;
    const { system, preamble } = splitCachedSystem(final, STATIC);
    expect(`${preamble}${SEP}${system}`).toBe(final);
  });
});
