import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { powerSpec, toPowerLevel, type PowerLevel } from '../src/server/AgentV3/powerLevel';
import { POWER_LEVELS_ORDERED, allowedPowerLevels, clampPowerForUser } from '../src/server/AgentV3/powerGating';
import { powerToTier, OPUS_MULTIPLIER } from '../src/server/AgentV3/pricing';

const panel = readFileSync(resolve(__dirname, '../src/components/agentv3/AgentV3Panel.tsx'), 'utf8');

/**
 * THREE TIERS (admin 2026-09-14, verbatim: "abhi 5 type hai — week, normal, strong, power, full team.
 * inko simple 3 me badlo, week, normal, strong. bas").
 *
 * The risk this suite exists for is not the deletion — that is visible. It is the two ways the
 * collapse goes wrong quietly: a user's stored top-tier preference silently becoming the MIDDLE tier,
 * and an Opus billing multiplier staying reachable from a tier no screen can produce.
 */
describe('there are exactly three selectable tiers', () => {
  it('the ordered list is weak → normal → strong and nothing else', () => {
    expect(POWER_LEVELS_ORDERED).toEqual(['weak', 'off', 'mini']);
    expect(allowedPowerLevels(true)).toHaveLength(3);
    expect(allowedPowerLevels(false)).toEqual(['weak']);
  });

  it('every ordered level resolves to a real spec, and each spec reports its own level', () => {
    for (const level of POWER_LEVELS_ORDERED) {
      const spec = powerSpec(level);
      expect(spec).toBeTruthy();
      expect(spec.level).toBe(level);
    }
  });

  it('the picker on screen offers exactly those three, in that order', () => {
    // A tier that exists in the engine but not in the picker is unreachable; one in the picker but
    // not the engine is a button that resolves to something else. Both are read from the same list.
    const keys = [...panel.matchAll(/\{ key: '(weak|off|mini|medium|max)', label: '/g)].map((m) => m[1]);
    expect(keys).toEqual(['weak', 'off', 'mini']);
  });
});

describe('🔴 a retired tier is carried UP, and can never become a free upgrade', () => {
  it('both retired keys resolve to Strong', () => {
    expect(toPowerLevel('medium')).toBe('mini');
    expect(toPowerLevel('max')).toBe('mini');
  });

  it('a genuinely unknown value still falls to the default — the remap is not a catch-all', () => {
    // If everything unrecognised became Strong, a typo or a hostile client would hand out the paid
    // premium tier. Only the two keys we actually retired are remapped.
    for (const junk of ['ultra', 'opus', 'full-team', 'MAX', '', 'nonsense']) {
      expect(toPowerLevel(junk)).toBe('off');
    }
  });

  it('the free-user clamp still wins over the remap', () => {
    for (const req of ['max', 'medium', 'mini', 'off', true]) {
      expect(clampPowerForUser(req, false)).toBe('weak');
    }
  });
});

describe('billing: nothing a user can CHOOSE carries the Opus multiplier any more', () => {
  it('no selectable tier bills at real-Opus × 2', () => {
    for (const level of POWER_LEVELS_ORDERED) {
      expect(powerSpec(level).multiplier).not.toBe(OPUS_MULTIPLIER);
      expect(powerToTier(level as PowerLevel)).not.toBe('opus');
    }
  });

  it('⚠️ but a HISTORICAL record still prices at the tier it was really charged', () => {
    // Retiring a choice is not rewriting what already happened. Build records written before today
    // carry 'medium'/'max' and were billed real-Opus × 2; pricing.ts must keep pricing them that way,
    // or every past Opus build silently reprices itself in the admin's cost history.
    expect(powerToTier('medium')).toBe('opus');
    expect(powerToTier('max')).toBe('opus');
  });
});
