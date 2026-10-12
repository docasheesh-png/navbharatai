import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { etaTickLine, measuredRemainingMs, type EtaTickState } from '../src/server/AgentV3/progressEta';
import { unevidencedEtaTickLine } from '../src/server/AgentV3/etaEvidence';

const route = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

/**
 * The wiring of a withheld claim fails NOTHING if it is dropped — no typecheck breaks, no build
 * breaks, and the ETA quietly returns to promising times it cannot keep. That is exactly how the
 * 2026-08-23 measurement came to sit unreachable for three weeks with nothing anywhere going red, so
 * the wiring itself is asserted here rather than only the pure module behind it.
 */
describe('the first ETA line is gated on evidence', () => {
  it('chooses the honest phase line when the estimate is not evidenced', () => {
    const at = route.indexOf('const etaShown =');
    expect(at).toBeGreaterThan(-1);
    // 400, not 200: the evidenced branch now also chooses the fleet line (autopsy a5b661c8).
    const line = route.slice(at, at + 400);
    expect(line).toContain('etaEvidenced');
    expect(line).toContain('firstEtaLine(');
    // Since 2026-09-26 (admin: "ETA dikhao andaaza label ke saath") the unevidenced line is handed the
    // estimate too, so it can SHOW the band as a labelled rough estimate instead of withholding it.
    expect(line).toContain('unevidencedFirstEtaLine(est)');
  });

  it('the flag is set from the estimator, not from a hand-maintained condition', () => {
    const at = route.indexOf('etaEvidenced = estimateIsEvidenced(');
    expect(at).toBeGreaterThan(-1);
  });

  it("the admin's report records WHY a number was or was not shown", () => {
    const at = route.indexOf("code: 'ETA_BASIS'");
    expect(at).toBeGreaterThan(-1);
    const block = route.slice(at, at + 600);
    // Since autopsy 19641ab5 the note also says WHOSE builds taught it (workspace vs platform).
    expect(block).toContain('etaEvidenceNote(est, ');
    // It must still quote the line the user actually read (autopsy f04421ef) — the report is never
    // allowed to be the less honest surface.
    expect(block).toContain('Shown to the user');
  });
});

/**
 * 🔁 UPDATED DELIBERATELY (autopsy 9c612cdb, 2026-10-12). The tick's decision used to be written out
 * inline in the route, so these guards read its SOURCE ORDER there. It now lives in ONE pure function,
 * `etaTickLine` (progressEta.ts), because the inline version decided from time budgets alone and told a
 * user "about 3 min more to go" 11 s after their app had rendered. The same rules are asserted below —
 * twice: by EXECUTING the function (stronger than reading it), and as a source-order guard on the
 * function's own body (so a bad merge into it still fails CI). The route is asserted to hand every fact in.
 */
const eta = readFileSync(resolve(__dirname, '../src/server/AgentV3/progressEta.ts'), 'utf8');
const fnStart = eta.indexOf('export function etaTickLine(');
const fnBody = eta.slice(fnStart, eta.indexOf('\n}\n', fnStart));
const base: EtaTickState = {
  elapsedMs: 4 * 60_000, now: 1_000_000 + 4 * 60_000, finalChecks: false, appRenderedAt: 0,
  plannedFiles: 0, filesDone: 0, firstFileAt: 0, plannedSteps: 0, stepsDone: 0, firstStepAt: 0,
  evidenced: false, budgetMs: 29 * 60_000, roughBand: null, roughHighMs: null,
  totalMs: 3 * 60_000, baseMs: 3 * 60_000, revisions: 0, promisedHighMs: 0,
};

