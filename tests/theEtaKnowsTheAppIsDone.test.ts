// Autopsy 9c612cdb (admin, 2026-10-12) — "similar to youtube … paste link" video app, weak tier, 457.8 s.
//
// Q-1039: the live ETA line decided from TIME BUDGETS ONLY. The app was answered at 348.4 s, rendered in a
// real browser and protected at 350.0 s, and the minute-6 tick at 361.4 s still said "this is taking
// longer than I estimated — about 3 min more to go": the 3 min was the overrun floor constant, the tick
// sat INSIDE the promised band (361 s < 385 s, a 45 s pre-overrun window), and the only phase flag the
// tick read was set later, at the integrity pass. At 241 s it counted down to the top of a rough GUESS
// with no label ("~2 min to go"), and at 121 s two repair edits of one file had counted as two plan
// steps ("3 of 5 steps done · ~2 min to go" with 5.6 min left).
//
// Q-981: READY_BEFORE_END said "ran 2 more step(s) over 105s". The ready mark was an elapsed time on the
// RUNNER's clock (the runner started 65.9 s into the build, after the fast lane) and the route subtracted
// it from the BUILD's elapsed time. The real figure was 39 s.
//
// THE CLASS: a live line or a report figure computed from a budget or a lane-local clock, instead of from
// what is true now (the app's phase) and from moments (epochs). Every case below uses the report's own
// numbers.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { etaTickLine, etaPhaseLine, appRunningEtaLine, type EtaTickState } from '../src/server/AgentV3/progressEta';
import { liveEtaTick, estimateBuildTime, complexityFromPrompt } from '../src/server/lib/BuildTimeEstimator';
import { ROUGH_ESTIMATE_LABEL, roughEstimateBand } from '../src/server/AgentV3/etaEvidence';
import { endOfTurnReadyMark, readyOverrunNote } from '../src/server/AgentV3/doneSignal';
import type { ReadinessReport } from '../src/server/AgentV3/Readiness';

/** The report's prompt, verbatim. */
const PROMPT = 'Build a app where I can just similar to youtube where where there is an option for paste link and when user pasts the link then the video adds in the app and again shoss the option.. for add link ... There we could also stream the videos with no adds';
/** The report's startedAt. */
const T0 = 1_791_819_048_064;
/** The report's ETA_BASIS: midpoint, low and high of the rough band the user was shown. */
const EST = { estimateMs: 290_231, lowMs: 230_734, highMs: 385_427 };
const BAND = roughEstimateBand(EST) as string;
/** The free build window: 25 min. */
const CAP = 25 * 60_000;
const NUMBER_LEFT = /\bto go\b|\bmore to go\b|\d+\s*(?:min|s) more\b|\bleft for this one\b/;

/**
 * Where this build's ETA state stood after minute 2: the plan measurement at 121.4 s ("~2 min to go")
 * had re-anchored the budget to ~241 s and flipped `evidenced`; the plan then saturated.
 */
const state = (over: Partial<EtaTickState> = {}): EtaTickState => {
  const elapsedMs = over.elapsedMs ?? 361_400;
  return {
    elapsedMs, now: T0 + elapsedMs,
    finalChecks: false, appRenderedAt: 0,
    plannedFiles: 0, filesDone: 21, firstFileAt: T0 + 22_300,
    plannedSteps: 5, stepsDone: 5, firstStepAt: T0 + 88_000,
    evidenced: true, budgetMs: CAP,
    roughBand: BAND, roughHighMs: EST.highMs,
    totalMs: 241_000, baseMs: EST.estimateMs, revisions: 0, promisedHighMs: EST.highMs,
    ...over,
  };
};

describe('the report\'s numbers are the real ones', () => {
  it('the band the user saw is ~4–6 min', () => {
    expect(BAND).toBe('~4–6 min');
  });
  it('the old pieces, called the way the route called them, produce the two lines the user read', () => {
    // Documents the defect; the fix is asserted below. Minute 4, inside the band: a bare countdown.
    expect(liveEtaTick(241_400, 241_000, EST.estimateMs, 0, EST.highMs).text).toBe('⏱️ Still building… 4 min in · ~2 min to go');
  });
});

