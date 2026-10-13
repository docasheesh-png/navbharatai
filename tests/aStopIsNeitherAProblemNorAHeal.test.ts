// AUTOPSY 303e8a6f (2026-10-12), item F — the user pressed Stop at 36 s and the report said
// `warnings: 2, autoResolved: 1`: the "self-heal" was the user's own Stop. The RELEASE_GATE row of a stopped build
// was recorded WARNING + closed, and a closed warning is exactly what the shared heal predicate (`isSelfHeal`)
// counts as a repair. The row also sat in `problems` beside a real provider fallback, on a report whose own
// outcome line says "No failure of the app or the engine is implied".
//
// The CLASS: one decision ("is this gate verdict owed to anyone?") was computed by TWO expressions at the record
// site — severity and autoResolved — and the two earlier fixes each moved one of them (6db0ff31 took the Stop out
// of the error branch; 31254f9a closed the row on a Stop). `releaseGateRecord` now decides both, and this file
// locks the invariant (a closed gate row is info, so it can never be a heal) plus a census of every record site
// that closes a row because of a stop.
//
// Also here: the build-health card's "proven running" read `problems` for an info row, which `problems` never
// carries — so every browser-proven build showed the user "READY (not verified) · 85/100". Found while tracing
// the readers of this row.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { releaseGate, releaseGateRecord, type GateState, type RuntimeEvidence, type StaticFindings } from '../src/server/AgentV3/releaseGate';
import { isSelfHeal } from '../src/lib/healIssue';
import { BuildDiagnostics, type BuildIssue } from '../src/server/AgentV3/BuildDiagnostics';
import { summarizeHealCodes } from '../src/server/AgentV3/healBreakdown';
import { buildHealthFromDiagnostics } from '../src/server/AgentV3/buildHealthCard';
import { abortOutcomeFor, ABORT_OUTCOME_CODES } from '../src/server/AgentV3/abortOutcome';

const REPORT = JSON.parse(readFileSync(join(__dirname, 'fixtures/report303e8a6f.issues.json'), 'utf8')) as {
  counts: Record<string, number>;
  issues: Array<Pick<BuildIssue, 'ts' | 'phase' | 'severity' | 'code' | 'message'>>;
};

const STATES: GateState[] = ['green', 'yellow', 'red', 'unknown'];
const BOOLS = [false, true];

describe('1 · one decision: a closed gate row is information, never a repair', () => {
  it('🔒 every state × ok × stop × module turn: closed ⇒ info, and isSelfHeal is never true', () => {
    for (const state of STATES) for (const buildOk of BOOLS) for (const stoppedByUser of BOOLS) for (const awaitsShell of BOOLS) {
      const rec = releaseGateRecord({ state }, { buildOk, stoppedByUser, awaitsShell });
      const label = JSON.stringify({ state, buildOk, stoppedByUser, awaitsShell });
      if (rec.autoResolved) expect(rec.severity, label).toBe('info');
      expect(isSelfHeal({ code: 'RELEASE_GATE', ...rec }), label).toBe(false);
    }
  });

  it('the exact cases', () => {
    const ev = (over: Partial<RuntimeEvidence>): RuntimeEvidence => ({
      buildOk: true, preview: 'not-run', pages: 'not-run', journeys: 'not-run', typecheck: 'not-run', tests: 'not-run', ...over,
    } as RuntimeEvidence);
    const clean: StaticFindings = { blockers: 0, highSeverity: 0, warnings: 0 };
    // The report's own gate: RED with the Stop headline. The verdict is unchanged; only how it is FILED changes.
    const stoppedGate = releaseGate(ev({ buildOk: false, stoppedByUser: true }), clean);
    expect(stoppedGate.state).toBe('red');
    expect(stoppedGate.headline).toMatch(/you stopped this build/);
    const at = (state: GateState, buildOk: boolean, stoppedByUser = false, awaitsShell = false) =>
      releaseGateRecord({ state }, { buildOk, stoppedByUser, awaitsShell });
    expect(releaseGateRecord(stoppedGate, { buildOk: false, stoppedByUser: true, awaitsShell: false })).toEqual({ severity: 'info', autoResolved: true });
    expect(at('red', false)).toEqual({ severity: 'error', autoResolved: false });      // a failed build's RED
    expect(at('red', true)).toEqual({ severity: 'warning', autoResolved: false });     // RED on a build that succeeded
    expect(at('green', true)).toEqual({ severity: 'info', autoResolved: true });
    expect(at('yellow', true)).toEqual({ severity: 'warning', autoResolved: false });
    expect(at('unknown', true)).toEqual({ severity: 'warning', autoResolved: false }); // "we could not tell" is read
    expect(at('unknown', true, false, true)).toEqual({ severity: 'info', autoResolved: true }); // a module turn: not due
  });
});

