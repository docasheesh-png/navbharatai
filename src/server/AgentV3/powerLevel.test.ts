import { describe, it, expect } from 'vitest';
import { toPowerLevel, powerSpec } from './powerLevel';
import { NORMAL_MULTIPLIER, SONNET_MULTIPLIER, OPUS_MULTIPLIER } from './pricing';

describe('toPowerLevel', () => {
  it('maps the legacy onlyOpus boolean (true → mini, false → off)', () => {
    expect(toPowerLevel(true)).toBe('mini');
    expect(toPowerLevel(false)).toBe('off');
  });

  it('passes through the three valid power levels', () => {
    expect(toPowerLevel('weak')).toBe('weak');
    expect(toPowerLevel('off')).toBe('off');
    expect(toPowerLevel('mini')).toBe('mini');
  });

  it('🔴 the retired tiers map UP to Strong, never down to the default', () => {
    // 'medium' (Powerful) and 'max' (Full Team) were the two tiers ABOVE Strong, so a stored value
    // of either means "give me the strongest engine you have". Falling through to the unknown-input
    // default would hand exactly those users the MIDDLE tier, with nothing on screen to say their
    // choice had been changed — a silent downgrade of the people paying most.
    expect(toPowerLevel('medium')).toBe('mini');
    expect(toPowerLevel('max')).toBe('mini');
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

  it('a retired tier resolves to the Strong spec — one real tier, not a ghost of the old one', () => {
    // Whatever a stored 'medium'/'max' used to mean, it must now resolve to a spec that genuinely
    // exists. Returning an Opus-pinned spec for a tier nobody can select would leave an Opus billing
    // multiplier reachable from a preference no screen can produce.
    for (const retired of ['medium', 'max']) {
      const s = powerSpec(retired);
      expect(s.level).toBe('mini');
      expect(s).toEqual(powerSpec('mini'));
      expect(s.multiplier).not.toBe(OPUS_MULTIPLIER);
    }
  });

  it('weak: cheap-only, never Claude — no pinned Claude model, cheap billing', () => {
    const s = powerSpec('weak');
    expect(s.powerMode).toBe(false);
    expect(s.cheapOnly).toBe(true);
    expect(s.pinnedModel).toBeUndefined();
    expect(s.multiplier).toBe(NORMAL_MULTIPLIER);
  });

  it('billing follows the model the tier really runs: Strong bills Sonnet × 3, the cheap tiers × 1.2', () => {
    expect(powerSpec('mini').multiplier).toBe(SONNET_MULTIPLIER);
    expect(powerSpec('off').multiplier).toBe(NORMAL_MULTIPLIER);
    expect(powerSpec('weak').multiplier).toBe(NORMAL_MULTIPLIER);
  });

  it('no selectable tier bills at the Opus multiplier any more', () => {
    // With Powerful and Full Team retired, nothing a user can CHOOSE pins Opus — so nothing they can
    // choose may carry the real-Opus × 2 markup. (Historical build records keep their own billing:
    // pricing.ts still prices a stored 'medium'/'max' at the Opus rate it was actually charged.)
    for (const level of ['weak', 'off', 'mini'] as const) {
      expect(powerSpec(level).multiplier).not.toBe(OPUS_MULTIPLIER);
    }
  });
});