describe('Q-1039 · A — the app is running, so the line says so and names no number', () => {
  it('🔴 the report: at 361.4 s, with the app rendered at 350.0 s, the tick says where the build is', () => {
    const d = etaTickLine(state({ appRenderedAt: T0 + 350_000 }));
    expect(d.kind).toBe('app-running');
    expect(d.text).toBe('⏱️ 6 min in · your app is already running in the preview — I\'m finishing it');
    expect(d.text).not.toMatch(NUMBER_LEFT);
    expect(d.text).not.toMatch(/taking longer/);
  });

  it('🔒 property: from the render to the cap, no tick names a remaining time — even with a measurable plan', () => {
    // A measurable file plan would otherwise produce "12 of 19 files written · ~N min to go": the app on
    // screen outranks it (verifier's ordering: phase before measurement).
    for (let e = 350_000; e <= CAP; e += 5_000) {
      const d = etaTickLine(state({ elapsedMs: e, now: T0 + e, appRenderedAt: T0 + 350_000, plannedFiles: 40, filesDone: 12 }));
      expect(d.kind).toBe('app-running');
      expect(d.text).not.toMatch(NUMBER_LEFT);
    }
  });

  it('🔒 property: once the builder\'s loop is over, the final-checks line wins over everything', () => {
    for (let e = 0; e <= CAP; e += 15_000) {
      const d = etaTickLine(state({ elapsedMs: e, now: T0 + e, finalChecks: true, appRenderedAt: T0 + 350_000, plannedFiles: 40, filesDone: 12, evidenced: false }));
      expect(d.kind).toBe('final-checks');
      expect(d.text).toMatch(/your app is built — running the final checks/);
      expect(d.text).not.toMatch(NUMBER_LEFT);
    }
  });

  it('a phase tick changes no carried state', () => {
    const s = state({ appRenderedAt: T0 + 350_000, revisions: 1, totalMs: 500_000 });
    const d = etaTickLine(s);
    expect([d.totalMs, d.revisions, d.evidenced]).toEqual([s.totalMs, s.revisions, s.evidenced]);
  });

  it('the transition line is the same line the tick shows, and null when no phase applies', () => {
    expect(etaPhaseLine({ elapsedMs: 350_000, finalChecks: false, appRenderedAt: T0 + 350_000 })).toBe(appRunningEtaLine(350_000));
    expect(etaPhaseLine({ elapsedMs: 361_900, finalChecks: true, appRenderedAt: T0 + 350_000 })).toMatch(/^⏱️ Almost done…/);
    expect(etaPhaseLine({ elapsedMs: 100_000, finalChecks: false, appRenderedAt: 0 })).toBeNull();
  });
});

describe('Q-1039 · B — a guess keeps its label, and nothing inside the promised band is an overrun', () => {
  it('🔴 the report: at 241.4 s the countdown to the top of the rough band says it is a guess', () => {
    const d = etaTickLine(state({ elapsedMs: 241_400 }));
    expect(d.kind).toBe('rough-countdown');
    expect(d.text).toContain(ROUGH_ESTIMATE_LABEL);
    expect(d.text).toContain(BAND);
    expect(d.text).not.toBe('⏱️ Still building… 4 min in · ~2 min to go');
  });

  it('🔴 the report: liveEtaTick at 361.4 s of a band ending at 385.4 s is not an overrun', () => {
    const t = liveEtaTick(361_400, 385_427, 290_231, 0, 385_427);
    expect(t.text).not.toMatch(/taking longer/);
    expect(t.text).not.toMatch(/\d+s to go/); // no seconds-precise claim about the top of a band
    expect(t.revised).toBe(false);
    expect(t.kind).toBe('near-end');
  });

  it('🔒 property: no overrun anywhere inside a promised band, whatever the carried budget', () => {
    for (const total of [60_000, 241_000, 385_427]) {
      for (let e = 0; e <= EST.highMs; e += 1_000) {
        const t = liveEtaTick(e, total, EST.estimateMs, 0, EST.highMs);
        expect(t.revised).toBe(false);
        expect(t.text).not.toMatch(/taking longer/);
      }
    }
  });

  it('🔒 property: every countdown built on the rough band carries its label, and none uses the overrun floor', () => {
    for (let e = 0; e <= CAP; e += 10_000) {
      const d = etaTickLine(state({ elapsedMs: e, now: T0 + e }));
      if (/\bto go\b/.test(d.text)) expect(d.text).toContain(ROUGH_ESTIMATE_LABEL);
      expect(d.text).not.toMatch(/about \d+ min more to go/);
    }
  });

  it('past the top of the guess, it says the guess was too low — the unevidenced line\'s own sentence', () => {
    const d = etaTickLine(state({ elapsedMs: 400_000 }));
    expect(d.kind).toBe('rough-outrun');
    expect(d.text).toMatch(/past my rough estimate of ~4–6 min, which was a guess and was too low/);
    expect(d.revisions).toBe(0); // nothing re-baselined on a guess
  });

  it('🔒 an EVIDENCED budget keeps its overrun line (unchanged behaviour)', () => {
    // History-backed opening: no rough band. Past the top of the band, the overrun is a real overrun.
    const d = etaTickLine(state({ roughBand: null, roughHighMs: null, elapsedMs: 420_000, totalMs: 300_000 }));
    expect(d.kind).toBe('budget');
    expect(d.text).toContain('taking longer than I estimated');
    expect(d.revisions).toBe(1);
  });

  it('a measured total past the guess counts down unlabelled — it is a measurement, not the guess', () => {
    const d = etaTickLine(state({ elapsedMs: 300_000, totalMs: 600_000 }));
    expect(d.kind).toBe('budget');
    expect(d.text).toMatch(/~5 min to go$/);
  });

  it('the estimator reproduces the report\'s band from the real prompt (the fixture is not invented)', () => {
    // The real prompt sizes to 1 module and 3 features (189 s of heuristic); the app_unsized fleet slice was
    // one day's average (implied 695 s) at history weight 0.2 — together exactly the report's ETA_BASIS.
    const c = complexityFromPrompt(PROMPT);
    expect(c).toEqual({ moduleCount: 1, featureCount: 3 });
    const e = estimateBuildTime(c, [{ complexity: c, durationMs: 695_155 }]);
    expect([e.estimateMs, e.lowMs, e.highMs, e.historyWeight, e.confidence]).toEqual([EST.estimateMs, EST.lowMs, EST.highMs, 0.2, 0.59]);
  });
});

