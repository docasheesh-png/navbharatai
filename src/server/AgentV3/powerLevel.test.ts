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

  it('5× (mini): Opus low effort, ×5', () => {
    const s = powerSpec('mini');
    expect(s.powerMode).toBe(true);
    expect(s.effort).toBe('low');
    expect(s.multiplier).toBe(5);
  });

  it('10× (medium): Opus medium effort, ×10', () => {
    const s = powerSpec('medium');
    expect(s.powerMode).toBe(true);
    expect(s.effort).toBe('medium');
    expect(s.multiplier).toBe(10);
  });

  it('20× (max / ultracode): Opus max effort, ×20', () => {
    const s = powerSpec('max');
    expect(s.powerMode).toBe(true);
    expect(s.effort).toBe('max');
    expect(s.multiplier).toBe(20);
  });

  it('billing multipliers increase strictly with power', () => {
    expect(powerSpec('mini').multiplier).toBeLessThan(powerSpec('medium').multiplier);
    expect(powerSpec('medium').multiplier).toBeLessThan(powerSpec('max').multiplier);
  });
});
