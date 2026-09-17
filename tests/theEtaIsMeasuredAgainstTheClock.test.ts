import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BuildDiagnostics,
  etaAccuracy,
  renderDiagnosticsText,
  type BuildDiagnosticsReport,
} from '../src/server/AgentV3/BuildDiagnostics';
import { buildAdminReportRecord } from '../src/server/AgentV3/AdminBuildReportStore';

/**
 * 🔴 THE BUILD'S ETA WAS ASSERTED AT t=0 AND NEVER RECONCILED (open root cause #6, PROGRESS.md
 * 2026-09-17).
 *
 * A report carried `ETA ~2–4 min` and, in the SAME document, a `startedAt` and an `endedAt`
 * 16.7 minutes apart. Both facts were recorded. Nothing ever put them side by side — so every
 * autopsy that wanted to know whether the estimate holds did the arithmetic by hand, and the admin's
 * panels could not count ETA accuracy at all. That is the one number that says whether the ETA work
 * of 2026-08-11 (learn from real builds) and 2026-09-14 (show a number only where it is measured)
 * actually landed.
 *
 * ⚠️ IT IS A MEASUREMENT, NOT A DEFECT. Deliberately NOT recorded as an issue: a missed estimate is
 * no fault of the user's app, and this repo has repeatedly watched a measurement recorded as a
 * warning become the headline `rootCause` of a SUCCESSFUL build — `POST_ANSWER_TIMING` and
 * `TIME_TO_FIRST_CALL` are both in NEVER_ROOT_CAUSE for exactly that.
 */

const MIN = 60_000;

describe('etaAccuracy (pure)', () => {
  const shown = { estimateMs: 3 * MIN, lowMs: 2 * MIN, highMs: 4 * MIN, evidenced: true };

  it('the reported case: "~2–4 min" against a 16.7-minute build', () => {
    const a = etaAccuracy(shown, 0, 16.7 * MIN)!;
    expect(a.actualMs).toBe(16.7 * MIN);
    expect(a.withinBand).toBe(false);
    expect(a.ratio).toBeCloseTo(5.57, 2);
    expect(a.line).toContain('2.0 min–4.0 min');
    expect(a.line).toContain('16.7 min');
    expect(a.line).toContain('5.6×');
    expect(a.line).toContain('OVER');
  });

  it('a build that lands inside the band says so plainly', () => {
    const a = etaAccuracy(shown, 0, 3.5 * MIN)!;
    expect(a.withinBand).toBe(true);
    expect(a.line).toContain('INSIDE that band');
    expect(a.line).not.toContain('OVER');
  });

  it('a build FASTER than the band is named as under, not silently passed', () => {
    const a = etaAccuracy(shown, 0, 30_000)!;
    expect(a.withinBand).toBe(false);
    expect(a.line).toContain('UNDER');
  });

  it('an UNEVIDENCED estimate never claims a promise nobody made', () => {
    // Since 2026-09-14 a build with no history shows the user a PHASE, not a number. Scoring its
    // hidden midpoint as a broken promise would invent one.
    const a = etaAccuracy({ ...shown, evidenced: false }, 0, 16.7 * MIN)!;
    expect(a.line).toContain('No figure was shown to the user');
    expect(a.evidenced).toBe(false);
    // The ratio is still measured — it is what teaches the estimator.
    expect(a.ratio).toBeCloseTo(5.57, 2);
  });

  it('makes NO claim when it has nothing to measure', () => {
    expect(etaAccuracy(null, 0, MIN)).toBeNull();
    expect(etaAccuracy(undefined, 0, MIN)).toBeNull();
    expect(etaAccuracy({ ...shown, estimateMs: 0 }, 0, MIN)).toBeNull();
    expect(etaAccuracy({ ...shown, estimateMs: NaN }, 0, MIN)).toBeNull();
    expect(etaAccuracy(shown, 0, undefined)).toBeNull();   // build has not ended
    expect(etaAccuracy(shown, 5 * MIN, MIN)).toBeNull();   // ended before it started
    expect(etaAccuracy(shown, 0, 0)).toBeNull();           // zero-length
  });

  it('a missing band falls back to the midpoint rather than inventing one', () => {
    const a = etaAccuracy({ estimateMs: 2 * MIN, lowMs: NaN, highMs: NaN, evidenced: true }, 0, 2 * MIN)!;
    expect(a.lowMs).toBe(2 * MIN);
    expect(a.highMs).toBe(2 * MIN);
    expect(a.withinBand).toBe(true);
  });

  it('never throws on junk', () => {
    expect(() => etaAccuracy({} as never, 'x' as never, {} as never)).not.toThrow();
  });
});

