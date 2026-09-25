/**
 * A TOOL CALL IS NOT A REPAIR (admin's Builder scorecard, 2026-09-25 03:01 UTC).
 *
 * The card's "Most-repaired" line read: TOOL_DONE ×10313 (236 builds), TOOL_CALL ×10171, AGENT_STEP
 * ×6903, EVENT ×4724, HEARTBEAT ×3431, SANDBOX_CMD ×2300 — "44324 repair(s) named" across 264 builds.
 * Two lines above it the same card said 3.36 repairs per build (887 in total). Both numbers came from
 * the same reports. The breakdown counted `autoResolved === true`; the recorder's `counts.autoResolved`
 * counts a strict subset of that (no info rows, no observations, no narration, no workaround codes),
 * because every tool call, heartbeat and narration line is recorded `info, autoResolved: true` so that
 * it never counts as an UNRESOLVED defect. Same word, two definitions, in two modules — and a third
 * in `firstPassQuality.topHealCodes`.
 *
 * And the second line on the same card, "Workarounds: 100.0% of 165 build(s)", was true by
 * construction: the recorder wrote `counts.workarounds` only when it was above zero, and the scorecard
 * excludes a build with no recorded count, so every counted build had one.
 *
 * This file locks both halves: ONE predicate that the recorder, the breakdown and the first-pass list
 * all call, proven on a REAL BuildDiagnostics instance rather than on fixtures that happen to agree;
 * and a workaround count whose zero is recorded, derived from a complete timeline for old rows, and
 * left honestly unknown when the timeline was trimmed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isSelfHeal, isWorkaroundIssue, isNarrationIssue, isTimelineComplete, workaroundCountOf,
  WORKAROUND_CODES, NARRATION_CODES,
} from '../src/lib/healIssue';
import { summarizeHealCodes } from '../src/server/AgentV3/healBreakdown';
import { firstPassStats } from '../src/lib/firstPassQuality';
import { toMetricInput } from '../src/server/lib/scorecardPopulation';
import { workaroundPressure, healBreakdown, scorecardHeadline, builderScorecard } from '../src/lib/builderMetrics';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The six codes the admin's card ranked as the most-repaired. Not one is a repair. */
const PROCESS_ROWS = [
  { code: 'TOOL_DONE', severity: 'info', autoResolved: true },
  { code: 'TOOL_CALL', severity: 'info', autoResolved: true },
  { code: 'AGENT_STEP', severity: 'info', autoResolved: true },
  { code: 'EVENT', severity: 'info', autoResolved: true },
  { code: 'HEARTBEAT', severity: 'info', autoResolved: true },
  { code: 'SANDBOX_CMD', severity: 'info', autoResolved: true },
];

describe('isSelfHeal — the one definition', () => {
  it('🔴 none of the six codes the card ranked as "most-repaired" is a heal', () => {
    for (const row of PROCESS_ROWS) expect(isSelfHeal(row), row.code).toBe(false);
  });
  it('an auto-resolved WARNING or ERROR is a heal', () => {
    expect(isSelfHeal({ code: 'DESIGN_HEALED', severity: 'warning', autoResolved: true })).toBe(true);
    expect(isSelfHeal({ code: 'PREVIEW_COMPILE_HEALED', severity: 'error', autoResolved: true })).toBe(true);
  });
  it('an unresolved row, an observation, narration and a workaround are not heals', () => {
    expect(isSelfHeal({ code: 'TOOL_ERROR', severity: 'error', autoResolved: false })).toBe(false);
    expect(isSelfHeal({ code: 'IMPORT_OBSERVATION', severity: 'warning', autoResolved: true, observation: true })).toBe(false);
    expect(isSelfHeal({ code: 'AGENT_NOTE', severity: 'warning', autoResolved: true })).toBe(false);
    expect(isSelfHeal({ code: 'PROVIDER_FALLBACK', severity: 'warning', autoResolved: true })).toBe(false);
  });
  it('null, undefined and a malformed row are never heals', () => {
    expect(isSelfHeal(null)).toBe(false);
    expect(isSelfHeal(undefined)).toBe(false);
    expect(isSelfHeal({ autoResolved: 'true' })).toBe(false);
  });
  it('the shared code lists carry what the recorder used to hold privately', () => {
    for (const c of ['PROVIDER_FALLBACK', 'SIMPLE_BUILD_FALLBACK', 'ONESHOT_FALLBACK', 'SIMPLE_BUILD_OUTCOME']) {
      expect(WORKAROUND_CODES.has(c), c).toBe(true);
    }
    expect([...NARRATION_CODES].sort()).toEqual(['AGENT_NOTE', 'AGENT_STEP']);
    expect(isNarrationIssue({ code: 'AGENT_STEP' })).toBe(true);
    expect(isWorkaroundIssue({ code: 'PROVIDER_FALLBACK', severity: 'warning' })).toBe(true);
    expect(isWorkaroundIssue({ code: 'PROVIDER_FALLBACK', severity: 'info' })).toBe(false);
  });
});

