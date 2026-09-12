import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chooseFloorLead, healthLeadEnabled, LEAD_BENCH_FLOOR_MS } from './floorLead';

/**
 * THE LEAD WAS A MONTH-OLD CONSTANT.
 *
 * `AGENTV3_FREE_KIMI_LEAD` has made KIMI lead every free build since 2026-08-02, when one autopsy
 * counted 106 GLM failures against 2. Correct that day; unexamined ever since — and the dashboard
 * shows where it ended up: 19.7M tokens through KIMI against 946 through GLM.
 *
 * These tests defend the one property that makes replacing it safe: **it only ever reorders, and only
 * when the two providers genuinely differ.** An absence of difference must never become a preference.
 */

const NOW = 1_000_000;
const facts = (coolingUntil: Record<string, number>) => ({ coolingUntil, nowMs: NOW });

describe('chooseFloorLead', () => {
  it('leads with the healthy one when the other is benched', () => {
    const d = chooseFloorLead(['GLM', 'KIMI'], facts({ GLM: NOW + 60_000 }));
    expect(d.lead).toBe('KIMI');
    expect(d.reason).toMatch(/GLM/);
  });

  it('works the other way round too — this is not a KIMI preference in disguise', () => {
    const d = chooseFloorLead(['GLM', 'KIMI'], facts({ KIMI: NOW + 60_000 }));
    expect(d.lead).toBe('GLM');
  });

  it('🔒 BOTH healthy ⇒ no opinion, so the caller keeps its existing rule', () => {
    const d = chooseFloorLead(['GLM', 'KIMI'], facts({}));
    expect(d.lead).toBeNull();
    expect(d.reason).toMatch(/healthy/i);
  });

  it('🔒 BOTH benched ⇒ still no opinion', () => {
    // Moving the first call from one failing provider to another is not an improvement, and claiming
    // to have chosen would be worse than saying there was nothing to choose between.
    const d = chooseFloorLead(['GLM', 'KIMI'], facts({ GLM: NOW + 60_000, KIMI: NOW + 30_000 }));
    expect(d.lead).toBeNull();
    expect(d.reason).toMatch(/every cheap provider/i);
  });

  it('a bench that has already expired is not a bench', () => {
    expect(chooseFloorLead(['GLM', 'KIMI'], facts({ GLM: NOW - 1 })).lead).toBeNull();
    expect(chooseFloorLead(['GLM', 'KIMI'], facts({ GLM: NOW + LEAD_BENCH_FLOOR_MS - 1 })).lead).toBeNull();
  });

  it('one provider configured ⇒ there was no choice, and it does not pretend there was', () => {
    const d = chooseFloorLead(['GLM'], facts({ GLM: NOW + 60_000 }));
    expect(d.lead).toBeNull();
    expect(d.reason).toMatch(/only one/i);
  });

  it('always explains itself, even when nothing changed', () => {
    for (const f of [facts({}), facts({ GLM: NOW + 9_000 }), facts({ GLM: NOW + 1, KIMI: NOW + 1 })]) {
      expect(chooseFloorLead(['GLM', 'KIMI'], f).reason.length).toBeGreaterThan(0);
    }
  });

  it('survives junk rather than throwing', () => {
    expect(chooseFloorLead([], facts({})).lead).toBeNull();
    expect(chooseFloorLead(['GLM', 'KIMI'], facts({ GLM: NaN as never })).lead).toBeNull();
    expect(chooseFloorLead(['GLM', 'GLM'], facts({})).reason).toMatch(/only one/i);
  });
});

describe('healthLeadEnabled', () => {
  it('is on by default — the rule it replaces is a constant that looks at nothing', () => {
    expect(healthLeadEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });

  it('off restores the frozen rules exactly', () => {
    expect(healthLeadEnabled({ AGENTV3_FLOOR_LEAD_HEALTH: 'off' } as never)).toBe(false);
    expect(healthLeadEnabled({ AGENTV3_FLOOR_LEAD_HEALTH: ' OFF ' } as never)).toBe(false);
  });
});

describe('🔒 the wiring — a reorder that drops a provider would be a capability loss', () => {
  const routes = readFileSync(resolve(__dirname, '../routes/agentv3.ts'), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

  it('the floor asks for a decision before falling back to the old rules', () => {
    const at = routes.indexOf('chooseFloorLead([');
    const freeAt = routes.indexOf('if (freeKimiLead) return balanceFloorLead');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(freeAt);
  });

  it('🔒 it REORDERS through balanceFloorLead, which keeps every runner', () => {
    // balanceFloorLead moves KIMI ahead of GLM and returns the rest untouched — it cannot drop a rung.
    const at = routes.indexOf('if (decision.lead)');
    expect(routes.slice(at, at + 220)).toContain('balanceFloorLead(runners,');
  });

  it('it only runs when BOTH cheap providers are present', () => {
    expect(routes).toContain('if (hasBoth && healthLeadEnabled())');
  });

  it('the choice reaches the admin build report', () => {
    expect(routes).toContain("code: 'FLOOR_LEAD'");
    expect(routes).toContain('floorLeadReason()');
  });
});
