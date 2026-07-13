import { describe, it, expect } from 'vitest';
import { toPowerLevel, powerSpec } from './powerLevel';
import { NORMAL_MULTIPLIER, SONNET_MULTIPLIER, OPUS_MULTIPLIER } from './pricing';

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

  it('mini / Strong: SONNET pinned 100%, no forced effort, Sonnet × 3 billing (admin 2026-07-13; was Opus low)', () => {
    const s = powerSpec('mini');
    expect(s.powerMode).toBe(true);
    expect(s.pinnedModel).toBe('sonnet');   // never Opus on this tier
    expect(s.effort).toBeUndefined();       // Sonnet runs at its own default reasoning
    expect(s.multiplier).toBe(SONNET_MULTIPLIER); // Sonnet work bills Sonnet × 3, never Opus rates
  });

  it('medium / Powerful: Opus MEDIUM effort, real Opus × 2 (admin 2026-07-13; was high)', () => {
    const s = powerSpec('medium');
    expect(s.powerMode).toBe(true);
    expect(s.pinnedModel).toBe('opus');
    expect(s.effort).toBe('medium');
    expect(s.multiplier).toBe(OPUS_MULTIPLIER);
  });

  it('max / Full Team (ultracode): Opus max effort, real Opus × 2', () => {
    const s = powerSpec('max');
    expect(s.powerMode).toBe(true);
    expect(s.pinnedModel).toBe('opus');
    expect(s.effort).toBe('max');
    expect(s.multiplier).toBe(OPUS_MULTIPLIER);
  });

  it('weak: cheap-only, never Claude — no pinned Claude model, cheap billing', () => {
    const s = powerSpec('weak');
    expect(s.powerMode).toBe(false);
    expect(s.cheapOnly).toBe(true);
    expect(s.pinnedModel).toBeUndefined();
    expect(s.multiplier).toBe(NORMAL_MULTIPLIER);
  });

  it('billing follows the pinned model: only the OPUS tiers bill × 2; Strong bills Sonnet × 3', () => {
    expect(powerSpec('mini').multiplier).toBe(SONNET_MULTIPLIER);
    expect(powerSpec('medium').multiplier).toBe(OPUS_MULTIPLIER);
    expect(powerSpec('max').multiplier).toBe(OPUS_MULTIPLIER);
  });
});
