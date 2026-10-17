// A NULL SCENE READING IS NEVER SILENT (Q-1097).
//
// 🔴 THE TWO FAILURES THAT FOUND IT, both on a real browser under a loaded machine, hours apart:
//
//   tests/aThreeGameIsReadFromItsScene.test.ts
//     × a chase camera done right      → { faces: false, mirrored: null }, expected mirrored: false
//     × 🔒 mirrored steering is read…  → { faces: false, mirrored: null }, expected mirrored: true
//
// Both runs had frames to spare, so `probeStarved` — Q-1038's reason — was FALSE and its starved branch never
// fired. The camera axis read fine; the steering axis came back with nothing to say, and said nothing about
// why. Three things were wrong underneath, and each is fixed at the class rather than the instance:
//
//   1. THE REASON WAS NOT COMPUTED FROM THE EVIDENCE. `probeStarved` counts frames; the verdict's floors are
//      geometric (the vehicle seen to move, the camera following it, the turn big enough to call). A predicate
//      and the evidence it guards computed from two different inputs is Q-1022's class. `sceneUnread` answers
//      from the same read the verdict does, and the invariant below makes a silent null impossible.
//   2. THE VEHICLE WAS IDENTIFIED TWICE. The steering probe re-picked it from its own sample. The racer
//      fixture's traffic car moves 0.5 per frame whatever the player presses and NEVER turns, so a second pick
//      under load can land on it — and an object that never turns reads as "no turn at all".
//   3. A LONG LOOK CAN LIE, not merely fail. `turn` is a chord angle: for an arc of swept angle θ it is θ/2.
//      Three seconds of holding LEFT is a 310° sweep at 60 fps on that fixture; past 360° the chord points
//      BACKWARDS and `turn < 0` accuses a correctly-steering game of mirrored steering. That is a WRONG
//      user-facing verdict — strictly worse than a null — and it sat one frame-rate step away.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';
import {
  sceneVerdict, sceneUnread, chordTurn, pickTurn, readTurn, probeStarved, probeStarvedNote, playtestVerdict,
  gamePlaytestConfig, PROBE_MIN_FRAMES, TURN_MIN_DEG, TURN_READ_MS, TURN_WRAP_SAFE_DEG, type SceneRead,
} from '../src/server/AgentV3/gamePlaytest';

/** A healthy read, in the shape the probe records now: the vectors, not a pre-computed angle. */
const read = (over: Partial<SceneRead> = {}): SceneRead => ({
  moved: 1, follows: true, ahead: -1, looks: 0.9, probeFrames: 60, probeMs: 300,
  aim: { straight: [0, 10], early: [3.4, 9.4], late: [3.4, 9.4] }, // ≈ +20°, the driver's left
  ...over,
});

const DRIVING = { progress: true, restart: true, driving: true };
const runWith = (scene: SceneRead | undefined) => ({
  ok: true, idle: 1, gas: 5, fps: 60, errorCount: 0, touch: 5, touchSurface: true,
  moves: [{ label: 'left / A', change: 5 }, { label: 'right / D', change: 5 }, { label: 'Space', change: 5 }],
  scene,
});
/** The vector a given chord angle would give, at a length well clear of the 0.2 floor. */
const at = (deg: number, len = 10): [number, number] =>
  [len * Math.sin((deg * Math.PI) / 180), len * Math.cos((deg * Math.PI) / 180)];
const aimOf = (early: number | null, late: number | null): SceneRead['aim'] =>
  ({ straight: at(0), early: early === null ? null : at(early), late: late === null ? null : at(late) });

