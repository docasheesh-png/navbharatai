import { describe, it, expect } from 'vitest';
import { toPowerLevel, powerSpec } from './powerLevel';
import { NORMAL_MULTIPLIER } from './pricing';

describe('toPowerLevel', () => {
  it('maps the legacy onlyOpus boolean (true → mini, false → off)', () => {
    expect(toPowerLevel(true)).toBe('mini');
    expect(toPowerLevel(false)).toBe('off');
  });

  it('passes through the four valid power levels', () => {
    expect(toPowerLevel('off')).toBe('off');
    expect(toPowerLevel('mini')).toBe('mini');
    expect(toPowerLevel('medium')).toBe('medium');
    expect(toPowerLevel('max')).toBe('max');
  });

  it('defaults unknown / nullish input to off', () => {
    expect(toPowerLevel(undefined)).toBe('off');
    expect(toPowerLevel(null)).toBe('off');
    expect(toPowerLevel('bogus')).toBe('off');
  });
});

describe('powerSpec', () => {
  it('power OFF: normal mode, no forced effort, Sonnet billing rate', () => {
    const s = powerSpec('off');
    expect(s.powerMode).toBe(false);
    expect(s.effort).toBeUndefined();
    expect(s.multiplier).toBe(NORMAL_MULTIPLIER);
    expect(s.ceilingEffort).toBe('low'); // Opus "lowest version" escalation ceiling
  });

  it('mini: Opus low effort, flat ×2 (2026-07-05 policy)', () => {
    const s = powerSpec('mini');
    expect(s.powerMode).toBe(true);
    expect(s.effort).toBe('low');
    expect(s.multiplier).toBe(2);
  });

  it('medium (10× "Powerful Force"): Opus HIGH effort, flat ×2', () => {
    const s = powerSpec('medium');
    expect(s.powerMode).toBe(true);
    expect(s.effort).toBe('high');
    expect(s.multiplier).toBe(2);
  });

  it('max / ultracode: Opus max effort, flat ×2', () => {
    const s = powerSpec('max');
    expect(s.powerMode).toBe(true);
    expect(s.effort).toBe('max');
    expect(s.multiplier).toBe(2);
  });

  it('every power level bills the same flat ×2 (the level changes real tokens, not the multiplier)', () => {
    expect(powerSpec('mini').multiplier).toBe(2);
    expect(powerSpec('medium').multiplier).toBe(2);
    expect(powerSpec('max').multiplier).toBe(2);
  });
});
