/**
 * 🎮 AN 8-MINUTE GAME EDIT WAS PRICED FROM THE HISTORY OF "hi" — autopsy `8b8743a3`, Q-313.
 *
 * The report: *"Road infinite both side street light with start restart scoring"*, an edit of a 3D
 * driving game, **8.0 minutes**, and the user was promised **3–5**. The request was filed as
 * `taskType: 'chat'`, `complexityScore: 5`.
 *
 * 🔑 THE QUEUE ROW BLAMED THE WRONG THING, AND FOLLOWING THE EVIDENCE WAS CHEAPER THAN ITS THEORY.
 * Q-313 read it as a vocabulary gap — "the scorer recognised nothing in a GAME feature list" — and
 * said a widening of `COMPLEX_APP_SIGNAL` toward game words would need a precision corpus first.
 * Measured on `main` before anything was written, that widening was **not needed**: a game IS
 * recognised (`Make a racing game` → `simple_app`, domain `game`), and recognising this one would
 * have moved it from `chat` to `simple_app` — **the same tier, the same 15**. Two wiring facts explain
 * the entire observation, and neither is a keyword list:
 *
 *   1. **The turn was an EDIT, and `app_unsized` only ever covered `new_build`.** That label exists
 *      because *"leaving it filed as `chat` sent its ETA to the history of a bucket named for
 *      something else"* (autopsy 0473628e). `etaTaskKey` returns the task type verbatim, so the
 *      label IS the fleet bucket: this build's estimate was learned from greetings, questions and
 *      capability checks. The harm runs both ways — the `chat` bucket was simultaneously being
 *      taught that a chat turn takes eight minutes.
 *   2. **`fileCount` was never passed.** `projectFileCount` has been in scope ~2,600 lines above the
 *      one `analyzeRequest` call site, and the analyser's own docblock justifies excluding an edit
 *      from the unsized floor with *"an edit is not an app being ordered, and its file count already
 *      raises the score"* — a compensation that never ran. Measured: `chat/5` where `chat/11` was the
 *      honest number, and an edit of a 200-file project scored exactly like an edit of an empty one.
 *
 * Both are this repo's headline class: the instance fixed in one of the two lanes that carry it.
 *
 * 🔒 WHAT THIS FILE LOCKS, and why some of it has to be a SOURCE guard: a missing OPTIONAL argument is
 * invisible to `tsc` and to every behavioural test — `analyzeRequest({ prompt })` compiles, runs, and
 * silently sizes every project as empty. That is exactly how fact 2 survived. So the wiring is asserted
 * against the route's own source, the way `cachePrefixWiring` and `theLoopBreakerAndItsMeasurement` do.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  analyzeRequest,
  anEditTurnThatCouldNotBeSized,
  anAppWasOrderedButNotRecognised,
} from '../src/server/AgentV3/RequestAnalyser';
import { etaTaskKey, fleetHistoryFromTelemetry } from '../src/server/AgentV3/etaHistory';

const REPORTED = 'Road infinite both side street light with start restart scoring';
/** The second message in the same report, mid-build. */
const REPORTED_FOLLOW_UP = '3d run control speed city road or forest road';

function size(prompt: string, buildIntent?: 'chat' | 'new_build' | 'edit_existing', fileCount?: number) {
  return analyzeRequest({ prompt, ...(buildIntent ? { buildIntent } : {}), ...(fileCount === undefined ? {} : { fileCount }) });
}

/** Everything downstream turns on these two: the opening rung reads the 40 line, the lane reads the tier. */
function routing(prompt: string, buildIntent?: 'chat' | 'new_build' | 'edit_existing', fileCount?: number) {
  const a = size(prompt, buildIntent, fileCount);
  return { tier: a.startTier, complex: a.complexityScore >= 40 };
}