describe('🔒 THE INVARIANT: every axis is either read or explained — never both, never neither', () => {
  // The grid walks each floor from both sides, so a future edit that adds a null branch without a reason
  // fails here rather than on a loaded machine six weeks later.
  const GRID: Array<SceneRead | null | undefined> = [
    null, undefined,
    read(), read({ aim: aimOf(-20, -20) }), read({ aim: undefined }), read({ aim: aimOf(0, 0) }),
    read({ aim: aimOf(TURN_MIN_DEG, TURN_MIN_DEG) }), read({ aim: aimOf(TURN_MIN_DEG - 0.1, null) }),
    read({ aim: aimOf(null, null) }), read({ aim: { straight: null, early: at(20), late: at(20) } }),
    read({ aim: undefined, turn: 20 }), read({ aim: undefined, turn: 1 }), read({ aim: undefined, turn: Number.NaN }),
    read({ probeFrames: PROBE_MIN_FRAMES - 1 }), read({ probeFrames: PROBE_MIN_FRAMES }),
    read({ follows: false }), read({ moved: 0.19 }), read({ moved: 0.2 }),
    read({ ahead: 0 }), read({ ahead: 0.3 }), read({ ahead: 0.31, looks: 0.5 }),
    read({ ahead: 0.31, looks: 0.51 }), read({ ahead: -0.3 }), read({ ahead: -0.31 }),
  ];

  it.each(GRID.map((r, i) => [i, r] as const))('read #%i: exactly one of the verdict and the reason', (_i, r) => {
    const v = sceneVerdict(r), u = sceneUnread(r);
    for (const axis of ['faces', 'mirrored'] as const) {
      const answered = v[axis] !== null, explained = u[axis] !== null;
      expect(answered !== explained, `${axis}: verdict=${String(v[axis])} reason=${String(u[axis])}`).toBe(true);
    }
  });

  it('a reason is a sentence a human can act on, not a code', () => {
    expect(sceneUnread(undefined).mirrored).toMatch(/scene was never read/);
    expect(sceneUnread(read({ follows: false })).faces).toMatch(/did not follow/);
    expect(sceneUnread(read({ moved: 0.1 })).mirrored).toMatch(/moved too little/);
    expect(sceneUnread(read({ aim: undefined })).mirrored).toMatch(/no turn was measured/);
    expect(sceneUnread(read({ aim: aimOf(2, 2) })).mirrored).toMatch(/too small to call \(2°\)/);
    expect(sceneUnread(read({ ahead: 0 })).faces).toMatch(/square to the vehicle/);
    expect(sceneUnread(read({ ahead: 0.9, looks: 0.1 })).faces).toMatch(/not looking at it \(looks 0\.1\)/);
  });

  it('starvation is named BEFORE a floor it caused — Q-1038 keeps its sentence', () => {
    const starved = read({ probeFrames: 3, probeMs: 2500, aim: undefined, moved: 0.01 });
    expect(sceneUnread(starved).mirrored).toBe(probeStarvedNote(starved));
    expect(sceneUnread(starved).mirrored).toMatch(/page starved: 3 frames in 2500 ms/);
    // Naming "moved too little" would blame the app for our own instrument not drawing.
    expect(sceneUnread(starved).mirrored).not.toMatch(/moved too little/);
  });

  it('🔴 THE SHAPE BOTH FAILURES PRODUCED is now explained, and still never a wrong claim', () => {
    const asMeasured = read({ ahead: -0.97, looks: 0.98, aim: undefined, probeFrames: 180, probeMs: 3000 });
    expect(sceneVerdict(asMeasured)).toEqual({ faces: false, mirrored: null });
    expect(sceneUnread(asMeasured).faces).toBeNull();
    expect(sceneUnread(asMeasured).mirrored).toMatch(/no turn was measured/);
  });
});

describe('🔒 WHY the live tests branch on the reason and not on the frame count', () => {
  it('the measured shape passes the frame count and still has no answer', () => {
    // This is the whole of Q-1097 in three lines. `tests/aThreeGameIsReadFromItsScene.test.ts` guarded its
    // reading with `probeStarved` — Q-1038's predicate — and this read walks straight through it. Anyone
    // tempted to simplify that branch back to a frame count fails here, with the numbers from the real run.
    const asMeasured = read({ ahead: -0.97, looks: 0.98, aim: undefined, probeFrames: 180, probeMs: 3000 });
    expect(probeStarved(asMeasured), 'the frame count says the page was drawing fine').toBe(false);
    expect(probeStarvedNote(asMeasured), 'so Q-1038 has nothing to say about it').toBeNull();
    expect(sceneUnread(asMeasured).mirrored, 'and the steering reading still has no answer').not.toBeNull();
  });
});

