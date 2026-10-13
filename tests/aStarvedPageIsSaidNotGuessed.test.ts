/**
 * Q-1038 — A FRAME-DRIVEN SIMULATION IS SAMPLED IN FRAMES, NOT MILLISECONDS.
 *
 * 🔴 WHAT WENT WRONG, AND WHY IT COST TWO PRs. The steering probe held LEFT for a fixed interval and read
 * the turn from the vehicle's velocity before and after. The fixture turns 0.03 rad — about 1.7° — PER
 * FRAME, and `sceneVerdict` will not read a turn below 5°, so three drawn frames is the arithmetic floor.
 * A page starved of frames by a loaded machine produced too little travel to clear the 0.2 speed floor,
 * the turn was never computed, and `mirrored` came back `null`.
 *
 * That null was never a FALSE claim — and it was indistinguishable from the true finding "this game does
 * not steer". So `tests/aThreeGameIsReadFromItsScene.test.ts` passed alone and failed under load, and it
 * gated report 9c612cdb's PR and then #3703 before anyone traced it to the clock.
 *
 * 🧬 IT IS Q-869's CLASS, IN THE PLACE THAT FIX DID NOT REACH. Q-869 removed exactly this dependence from
 * the PIXEL verdicts — a page a loaded machine stops drawing shows the same picture whatever the car does,
 * so those looks record `gasLateFrames` and are only believed when the page was drawing. The STEERING
 * probe, in the same file, kept its stopwatch. The instance was fixed; the class was not.
 *
 * 🔒 SO THE FIX HAS TWO HALVES, and the second is what makes the first checkable:
 *   1. the probe waits for DRAWN FRAMES (`waitFrames`), with a wall-clock cap so a dead raf loop cannot
 *      hang it;
 *   2. when the cap wins, it SAYS SO — "page starved: 3 frames in 2500 ms" — instead of reporting a null
 *      that reads like a clean result. That is `playtestNotRunVerdict`'s own stated principle applied one
 *      level down: a check that could not look is not a check that passed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  probeStarved, probeStarvedNote, sceneVerdict, playtestVerdict,
  PROBE_MIN_FRAMES, PROBE_CAP_MS, type SceneRead,
} from '../src/server/AgentV3/gamePlaytest';

const SRC = readFileSync(resolve(__dirname, '../src/server/AgentV3/gamePlaytest.ts'), 'utf8');

/** A scene read that turned properly, with the frames to prove the page was drawing. */
const healthy = (over: Partial<SceneRead> = {}): SceneRead =>
  ({ moved: 1, follows: true, ahead: -1, looks: 0.9, turn: 20, probeFrames: 60, probeMs: 300, ...over });

describe('Q-1038 — a starved page is reported, never guessed at', () => {
  it('🔴 a probe that drew too few frames is starved', () => {
    expect(probeStarved(healthy({ probeFrames: 2, turn: undefined }))).toBe(true);
    expect(probeStarved(healthy({ probeFrames: PROBE_MIN_FRAMES - 1 }))).toBe(true);
  });

  it('a probe that drew enough frames is NOT starved, even with no turn to report', () => {
    // This is the true finding the null used to be confused with: the page drew plenty and the car did
    // not turn. It must stay a finding.
    expect(probeStarved(healthy({ probeFrames: PROBE_MIN_FRAMES, turn: undefined }))).toBe(false);
    expect(probeStarved(healthy({ probeFrames: 180, turn: undefined }))).toBe(false);
  });

  it('🔒 a run from BEFORE this measurement is not called starved', () => {
    // `undefined` means "this run predates the counter", not "zero frames". Treating it as starvation
    // would turn every stored run into a false alarm overnight.
    expect(probeStarved({ moved: 1, follows: true, ahead: -1, looks: 0.9 })).toBe(false);
    expect(probeStarved(null)).toBe(false);
    expect(probeStarved(undefined)).toBe(false);
    expect(probeStarvedNote({ moved: 1, follows: true, ahead: -1, looks: 0.9 })).toBeNull();
  });

  it('🔴 the note carries BOTH numbers, because that is what tells the two causes apart', () => {
    const note = probeStarvedNote(healthy({ probeFrames: 3, probeMs: 2500, turn: undefined }))!;
    expect(note).toContain('3 frames');
    expect(note).toContain('2500 ms');
    expect(note).toMatch(/starved/);
    // And nothing is said when the page was drawing.
    expect(probeStarvedNote(healthy())).toBeNull();
  });

  it('the thresholds are the arithmetic, not a feeling', () => {
    // 1.7° per frame against sceneVerdict's 5° floor is a 3-frame floor; 12 is that with room.
    expect(PROBE_MIN_FRAMES).toBeGreaterThanOrEqual(3);
    expect(PROBE_MIN_FRAMES).toBe(12);
    // 12 frames is 2.4 s at 5 fps, so the cap must clear that or the cap always wins on a loaded machine.
    expect(PROBE_CAP_MS).toBeGreaterThan((PROBE_MIN_FRAMES / 5) * 1000);
  });
});

