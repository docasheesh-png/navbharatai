import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

/**
 * AN IMPORT'S QUIET MINUTES MUST BE NAMED — autopsy faa98da9, 2026-09-04.
 *
 * That report timed every PREVIEW stretch ("creating the database tables took 50s", "installing
 * dependencies and starting your app took 28s") and yet carried a 40-SECOND HOLE with nothing recorded
 * during the import. Its own TIME_TO_FIRST_CALL warning could only say where the silence STARTED:
 *
 *     "The longest single stretch with NOTHING recorded was 40s, beginning right after: 'Sandbox
 *      landing: 175 file(s) via bulk' — that is where to look first (it names when the silence
 *      started, not what caused it)."
 *
 * The mechanism to name it already existed and simply was not called on this path. Two costs: the
 * admin cannot see where an import's minutes go, and the USER's heartbeat falls back to echoing a
 * stale narration — minute 1 of that build read "still working (last: 🔗 Connected to …)".
 */
describe('the phase mechanism records what a long stretch was, and how long it took', () => {
  it('a stretch over the noise floor becomes a PHASE_TIMING line', () => {
    let now = 0;
    const d = new BuildDiagnostics({ workspaceId: 'w', sessionId: 's', prompt: 'p', now: () => now });
    d.enterPhase("importing your project's files");
    now = 41_000;
    d.exitPhase();
    const timings = d.report().issues.filter((i) => i.code === 'PHASE_TIMING');
    expect(timings).toHaveLength(1);
    expect(timings[0].message).toContain("importing your project's files");
    expect(timings[0].message).toContain('41s');
  });

  it('a sub-3s step stays off the timeline — naming every blink would bury the real stretches', () => {
    let now = 0;
    const d = new BuildDiagnostics({ workspaceId: 'w', sessionId: 's', prompt: 'p', now: () => now });
    d.enterPhase('a blink');
    now = 1_500;
    d.exitPhase();
    expect(d.report().issues.filter((i) => i.code === 'PHASE_TIMING')).toHaveLength(0);
  });

  it('a forgotten exit cannot strand the label — a new phase supersedes it', () => {
    // Relied on by the import path, where three stretches run back to back.
    let now = 0;
    const d = new BuildDiagnostics({ workspaceId: 'w', sessionId: 's', prompt: 'p', now: () => now });
    d.enterPhase('first');
    now = 10_000;
    d.enterPhase('second');            // no exitPhase() for 'first'
    now = 25_000;
    d.exitPhase();
    const msgs = d.report().issues.filter((i) => i.code === 'PHASE_TIMING').map((i) => i.message);
    expect(msgs.join(' ')).toContain('first');
    expect(msgs.join(' ')).toContain('second');
  });
});

/**
 * The wiring half. Source-level for the same honest reason as the other route guards: this lives
 * inside a ~16,000-line closure that cannot be imported. IF IT IS DROPPED, NOTHING FAILS — the import
 * simply goes back to being an unexplained gap in every report, which is precisely the symptom that
 * took an autopsy to notice in the first place.
 */
const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

describe("the import names its own long stretches (autopsy faa98da9)", () => {
  const importPhases = [
    "enterPhase?.('importing your project\\'s files')",
    "enterPhase?.('adding your project\\'s images and fonts')",
    "enterPhase?.('saving your project so it survives a restart')",
  ];

  for (const call of importPhases) {
    it(`names the stretch: ${call.slice(call.indexOf("('") + 2, -2)}`, () => {
      expect(route).toContain(call);
    });
  }

  it('every import phase is closed, so a label can never outlive its stretch', () => {
    // `finally` rather than a trailing call: an import that throws mid-stretch must still close it.
    const first = route.indexOf("enterPhase?.('importing your project\\'s files')");
    expect(first).toBeGreaterThan(0);
    expect(route.slice(first, first + 400)).toMatch(/finally \{[\s\S]{0,200}exitPhase\?\.\(\)/);
  });

  it('the phase calls are optional-chained and wrapped — diagnostics can never break an import', () => {
    // The whole point of adding these was that they are free. A throw here would make a reporting
    // improvement into an import failure, which would be a far worse bug than the one being fixed.
    for (const call of importPhases) {
      const i = route.indexOf(call);
      expect(route.slice(Math.max(0, i - 120), i)).toContain('try {');
    }
  });
});