describe('Q-1039 · the ETA counts a file once, however often it is repaired', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  const PLAN = 5;
  // The report's writes between the plan (85.4 s) and the minute-2 tick (121.4 s).
  const writes = ['src/hooks/useVideoList.ts', 'src/hooks/useVideoList.ts', 'src/utils/videoExtractor.ts'];

  it('🔴 the report: two edits of useVideoList.ts and one new file are two steps, not three — no "3 of 5"', () => {
    const asCountedBefore = etaTickLine(state({ elapsedMs: 121_400, evidenced: false, plannedSteps: PLAN, stepsDone: writes.length }));
    expect(asCountedBefore.text).toContain('3 of 5 steps done · ~2 min to go'); // what the user read
    const d = etaTickLine(state({ elapsedMs: 121_400, evidenced: false, plannedSteps: PLAN, stepsDone: new Set(writes).size }));
    expect(d.kind).not.toBe('measured-steps');
    expect(d.text).not.toMatch(/steps done/);
  });

  it('🔒 the tick reads the distinct-path count; the plan ticks and the futility breaker keep the write count', () => {
    const call = route.slice(route.indexOf('const decision = etaTickLine({'), route.indexOf('});', route.indexOf('const decision = etaTickLine({')));
    expect(call).toContain('stepsDone: etaStepPaths.size');
    expect(call).not.toContain('etaStepsDone');
    expect(route).toContain('noteEtaPlanStep(cur.length, planSteps, path)');
    expect(route).toContain('if (path) etaStepPaths.add(path);');
    expect(route).toContain('state.setTodos(computePlanProgress(cur, planSteps, false));');
    expect(route.match(/stepsDone: etaStepsDone \}/g)?.length).toBeGreaterThanOrEqual(3); // futility inputs, unchanged
  });
});

