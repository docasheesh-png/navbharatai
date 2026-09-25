/**
 * THE COUNTER WATCHED ONE LANE, AND THE SENTENCE WAS ABOUT THE BUILD (autopsy 2026-09-22).
 *
 * 🔴 WHAT HAPPENED. A build that wrote TypeScript reported, in its own admin line:
 * *"Write-time typecheck: no TypeScript source was written this build (0 write(s) skipped as not
 * TypeScript)."* Every call site of the write-time check lives in `ToolDispatcher`, so it observes
 * the ARCHITECT's writes only; the FAST LANE writes through `deps.writeFiles` and verifies once with
 * a `tsc` of its own. On a successful fast-lane build the stats object is therefore never touched —
 * and the summary read that silence as a fact about the build's files.
 *
 * 🔑 THE CLASS, and it is this repo's headline one. `sharedWriteTypecheckStats` already names the
 * all-zero state as the tell — *"that object was never touched, not that nothing happened"* — for
 * the SUB-AGENT cause of it (autopsy 3ce8459b). That instance was fixed by sharing the object; the
 * fast-lane sibling, which produces the identical all-zero state by a completely different route,
 * was never hunted. Same shape as the HTML boot guard that ran on one lane of two, and the console
 * listener that ran on one lane of three.
 *
 * THE FIX IS EVIDENCE, NOT WORDING. `writtenFiles` is the one set every writer feeds, fast lanes
 * included, so the route hands the summary a real count of model-authored TypeScript files. "No
 * TypeScript source was written" is now said only when a count says so; with no count the line says
 * what it knows and stops.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  emptyWriteTypecheckStats,
  writeTypecheckSummary,
  writeTypecheckUntouched,
  type WriteTypecheckStats,
} from '../src/server/AgentV3/writeTimeTypecheck';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const stats = (over: Partial<WriteTypecheckStats> = {}): WriteTypecheckStats =>
  ({ ...emptyWriteTypecheckStats(), ...over });

describe('an untouched counter is not a measurement of zero', () => {
  it('a fresh stats object is untouched', () => {
    expect(writeTypecheckUntouched(emptyWriteTypecheckStats())).toBe(true);
  });

  it('ANY field having moved means the check was really consulted', () => {
    // Each of these is a different way of having something true to say. None of them is silence.
    expect(writeTypecheckUntouched(stats({ runs: 1 }))).toBe(false);
    expect(writeTypecheckUntouched(stats({ skipped: 1 }))).toBe(false);
    expect(writeTypecheckUntouched(stats({ skippedNotTs: 1 }))).toBe(false);
    expect(writeTypecheckUntouched(stats({ skippedNoTsconfig: 1 }))).toBe(false);
    expect(writeTypecheckUntouched(stats({ probeFailures: 1 }))).toBe(false);
    expect(writeTypecheckUntouched(stats({ disabledReason: 'took too long' }))).toBe(false);
  });
});

describe('the sentence the fast-lane build got', () => {
  it('no longer claims nothing was written when the build wrote TypeScript', () => {
    const line = writeTypecheckSummary(emptyWriteTypecheckStats(), true, 6);
    expect(line).not.toContain('no TypeScript source was written');
    expect(line).toContain('never ran');
    expect(line).toContain('6 TypeScript file(s)');
    // It must also be clear that this line is NOT a verdict on the other lane's own check.
    expect(line).toMatch(/nothing here says whether THAT check passed/i);
  });

  it('says nothing was written ONLY when a real count agrees', () => {
    expect(writeTypecheckSummary(emptyWriteTypecheckStats(), true, 0))
      .toContain('no TypeScript source was written this build');
  });

  it('with no count supplied it states what it knows and no more', () => {
    // `null` is "not supplied", never "zero" — a missing measurement is not a measurement of zero.
    const line = writeTypecheckSummary(emptyWriteTypecheckStats(), true);
    expect(line).not.toContain('no TypeScript source was written');
    expect(line).toContain('not one write reached it');
    expect(line).toContain('not recorded here');
  });
});

describe('the sibling branch, one step along', () => {
  it('a check consulted about non-TypeScript writes still must not deny the other lane', () => {
    // The check can be asked about a handful of .css writes while another lane writes the app. The
    // old wording would have been false here for exactly the same reason.
    const line = writeTypecheckSummary(stats({ skipped: 9, skippedNotTs: 9 }), true, 4);
    expect(line).not.toContain('no TypeScript source was written');
    expect(line).toContain('9 write(s) skipped as not TypeScript');
    expect(line).toContain('4 TypeScript file(s)');
  });

  it('and keeps its exact wording when the count agrees with it', () => {
    expect(writeTypecheckSummary(stats({ skipped: 9, skippedNotTs: 9 }), true, 0))
      .toContain('no TypeScript source was written this build (9 write(s) skipped as not TypeScript)');
  });
});

describe('every other branch is untouched', () => {
  it('OFF, stood-down and no-tsconfig read exactly as before, whatever the count', () => {
    expect(writeTypecheckSummary(emptyWriteTypecheckStats(), false, 7)).toContain('OFF');
    expect(writeTypecheckSummary(stats({ disabledReason: 'x' }), true, 7)).toContain('never ran — x');
    // ⚠️ THE FIXTURE CHANGED BECAUSE THE STATE DID (autopsy 21b431e1, 2026-09-22). This used to pass
    // `skippedNoTsconfig: 4` TOGETHER WITH `probeFailures: 3` — the shape of a check that switched
    // itself off on a read error, which `probeFailures`' own comment already named as a defect. The
    // dispatcher can no longer produce it: a failed probe never settles the verdict, so
    // `skippedNoTsconfig` now means one thing only — we looked and there is no tsconfig.
    const noTsconfig = writeTypecheckSummary(
      stats({ skipped: 4, skippedNoTsconfig: 4, projectVerdict: 'no' }), true, 4,
    );
    expect(noTsconfig).toContain('4 TypeScript write(s) happened');
    expect(noTsconfig).toContain('no tsconfig.json was found');
  });

  it('a run that happened reports its numbers and ignores the count', () => {
    const ran = writeTypecheckSummary(
      stats({ runs: 3, cleanRuns: 2, ownErrorsSurfaced: 1, elapsedMs: 4500 }), true, 0,
    );
    expect(ran).toContain('3 run(s)');
    expect(ran).toContain('1 error(s) quoted back');
    expect(ran).not.toContain('no TypeScript source was written');
  });

  it('names no engine on any branch (White-Label Law)', () => {
    const lines = [
      writeTypecheckSummary(emptyWriteTypecheckStats(), true, 6),
      writeTypecheckSummary(emptyWriteTypecheckStats(), true, 0),
      writeTypecheckSummary(emptyWriteTypecheckStats(), true),
      writeTypecheckSummary(stats({ skipped: 2, skippedNotTs: 2 }), true, 3),
    ];
    for (const l of lines) expect(l).not.toMatch(/\b(GLM|Kimi|Claude|Gemini|Grok|OpenAI|Nemotron|Sonnet|Opus|Haiku)\b/);
  });
});

describe('the wiring, and the premise it rests on', () => {
  it('the route hands the summary a REAL count, not a guess', () => {
    // Reversion guard: this is the whole fix. Dropping the third argument silently restores the
    // sentence that lied, and no behavioural test in this repo would notice.
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain('const tsWritten = modelAuthoredPaths(writtenFiles).filter(shouldTypecheckWrite).length;');
    expect(route).toContain('writeTypecheckSummary(wt, writeTypecheckEnabled(), tsWritten)');
  });

  it('the count comes from the set EVERY lane feeds, and drops our own pre-seeded template', () => {
    // `writtenFiles` is the route's one write ledger (its own comment says so: "the architect's
    // tools, the fast lanes"); `modelAuthoredPaths` is what stops a golden scaffold being counted
    // as the model's work, exactly as the readiness gate already requires (autopsy 2b0a3ed5).
    const route = read('src/server/routes/agentv3.ts');
    const decl = route.indexOf('const tsWritten = modelAuthoredPaths(writtenFiles)');
    const record = route.indexOf("code: 'WRITE_TIME_TYPECHECK'");
    expect(decl).toBeGreaterThan(-1);
    expect(decl).toBeLessThan(record);
  });

  it('the premise holds: the fast lane does not route its writes through this check', () => {
    // If the fast lane ever DOES gain a write-time typecheck, this test is the place that says so —
    // and the summary's wording about "a lane that does not write through the build's tools" must be
    // corrected in the same change rather than left describing a lane that no longer exists.
    const simple = read('src/server/AgentV3/SimpleBuilder.ts');
    expect(simple).toContain('deps.writeFiles(');
    expect(simple).not.toContain('writeTimeTypecheck');
    expect(simple).not.toContain('writeTypecheckNote');
  });
});

/**
 * 🔴 THE THIRD CAUSE OF THE SAME WRONG SENTENCE (autopsy e628efd4, 2026-09-25).
 *
 * Two lanes had already been hunted — a sub-agent with its own stats object (3ce8459b) and a fast
 * lane that never touches them (above). This one is neither: the counters were right, and the line
 * was recorded in the wrong PLACE. It sat above the empty-build retry, so on every build that
 * retried, the admin report's `WRITE_TIME_TYPECHECK` described the ABANDONED first attempt while
 * every other line in the same report described the build that shipped.
 *
 * `dispatcher` is a single instance, shared with the retry runner through `baseRunnerOpts`, so its
 * counters accumulate across BOTH attempts. Reading them after the retry is therefore not a better
 * sample of the same thing — it is the only reading that is about the build the user was given.
 */
