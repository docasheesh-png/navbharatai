/**
 * A WARNING LEFT OPEN IS NOT A REPAIR (admin Builder scorecard, 2026-09-30).
 *
 * The card read:
 *   "Most-repaired: READINESS_WARNING ×305 (130 builds), TOOL_ERROR ×114 (65 builds),
 *    PREVIEW_SNAPSHOT_STALE ×105 (105 builds), SANDBOX_CMD_FAILED ×46, EMPTY_BUILD_RETRY ×20,
 *    USAGE_NOT_REPORTED ×10 — 629 repair(s) named."
 *
 * Three of the six repaired nothing. A readiness warning is recorded `autoResolved: true` because it
 * does not BLOCK — an import cycle, an unused component, a requested feature never built — and it is
 * still in the app when the build ends. A stale snapshot stayed stale. A provider that reported no
 * usage is a measurement gap. So 420 of the 629 "repairs" were findings nobody fixed, and the one
 * number the 50/50 law is read from counted shipped imperfections as heals.
 *
 * They now count as LEFT OPEN — never dropped, never a heal — and older stored reports are corrected
 * on read, so the admin's card is right about the builds already recorded, not only future ones.
 */
import { describe, it, expect } from 'vitest';
import { isSelfHeal, isLeftOpen, healCountOf, HEAL_RULE, NOT_A_REPAIR_CODES } from '../src/lib/healIssue';
import { summarizeHealCodes } from '../src/server/AgentV3/healBreakdown';
import { classifyFirstPass, firstPassStatsFromMeta } from '../src/lib/firstPassQuality';
import { toMetricInput } from '../src/server/lib/scorecardPopulation';
import { builderScorecard, scorecardHeadline } from '../src/lib/builderMetrics';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

const warn = (code: string) => ({ code, severity: 'warning', autoResolved: true });

describe('1 · the definition', () => {
  it('🔴 the three codes from the card that repaired nothing are not heals — they are left open', () => {
    for (const code of ['READINESS_WARNING', 'PREVIEW_SNAPSHOT_STALE', 'USAGE_NOT_REPORTED']) {
      expect(isSelfHeal(warn(code)), code).toBe(false);
      expect(isLeftOpen(warn(code)), code).toBe(true);
    }
  });
  it('an undone repair and a review that never ran are not heals either', () => {
    for (const code of ['RUNTIME_FIX_REGRESSED', 'DESIGN_HEAL_REVERTED', 'CHEAP_REVIEW_NOT_RUN']) {
      expect(NOT_A_REPAIR_CODES.has(code), code).toBe(true);
      expect(isSelfHeal(warn(code)), code).toBe(false);
    }
  });
  it('🔒 a real repair is still a heal, and is not left open', () => {
    for (const code of ['TOOL_ERROR', 'SANDBOX_CMD_FAILED', 'DESIGN_HEALED', 'HTML_ENTRY_REPAIRED']) {
      expect(isSelfHeal(warn(code)), code).toBe(true);
      expect(isLeftOpen(warn(code)), code).toBe(false);
    }
  });
  it('an info row of a left-open code is neither', () => {
    expect(isLeftOpen({ code: 'PREVIEW_SNAPSHOT_STALE', severity: 'info', autoResolved: true })).toBe(false);
  });
});

describe('2 · the recorder', () => {
  it('a build that ends with readiness warnings counts them as left open, not as heals', () => {
    const d = new BuildDiagnostics('ws', 'sess');
    d.record({ phase: 'build', severity: 'warning', code: 'DESIGN_HEALED', message: 'two pages repaired', autoResolved: true });
    d.ingestEvent({ type: 'done', ok: true, summary: 'done', readiness: { ready: true, blockers: [], warnings: ['2 import cycle(s)', 'Requested feature not found: search'] } } as never);
    const c = d.report().counts;
    expect(c.autoResolved).toBe(1);
    expect(c.leftOpen).toBe(2);
    expect(c.healRule).toBe(HEAL_RULE);
  });
});