describe('the reported turn is no longer filed as chat', () => {
  it('labels the report\'s own prompt an unsized EDIT, not a chat turn', () => {
    const a = size(REPORTED, 'edit_existing', 14);
    expect(a.taskType).toBe('edit_unsized');
    expect(a.reasoning).toContain('an edit ran on the build path but no signal recognised it');
  });

  it('sends its ETA to its own bucket instead of the history of greetings', () => {
    const a = size(REPORTED, 'edit_existing', 14);
    expect(etaTaskKey(a.taskType, false)).toBe('edit_unsized');
    expect(etaTaskKey(a.taskType, false)).not.toBe('chat');
  });

  it('falls back to the heuristic while that bucket is empty — never to another bucket\'s mean', () => {
    // A brand-new bucket has no telemetry on day one. The honest answer is "no fleet history", which
    // is what every new task type gets; borrowing the chat bucket's mean is the defect being fixed.
    const days = [{ date: '2026-10-03', byTaskType: { chat: { builds: 90, durationMs: 90 * 4_000, okBuilds: 90, okDurationMs: 90 * 4_000 } } }];
    const fleet = fleetHistoryFromTelemetry(days, 'edit_unsized', { files: 3, features: 2, integrations: 0, hasAuth: false, hasDatabase: false, hasPayments: false });
    expect(fleet.history).toEqual([]);
    expect(fleet.builds).toBe(0);
  });

  it('covers the same report\'s follow-up message too', () => {
    expect(size(REPORTED_FOLLOW_UP, 'edit_existing', 14).taskType).toBe('edit_unsized');
  });
});

describe('it changes what the report says, not where the build goes', () => {
  it('is routing-identical to the chat label it replaces', () => {
    // 15 and 11 both map to the same tier and both sit below the 40 line, which is the entire claim.
    const before = { ...routing(REPORTED, 'edit_existing', 14) };
    process.env.AGENTV3_SIZE_EDIT_TURNS = 'off';
    try {
      const reverted = routing(REPORTED, 'edit_existing', 14);
      expect(size(REPORTED, 'edit_existing', 14).taskType).toBe('chat');
      expect(reverted).toEqual(before);
    } finally {
      delete process.env.AGENTV3_SIZE_EDIT_TURNS;
    }
  });

  it('holds the two floors equal, which is what makes that true by construction', () => {
    // Both labels mean "a build turn this module could not size"; a different floor for one of them
    // would make the relabel a routing change nobody measured.
    const app = size('Create a upsc preparation aap', 'new_build');
    const edit = size(REPORTED, 'edit_existing');
    expect(app.taskType).toBe('app_unsized');
    expect(edit.taskType).toBe('edit_unsized');
    expect(edit.complexityScore).toBe(app.complexityScore);
  });
});

describe('precision — the turns that must NOT be relabelled', () => {
  it('leaves a chat turn alone however many files the workspace holds', () => {
    for (const p of ['hi', 'thanks!', 'is it working?', 'how much does this cost?', 'can you generate images?', 'what can you build?']) {
      expect(size(p, 'chat', 40).taskType).toBe('chat');
    }
  });

  it('never calls a greeting a build turn, even if the intent says edit', () => {
    // If something upstream routed "hi" to edit_existing, mislabelling it here helps nobody and
    // pollutes the new bucket on its first day.
    expect(size('hi', 'edit_existing', 14).taskType).toBe('chat');
    expect(anEditTurnThatCouldNotBeSized('hello', 'edit_existing')).toBe(false);
    expect(anEditTurnThatCouldNotBeSized('   ', 'edit_existing')).toBe(false);
  });

  it('leaves an edit the module DOES recognise exactly as it was', () => {
    const a = size('add pagination to the product list', 'edit_existing', 14);
    expect(a.taskType).toBe('complex_app');
    expect(anEditTurnThatCouldNotBeSized('add pagination to the product list', 'edit_existing')).toBe(false);
  });

  it('never fires without the platform saying the turn is an edit', () => {
    expect(anEditTurnThatCouldNotBeSized(REPORTED, 'chat')).toBe(false);
    expect(anEditTurnThatCouldNotBeSized(REPORTED, 'new_build')).toBe(false);
    expect(anEditTurnThatCouldNotBeSized(REPORTED, undefined)).toBe(false);
  });

  it('leaves the new_build lane to the predicate that already owns it', () => {
    // One label per lane: a new build is still app_unsized, and this predicate stands down there.
    expect(anAppWasOrderedButNotRecognised('Create a upsc preparation aap', 'new_build')).toBe(true);
    expect(size('Create a upsc preparation aap', 'new_build').taskType).toBe('app_unsized');
  });

  it('labels a continuation, and that is deliberate', () => {
    // `describesWorkAlreadyStarted` guards the CLAIM "an app was ordered" — false of a continuation
    // (autopsy 697b38ee). This label claims only "a build turn we could not size", which is true of
    // one, and its ETA must not come from the greeting bucket either.
    expect(size('Continue from where you left off and finish the build', 'edit_existing', 14).taskType).toBe('edit_unsized');
    expect(size('Continue from where you left off and finish the build', 'new_build').taskType).not.toBe('app_unsized');
  });
});