/** The report's 40 rows, replayed through the real recorder, with the gate row filed by `record`. */
function replay(gateRow: { severity: BuildIssue['severity']; autoResolved: boolean }) {
  const d = new BuildDiagnostics({ buildId: '303e8a6f' } as never);
  for (const row of REPORT.issues) {
    // Info rows and the provider fallback are closed as the route records them; the gate row is the variable.
    const filed = row.code === 'RELEASE_GATE' ? gateRow : { severity: row.severity, autoResolved: true };
    d.record({ phase: row.phase, code: row.code, message: row.message, ...filed } as never);
  }
  return d.report();
}

describe('2 · the real report 303e8a6f', () => {
  const asFiled = releaseGateRecord({ state: 'red' }, { buildOk: false, stoppedByUser: true, awaitsShell: false });

  it('the fixture is the report: 40 rows, and the old filing reproduces its exact counts', () => {
    expect(REPORT.issues).toHaveLength(40);
    const before = replay({ severity: 'warning', autoResolved: true });
    expect(before.counts).toMatchObject({ warnings: REPORT.counts.warnings, autoResolved: REPORT.counts.autoResolved, workarounds: REPORT.counts.workarounds });
    expect(summarizeHealCodes(before)?.codes).toEqual({ RELEASE_GATE: 1 });
  });

  it('filed by the one decision: the Stop is neither a problem nor a heal', () => {
    const r = replay(asFiled);
    expect(r.counts).toMatchObject({ warnings: 1, autoResolved: 0, workarounds: 1 });
    expect(r.problems.map((p) => p.code)).toEqual(['PROVIDER_FALLBACK']);
    expect(summarizeHealCodes(r)?.codes ?? {}).not.toHaveProperty('RELEASE_GATE');
    expect(r.rootCause).toMatch(/STOPPED BY THE USER/);
    // The verdict text is untouched: nothing was proven, and the row still says so.
    expect(r.issues.find((i) => i.code === 'RELEASE_GATE')?.message).toMatch(/^Release gate: RED/);
    const card = buildHealthFromDiagnostics(r, false);
    expect(card.blockers).toEqual([]);
  });
});