describe('Q-1039 · the wiring — one decision, fed every fact, told the moment a phase begins', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  const code = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('🔒 census: the route makes no ETA decision of its own — every tick goes through etaTickLine', () => {
    for (const fn of ['liveEtaTick(', 'measuredRemainingMs(', 'measuredRemainingFromSteps(', 'unevidencedEtaTickLine(', 'finalChecksEtaLine(', 'measuredEtaText(', 'stepEtaText(']) {
      expect(code.includes(fn), `the route calls ${fn} directly`).toBe(false);
    }
    expect(code.match(/etaTickLine\(\{/g)?.length).toBe(1);
  });

  it('the tick hands it the phase facts and carries its state back', () => {
    const at = code.indexOf('const decision = etaTickLine({');
    const call = code.slice(at, code.indexOf('});', at));
    expect(call).toContain('finalChecks: etaFinalChecks, appRenderedAt: etaAppRenderedAt');
    expect(call).toContain('totalMs: etaTotalMs, baseMs: etaBaseMs, revisions: etaRevisions, promisedHighMs: etaPromisedHighMs');
    const after = code.slice(at, at + 1400);
    expect(after).toContain('etaTotalMs = decision.totalMs;');
    expect(after).toContain('etaRevisions = decision.revisions;');
    expect(after).toContain('etaEvidenced = decision.evidenced;');
  });

  it('🔴 the app-rendered moment is recorded where the green is saved, and announced at once', () => {
    expect(code).toMatch(/if \(st === 'saved'\) \{\s*inBuildGreenAt = Date\.now\(\);\s*etaAppRenderedAt = inBuildGreenAt;[\s\S]{0,400}emitEtaPhaseNow\(\);/);
    // Hoisted beside the final-checks flag, where the heartbeat can see it.
    expect(code.indexOf('let etaAppRenderedAt = 0;')).toBeGreaterThan(code.indexOf('let etaFinalChecks = false;'));
    expect(code.indexOf('let etaAppRenderedAt = 0;')).toBeLessThan(code.indexOf('const diagHeartbeatTimer'));
  });

  it('🔴 the loop\'s end flips the line when the final result settles, before READY_BEFORE_END', () => {
    const settled = code.indexOf('if (!result) result = await runner.run(buildPrompt);');
    const ready = code.indexOf("code: 'READY_BEFORE_END'");
    const set = code.indexOf('etaFinalChecks = true;', settled);
    expect(set).toBeGreaterThan(settled);
    expect(set).toBeLessThan(ready);
    // Announced at once — but only over an app that exists (never 'your app is built' after a Stop or an empty build).
    // PIN UPDATED 2026-10-13: the guard moved INTO the emitter (the chat handler is at TypeScript's control-flow limit,
    // TS2563, and an `if (a && b)` at the call was two more branches); the next test asserts the guard's body.
    expect(code.slice(set, set + 160)).toContain('emitEtaPhaseNow({ unlessStopped: abort.signal, wrote: builderWroteCount });');
  });

  it('the transition emitter speaks only while the live ETA runs and nobody is being asked', () => {
    const at = code.indexOf('const emitEtaPhaseNow = (only?: { unlessStopped: AbortSignal; wrote: () => number }): void => {');
    expect(at).toBeGreaterThan(-1);
    const body = code.slice(at, code.indexOf('};', at));
    // Never "your app is built" after a Stop or over an empty build (the guard the settle call used to carry).
    expect(body).toContain('if (only && (only.unlessStopped.aborted || only.wrote() <= 0)) return;');
    expect(body).toContain('if (!(etaTotalMs > 0 && etaStartMs > 0) || userWait.since !== null) return;');
    expect(body).toContain("id: 'eta-live'");
  });
});

describe('Q-981 · READY_BEFORE_END on one clock — fixed by #3698 (Q-976); this report\'s real numbers, through it', () => {
  // The root (a mark timed from the RUNNER's start, subtracted from the BUILD's clock) was fixed twice in parallel; the
  // merged form is #3698's (`at` + `endAt`, tests/theBanaoTodoAppMissedItems.test.ts), and this PR keeps it. What stays
  // here is 9c612cdb's own figure, so the report that found it is the fixture that proves it.
  const report = (score: number): ReadinessReport => ({ score, ready: true, blockers: [], warnings: [], tier: 'production' });

  it('🔴 the report: runner started at 65.9 s, judged finished at 322.8 s, ended at 361.9 s → over 39s, never 105s', () => {
    const RUNNER_START_MS = 65_900; // after the fast lane handed off — the origin that used to leak in
    const mark = endOfTurnReadyMark({
      existing: null, readiness: report(92), typeErrors: 0, editingExistingApp: false, wroteThisRun: true,
      step: 20, elapsedMs: 322_800 - RUNNER_START_MS, at: T0 + 322_800,
    });
    const note = readyOverrunNote(mark, 22, 361_900, { endAt: T0 + 361_900 });
    expect(note).toContain('ran 2 more step(s) over 39s');
    expect(note).not.toContain('105s');
    // The old pairing, for the record: (361.9 − (322.8 − 65.9)) = 105 s.
    expect(Math.round((361_900 - (322_800 - RUNNER_START_MS)) / 1000)).toBe(105);
  });
});
