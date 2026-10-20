import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { releaseGate, runtimeProven, type RuntimeEvidence } from '../src/server/AgentV3/releaseGate';
import { applyGateRedNotice, gateRedNoticeLine, runtimeFailureParts, GATE_RED_TOLD_CODE } from '../src/server/AgentV3/gateRedNotice';

/**
 * AUDIT P0-1 (2026-10-16) — a RED gate on runtime evidence must reach the user, WITHOUT changing billing.
 *
 * Reproduced with the real gate: preview/page/journey 'failed' and zero error-severity findings → state RED. The route's
 * verdict flip needs an unresolved ERROR (`gateBlockers > 0`) or `AGENTV3_RUNTIME_RED_FLIP` (default off), and a failed
 * page or journey is recorded at WARNING — so `result.ok` stayed true and the user read the ordinary success summary.
 * UNKNOWN had its own honest line; RED had none.
 *
 * The admin's standing ruling (autopsy 4efab9d7) forbids the obvious fix: flipping `ok` makes the build FREE. So this
 * changes the SENTENCE only. Every other field of the result — including everything billing reads — is untouched.
 */
const ev = (over: Partial<RuntimeEvidence> = {}): RuntimeEvidence => ({
  buildOk: true, preview: 'passed', pages: 'not-run', journeys: 'not-run', typecheck: 'passed', tests: 'not-run', ...over,
});
const clean = { blockers: 0, highSeverity: 0, warnings: 0 };
const okResult = () => ({
  ok: true, summary: 'Your app is ready.', steps: 12, billedUsd: 0.42, billedInr: 35.7, resumable: false,
  walletTokensDebited: 3570, tokens: 91_234,
});

describe('the reproduction — RED gate, ok:true (the false success this fixes)', () => {
  for (const [label, evidence] of [
    ['a failed preview', ev({ preview: 'failed' })],
    ['a failed page-render check', ev({ pages: 'failed' })],
    ['a failed user journey', ev({ journeys: 'failed' })],
  ] as const) {
    it(`${label}: the gate is RED, the runtime verdict is "failed", and nothing flipped ok`, () => {
      const gate = releaseGate(evidence, clean);
      expect(gate.state).toBe('red');
      expect(runtimeProven(evidence)).toBe('failed');
      const out = applyGateRedNotice(okResult(), gate, evidence);
      expect(out.ok).toBe(true); // the verdict is NOT changed — billing semantics intact
      expect(out.summary).toContain('Your app is ready.');
      expect(out.summary).toContain('I have NOT confirmed that it works');
    });
  }

  it('each failure is named in a person\'s words, and several are all named', () => {
    expect(runtimeFailureParts(ev({ preview: 'failed' }))).toEqual(['the live preview did not open or render properly']);
    expect(runtimeFailureParts(ev({ pages: 'failed' }))).toEqual(['at least one page showed errors when I opened it']);
    expect(runtimeFailureParts(ev({ journeys: 'failed' }))[0]).toMatch(/adding or saving/);
    expect(runtimeFailureParts(ev({ preview: 'failed', pages: 'failed', journeys: 'failed' }))).toHaveLength(3);
  });
});

describe('🔒 billing and the verdict are untouched', () => {
  it('only `summary` differs — every other field, including the bill and the wallet debit, is identical', () => {
    const before = okResult();
    const gate = releaseGate(ev({ pages: 'failed' }), clean);
    const out = applyGateRedNotice(before, gate, ev({ pages: 'failed' }));
    const { summary: s1, ...rest1 } = before;
    const { summary: s2, ...rest2 } = out;
    expect(rest2).toEqual(rest1);
    expect(s2).not.toBe(s1);
  });
  it('the input is not mutated', () => {
    const before = okResult();
    applyGateRedNotice(before, releaseGate(ev({ preview: 'failed' }), clean), ev({ preview: 'failed' }));
    expect(before.summary).toBe('Your app is ready.');
  });
  it('the helper never assigns ok (source guard)', () => {
    const src = readFileSync('src/server/AgentV3/gateRedNotice.ts', 'utf8').split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    expect(src).not.toMatch(/\bok\s*:\s*false\b/);
    expect(src).not.toMatch(/\bok\s*=[^=]/);
  });
});

