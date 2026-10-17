// Q-1132 — A FLOW READ WAITS FOR THE FRAMES ITS VERDICT NEEDS, AND SAYS SO WHEN IT COULD NOT.
//
// 🔴 HOW IT WAS FOUND, and it is not a flake. `tests/aRacingGameIsStartedAndDriven.test.ts`'s chase-front
// case failed inside the FULL suite on `main` — `expect(firmFlow(run.gasFlow)).toBe(-1)` received `0` —
// and passed on its own, 26/26. Measured: the failure came at 16.2 s against a 180 s bound, so it was an
// assertion and not a timeout, and the diff of the commit that had just merged could not reach this code
// at all (8 files, none of them the probe). What it actually was: `sampleFlow` collected frames for a
// fixed 3 s, a machine running 2717 test files beside it drew too few of them, fewer than
// FLOW_MIN_PAIRS voted, and `firmFlow` answered `0` — "could not tell".
//
// 🧬 THE CLASS IS Q-1038'S, IN THE SIBLING THAT HUNT MISSED. Q-1038 was, in its own words, *"the
// playtest's turn sample is wall-clock, so a starved page reads null"*. The TURN sample was moved onto
// drawn frames then; `sampleFlow` kept its wall clock, and nothing in that change looked for it. Rule 3
// of the fourth absolute rule is to hunt the siblings, and this one was mine and was not hunted.
//
// ⚠️ THE VERDICT WAS NEVER WRONG, which is exactly why it took a red CI run to surface. `firmFlow`
// returned `0`, never the opposite direction — Q-1097's guarantee held. What was missing is the other
// half of that same rule: a starved read must SAY it was starved, so a caller can tell "could not
// measure" from "measured, and the game is fine". Both halves are here now.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  firmFlow, flowStarved, flowStarvedNote, FLOW_MIN_PAIRS, FLOW_MIN_FRAMES, FLOW_MIN_PX,
  type FlowRead,
} from '../src/server/AgentV3/gamePlaytest';

const SRC = readFileSync(join(process.cwd(), 'src/server/AgentV3/gamePlaytest.ts'), 'utf8');

/** A read with enough agreeing pairs to be firm in the given direction. */
const firm = (sign: -1 | 1, frames = FLOW_MIN_FRAMES): FlowRead =>
  ({ total: sign * (FLOW_MIN_PX + 2), pos: sign > 0 ? 3 : 0, neg: sign > 0 ? 0 : 3, pairs: 3, read: 3, frames });

describe('a flow read waits for its frames, and says so when it could not get them', () => {
  it('the floor is ONE number, read by both the sampler and the verdict', () => {
    expect(FLOW_MIN_FRAMES).toBe(FLOW_MIN_PAIRS + 1);
    // The literal `3` inside firmFlow is what made the floor invisible upstream: nothing could know what
    // the sampler had to collect. A reversion to the literal fails here.
    expect(SRC, 'firmFlow must read the shared constant, not a literal')
      .toContain('if (agree < FLOW_MIN_PAIRS || agree < Math.ceil(voted * 0.75)) return 0;');
    expect(SRC, 'the sampler must be handed the same floor').toContain('flowMinFrames: FLOW_MIN_FRAMES');
  });

  it('the sampler extends its window while the floor is unmet, and is still bounded', () => {
    // The loop is inside the Playwright script (a template literal), so it is asserted as source.
    expect(SRC).toContain('const hardEnd = performance.now() + ms * 3;');
    expect(SRC).toContain('&& (performance.now() < end || frames.length < minFrames)');
    expect(SRC, 'a canvas that never draws again must still end the probe')
      .toContain('&& performance.now() < hardEnd');
  });

  it('BOTH flow reads get the floor — the steering one was the sibling in the same function', () => {
    // Fixing the accelerator read and leaving the steering read on the wall clock would have been this
    // bug's own class repeated one line down. Both call sites are pinned.
    const calls = [...SRC.matchAll(/sampleFlow\(page, '[xy]', 3000[^)]*\)/g)].map((m) => m[0]);
    expect(calls.length, 'two flow reads: the accelerator (y) and the steering (x)').toBe(2);
    for (const call of calls) expect(call, call).toContain('cfg.flowMinFrames');
    expect(SRC).toContain("out.steerFlow = await sampleFlow(page, 'x', 3000, cfg.flowMinFrames)");
  });

  it('a firm read still reads firm, in both directions — the verdict is unchanged', () => {
    expect(firmFlow(firm(1))).toBe(1);
    expect(firmFlow(firm(-1))).toBe(-1);
    expect(flowStarved(firm(1))).toBe(false);
    expect(flowStarvedNote(firm(1))).toBeNull();
  });

  it('a STARVED read is named, not silently 0 — this is the half that was missing', () => {
    const starved: FlowRead = { total: 0.4, pos: 1, neg: 0, pairs: 1, read: 1, frames: 2 };
    expect(firmFlow(starved), 'still no verdict — that part was always right').toBe(0);
    expect(flowStarved(starved)).toBe(true);
    expect(flowStarvedNote(starved)).toContain('drew only 2 frame(s)');
    expect(flowStarvedNote(starved)).toContain(`${FLOW_MIN_FRAMES}`);
  });

  it('and a read that saw ENOUGH frames but found no direction is NOT called starved', () => {
    // The distinction the whole row is about: this one is a fact about the game (a top-down camera that
    // moves nothing), not a fact about our probe. Calling it starved would blame the wrong thing.
    const flat: FlowRead = { total: 0.2, pos: 2, neg: 2, pairs: 4, read: 4, frames: 9 };
    expect(firmFlow(flat)).toBe(0);
    expect(flowStarved(flat)).toBe(false);
    expect(flowStarvedNote(flat)).toBeNull();
  });

  it('a missing read, and an older read with no frame count, are judged honestly', () => {
    expect(flowStarved(null)).toBe(true);
    expect(flowStarved(undefined)).toBe(true);
    expect(flowStarvedNote(null)).toContain('no canvas large enough');
    // A read saved before this change carries no `frames`; its votes are the next best evidence, so an
    // old firm read is not retro-actively called starved.
    const old = { total: -5, pos: 0, neg: 3, pairs: 3, read: 3 } as FlowRead;
    expect(flowStarved(old)).toBe(false);
    const oldThin = { total: -5, pos: 0, neg: 1, pairs: 1, read: 1 } as FlowRead;
    expect(flowStarved(oldThin)).toBe(true);
  });

  it('the sampler reports what it saw, so the note is a measurement and not a guess', () => {
    expect(SRC).toContain('read, frames: frames.length };');
  });
});
