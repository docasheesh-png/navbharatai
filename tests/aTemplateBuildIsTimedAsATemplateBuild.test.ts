// AUTOPSY 4a1c0157 (2026-10-01): a starter chip's login page was promised ~11 min and took 3.8.
//
// The prompt was a starter chip's own text, so the tested "Login page" template was seeded and the job
// was to verify and polish it. Routing knew this (`COMPLEXITY_ROUTING`: "simple (score 58, scaffold)").
// The ETA did not. It asked the platform how long recent `complex_app` builds take (19 builds,
// ~11 min) and showed that. Two minutes in, the strip said "~9 min to go" while the build was in its
// final checks. And the same key poured every short template build into the `complex_app` average,
// pulling a real from-scratch complex build's estimate down.
//
// The class: two subsystems answered "what kind of build is this?" differently. Now one key decides
// both the history a build is counted under and the history its estimate reads.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  etaTaskKey, SCAFFOLD_TASK_KEY, fleetHistoryFromTelemetry, fleetEtaBasisNote,
} from '../src/server/AgentV3/etaHistory';
import { estimateBuildTime } from '../src/server/lib/BuildTimeEstimator';
import { foldCostTelemetry } from '../src/server/AgentV3/AgentV3CostTelemetry';

const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '');

const MIN = 60_000;
const complexity = { moduleCount: 6, featureCount: 12 };

describe('a seeded template is its own kind of build', () => {
  it('the key is the template kind when seeded, the analyser task type otherwise', () => {
    expect(etaTaskKey('complex_app', true)).toBe(SCAFFOLD_TASK_KEY);
    expect(etaTaskKey('complex_app', false)).toBe('complex_app');
    expect(etaTaskKey(null, false)).toBe('unknown');
    expect(etaTaskKey('  ', false)).toBe('unknown');
  });

  it('the report\'s own numbers: the template slice gives ~4 min where the complex slice gave ~11', () => {
    const day = (date: string) => ({
      date,
      byTaskType: {
        complex_app: { builds: 4, durationMs: 4 * 11 * MIN, okBuilds: 4, okDurationMs: 4 * 11 * MIN },
        [SCAFFOLD_TASK_KEY]: { builds: 3, durationMs: 3 * 3.8 * MIN, okBuilds: 3, okDurationMs: 3 * 3.8 * MIN },
      },
    });
    const days = ['2026-10-01', '2026-09-30', '2026-09-29', '2026-09-28', '2026-09-27'].map(day);
    const complex = fleetHistoryFromTelemetry(days, etaTaskKey('complex_app', false), complexity);
    const seeded = fleetHistoryFromTelemetry(days, etaTaskKey('complex_app', true), complexity);
    const estComplex = estimateBuildTime(complexity, complex.history);
    const estSeeded = estimateBuildTime(complexity, seeded.history);
    expect(estComplex.estimateMs).toBeGreaterThan(9 * MIN);
    expect(estSeeded.estimateMs).toBeLessThan(5 * MIN);
    expect(estSeeded.highMs).toBeGreaterThan(3.8 * MIN);
  });

  it('a template build is folded into its own slice, not into complex_app', () => {
    const doc = foldCostTelemetry(null, '2026-10-01', {
      taskType: etaTaskKey('complex_app', true), startTier: 'gemini', billedUsd: 0.24, inputTokens: 1, outputTokens: 1,
      ok: true, durationMs: 226_201, powerMode: false,
    } as any, Date.now());
    expect(doc.byTaskType[SCAFFOLD_TASK_KEY]?.builds).toBe(1);
    expect(doc.byTaskType.complex_app).toBeUndefined();
  });

  it('the admin line names the kind in words', () => {
    expect(fleetEtaBasisNote(SCAFFOLD_TASK_KEY, 5, 3)).toContain('start from a tested template');
    expect(fleetEtaBasisNote('complex_app', 19, 5)).toContain('"complex_app" builds');
  });
});

describe('the route asks one question in both places', () => {
  it('the ETA reads the slice routing chose, before the estimate is made', () => {
    const decided = route.indexOf('const scaffoldWillSeed =');
    const asked = route.indexOf('etaTaskKey(analysis.taskType, scaffoldWillSeed)');
    expect(decided).toBeGreaterThan(0);
    expect(asked).toBeGreaterThan(decided);
    expect(route).toContain('fleetHistoryFromTelemetry(await withTimeout(agentV3CostTelemetry.list(7), 3_000, \'eta-fleet\'), etaFleetKey, etaComplexity)');
  });

  it('the telemetry counts the build under the template kind when the template was seeded', () => {
    expect(route).toMatch(/\.record\(\{\s*taskType: etaTaskKey\(analysis\?\.taskType, goldenPreseeded\),/);
  });
});