describe('3 · 🔒 census: a row closed because of a stop is information', () => {
  const ROOT = join(__dirname, '..');
  const walk = (d: string, out: string[] = []): string[] => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.ts$/.test(n) && !/\.test\.ts$/.test(n)) out.push(p);
    }
    return out;
  };
  const objectAt = (src: string, open: number): string => {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
    }
    return '';
  };
  /**
   * A site whose severity comes from a value the scan cannot read, with the behavioural proof beside it.
   * The abort-outcome site closes its row only for the user's own stop, and that outcome is info — asserted below.
   */
  const PROVEN_ELSEWHERE = ['autoResolved: outcome.code === ABORT_OUTCOME_CODES.userStopped'];

  it('every `.record({…})` whose autoResolved names a stop files it as info (or lets the one decision file it)', () => {
    const files = [...walk(join(ROOT, 'src/server')), join(ROOT, 'server.ts')];
    const sites: string[] = [];
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const re = /\.record\(\s*\{/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const obj = objectAt(src, src.indexOf('{', m.index));
        const ar = /autoResolved:\s*([^,\n}]+)/.exec(obj);
        // Whole identifiers, never a substring: /stop/i would also catch `stopwatch` or `nonstop` (adversarial review).
        if (!ar || !/\b(?:stopped|stoppedByUser|userStopped|wasStopped|aborted|isAborted)\b/.test(ar[1]!)) continue;
        const where = `${f.slice(ROOT.length + 1)}:${src.slice(0, m.index).split('\n').length} autoResolved: ${ar[1]!.trim()}`;
        sites.push(where);
        const ok = /severity:\s*'info'/.test(obj)
          || /severity:\s*[\w.!]*\b(?:stopped|stoppedByUser|userStopped|wasStopped|aborted|isAborted)\s*\?\s*'info'/.test(obj)
          || obj.includes('...releaseGateRecord(')
          || PROVEN_ELSEWHERE.some((s) => obj.includes(s));
        if (!ok) bad.push(where);
      }
    }
    expect(sites.length).toBeGreaterThanOrEqual(2); // the abort outcome and the upsell (the gate row spreads the one decision)
    expect(bad).toEqual([]);
  });

  it('the abort-outcome site\'s proof: the only outcome it closes is the user\'s own stop, and that is info', () => {
    const userStop = abortOutcomeFor('user-stop');
    expect(userStop?.code).toBe(ABORT_OUTCOME_CODES.userStopped);
    expect(userStop?.severity).toBe('info');
    // A stop of a prompt NavBharatAI composed is not the user's choice: a different code, an error, and the
    // route's `autoResolved` (code === userStopped) leaves it open.
    const composed = abortOutcomeFor('user-stop', { platformComposed: true });
    expect(composed?.code).not.toBe(ABORT_OUTCOME_CODES.userStopped);
    expect(composed?.severity).toBe('error');
  });

  it('the route files the gate row in exactly one place, through the one decision', () => {
    const route = readFileSync(join(ROOT, 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route.match(/code: 'RELEASE_GATE',/g)).toHaveLength(1);
    const site = route.slice(route.indexOf("code: 'RELEASE_GATE',") - 1500, route.indexOf("code: 'RELEASE_GATE',"));
    expect(site).toContain('...releaseGateRecord(gate, {');
    expect(site).not.toMatch(/severity: gate\.state/);
  });
});

describe('4 · the health card finds the proof the real recorder writes', () => {
  /** A build the browser proved, recorded the way the route records it. */
  function provenBuild(): BuildDiagnostics {
    const d = new BuildDiagnostics({ buildId: 'proven' } as never);
    d.record({ phase: 'build', severity: 'info', code: 'OUTCOME_BUILD_PARTIAL', message: 'Build outcome: BUILD_PARTIAL', autoResolved: true });
    expect(d.recordPreviewVerified()).toBe(true);
    return d;
  }

  it('a browser-proven clean build is proven running and earns the full score', () => {
    const r = provenBuild().report();
    // The trap, stated: the proof is an info row, and `problems` never carries info rows.
    expect(r.problems.some((p) => p.code === 'OUTCOME_BUILD_SUCCESS')).toBe(false);
    const card = buildHealthFromDiagnostics(r, true);
    expect(card.provenRunning).toBe(true);
    expect(card.score).toBe(100);
    expect(card.warnings.join(' ')).not.toMatch(/not seen running/i);
  });

  it('the LAST outcome wins: an early success followed by a runtime failure is not proof', () => {
    const d = provenBuild();
    d.record({ phase: 'build', severity: 'error', code: 'OUTCOME_RUNTIME_FAILED', message: 'Build outcome: RUNTIME_FAILED', autoResolved: false });
    expect(buildHealthFromDiagnostics(d.report(), true).provenRunning).toBe(false);
  });

  it('a build never seen running stays capped, as before', () => {
    const d = new BuildDiagnostics({ buildId: 'unproven' } as never);
    d.record({ phase: 'build', severity: 'info', code: 'OUTCOME_BUILD_PARTIAL', message: 'Build outcome: BUILD_PARTIAL', autoResolved: true });
    const card = buildHealthFromDiagnostics(d.report(), true);
    expect(card.provenRunning).toBe(false);
    expect(card.score).toBe(85);
  });
});
