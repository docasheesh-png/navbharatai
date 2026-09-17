import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
    const line = route.slice(at, at + 200);
    expect(line).toContain('etaEvidenced');
    expect(line).toContain('firstEtaLine(');
    expect(line).toContain('unevidencedFirstEtaLine()');
  });

  it('the flag is set from the estimator, not from a hand-maintained condition', () => {
    const at = route.indexOf('etaEvidenced = estimateIsEvidenced(');
    expect(at).toBeGreaterThan(-1);
  });

  it("the admin's report records WHY a number was or was not shown", () => {
    const at = route.indexOf("code: 'ETA_BASIS'");
    expect(at).toBeGreaterThan(-1);
    const block = route.slice(at, at + 600);
    expect(block).toContain('etaEvidenceNote(est)');
    // It must still quote the line the user actually read (autopsy f04421ef) — the report is never
    // allowed to be the less honest surface.
    expect(block).toContain('Shown to the user');
  });
});

describe('🔴 the live tick must not count down from a number we declined to show', () => {
  it('an unevidenced tick emits the honest line and returns before liveEtaTick', () => {
    const guard = route.indexOf('if (!etaEvidenced) {');
    const tick = route.indexOf('liveEtaTick(elapsedMs');
    expect(guard).toBeGreaterThan(-1);
    expect(tick).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(tick);
    const block = route.slice(guard, tick);
    // STRENGTHENED 2026-09-16 (autopsy dd1f5f60): the budget must reach the line, or it prints the
    // SAME sentence at minute 2 and minute 28 — the twelve identical ticks that made a real user
    // press the button three times. Asserting the argument is what stops that silently regressing.
    expect(block).toContain('unevidencedEtaTickLine(elapsedMs, effectiveBuildSeconds * 1000)');
    expect(block).toContain('return;');
  });

  it('a real measurement flips the flag, so the countdown resumes on a measured anchor', () => {
    const at = route.indexOf('etaTotalMs = elapsedMs + measured;');
    expect(at).toBeGreaterThan(-1);
    expect(route.slice(at, at + 700)).toContain('etaEvidenced = true;');
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
 * PR #2932 (another session, in flight at the time of writing) adds a SECOND measurement to this same
 * function: the architect's plan-step extrapolation, inserted between the file measurement and the
 * fallback. The two changes are complementary and the correct resolution is to keep BOTH — every
 * measurement first, the evidence gate after them, the countdown last. A resolution that drops a
 * measurement, or that puts the gate ahead of one, would silently return this build to guessing.
 *
 * So the rule is asserted structurally: EVERY `measuredRemaining*` call must precede the gate, and the
 * gate must precede `liveEtaTick`. A wrong resolution then fails CI instead of shipping quietly.
 */
describe('the order rule: measure → gate → count down', () => {
  const tickStart = route.indexOf('const measured = measuredRemainingMs({ plannedFiles');
  const gate = route.indexOf('if (!etaEvidenced) {');
  const countdown = route.indexOf('liveEtaTick(elapsedMs');

  it('every measurement in the tick runs BEFORE the evidence gate', () => {
    expect(tickStart).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(tickStart);
    // Name-agnostic across however many measurements exist: find them all inside the tick body.
    const body = route.slice(tickStart, countdown);
    const calls = [...body.matchAll(/measuredRemaining\w*\(/g)];
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const m of calls) {
      expect(tickStart + m.index!).toBeLessThan(gate);
    }
  });

  it('the gate runs before the countdown', () => {
    expect(gate).toBeLessThan(countdown);
  });

  it('every measurement branch returns, so none of them can fall through into the gate', () => {
    const body = route.slice(tickStart, gate);
    const branches = [...body.matchAll(/!==\s*null\)\s*\{/g)];
    expect(branches.length).toBeGreaterThanOrEqual(1);
    // Each measured branch ends in a return before the NEXT branch begins — otherwise a measured
    // build would print the measured line AND then the honest "no time yet" line on the same tick.
    for (let i = 0; i < branches.length; i += 1) {
      const from = branches[i].index!;
      const to = i + 1 < branches.length ? branches[i + 1].index! : body.length;
      expect(body.slice(from, to)).toContain('return;');
    }
  });
});