describe('it says nothing when it is not the case it exists for', () => {
  const failed = ev({ preview: 'failed' });
  const red = releaseGate(failed, clean);
  it('the verdict flip already ran (ok is false): the same object comes back, nothing is said twice', () => {
    const flipped = { ...okResult(), ok: false, summary: 'Release gate: RED …' };
    expect(applyGateRedNotice(flipped, red, failed)).toBe(flipped);
  });
  it('a green, yellow or UNKNOWN gate: nothing (UNKNOWN has its own line)', () => {
    for (const e of [ev({ preview: 'passed', pages: 'passed', journeys: 'passed' }), ev({ preview: 'passed' }), ev({ preview: 'not-run' })]) {
      const g = releaseGate(e, clean);
      expect(g.state).not.toBe('red');
      expect(gateRedNoticeLine(g, e)).toBeNull();
    }
  });
  it('RED from STATIC findings only, with the app proven to run, is not told it failed to run', () => {
    const e = ev({ preview: 'passed', pages: 'passed' });
    const g = releaseGate(e, { ...clean, blockers: 2 });
    expect(g.state).toBe('red');
    expect(gateRedNoticeLine(g, e)).toBeNull();
  });
  it('missing evidence is never read as failure', () => {
    expect(gateRedNoticeLine({ state: 'red' }, undefined)).toBeNull();
    expect(applyGateRedNotice(okResult(), { state: 'red' }, null).summary).toBe('Your app is ready.');
  });
});

describe('the admin report and the White-Label Law', () => {
  it('records one info finding, auto-resolved, naming the cause and that billing is unchanged', () => {
    const rows: Array<Record<string, unknown>> = [];
    applyGateRedNotice(okResult(), releaseGate(ev({ journeys: 'failed' }), clean), ev({ journeys: 'failed' }), { record: (r) => { rows.push(r); } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ phase: 'readiness', severity: 'info', code: GATE_RED_TOLD_CODE, autoResolved: true });
    expect(String(rows[0].message)).toContain('billing semantics unchanged');
  });
  it('a recorder that throws cannot stop the notice', () => {
    const out = applyGateRedNotice(okResult(), releaseGate(ev({ preview: 'failed' }), clean), ev({ preview: 'failed' }), { record: () => { throw new Error('x'); } });
    expect(out.summary).toContain('NOT confirmed');
  });
  it('names no vendor or model', () => {
    const line = gateRedNoticeLine(releaseGate(ev({ preview: 'failed', pages: 'failed', journeys: 'failed' }), clean), ev({ preview: 'failed', pages: 'failed', journeys: 'failed' })) ?? '';
    expect(line).not.toMatch(/glm|kimi|nemotron|haiku|claude|anthropic|openai|gemini|grok|moonshot|model/i);
  });
});

describe('🔒 wiring: after the verdict flip, before the UNKNOWN line, and inside the gate\'s own try', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  it('the route calls it once, between the two', () => {
    const call = 'result = applyGateRedNotice(result, gate, gateEvidence, buildDiag);';
    expect(route.split(call)).toHaveLength(2);
    const at = route.indexOf(call);
    expect(route.indexOf("code: 'OUTCOME_RELEASE_GATE_RED'")).toBeGreaterThan(0);
    expect(route.indexOf("code: 'OUTCOME_RELEASE_GATE_RED'")).toBeLessThan(at);
    expect(route.indexOf("code: 'RELEASE_GATE_UNPROVEN'")).toBeGreaterThan(at);
  });
  it('the flip itself is unchanged — the blocker arm and the flag arm both remain', () => {
    expect(route).toContain("if (gate.state === 'red' && (gateBlockers > 0 || runtimeRed) && settled && settled.ok) {");
  });
});