describe('🔒 the recorder, the breakdown and the first-pass list agree on a REAL build', () => {
  /** A build shaped like the ones on the card: a torrent of process rows around two genuine heals. */
  function realBuild(): BuildDiagnostics {
    const d = new BuildDiagnostics('ws', 'sess');
    for (let i = 0; i < 40; i++) {
      d.record({ phase: 'tool', severity: 'info', code: 'TOOL_CALL', message: `▶ write_file ${i}`, autoResolved: true });
      d.record({ phase: 'tool', severity: 'info', code: 'TOOL_DONE', message: `✓ write_file ${i}`, autoResolved: true });
    }
    for (let m = 1; m <= 5; m++) {
      d.record({ phase: 'build', severity: 'info', code: 'HEARTBEAT', message: `⏱ minute ${m} — still working`, autoResolved: true });
    }
    d.record({ phase: 'build', severity: 'info', code: 'AGENT_STEP', message: 'Reading App.tsx', autoResolved: true });
    d.record({ phase: 'build', severity: 'info', code: 'SANDBOX_CMD', message: '$ npm install → exit 0', autoResolved: true });
    d.record({ phase: 'provider', severity: 'warning', code: 'PROVIDER_FALLBACK', message: 'Provider GLM failed', autoResolved: true });
    d.record({ phase: 'build', severity: 'warning', code: 'DESIGN_HEALED', message: 'two pages repaired', autoResolved: true });
    d.record({ phase: 'preview', severity: 'error', code: 'PREVIEW_COMPILE_HEALED', message: 'compile fixed', autoResolved: true });
    d.record({ phase: 'build', severity: 'warning', code: 'IMPORT_OBSERVATION', message: 'unused dep', autoResolved: true, observation: true });
    return d;
  }

  it('the breakdown names exactly the heals the recorder counted — unattributed 0, not clamped 0', () => {
    const report = realBuild().report();
    expect(report.counts.autoResolved).toBe(2);
    const tally = summarizeHealCodes(report);
    expect(tally).toEqual({
      codes: { DESIGN_HEALED: 1, PREVIEW_COMPILE_HEALED: 1 },
      total: 2,
      unattributed: 0,
    });
    // The check that used to be neutralised: a trimmed timeline is declared again.
    const trimmed = summarizeHealCodes({ ...report, issues: report.issues.slice(0, 20) });
    expect(trimmed).toMatchObject({ codes: {}, total: 2, unattributed: 2 });
  });

  it('the first-pass work list ranks the same two codes and none of the process rows', () => {
    const s = firstPassStats([{ ...realBuild().report(), ok: true }]);
    expect(s.topHealCodes.map((h) => h.code).sort()).toEqual(['DESIGN_HEALED', 'PREVIEW_COMPILE_HEALED']);
  });

  it('🔴 the exact card: 264 builds of process rows produce no "TOOL_DONE" repair', () => {
    const builds = Array.from({ length: 12 }, (_, i) => ({
      workspaceId: `w${i}`, reportedAt: i, ok: true, buildMs: 1000,
      healCodes: summarizeHealCodes({ issues: PROCESS_ROWS, counts: { autoResolved: 0 } }),
    }));
    const b = healBreakdown(builds);
    expect(b.top).toEqual([]);
    expect(b.attributed).toBe(0);
    expect(b.unattributed).toBe(0);
  });
});

