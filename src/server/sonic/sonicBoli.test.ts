import { describe, it, expect } from 'vitest';
import { BOLI_OPTIONS, boliClause, parseBoli, type SonicBoli } from './sonicBoli';

describe('sonicBoli — regional tone flavour (never a language switch)', () => {
  it('neutral has no clause (today\'s default behaviour)', () => {
    expect(boliClause('neutral')).toBe('');
  });

  it('every non-neutral boli produces a clause that RE-ASSERTS keeping the user\'s language', () => {
    for (const o of BOLI_OPTIONS) {
      if (o.id === 'neutral') continue;
      const c = boliClause(o.id);
      expect(c.length).toBeGreaterThan(0);
      // The hard rule: colour the tone, keep the language the user speaks.
      expect(c).toContain('SAME language');
      expect(c).toContain('NEVER switch');
    }
  });

  it('parseBoli accepts known ids and falls back to neutral for anything else', () => {
    expect(parseBoli('punjabi')).toBe('punjabi');
    expect(parseBoli(' bhojpuri ')).toBe('bhojpuri');
    expect(parseBoli('klingon')).toBe('neutral'); // unknown → safe default
    expect(parseBoli(null)).toBe('neutral');
    expect(parseBoli(undefined)).toBe('neutral');
    expect(parseBoli('')).toBe('neutral');
  });

  it('an unknown id passed straight to boliClause yields no clause (defensive)', () => {
    expect(boliClause('nope' as SonicBoli)).toBe('');
  });

  it('the picker list is non-empty and leads with neutral', () => {
    expect(BOLI_OPTIONS.length).toBeGreaterThan(1);
    expect(BOLI_OPTIONS[0].id).toBe('neutral');
  });
});