describe('🔴 the live tick must not count down from a number we declined to show', () => {
  it('an unevidenced tick emits the honest line, carrying the build\'s own limit — never a countdown', () => {
    const d = etaTickLine(base);
    expect(d.kind).toBe('unevidenced');
    expect(d.text).toBe(unevidencedEtaTickLine(4 * 60_000, 29 * 60_000, null, null));
    expect(d.text).not.toMatch(/to go/);
    // STRENGTHENED 2026-09-16 (autopsy dd1f5f60): the budget must reach the line, or it prints the
    // SAME sentence at minute 2 and minute 28. And since 2026-09-26 the tick also carries the labelled
    // rough band (null when there is none).
    expect(route).toContain('evidenced: etaEvidenced, budgetMs: effectiveBuildSeconds * 1000,');
    expect(route).toContain('roughBand: etaRoughBand, roughHighMs: etaRoughHighMs,');
    expect(fnBody).toContain('unevidencedEtaTickLine(elapsedMs, s.budgetMs, s.roughBand, s.roughHighMs)');
  });

  it('a real measurement flips the flag, so the countdown resumes on a measured anchor', () => {
    const d = etaTickLine({ ...base, plannedFiles: 19, filesDone: 5, firstFileAt: 1_000_000, now: 1_000_000 + 4 * 50_000 });
    expect(d.kind).toBe('measured-files');
    expect(d.evidenced).toBe(true);
    expect(d.totalMs).toBe(base.elapsedMs + measuredRemainingMs({ plannedFiles: 19, filesDone: 5, firstFileAt: 1_000_000, now: 1_000_000 + 4 * 50_000 })!);
    // …and the route carries the flag and the anchor into the next tick.
    expect(route).toContain('etaTotalMs = decision.totalMs;');
    expect(route).toContain('etaEvidenced = decision.evidenced;');
  });

  it('the heartbeat is still ENTERED for an unevidenced build — withholding a number must not withhold the measurement', () => {
    // The tick is guarded on the seeded budget. Zeroing that budget to suppress the countdown would
    // also switch off the branch that produces the measured line, turning a fix into a regression.
    const at = route.indexOf('if (etaTotalMs > 0 && etaStartMs > 0 && etaTick % 2 === 0)');
    expect(at).toBeGreaterThan(-1);
    // …so nothing may zero it on the unevidenced path.
    const decision = route.indexOf('etaEvidenced = estimateIsEvidenced(');
    const window = route.slice(decision - 400, decision + 400);
    expect(window).not.toMatch(/etaTotalMs\s*=\s*0/);
    expect(window).not.toMatch(/etaBaseMs\s*=\s*0/);
  });
});

/**
 * 🔒 THE ORDER RULE — this is what protects the fix from a bad merge rather than from a bad author.
 *
 * PR #2932 added a SECOND measurement (the architect's plan-step extrapolation) between the file
 * measurement and the fallback; the correct resolution kept BOTH — every measurement first, the evidence
 * gate after them, the countdown last. Since autopsy 9c612cdb two PHASE branches come before all of them
 * (final checks, then the app rendered), and the whole order lives in `etaTickLine`.
 *
 * So the rule is asserted structurally on that function's body: the phase before every measurement,
 * EVERY `measuredRemaining*` call before the gate, the gate before `liveEtaTick`.
 */
describe('the order rule: phase → measure → gate → count down', () => {
  const phase = fnBody.indexOf('etaPhaseLine(');
  const tickStart = fnBody.indexOf('const measured = measuredRemainingMs({ plannedFiles');
  const gate = fnBody.indexOf('if (!s.evidenced) {');
  const countdown = fnBody.indexOf('liveEtaTick(elapsedMs');

  it('the phase is decided before any measurement', () => {
    expect(phase).toBeGreaterThan(-1);
    expect(phase).toBeLessThan(tickStart);
  });

  it('every measurement in the tick runs BEFORE the evidence gate', () => {
    expect(tickStart).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(tickStart);
    // Name-agnostic across however many measurements exist: find them all inside the tick body.
    const body = fnBody.slice(tickStart, countdown);
    const calls = [...body.matchAll(/measuredRemaining\w*\(/g)];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const m of calls) {
      expect(tickStart + m.index!).toBeLessThan(gate);
    }
  });

  it('the gate runs before the countdown', () => {
    expect(gate).toBeLessThan(countdown);
  });

  it('every measurement branch returns, so none of them can fall through into the gate', () => {
    const body = fnBody.slice(tickStart, gate);
    const branches = [...body.matchAll(/!==\s*null\)\s*\{/g)];
    expect(branches.length).toBeGreaterThanOrEqual(2);
    // Each measured branch ends in a return before the NEXT branch begins — otherwise a measured
    // build would print the measured line AND then the honest "no time yet" line on the same tick.
    for (let i = 0; i < branches.length; i += 1) {
      const from = branches[i].index!;
      const to = i + 1 < branches.length ? branches[i + 1].index! : body.length;
      expect(body.slice(from, to)).toContain('return {');
    }
  });

  it('the route calls the one decision and nothing else decides', () => {
    expect(route).toContain('const decision = etaTickLine({');
    const code = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bliveEtaTick\(|\bunevidencedEtaTickLine\(|\bmeasuredRemaining\w*\(/);
  });
});