describe('the line is about the build that shipped, not the one that was abandoned', () => {
  const route = read('src/server/routes/agentv3.ts');

  it('🔒 the record comes AFTER the empty-build retry has run', () => {
    // Reversion guard, and it is the entire fix: move this record back above the retry and the
    // sentence silently starts describing a discarded attempt again. No behavioural test can see
    // that, because both positions produce a perfectly well-formed line.
    const decision = route.indexOf('shouldRetryEmptyBuild({');
    const retryRan = route.indexOf('[AGENTV3] empty-build Claude retry failed');
    const record = route.indexOf("code: 'WRITE_TIME_TYPECHECK'");
    expect(decision).toBeGreaterThan(-1);
    expect(retryRan).toBeGreaterThan(decision);
    expect(record).toBeGreaterThan(retryRan);
  });

  it('…and still inside the same post-build block, before the release gate collects its evidence', () => {
    // Bounded on the other side too: pushed past the gate it would be describing the build after
    // the advisory passes have had their say, which is a different claim again.
    const record = route.indexOf("code: 'WRITE_TIME_TYPECHECK'");
    const gate = route.indexOf('const gateEvidence: RuntimeEvidence = {');
    expect(gate).toBeGreaterThan(record);
  });

  it('the premise is real: the retry SHARES the build dispatcher, so the counters accumulate', () => {
    // If the retry ever gets a ToolDispatcher of its own, the counters stop being cumulative and
    // this whole position becomes wrong — so the premise is pinned rather than remembered.
    //
    // ⚠️ Pinned as "the BUILD's dispatcher", not as "the only one in the file". There are three in
    // this route and the other two are correctly separate: the publish handler's (a different
    // request entirely) and the plan runner's (`update_todo` only, so it writes nothing to count).
    // A global count would have failed for two reasons that have nothing to do with this fix.
    const built = route.match(/const dispatcher = new ToolDispatcher\(actuator, workspaceId, state, events, spawnSubAgent,/g) ?? [];
    expect(built).toHaveLength(1);
    expect(route).toContain('const baseRunnerOpts = {');
    expect(route).toMatch(/const retryRunner = new AgentRunner\(\{\s*\n\s*\.\.\.baseRunnerOpts,/);

    // …and the retry does not override it back out again.
    const from = route.indexOf('const retryRunner = new AgentRunner({');
    const to = route.indexOf('const retry = await retryRunner.run(');
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    expect(route.slice(from, to)).not.toContain('dispatcher');
  });
});