describe('the project\'s size reaches the scorer', () => {
  it('sizes an edit of a real project above an edit of an empty one', () => {
    // Measured on a RECOGNISED edit, where nothing else is competing: 58 → 64 → 70, same tier.
    const empty = size('add pagination to the product list', 'edit_existing');
    const real = size('add pagination to the product list', 'edit_existing', 14);
    const big = size('add pagination to the product list', 'edit_existing', 40);
    expect(real.complexityScore).toBeGreaterThan(empty.complexityScore);
    expect(big.complexityScore).toBeGreaterThan(real.complexityScore);
    expect(real.reasoning).toContain('multi-file project');
    expect(big.reasoning).toContain('large project');
  });

  it('lets the floor win over a small project\'s bump, and that is the routing-neutral half', () => {
    // 🔎 RECORDED BECAUSE IT SURPRISED THE FIRST DRAFT OF THIS TEST. On an UNSIZED edit the floor is
    // applied LAST and can only RAISE, so 5+0 and 5+6 both land on 15 — the file count contributes
    // nothing until it exceeds the floor. That is deliberate: making the two additive would put a
    // one-line edit of a 14-file project at 21, across the ≤20 tier boundary, on nothing but a file
    // count. The label is the fix here; the number stays where it was proven neutral.
    expect(size(REPORTED, 'edit_existing').complexityScore).toBe(15);
    expect(size(REPORTED, 'edit_existing', 14).complexityScore).toBe(15);
    // A genuinely large project does clear it (+12 > the floor), still inside the same tier.
    const large = size(REPORTED, 'edit_existing', 40);
    expect(large.complexityScore).toBeGreaterThan(15);
    expect(large.startTier).toBe(size(REPORTED, 'edit_existing').startTier);
  });

  it('moves no build across the 40 line that decides the opening rung', () => {
    // The measured blast radius, kept as a test so a later adjustment to the file-count bump cannot
    // silently start routing ordinary edits onto the reasoning rung (real money, on the tier
    // NavBharatAI pays for itself).
    const corpus = [
      'add a dark mode toggle', 'fix the header alignment', 'make the buttons bigger',
      'change the primary colour to green', 'add an export to CSV button', 'remove the footer',
      'the save button does nothing', 'add a chart showing monthly sales', REPORTED, REPORTED_FOLLOW_UP,
      'refactor the cart into its own component', 'add tests for the invoice calculator',
      'make a todo app', 'snake game', 'tic tac toe', 'Make a racing game', 'ek billing app banao',
    ];
    for (const p of corpus) {
      for (const intent of ['new_build', 'edit_existing'] as const) {
        const bare = routing(p, intent);
        for (const files of [14, 40]) {
          expect(routing(p, intent, files).complex, `${p} @ ${files} files`).toBe(bare.complex);
        }
      }
    }
  });

  it('is wired at the route\'s own call site — a source guard, because nothing else can see it', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    const calls = src.match(/analyzeRequest\(\{[\s\S]{0,600}?\}\)/g) ?? [];
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('fileCount: projectFileCount');
    expect(calls[0]).toContain('buildIntent: intent');
  });

  it('reverts with one key, and the key is named in the route', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    expect(src).toContain("AGENTV3_SIZE_PROJECT");
  });
});
