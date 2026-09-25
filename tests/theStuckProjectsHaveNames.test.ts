/**
 * THE SEVEN, NAMED (admin 2026-09-25: "han, karo").
 *
 * The Builder scorecard said "7 project(s) currently sitting on a failed build" and could not say
 * which seven, when, why, or whether the person in front of each one still had a working app. A
 * number with no names is a number nobody can act on — and "sitting on a failed build" is two
 * different situations: GreenGuard put the last WORKING version back (the edit was refused, the app
 * runs) or the failed attempt was left standing (a real person is looking at a broken screen).
 *
 * Every fact used here was already on the stored report (`rootCause`, `prompt`, the
 * `GREEN_GUARD_RESTORED` timeline row). This is a projection, not a new measurement, and it costs no
 * extra read: both store readers already hold the whole document.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { editSurvival, builderScorecard, scorecardHeadline, STUCK_PROJECTS_SHOWN, type BuildMetricInput } from '../src/lib/builderMetrics';
import { toMetricInput } from '../src/server/lib/scorecardPopulation';
import { restoredToGreenOf } from '../src/server/AgentV3/DiagnosticsStore';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const b = (o: Partial<BuildMetricInput> & { ok: boolean | null }): BuildMetricInput => ({
  workspaceId: 'w1', reportedAt: 1, inFlight: false, buildMs: null, billedInr: null, ...o,
});

describe('editSurvival names the stuck projects', () => {
  const rows = [
    b({ workspaceId: 'a', reportedAt: 1, ok: true }),
    b({ workspaceId: 'a', reportedAt: 2, ok: false, restoredToGreen: true, rootCause: 'tsc failed in App.tsx', prompt: 'add dark mode' }),
    b({ workspaceId: 'b', reportedAt: 1, ok: true }),
    b({ workspaceId: 'b', reportedAt: 5, ok: false, restoredToGreen: false, rootCause: 'preview served Cannot GET /' }),
    b({ workspaceId: 'b', reportedAt: 9, ok: false, restoredToGreen: false, rootCause: 'still Cannot GET /', prompt: '  fix it  ' }),
    b({ workspaceId: 'c', reportedAt: 1, ok: true }),
    b({ workspaceId: 'c', reportedAt: 3, ok: false }),
    b({ workspaceId: 'ok', reportedAt: 1, ok: true }),
    b({ workspaceId: 'ok', reportedAt: 2, ok: true }),
  ];

  it('lists exactly the currently-broken projects, newest failure first', () => {
    const s = editSurvival(rows);
    expect(s.currentlyBroken).toBe(3);
    expect(s.broken.map((p) => p.workspaceId)).toEqual(['b', 'c', 'a']);
  });

  it('carries when, how many failed in a row, the root cause and the prompt', () => {
    const p = editSurvival(rows).broken.find((x) => x.workspaceId === 'b')!;
    expect(p).toEqual({
      workspaceId: 'b', lastBuildAt: 9, failedInARow: 2, builds: 3,
      restoredToGreen: false, rootCause: 'still Cannot GET /', prompt: 'fix it',
    });
    expect(editSurvival(rows).broken.find((x) => x.workspaceId === 'a')!.failedInARow).toBe(1);
  });

  it('🔴 says whether the person still has a working app — restored, left standing, or unknown', () => {
    const s = editSurvival(rows);
    expect(s.restoredToGreen).toBe(1);
    expect(s.restoredUnknown).toBe(1);
    const byId = Object.fromEntries(s.broken.map((p) => [p.workspaceId, p.restoredToGreen]));
    expect(byId).toEqual({ a: true, b: false, c: null });
  });

  it('a later successful build removes the project from the list', () => {
    const s = editSurvival([...rows, b({ workspaceId: 'b', reportedAt: 10, ok: true })]);
    expect(s.broken.map((p) => p.workspaceId)).toEqual(['c', 'a']);
    expect(s.currentlyBroken).toBe(2);
  });

  it('a project born broken is NOT listed — it belongs to build success, not to survival', () => {
    const s = editSurvival([b({ workspaceId: 'x', reportedAt: 1, ok: false })]);
    expect(s.currentlyBroken).toBe(0);
    expect(s.broken).toEqual([]);
  });

  it('the list is bounded and the count above it is not', () => {
    const many: BuildMetricInput[] = [];
    for (let i = 0; i < STUCK_PROJECTS_SHOWN + 5; i++) {
      many.push(b({ workspaceId: `w${i}`, reportedAt: 1, ok: true }), b({ workspaceId: `w${i}`, reportedAt: 2 + i, ok: false }));
    }
    const s = editSurvival(many);
    expect(s.currentlyBroken).toBe(STUCK_PROJECTS_SHOWN + 5);
    expect(s.broken.length).toBe(STUCK_PROJECTS_SHOWN);
    expect(s.broken[0].workspaceId).toBe(`w${STUCK_PROJECTS_SHOWN + 4}`); // the newest
  });

  it('the headline splits the stuck count into restored / left standing / unknown', () => {
    const line = scorecardHeadline(builderScorecard(rows));
    expect(line).toContain('3 project(s) currently sitting on a failed build — 1 restored to the last working version, 1 left on the failed attempt, 1 unknown; named below');
  });

  it('with nothing stuck, the headline says nothing extra', () => {
    const line = scorecardHeadline(builderScorecard([b({ workspaceId: 'ok', reportedAt: 1, ok: true }), b({ workspaceId: 'ok', reportedAt: 2, ok: true })]));
    expect(line).toContain('0 project(s) currently sitting on a failed build');
    expect(line).not.toContain('restored to the last working version');
  });
});

describe('the facts travel from the stored report to the metric', () => {
  it('restoredToGreenOf reads the GreenGuard row off the timeline, and null off a report with none', () => {
    expect(restoredToGreenOf({ issues: [{ code: 'TOOL_DONE' }, { code: 'GREEN_GUARD_RESTORED' }] })).toBe(true);
    expect(restoredToGreenOf({ issues: [{ code: 'GREEN_GUARD_SAVE' }] })).toBe(false);
    expect(restoredToGreenOf({})).toBeNull();
    expect(restoredToGreenOf(null)).toBeNull();
  });

  it('toMetricInput carries rootCause, prompt and restoredToGreen — and adds NO key when absent', () => {
    const full = toMetricInput({ workspaceId: 'w', startedAt: 1, endedAt: 2, ok: false, rootCause: 'x', prompt: 'p', restoredToGreen: true });
    expect(full).toMatchObject({ rootCause: 'x', prompt: 'p', restoredToGreen: true });
    const bare = toMetricInput({ workspaceId: 'w', startedAt: 1, endedAt: 2, ok: false });
    expect('rootCause' in bare && bare.rootCause !== undefined).toBe(false);
    expect(bare.restoredToGreen).toBeUndefined();
    expect(toMetricInput({ workspaceId: 'w', startedAt: 1, endedAt: 2, ok: false, restoredToGreen: null }).restoredToGreen).toBeUndefined();
  });
});

describe('🔒 source guards — both store readers project it, and the card renders it', () => {
  it('the history reader and the all-workspaces reader both call restoredToGreenOf', () => {
    const ds = strip(src('src/server/AgentV3/DiagnosticsStore.ts'));
    expect(ds.split('restoredToGreen: restoredToGreenOf(r)').length - 1).toBe(2);
  });
  it('the collector hands all three facts to the metric', () => {
    const sp = strip(src('src/server/lib/scorecardPopulation.ts'));
    for (const k of ['rootCause:', 'prompt:', 'restoredToGreen:']) expect(sp).toContain(k);
  });
  it('the Diagnostics card lists survival.broken with the restore state in words', () => {
    const ep = strip(src('src/components/admin/EngineReportsPanel.tsx'));
    expect(ep).toContain('d.survival.broken.map(');
    expect(ep).toContain('last working version restored');
    expect(ep).toContain('failed attempt left standing');
    expect(ep).toContain('restore state unknown');
  });
});
