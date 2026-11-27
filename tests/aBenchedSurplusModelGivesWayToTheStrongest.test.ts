// 🔝 A BENCHED SURPLUS MODEL GIVES WAY TO THE STRONGEST ONE LEFT (admin 2026-11-27: "jo sabse strong ho woh build kare";
// builds #2565/#2566 visibly fell to deepseek-v4.1-flash). The opening choice already ranks by coding quality, but when the
// sticky model was benched mid-build the next one was the FIRST un-benched model in the snapshot's order — the static
// registry list, where flash models come early — not the strongest still eligible.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { nextStrongestSurplusModel } from '../src/server/AI/SurplusRegistry/buildSession';
import { SURPLUS_CODING_QUALITY_ORDER } from '../src/server/AI/SurplusRegistry/config';

// The registry's own static order has the flash model early (the order the old code took).
const listOrder = ['deepseek-v4.1-flash', 'minimax-m2.5', 'glm-5.3', 'qwen3-coder', 'deepseek-v4.1-flash-1017', 'gpt-5.6-sol'];

describe('🔝 nextStrongestSurplusModel', () => {
  it('the real #2566 sequence: qwen3-coder benched → glm-5.3 (the strongest plain one left), not the list\'s first (deepseek-flash)', () => {
    expect(nextStrongestSurplusModel(listOrder, new Set(['qwen3-coder']), 'weak')).toBe('glm-5.3');
  });
  it('then glm-5.3 benched → deepseek-v4.1-flash-1017 before plain deepseek-v4.1-flash (the quality order)', () => {
    expect(nextStrongestSurplusModel(listOrder, new Set(['qwen3-coder', 'glm-5.3']), 'weak')).toBe('deepseek-v4.1-flash-1017');
  });
  // Admin 2026-11-27 (#4613): Weak may run Claude through Surplus on the guaranteed ≥90% floor (surplusModelPermitted), and
  // it ranks first — so it is the strongest one left. Outside Weak, Surplus never offers it.
  it('Claude on Weak is allowed (≥90% floor) and, ranking first, is the strongest left; never on another tier', () => {
    expect(nextStrongestSurplusModel(['claude-sonnet-5', 'glm-5.3'], new Set(), 'weak')).toBe('claude-sonnet-5');
    expect(nextStrongestSurplusModel(['claude-sonnet-5', 'glm-5.3'], new Set(), 'normal')).toBe('glm-5.3');
  });
  it('a reasoning model only when no plain one is left (the opening rule)', () => {
    expect(nextStrongestSurplusModel(['gpt-5.6-sol', 'minimax-m2.5'], new Set(), 'weak')).toBe('minimax-m2.5');
    expect(nextStrongestSurplusModel(['gpt-5.6-sol', 'minimax-m2.5'], new Set(['minimax-m2.5']), 'weak')).toBe('gpt-5.6-sol');
  });
  it('everything benched → undefined (the session keeps its own recovery)', () => {
    expect(nextStrongestSurplusModel(['glm-5.3'], new Set(['glm-5.3']), 'weak')).toBe(undefined);
  });
  it('the order it follows is the reviewed quality list, best first', () => {
    expect(SURPLUS_CODING_QUALITY_ORDER.indexOf('glm-5.3')).toBeLessThan(SURPLUS_CODING_QUALITY_ORDER.indexOf('deepseek-v4.1-flash'));
  });
  it('census: the bench path uses it — never "the first un-benched model in the snapshot"', () => {
    const src = readFileSync('src/server/AI/SurplusRegistry/buildSession.ts', 'utf8');
    expect(src).toMatch(/const alt = nextStrongestSurplusModel\(/);
    expect(src).not.toMatch(/\.map\(o => o\.model\)\.find\(m => !benchedModels\.has\(m\)/);
    expect(src).toMatch(/!benched\.has\(m\) && surplusModelPermitted\(m, tier\)/);   // one permission rule (#4613)
  });
});