describe('BuildDiagnostics — the promise is kept structured, and reconciled at serialization', () => {
  // A moving clock: the build starts at 0 and every later read is 16.7 minutes in, so `finish()`
  // stamps a real `endedAt`. A frozen clock would make startedAt === endedAt, which correctly yields
  // NO accuracy at all — the first draft of this file used one and measured nothing.
  const mk = () => {
    let first = true;
    return new BuildDiagnostics({
      buildId: 'b', workspaceId: 'w', prompt: 'build a todo app',
      now: () => { if (first) { first = false; return 0; } return 16.7 * MIN; },
    });
  };

  it('a build that showed an ETA reports how it held up', () => {
    const d = mk();
    d.setEtaPromise({ estimateMs: 3 * MIN, lowMs: 2 * MIN, highMs: 4 * MIN, evidenced: true, shown: 'about 2–4 min' });
    d.finish(true, 'done');
    const r = d.report();
    expect(r.etaAccuracy).toBeTruthy();
    expect(r.etaAccuracy?.promisedMs).toBe(3 * MIN);
  });

  it('a turn that showed NO ETA says nothing about accuracy', () => {
    const d = mk();
    d.finish(true, 'done');
    expect(d.report().etaAccuracy).toBeUndefined();
  });

  it('a malformed estimate is not stored — the report stays silent rather than wrong', () => {
    const d = mk();
    d.setEtaPromise({ estimateMs: -1, lowMs: 0, highMs: 0, evidenced: true });
    d.finish(true, 'done');
    expect(d.report().etaAccuracy).toBeUndefined();
  });

  it('report() stays PURE — calling it twice mid-build changes nothing', () => {
    const d = mk();
    d.setEtaPromise({ estimateMs: 3 * MIN, lowMs: 2 * MIN, highMs: 4 * MIN, evidenced: true });
    const before = d.report().counts.total;
    d.report(); d.report();
    expect(d.report().counts.total).toBe(before);
  });

  it('🔒 it is NOT an issue — it can never inflate a count or become a rootCause', () => {
    const d = mk();
    d.setEtaPromise({ estimateMs: 3 * MIN, lowMs: 2 * MIN, highMs: 4 * MIN, evidenced: true });
    d.finish(true, 'done');
    const r = d.report();
    expect(r.issues.some((i) => /ETA_ACCURACY|ETA_MISSED/.test(i.code))).toBe(false);
    expect(r.rootCause ?? '').not.toContain('min');
  });
});

describe('the admin surfaces carry it', () => {
  const report = (): BuildDiagnosticsReport => {
    const d = new BuildDiagnostics({ buildId: 'b', workspaceId: 'w', prompt: 'build a todo app', now: () => 1 });
    d.setEtaPromise({ estimateMs: 3 * MIN, lowMs: 2 * MIN, highMs: 4 * MIN, evidenced: true });
    d.finish(true, 'done');
    const r = d.report();
    return { ...r, startedAt: 0, endedAt: 16.7 * MIN, etaAccuracy: etaAccuracy({ estimateMs: 3 * MIN, lowMs: 2 * MIN, highMs: 4 * MIN, evidenced: true }, 0, 16.7 * MIN)! };
  };

  it('the .txt report prints the promise beside the clock', () => {
    const text = renderDiagnosticsText(report());
    expect(text).toContain('ETA      :');
    expect(text).toContain('16.7 min');
    // Both halves on adjacent lines — the whole point of the fix.
    expect(text).toMatch(/Duration : \d+s\nETA      :/);
  });

  it('the admin inbox meta carries the numbers, not the prose', () => {
    const rec = buildAdminReportRecord(report(), { userNote: '' } as never);
    expect(rec.meta.etaRatio).toBeCloseTo(5.57, 2);
    expect(rec.meta.etaWithinBand).toBe(false);
    expect(rec.meta.etaEvidenced).toBe(true);
  });

  it('a LEGACY record leaves them undefined — never counted as accurate', () => {
    const r = report();
    const rec = buildAdminReportRecord({ ...r, etaAccuracy: undefined }, { userNote: '' } as never);
    expect(rec.meta.etaRatio).toBeUndefined();
    expect(rec.meta.etaWithinBand).toBeUndefined();
    // "not known" is a different fact from "it was accurate", and an average that swallows a NaN
    // would quietly assert the second.
    expect(Number.isNaN(rec.meta.etaRatio as number)).toBe(false);
  });
});

/** ⚠️ REVERSION GUARD, reading CODE with comments stripped — a fixed window measures formatting. */
describe('the promise is stored as NUMBERS, never parsed back out of our own prose', () => {
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const diag = strip(readFileSync(join(__dirname, '../src/server/AgentV3/BuildDiagnostics.ts'), 'utf8'));
  const route = strip(readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8'));

  it('the route hands over the structured estimate beside the prose ETA_BASIS line', () => {
    expect(route).toContain('buildDiag.setEtaPromise(');
    expect(route).toContain("code: 'ETA_BASIS'");
  });

  it('nothing regexes the ETA_BASIS sentence to recover the numbers', () => {
    // `buildFailureCategory.ts` documents at length what happens when a reader classifies on prose we
    // wrote ourselves: a wording change silently re-files every record.
    expect(diag).not.toMatch(/ETA\s+\$\{?\S*\}?.*match\(/);
    expect(diag).not.toContain("/ETA ~?([\\d.]+)/");
  });

  it('the reconciliation is derived at serialization, so no ending path can forget it', () => {
    expect(diag).toContain('etaAccuracy(this.etaPromise, this.startedAt, this.endedAt)');
  });
});