describe('🔒 the chord angle, and how far it may be trusted', () => {
  it('+ is the driver’s left, − the right', () => {
    expect(chordTurn(at(0), at(20))!).toBeCloseTo(20, 1);
    expect(chordTurn(at(0), at(-20))!).toBeCloseTo(-20, 1);
    expect(chordTurn(at(0), at(0))!).toBe(0);
    expect(chordTurn(at(90), at(110))!).toBeCloseTo(20, 1);
  });

  it('a displacement too short to have a direction is null, not a guess', () => {
    expect(chordTurn(at(0), at(20, 0.19))).toBeNull();
    expect(chordTurn(at(0, 0.1), at(20))).toBeNull();
    expect(chordTurn(at(0), null)).toBeNull();
    expect(chordTurn(null, at(20))).toBeNull();
    expect(chordTurn(at(0), at(20, 0.2))).not.toBeNull();
  });

  it('🔴 THE WRAP: a sweep past half a turn is REFUSED, because its sign is a lie', () => {
    // A 361° sweep gives a chord at 180.5°, which atan2 reports as −179.5: "it turned right". The vehicle
    // turned LEFT, for a full circle. Believing that reading is how a correct game gets accused.
    const wrapped = chordTurn(at(0), at(180.5))!;
    expect(wrapped).toBeLessThan(0);
    expect(Math.abs(wrapped)).toBeGreaterThan(TURN_WRAP_SAFE_DEG);
    expect(pickTurn(null, wrapped), 'a possibly-wrapped long reading is never used').toBeNull();
    expect(pickTurn(2, wrapped), 'nor when the short reading is merely too small').toBe(2);
    expect(sceneVerdict(read({ aim: aimOf(null, 180.5) })).mirrored, 'and no verdict comes of it').toBeNull();
    expect(sceneUnread(read({ aim: aimOf(null, 180.5) })).mirrored).toMatch(/no turn was measured/);
  });

  it('the short window first; the long one only as a fallback, and only unwrapped', () => {
    expect(pickTurn(20, 155)).toBe(20);
    expect(pickTurn(2, 140), 'too small to call, and the long look has not wrapped').toBe(140);
    expect(pickTurn(null, 140), 'nothing in the short window, a safe long one').toBe(140);
    expect(pickTurn(null, TURN_WRAP_SAFE_DEG)).toBe(TURN_WRAP_SAFE_DEG);
    expect(pickTurn(null, TURN_WRAP_SAFE_DEG + 0.1)).toBeNull();
    expect(pickTurn(null, null)).toBeNull();
    expect(pickTurn(-20, 170)).toBe(-20);
  });

  it('readTurn: the vectors when the probe recorded them, the old field when it did not', () => {
    expect(readTurn(read())!).toBeCloseTo(20, 0);
    expect(readTurn(read({ aim: undefined, turn: -14 }))).toBe(-14);
    expect(readTurn(read({ aim: undefined, turn: Number.NaN }))).toBeNull();
    expect(readTurn(read({ aim: undefined }))).toBeNull();
    expect(readTurn(null)).toBeNull();
    // `aim` wins where both exist: it is what this run measured, `turn` is what an older one carried.
    expect(readTurn(read({ aim: aimOf(-30, -30), turn: 99 }))!).toBeCloseTo(-30, 0);
  });
});