describe('3 · reports already stored are corrected on read', () => {
  const issues = [warn('READINESS_WARNING'), warn('READINESS_WARNING'), warn('READINESS_WARNING'), warn('TOOL_ERROR'), warn('TOOL_ERROR')];
  it('an older report (no healRule) loses the left-open rows its count included', () => {
    const legacy = { counts: { autoResolved: 5 }, issues };
    expect(healCountOf(legacy)).toBe(2);
    expect(summarizeHealCodes(legacy)).toEqual({ codes: { TOOL_ERROR: 2 }, total: 2, unattributed: 0, open: { READINESS_WARNING: 3 } });
  });
  it('a new report is never corrected twice', () => {
    const current = { counts: { autoResolved: 2, leftOpen: 3, healRule: HEAL_RULE }, issues };
    expect(healCountOf(current)).toBe(2);
    expect(summarizeHealCodes(current)?.total).toBe(2);
  });
  it('no count ⇒ null, never zero', () => {
    expect(healCountOf({ issues })).toBeNull();
  });
  it('the scorecard reads the corrected count, not the stored one', () => {
    const legacy = { counts: { autoResolved: 5 }, issues };
    const input = toMetricInput({ workspaceId: 'w', startedAt: 1, endedAt: 2, ok: true, counts: legacy.counts, healCodes: summarizeHealCodes(legacy) });
    expect(input.healCount).toBe(2);
  });
});

describe('4 · the card says it', () => {
  it('🔴 READINESS_WARNING leaves "Most-repaired" and appears as left open', () => {
    const legacy = { counts: { autoResolved: 5 }, issues: [warn('READINESS_WARNING'), warn('READINESS_WARNING'), warn('READINESS_WARNING'), warn('TOOL_ERROR'), warn('TOOL_ERROR')] };
    const tally = summarizeHealCodes(legacy)!;
    const card = builderScorecard([{ workspaceId: 'w', reportedAt: 1, ok: true, healCount: tally.total, healCodes: tally }]);
    expect(card.healCodes.top.map((r) => r.code)).toEqual(['TOOL_ERROR']);
    expect(card.healCodes.openTop).toEqual([{ code: 'READINESS_WARNING', heals: 3, builds: 1 }]);
    const headline = scorecardHeadline(card);
    expect(headline).toMatch(/Most-repaired: TOOL_ERROR ×2/);
    expect(headline).toMatch(/Left open, not repaired: READINESS_WARNING ×3 \(1 build\)/);
  });
});

describe('5 · first-pass quality does not get better by renaming', () => {
  it('a build whose only findings were left open is still not right first time — old or new report', () => {
    expect(classifyFirstPass({ ok: true, counts: { autoResolved: 0, unresolved: 0, leftOpen: 2 } })).toBe('healed');
    expect(classifyFirstPass({ ok: true, counts: { autoResolved: 2, unresolved: 0 } })).toBe('healed');
    expect(classifyFirstPass({ ok: true, counts: { autoResolved: 0, unresolved: 0, leftOpen: 0 } })).toBe('clean');
  });
  it('the admin-report projection carries it too', () => {
    const s = firstPassStatsFromMeta([{ ok: true, healCount: 0, unresolvedCount: 0, leftOpenCount: 1 }]);
    expect(s.clean).toBe(0);
    expect(s.healed).toBe(1);
  });
});

describe('6 · a build its own user stopped is neither a failure nor a stuck project', () => {
  // Two of the four "stuck projects" on the 2026-09-30 card said, in their own root cause, "STOPPED BY
  // THE USER — no failure of the app or the engine is implied". The failure panel already excluded
  // them (`isUserStoppedBuild`); the scorecard did not.
  const b = (ws: string, t: number, ok: boolean, userStopped?: boolean) => ({ workspaceId: ws, reportedAt: t, ok, userStopped });

  it('🔴 the card: a project whose latest build was a Stop is not stuck, and the Stop is not a failure', () => {
    const card = builderScorecard([b('a', 1, true), b('a', 2, false, true), b('c', 1, true), b('c', 2, false)]);
    expect(card.survival.broken.map((p) => p.workspaceId)).toEqual(['c']);
    expect(card.survival.stoppedByUser).toBe(1);
    expect(card.success).toMatchObject({ total: 3, succeeded: 2, failed: 1, stoppedByUser: 1, skipped: 0 });
    expect(scorecardHeadline(card)).toMatch(/Stopped by their own user: 1 build/);
  });

  it('a stop that is NOT the user (no flag) still counts, and the history row carries the flag', () => {
    expect(builderScorecard([b('x', 1, false)]).success.failed).toBe(1);
    expect(toMetricInput({ workspaceId: 'w', startedAt: 1, endedAt: 2, ok: false, userStopped: true }).userStopped).toBe(true);
    expect(toMetricInput({ workspaceId: 'w', startedAt: 1, endedAt: 2, ok: false }).userStopped).toBeUndefined();
  });
});