describe('the workaround rate can read something other than 100%', () => {
  it('the recorder writes the zero', () => {
    const d = new BuildDiagnostics('ws', 'sess');
    d.record({ phase: 'build', severity: 'warning', code: 'DESIGN_HEALED', message: 'fixed', autoResolved: true });
    expect(d.report().counts.workarounds).toBe(0);
  });

  it('a legacy row with a COMPLETE timeline and no field derives its count — zero included', () => {
    const d = new BuildDiagnostics('ws', 'sess');
    d.record({ phase: 'tool', severity: 'info', code: 'TOOL_CALL', message: '▶ x', autoResolved: true });
    const report = d.report();
    const legacy = { ...report, counts: { ...report.counts, workarounds: undefined } };
    expect(isTimelineComplete(legacy)).toBe(true);
    expect(workaroundCountOf(legacy)).toBe(0);
    const withFallback = { ...legacy, issues: [...legacy.issues, { ts: 1, phase: 'provider', severity: 'warning', code: 'PROVIDER_FALLBACK', message: 'x', autoResolved: true }], counts: { ...legacy.counts, total: legacy.counts.total + 1 } };
    expect(workaroundCountOf(withFallback as never)).toBe(1);
  });

  it('🔒 a TRIMMED timeline yields null, never a guessed zero', () => {
    const base = { issues: [{ code: 'A', severity: 'warning', autoResolved: true }], counts: { total: 1 } };
    expect(workaroundCountOf(base)).toBe(0);
    expect(workaroundCountOf({ ...base, counts: { total: 500 } })).toBeNull();
    expect(workaroundCountOf({ ...base, truncation: { channels: { issues: { kept: 1, total: 900 } } } })).toBeNull();
    expect(workaroundCountOf({ ...base, issues: [...base.issues, { code: 'TIMELINE_TRUNCATED', severity: 'warning', autoResolved: false }], counts: { total: 2 } })).toBeNull();
    expect(workaroundCountOf({ counts: {} })).toBeNull();
    expect(workaroundCountOf(null)).toBeNull();
  });

  it('the recorder\'s own number wins over the derivation when it exists', () => {
    expect(workaroundCountOf({ issues: [], counts: { total: 0, workarounds: 3 } })).toBe(3);
  });

  it('the collector prefers the derived count and still excludes the unknowable', () => {
    expect(toMetricInput({ workspaceId: 'w', startedAt: 1, endedAt: 2, ok: true, workaroundCount: 0 }).workaroundCount).toBe(0);
    expect(toMetricInput({ workspaceId: 'w', startedAt: 1, endedAt: 2, ok: true, counts: { workarounds: 2 } }).workaroundCount).toBe(2);
    expect(toMetricInput({ workspaceId: 'w', startedAt: 1, endedAt: 2, ok: true, workaroundCount: null }).workaroundCount).toBeUndefined();
  });

  it('🔴 with zeros recorded the rate is a measurement: 1 of 4 builds, not 100% of 1', () => {
    const rows = [0, 0, 2, 0].map((n, i) => ({ workspaceId: `w${i}`, reportedAt: i, ok: true, buildMs: 1000, workaroundCount: n }));
    const p = workaroundPressure(rows);
    expect(p).toMatchObject({ builds: 4, buildsWithWorkaround: 1, rate: 0.25 });
    const line = scorecardHeadline(builderScorecard(rows));
    expect(line).toContain('Workarounds: 25.0% of 4 build(s)');
  });
});

describe('🔒 source guards — the flag is never re-read as "heal" outside the one module', () => {
  const readers = [
    'src/server/AgentV3/BuildDiagnostics.ts',
    'src/server/AgentV3/healBreakdown.ts',
    'src/lib/firstPassQuality.ts',
  ];
  it('all three readers import isSelfHeal from src/lib/healIssue', () => {
    for (const p of readers) {
      expect(strip(src(p)), p).toMatch(/import \{[^}]*\bisSelfHeal\b[^}]*\} from '(\.\.\/)*(\.\/)?(lib\/)?healIssue'/);
    }
  });
  it('the recorder\'s tally and the breakdown both call it, and neither keeps a private predicate', () => {
    const bd = strip(src('src/server/AgentV3/BuildDiagnostics.ts'));
    expect(bd).toContain('counted.filter(isSelfHeal)');
    expect(bd).toContain('this.issues.filter(isWorkaroundIssue)');
    expect(bd).not.toMatch(/const WORKAROUND_CODES\s*=/);
    expect(bd).not.toMatch(/const NARRATION_CODES\s*=/);
    const hb = strip(src('src/server/AgentV3/healBreakdown.ts'));
    expect(hb).toContain('if (!isSelfHeal(issue)) continue;');
    expect(hb).not.toContain('issue.autoResolved !== true');
    const fp = strip(src('src/lib/firstPassQuality.ts'));
    expect(fp).toContain('if (!isSelfHeal(i)) continue;');
  });
  it('the recorder writes `workarounds` unconditionally', () => {
    const bd = strip(src('src/server/AgentV3/BuildDiagnostics.ts'));
    expect(bd).not.toContain('workarounds > 0 ? { workarounds }');
    expect(bd).toMatch(/autoResolved,\s*workarounds,/);
  });
  it('both store readers project the derived workaround count and the collector reads it', () => {
    const ds = strip(src('src/server/AgentV3/DiagnosticsStore.ts'));
    expect(ds.split('workaroundCountOf(r)').length - 1).toBe(2);
    const sp = strip(src('src/server/lib/scorecardPopulation.ts'));
    expect(sp).toContain("typeof e.workaroundCount === 'number' ? e.workaroundCount");
  });
});