describe('🔒 the report says which reason it was, and only where the scene was consulted', () => {
  it('a starved page reads exactly as it did before Q-1097', () => {
    const m = playtestVerdict(runWith(read({ probeFrames: 3, probeMs: 2500, aim: undefined })) as never, DRIVING).message;
    expect(m).toMatch(/Steering was not read — page starved: 3 frames in 2500 ms/);
    // One sentence, not the same reason twice under two headings.
    expect(m).not.toMatch(/camera could not be read/);
  });

  it('🔴 the four reasons that used to print NOTHING now print', () => {
    for (const [scene, pattern] of [
      [read({ aim: undefined }), /Steering was not read — no turn was measured/],
      [read({ aim: aimOf(1.2, 1.2) }), /Steering was not read — the turn was too small to call \(1\.2°\)/],
      [read({ follows: false }), /Steering was not read — the camera did not follow/],
      [read({ moved: 0.05, aim: undefined }), /Steering was not read — the vehicle moved too little/],
    ] as const) {
      expect(playtestVerdict(runWith(scene) as never, DRIVING).message).toMatch(pattern);
    }
  });

  it('the camera half is appended only when its reason differs from the steering one', () => {
    const cameraOnly = playtestVerdict(runWith(read({ ahead: 0 })) as never, DRIVING).message;
    expect(cameraOnly).toMatch(/The camera could not be read from the scene — the camera sat square/);
    expect(cameraOnly).not.toMatch(/Steering was not read/);
    const both = playtestVerdict(runWith(read({ follows: false })) as never, DRIVING).message;
    expect(both.match(/did not follow the vehicle/g), 'said once, not twice').toHaveLength(1);
  });

  it('🔴 A CONTRADICTION Q-1038 LEFT BEHIND: a starved page whose turn DID read is not called unread', () => {
    // The note used to fire on the frame count alone, so this run said "Steering was not read" in the same
    // report that scored `steeringMirrored` from the reading it had just denied having. That is Q-1022's
    // class — a predicate and its evidence computed from two different inputs — sitting inside the previous
    // fix for it. Positions are state: a short look at them is shorter, never wrong.
    const starvedButRead = read({ probeFrames: 3, probeMs: 2500 }); // its aim is healthy: about +20°
    expect(sceneVerdict(starvedButRead).mirrored).toBe(false);
    expect(sceneUnread(starvedButRead).mirrored, 'it WAS read — there is nothing to explain').toBeNull();
    expect(playtestVerdict(runWith(starvedButRead) as never, DRIVING).message).not.toMatch(/Steering was not read/);
    // …and the axis that genuinely could not be read still names the starvation, not the floor it caused.
    const starvedAndNot = read({ probeFrames: 3, probeMs: 2500, aim: undefined, moved: 0.01 });
    expect(sceneUnread(starvedAndNot).mirrored).toMatch(/page starved/);
  });

  it('a page that WAS drawing says nothing extra', () => {
    const m = playtestVerdict(runWith(read()) as never, DRIVING).message;
    expect(m).not.toMatch(/Steering was not read/);
    expect(m).not.toMatch(/camera could not be read/);
  });

  it('🔒 PRECISION: no scene, and no driving game, stay silent — pixels are the designed path there', () => {
    expect(playtestVerdict(runWith(undefined) as never, DRIVING).message).not.toMatch(/was not read|could not be read/);
    expect(playtestVerdict(runWith(read({ aim: undefined })) as never, { progress: true, restart: true, driving: false }).message)
      .not.toMatch(/was not read|could not be read/);
  });

  it('a reason does not change the SCORE — our instrument, not the app’s defect (Q-1038’s division)', () => {
    const scored = (scene: SceneRead) => playtestVerdict(runWith(scene) as never, DRIVING).score!.overall;
    expect(scored(read({ aim: undefined }))).toBe(scored(read()));
    expect(scored(read({ aim: aimOf(1.2, 1.2) }))).toBe(scored(read()));
  });
});

describe('🧭 CLASS GUARD: one subject, one arithmetic, one floor', () => {
  // The comments are stripped because this file's own history notes NAME the call and the literal the fix
  // removed — a source guard that cannot tell code from the prose describing it fails on its own
  // documentation, which is the trap Q-1081, Q-1021 and Q-1016 each hit in turn.
  const SRC = stripCodeComments(readFileSync(join(__dirname, '../src/server/AgentV3/gamePlaytest.ts'), 'utf8'));

  it('the vehicle is picked ONCE in the whole probe', () => {
    const calls = [...SRC.matchAll(/pickVehicle\(/g)].length - [...SRC.matchAll(/function pickVehicle\(/g)].length;
    expect(calls, 'a second pick can land on a different object — that is Q-1097').toBe(1);
    expect(SRC, 'the steering probe reads the pick, it does not make one').toMatch(/const car = vehicleId;/);
    expect(SRC).toMatch(/vehicleId = car;/);
  });

  it('the steering arithmetic lives OUTSIDE the probe script, in one place', () => {
    // `atan2` is the angle; the script may measure, never decide. A copy inside the template literal is how
    // user-facing arithmetic became untestable in the first place.
    expect([...SRC.matchAll(/Math\.atan2\(/g)].length, 'one atan2, inside chordTurn').toBe(1);
    expect(SRC).toMatch(/out\.scene\.aim = \{/);
    expect(SRC, 'the probe no longer computes the angle itself').not.toMatch(/out\.scene\.turn = /);
  });

  it('the turn floor and the wrap bound each have one definition', () => {
    expect([...SRC.matchAll(/Math\.abs\(turn\) >= TURN_MIN_DEG/g)].length).toBe(1);
    expect(SRC, 'the floor is named, never a literal 5 again').not.toMatch(/Math\.abs\(r\.turn\) >= 5\b/);
    expect([...SRC.matchAll(/TURN_WRAP_SAFE_DEG/g)].length, 'declared, and read in pickTurn only').toBe(2);
  });

  it('the window the reading depends on reaches the script through cfg, like every other constant', () => {
    expect(gamePlaytestConfig('http://x').turnReadMs).toBe(TURN_READ_MS);
    expect(SRC).toMatch(/cfg\.turnReadMs/);
    // And its frames are counted into the weakest leg — Q-1038's rule for any window a reading rests on.
    expect(SRC).toMatch(/legStraight\.frames, legEarly\.frames, legTurn\.frames/);
  });
});
