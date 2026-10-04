// CHANGE ENGINE slice 2 (2026-10-04) — a working feature an edit removed is RESTORED by the same bounded
// feature heal that adds a missing requested one. No new repair engine: the regression joins the existing
// heal's target list, inside the existing verify-after-fix net, behind the existing heal cohort gate.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { featurePresenceRepairPrompt, checkFeaturePresence } from '../src/server/AgentV3/FeaturePresence';

const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');

describe('the repair prompt says RESTORE, not build', () => {
  const none = { probes: [], missing: [], present: [] };
  it('a regression alone is a restore instruction', () => {
    const p = featurePresenceRepairPrompt(none, ['Delete / remove']);
    expect(p).toMatch(/WORKED in this app before the current change/);
    expect(p).toMatch(/do not redesign/);
    expect(p).toContain('Delete / remove');
    expect(p).not.toMatch(/REQUESTED features/);
  });
  it('requested-missing and regressed are named separately, and a label is never listed twice', () => {
    const r = { probes: [], missing: ['Search'], present: [] };
    const p = featurePresenceRepairPrompt(r, ['Search', 'Delete / remove']);
    expect(p.match(/Search/g)).toHaveLength(1);
    expect(p).toMatch(/REQUESTED features[\s\S]*Search[\s\S]*WORKED[\s\S]*Delete/);
  });
  it('nothing to do is still the empty string (old behaviour unchanged)', () => {
    expect(featurePresenceRepairPrompt(none)).toBe('');
    expect(featurePresenceRepairPrompt(checkFeaturePresence('add tasks', '<form><input/><button>Add</button></form><ul><li>a</li></ul>'))).toBe('');
  });
});

describe('the route wires the regression into the existing heal', () => {
  const probeAt = src.indexOf('regressedBeforeHeal = regressionsSoFar(changeSession);');
  const healAt = src.indexOf('(coverage.missing.length > 0 || regressedLabels.length > 0) && featureHealEnabled(workspaceId)');
  const reportAt = src.indexOf("code: 'FEATURE_REGRESSED'");
  it('the regression is probed BEFORE the heal decision and reported AFTER it', () => {
    expect(probeAt).toBeGreaterThan(0);
    expect(healAt).toBeGreaterThan(probeAt);
    expect(reportAt).toBeGreaterThan(healAt);
  });
  it('the heal is the existing one, under the existing cohort gate and the verify-after-fix net', () => {
    expect(src).toMatch(/featureRunner\.run\(featurePresenceRepairPrompt\(coverage, regressedLabels\)\)/);
    const healBlock = src.slice(healAt, reportAt);
    expect(healBlock).toMatch(/verifyAfterFix</);
    expect(healBlock).toMatch(/runInPass\('feature-presence-heal'/);
  });
  it('the heal is re-checked after it runs, and a restore is recorded honestly', () => {
    expect(src.slice(healAt, reportAt).match(/await reprobeRegressions\(/g)).toHaveLength(2);
    expect(src).toMatch(/code: 'FEATURE_REGRESSION_HEALED'/);
  });
});