describe('Q-1038 — the probe really waits on frames, and the report really says it', () => {
  it('🔴 the ACCELERATOR window waits for drawn frames — the interval every verdict depends on', () => {
    /**
     * This is the half that actually stopped the flake, and it had NO guard until a reversion proved it:
     * removing it left all thirteen other tests green. `out.scene` is read across this interval, and BOTH
     * sceneVerdict fields sit behind its `moved >= 0.2` guard — so frame-gating the steering leg alone
     * (which is where the queue row pointed) left the camera reading, and through the guard the steering
     * reading too, still on the clock. The test under load still failed. Measuring beat reading the row.
     */
    expect(SRC).toMatch(/const legGas = await waitFrames\(page, \$\{PROBE_MIN_FRAMES\}, \$\{PROBE_CAP_MS\}, 550\);/);
    expect(SRC).not.toMatch(/const g0 = await shot\(page, box\);\s*\n\s*await page\.waitForTimeout\(550\);/);
    // And its frames reach the scene read, or `probeStarved` would be blind to the window that matters.
    expect(SRC).toMatch(/probeFrames: legGas\.frames, probeMs: legGas\.ms,/);
  });

  it('🔴 the frame count is a FLOOR ON TOP OF the original time, not a replacement', () => {
    /**
     * A REGRESSION THIS CHANGE CAUSED AND THE FULL SUITE CAUGHT. The first version waited for frames
     * ALONE — and on a fast machine twelve frames is about 200 ms, against the 550 ms the accelerator
     * window had always run for. The picture changed less between the two shots, `out.gas` fell under the
     * still threshold, the gas optical-flow sample was never taken, and Q-861's steering test
     * (`aRacingGameIsStartedAndDriven`) went from a firm reading to no reading at all.
     *
     * A fix that SHORTENS the measurement it was protecting is not a fix. The slow machine gets its
     * frames; the fast machine keeps its milliseconds; the cap bounds both.
     */
    expect(SRC).toMatch(/async function waitFrames\(page, n, capMs, minMs\)/);
    // Both conditions must hold before it returns — frames AND the floor.
    expect(SRC).toMatch(/if \(got >= n && waited >= minMs\) break;/);
    // And each call site passes the duration that interval used to run for, not a shorter one.
    expect(SRC).toMatch(/legGas = await waitFrames\(page, \$\{PROBE_MIN_FRAMES\}, \$\{PROBE_CAP_MS\}, 550\)/);
    expect(SRC).toMatch(/legStraight = await waitFrames\(page, \$\{PROBE_MIN_FRAMES\}, \$\{PROBE_CAP_MS\}, 400\)/);
  });

  it('🔒 the WEAKEST leg decides, because one starved interval is enough', () => {
    // The accelerator window sets it; the steering legs can only lower it. A max, or overwriting it,
    // would let a good leg hide a starved one.
    expect(SRC).toMatch(/out\.scene\.probeFrames = Math\.min\(out\.scene\.probeFrames \?\? Infinity, legStraight\.frames, legTurn\.frames\);/);
  });

  it('🔒 the steering leg waits for DRAWN frames, not a bare timeout', () => {
    // The exact line that was `waitForTimeout(400)`. Script-side code is inside a template literal, so a
    // source assertion is how this repo locks it (the same way the Q-745 and Q-869 wiring is locked).
    expect(SRC).toMatch(/const legStraight = await waitFrames\(page, \$\{PROBE_MIN_FRAMES\}, \$\{PROBE_CAP_MS\}, 400\);/);
    expect(SRC).not.toMatch(/const e0 = await snapScene\(page\);\s*\n\s*await page\.waitForTimeout\(400\);/);
  });

  it('🔒 the wait is CAPPED — a dead raf loop must not hang the playtest', () => {
    const fn = SRC.slice(SRC.indexOf('async function waitFrames'), SRC.indexOf('async function waitFrames') + 500);
    expect(fn).toMatch(/if \(waited >= capMs\) break;/);
    expect(fn).toMatch(/starved: got < n/);
  });

  it('🔒 the frames are recorded WHETHER OR NOT a turn was computed', () => {
    // The whole point: the number must exist on the run even when the probe found nothing, or the two
    // causes of a null are still indistinguishable.
    const at = SRC.indexOf('out.scene.probeFrames');
    expect(at).toBeGreaterThan(-1);
    // It is set in the `if (out.scene)` block that precedes the narrower `car && after` block.
    expect(SRC.slice(at - 600, at)).toMatch(/Recorded WHETHER OR NOT a turn is computed/);
  });

  it('🔴 the verdict message names the starvation instead of reading as a pass', () => {
    const run = {
      ok: true, idle: 1, gas: 5, fps: 60, errorCount: 0, touch: 5, touchSurface: true,
      moves: [{ label: 'left / A', change: 5 }, { label: 'right / D', change: 5 }, { label: 'Space', change: 5 }],
      scene: healthy({ probeFrames: 3, probeMs: 2500, turn: undefined }),
    };
    const v = playtestVerdict(run as never, { progress: true, restart: true, driving: true });
    expect(v.message).toMatch(/Steering was not read/);
    expect(v.message).toContain('3 frames in 2500 ms');
  });

  it('…and says nothing extra when the page was drawing', () => {
    const run = {
      ok: true, idle: 1, gas: 5, fps: 60, errorCount: 0, touch: 5, touchSurface: true,
      moves: [{ label: 'left / A', change: 5 }, { label: 'right / D', change: 5 }, { label: 'Space', change: 5 }],
      scene: healthy(),
    };
    expect(playtestVerdict(run as never, { progress: true, restart: true, driving: true }).message)
      .not.toMatch(/Steering was not read/);
  });

  it('a starved probe does not change the SCORE — it is our instrument, not the app\'s defect', () => {
    // The same division `playtestNotRunVerdict` draws: the playtest failing to look costs the app no
    // points and no money. Only the sentence changes.
    const base = { ok: true, idle: 1, gas: 5, fps: 60, errorCount: 0, touch: 5, touchSurface: true,
      moves: [{ label: 'left / A', change: 5 }, { label: 'right / D', change: 5 }, { label: 'Space', change: 5 }] };
    const drawing = playtestVerdict({ ...base, scene: healthy({ turn: undefined }) } as never, { progress: true, restart: true, driving: true });
    const starvedRun = playtestVerdict({ ...base, scene: healthy({ probeFrames: 3, probeMs: 2500, turn: undefined }) } as never, { progress: true, restart: true, driving: true });
    expect(starvedRun.score!.overall).toBe(drawing.score!.overall);
  });

  it('🧬 and the PIXEL looks still carry their own frame count — Q-869, whose class this is', () => {
    // If that ever regressed, this fix would be the only frame-aware probe in the file and the class
    // would be half-closed again.
    expect(SRC).toMatch(/out\.gasLateFrames = /);
    expect(SRC).toMatch(/\(run\.gasLateFrames \?\? 0\) >= LATE_MIN_FRAMES/);
  });

  it('🔒 the browser script carries no backtick — it IS a template literal', () => {
    /**
     * Not style. `gamePlaytestModule` returns the browser script as a template literal, so an unescaped
     * backtick ANYWHERE inside it — including inside a comment — ends the literal, and the rest of the
     * script becomes code.
     *
     * ⚠️ WHAT THIS DOES AND DOES NOT BUY, because overclaiming it would be worse than not having it: the
     * compiler already catches this, every time it happened today (three times while writing this one
     * change). What it does NOT do is say WHERE — TS1005 points at the next line that fails to parse,
     * which was twenty lines past the backtick each time. This names the line. It is a diagnostics fix,
     * not a new safety net, and it is here because three confused minutes per occurrence is a real cost.
     *
     * The script region is everything `gamePlaytestModule` builds. A backtick there is always a mistake:
     * a value that needs one would be interpolated from the TypeScript side instead.
     */
    // The region is the literal itself: from `return \`${importLine}` to the line that closes it. Bounded
    // by both markers rather than by one, so a shift in the file cannot silently widen the scan to the
    // TypeScript half — whose JSDoc uses backticks legitimately and would drown this in false alarms.
    const open = SRC.indexOf('  return `${importLine}');
    const close = SRC.indexOf('\n`;\n', open);
    expect(open, 'the playtest script template has moved — this guard must follow it').toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    const script = SRC.slice(open, close);
    const offenders = script.split('\n')
      .map((line, i) => ({ line, n: i }))
      // An ESCAPED backtick is legal inside a template literal and two existing comments use one — so the
      // rule is unescaped only. That is also the answer when a comment really needs one: escape it.
      .filter(({ line }) => /^\s*(\/\/|\*)/.test(line) && /(^|[^\\])`/.test(line))
      .map(({ line }) => line.trim().slice(0, 90));
    expect(
      offenders,
      'a backtick in a comment inside the browser-script template literal ENDS the literal:\n' + offenders.join('\n'),
    ).toEqual([]);
  });

  it('🔒 no TypeScript constant is used BARE inside the browser script', () => {
    /**
     * 🔴 A BUG THIS TEST CAUGHT IN ITS OWN CHANGE. The accelerator fix was first written
     * `waitFrames(page, PROBE_MIN_FRAMES, PROBE_CAP_MS)` — no `${…}`. Inside the template literal that is
     * not the TypeScript constant, it is a bare identifier the BROWSER must resolve, and the browser has
     * never heard of it: a ReferenceError that would have thrown inside the accelerator step, left
     * `out.scene` unset, and nulled every scene verdict — turning an intermittent flake into a permanent
     * one. The steering call site, written minutes earlier, had the interpolation; this one did not.
     *
     * It survived a full typecheck (a template literal's contents are just text) and no browser test had
     * run since the edit. Only the source assertion above noticed. So the class gets its own guard.
     */
    const open = SRC.indexOf('  return `${importLine}');
    // Comments stripped first: this file's prose SHOUTS ("READ THE SCENE ITSELF, NOT ONLY ITS PIXELS"),
    // and reading those words as identifiers is the same false-positive class the collection census
    // learned with `stripComments` — a scan that cannot tell code from prose gets its findings ignored.
    const script = SRC.slice(open, SRC.indexOf('\n`;\n', open))
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    // Every SCREAMING_CASE identifier in the script, minus the ones that are really the browser's own.
    const BROWSER_OWN = new Set(['NaN', 'Infinity', 'JSON', 'URL', 'RegExp', 'Math', 'Date', 'Promise', 'Set', 'Map', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Error', 'EventTarget', 'WebGLRenderer']);
    // A constant the SCRIPT declares itself is the browser's own at run time — `CONTROL` is one. Only an
    // identifier that exists nowhere in the script is the TypeScript-side mistake this looks for.
    const declaredHere = new Set([...script.matchAll(/\b(?:const|let|var)\s+([A-Z][A-Z0-9_]{3,})\b/g)].map((m) => m[1]));
    const bare: string[] = [];
    for (const m of script.matchAll(/(^|[^.$\w{])\b([A-Z][A-Z0-9_]{3,})\b/g)) {
      const name = m[2];
      if (BROWSER_OWN.has(name) || declaredHere.has(name) || bare.includes(name)) continue;
      // Interpolated somewhere is fine; used ONLY bare is the bug.
      if (!script.includes('${' + name + '}') && !new RegExp('\\$\\{[^}]*\\b' + name + '\\b').test(script)) bare.push(name);
    }
    expect(
      bare,
      'these look like TypeScript constants used bare in the browser script — the browser cannot resolve '
      + 'them and will throw a ReferenceError:\n' + bare.join('\n'),
    ).toEqual([]);
  });

  it('sceneVerdict itself is unchanged: it still refuses to read a turn under 5°', () => {
    // The fix is upstream of the verdict. If this moved, a starved page could start making CLAIMS
    // instead of nulls, which would be far worse than the flake.
    expect(sceneVerdict(healthy({ turn: 4.9 })).mirrored).toBeNull();
    expect(sceneVerdict(healthy({ turn: -20 })).mirrored).toBe(true);
    expect(sceneVerdict(healthy({ turn: 20 })).mirrored).toBe(false);
  });
});
