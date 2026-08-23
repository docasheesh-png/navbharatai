import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { measuredRemainingMs } from '../src/server/AgentV3/progressEta';

/**
 * MEASURED-ETA WIRING — the three connections that turn a pure function into a working fix.
 *
 * `progressEta.ts` is pure and fully covered by its own tests. But the fix only exists if three
 * separate things happen inside the build route: the plan's file count reaches it, the first file's
 * timestamp reaches it, and the heartbeat actually prefers it over the prompt guess.
 *
 * IF ANY ONE OF THEM IS DROPPED, NOTHING FAILS. No error, no failing build — the ETA just silently
 * goes back to predicting from prompt words, which is the exact defect this change exists to remove,
 * and the only symptom would be another user reporting a broken promise weeks later.
 *
 * These assertions are SOURCE-LEVEL for the same reason `cachePrefixWiring.test.ts` is: the code lives
 * inside a ~12,000-line route closure that cannot be imported or exercised in a unit test. That is a
 * weaker check than execution, chosen honestly over no check at all.
 */

const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
const simpleBuilder = readFileSync(join(process.cwd(), 'src/server/AgentV3/SimpleBuilder.ts'), 'utf8');

describe('the plan size reaches the ETA', () => {
  it('the fast lane reports its plan size through onPlanned', () => {
    // SimpleBuilder is where most builds — including the reported one — learn their real size.
    expect(simpleBuilder).toContain('deps.onPlanned?.(manifest.length)');
    expect(route).toContain('onPlanned: noteEtaPlannedFiles');
  });

  it('the blueprint lane reports its manifest size too', () => {
    expect(route).toContain('noteEtaPlannedFiles(manifest.length)');
  });

  it('onPlanned fires BEFORE the too-small bail, so a rejected plan still reports its size', () => {
    const planned = simpleBuilder.indexOf('deps.onPlanned?.(manifest.length)');
    const bail = simpleBuilder.indexOf("throw new Error('manifest_too_small')");
    expect(planned).toBeGreaterThan(-1);
    expect(bail).toBeGreaterThan(-1);
    expect(planned).toBeLessThan(bail);
  });
});

describe('the first file timestamp reaches the ETA', () => {
  it('is stamped on the shared write hook, so BOTH lanes are covered', () => {
    // Every write_file — agentic loop and fast lane alike — funnels through onFileWrite via the
    // dispatcher. Stamping anywhere else would cover one lane and silently miss the other.
    const hook = route.indexOf('const onFileWrite = (path: string, content: string) =>');
    expect(hook).toBeGreaterThan(-1);
    const body = route.slice(hook, hook + 2000);
    expect(body).toContain('noteEtaFileWritten()');
  });

  it('only the FIRST write sets it — a later write must not restart the measurement', () => {
    expect(route).toContain('if (etaFirstFileAt === 0) etaFirstFileAt = Date.now()');
  });
});

describe('the heartbeat prefers the measurement over the guess', () => {
  it('calls measuredRemainingMs and returns early when it has a real number', () => {
    const tick = route.indexOf('const measured = measuredRemainingMs(');
    const fallback = route.indexOf('const tick = liveEtaTick(');
    expect(tick).toBeGreaterThan(-1);
    expect(fallback).toBeGreaterThan(tick); // the guess is the FALLBACK, not the default
    expect(route).toContain('measuredEtaText(elapsedMs, measured, writtenFiles.size, etaPlannedFiles)');
  });

  it('re-anchors the fallback budget, so a build entering repair does not revert to the prompt guess', () => {
    // Without this the moment measurement stops applying (every planned file written, repair begins)
    // liveEtaTick would resume counting against the stale ~3 min it was still carrying.
    expect(route).toContain('etaTotalMs = elapsedMs + measured');
  });

  it('the first line shows the band, not the discarded point estimate', () => {
    expect(route).toContain('firstEtaLine(est, past.length)');
    expect(route).not.toContain('Estimated build time: ${est.etaText}');
  });
});

describe('the guarantee the wiring exists to deliver', () => {
  it('a slow real build produces a real number where the prompt heuristic produced ~3 min', () => {
    // Not a source assertion — the actual property, so this file cannot pass on grep alone.
    const T0 = 1_770_000_000_000;
    const remaining = measuredRemainingMs({ plannedFiles: 19, filesDone: 5, firstFileAt: T0, now: T0 + 4 * 50_000 });
    expect(remaining).not.toBeNull();
    expect(remaining!).toBeGreaterThan(10 * 60_000);
  });
});
