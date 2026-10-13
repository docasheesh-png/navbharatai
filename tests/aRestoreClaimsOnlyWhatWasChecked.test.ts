/**
 * A RESTORE CLAIMS ONLY WHAT WAS CHECKED (autopsy 303e8a6f, Q-973, 2026-10-12).
 *
 * GreenGuard can put back two different bases (GreenGuard.ts `chooseRestoreBase`): the last snapshot a
 * browser saw running, or the files as they were at the START of the turn. It picks the turn start exactly
 * when that tree DIFFERS from the checked snapshot — a turn kept unverified, a manual edit — so that base was
 * never seen running. Every sentence about the restore still said "the last version that ran correctly",
 * "the last version that DID work … nothing is broken", "Restored the last verified-working version", and the
 * admin scorecard counted it as "last working version restored".
 *
 * The class: a claim about a restore that does not depend on which base was restored. The lock: every
 * producer of restore text is called with the unchecked base and must make no verification claim.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { greenGuardMessage, greenGuardRestoredRecord, restorePlan, GREEN_RESTORE_UNCHECKED_DETAIL } from '../src/server/AgentV3/GreenGuard';
import { greenGuardSummaryCorrection, withGreenGuardCorrection } from '../src/server/AgentV3/greenGuardHonesty';
import { restoredToGreenOf, restoredUncheckedOf } from '../src/server/AgentV3/DiagnosticsStore';
import { editSurvival, builderScorecard, scorecardHeadline, type BuildMetricInput } from '../src/lib/builderMetrics';
import { toMetricInput } from '../src/server/lib/scorecardPopulation';
import { codeOnly } from './helpers/sourceSlice';

const plan = restorePlan({ 'src/App.tsx': 'GOOD' }, { 'src/App.tsx': 'BAD', 'src/New.tsx': 'NEW' });
/** Words that assert the restored version was seen running. */
const CLAIMS_A_CHECK = /ran correctly|did work|verified|working version|working app is back|nothing is broken/i;

describe('every producer of restore text, given the unchecked base, claims no check', () => {
  const producers: Array<[string, string]> = [
    ['the chat narration', greenGuardMessage(plan, 'turn-start')],
    ['the admin report row', greenGuardRestoredRecord(plan, 'turn-start').message],
    ['the summary correction', greenGuardSummaryCorrection({ restored: 1, removed: 1, unchecked: true })],
    ['the summary as the user reads it', withGreenGuardCorrection('Done — your app is ready.', { restored: 1, removed: 1, unchecked: true })],
  ];
  for (const [name, text] of producers) {
    it(`${name} says what was put back and that it was not re-checked`, () => {
      expect(text).not.toMatch(CLAIMS_A_CHECK);
      expect(text).toMatch(/not re-checked/);
    });
  }

  it('the checked base keeps its claim — it is true there', () => {
    expect(greenGuardMessage(plan, 'green-snapshot')).toMatch(/ran correctly/);
    expect(greenGuardRestoredRecord(plan, 'green-snapshot').message).toMatch(/verified-working/);
    expect(greenGuardSummaryCorrection({ restored: 1, removed: 0 })).toMatch(/DID work/);
  });

  it('the admin row carries the base as a structured detail only when unchecked', () => {
    expect(greenGuardRestoredRecord(plan, 'turn-start').detail).toBe(GREEN_RESTORE_UNCHECKED_DETAIL);
    expect(greenGuardRestoredRecord(plan, 'green-snapshot').detail).toBeUndefined();
  });
});

describe('the scorecard counts an unchecked restore as its own state', () => {
  const unchecked = { code: 'GREEN_GUARD_RESTORED', detail: GREEN_RESTORE_UNCHECKED_DETAIL };
  const checked = { code: 'GREEN_GUARD_RESTORED' };

  it('the store reads the two bases apart', () => {
    expect(restoredToGreenOf({ issues: [unchecked] })).toBe(false);
    expect(restoredUncheckedOf({ issues: [unchecked] })).toBe(true);
    expect(restoredToGreenOf({ issues: [checked] })).toBe(true);
    expect(restoredUncheckedOf({ issues: [checked] })).toBeUndefined();
    expect(restoredUncheckedOf({ issues: [unchecked, checked] })).toBeUndefined(); // a checked restore wins
    expect(restoredUncheckedOf({})).toBeUndefined();
  });

  it('the collector passes it on only when true, so an older row keeps its shape', () => {
    expect(toMetricInput({ workspaceId: 'w', startedAt: 1, endedAt: 2, ok: false, restoredToGreen: false, restoredUnchecked: true }).restoredUnchecked).toBe(true);
    expect('restoredUnchecked' in toMetricInput({ workspaceId: 'w', startedAt: 1, endedAt: 2, ok: false })).toBe(false);
  });

  const b = (o: Partial<BuildMetricInput> & { ok: boolean | null }): BuildMetricInput => ({
    workspaceId: 'w1', reportedAt: 1, inFlight: false, buildMs: null, billedInr: null, ...o,
  });
  const rows = [
    b({ workspaceId: 'a', reportedAt: 1, ok: true }), b({ workspaceId: 'a', reportedAt: 2, ok: false, restoredToGreen: true }),
    b({ workspaceId: 'u', reportedAt: 1, ok: true }), b({ workspaceId: 'u', reportedAt: 3, ok: false, restoredToGreen: false, restoredUnchecked: true }),
    b({ workspaceId: 'f', reportedAt: 1, ok: true }), b({ workspaceId: 'f', reportedAt: 4, ok: false, restoredToGreen: false }),
  ];

  it('never as "restored to the last working version", never as "left on the failed attempt"', () => {
    const s = editSurvival(rows);
    expect(s.restoredToGreen).toBe(1);
    expect(s.restoredUnchecked).toBe(1);
    expect(s.broken.find((p) => p.workspaceId === 'u')).toMatchObject({ restoredToGreen: false, restoredUnchecked: true });
    expect('restoredUnchecked' in s.broken.find((p) => p.workspaceId === 'f')!).toBe(false);
    expect(scorecardHeadline(builderScorecard(rows))).toContain(
      '3 project(s) currently sitting on a failed build — 1 restored to the last working version, 1 put back to the pre-request version (not re-checked), 1 left on the failed attempt',
    );
  });
});

describe('🔒 the wiring', () => {
  const route = codeOnly(readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8'));
  it('the route records the restore by its base and tells the summary which base it was', () => {
    expect(route).toContain('...greenGuardRestoredRecord(plan, chosen.kind)');
    expect(route).toContain("unchecked: chosen.kind === 'turn-start'");
    expect(route).not.toContain('Restored the last verified-working version');
  });
  it('both store readers project it, and the admin card names it', () => {
    const ds = codeOnly(readFileSync(join(process.cwd(), 'src/server/AgentV3/DiagnosticsStore.ts'), 'utf8'));
    expect(ds.split('...(restoredUncheckedOf(r) ? { restoredUnchecked: true as const } : {})').length - 1).toBe(2);
    const panel = readFileSync(join(process.cwd(), 'src/components/admin/EngineReportsPanel.tsx'), 'utf8');
    expect(panel).toContain('pre-request version restored (not re-checked)');
  });
});
