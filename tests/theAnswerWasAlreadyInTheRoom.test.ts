/**
 * AUTOPSY `21b431e1` (2026-09-22) — TWO SUBSYSTEMS RE-DERIVED A FACT THE PLATFORM ALREADY HELD, GOT
 * IT WRONG, AND RECORDED THE WRONG ANSWER AS A FACT ABOUT THE USER'S REQUEST AND THE USER'S PROJECT.
 *
 * One build. 18.1 minutes. ₹164.68 billed to a FREE-tier user.
 *
 * 1. THE SIZER FILED A REAL APP BUILD AS "chat", SCORE 5 — the score of the word "hi".
 *    `anAppWasOrderedButNotRecognised` (written 2026-09-20 for autopsy 31dc61fd, to stop exactly
 *    this) asks `userAskedForAnAppToBeBuilt`, which requires HIGH confidence. A QUESTION is capped
 *    below HIGH on purpose — the "read the mood first" rule — so *"kya aap ek app bana sakte ho?"*
 *    and *"mujhe ek app chahiye"*, the commonest shapes a real Indian user types, were
 *    STRUCTURALLY unreachable by the guard. Meanwhile the route had already decided `new_build`
 *    two thousand lines earlier and never passed it in.
 *
 * 2. THE COMPILER SWITCHED ITSELF OFF ON A READ ERROR AND BLAMED THE PROJECT. Three `tsconfig.json`
 *    reads threw; the third was latched as "this is not a TypeScript project" — about a workspace
 *    whose own `ls -la` in the same report lists `tsconfig.json`, and into which `.tsx` files were
 *    being written at that moment. 23 TypeScript writes went unchecked and the fast lane then died
 *    on a `TS2554` this check exists to surface at write time.
 *
 * 🔑 ONE CLASS, TWO INSTANCES: *"we could not look"* recorded as *"there is nothing there"*. Both
 * modules' own docblocks had already NAMED it — `RequestAnalyser`'s says *"TWO MODULES ANSWER 'IS
 * THIS A BUILD?' AND ONE IS NEVER TOLD THE OTHER'S ANSWER"*, and `probeFailures`' says
 * *"`probeFailures > 0` with `skippedNoTsconfig > 0` is the shape of a check that disabled itself
 * on a read error"*. Naming a shape is not acting on it.
 */
import { describe, it, expect } from 'vitest';
import { analyzeRequest, anAppWasOrderedButNotRecognised } from '../src/server/AgentV3/RequestAnalyser';
import { classifyIntentWithConfidence, userAskedForAnAppToBeBuilt, describesWorkAlreadyStarted, normalizeApostrophes } from '../src/server/AgentV3/IntentClassifier';
import {
  probeExhausted, tsProjectSettled, MAX_TSCONFIG_PROBES,
  emptyWriteTypecheckStats, writeTypecheckSummary, writeTypecheckUntouched,
  type WriteTypecheckStats,
} from '../src/server/AgentV3/writeTimeTypecheck';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The four shapes, measured on `main` before the fix: all route to new_build, all filed as chat/5. */
const QUESTION_SHAPED_ORDERS = [
  'kya tum mere liye ek UPPCS preparation app bana sakte ho?',
  'Can you make me a UPPCS preparation app?',
  'mujhe uppcs ki preparation ke liye ek app chahiye',
  'kya aap ek billing app bana sakte ho?',
];

describe('the platform knew it was building, and the sizer is finally told', () => {
  it('every question-shaped order routes to new_build but cannot earn HIGH — that is the gap', () => {
    for (const p of QUESTION_SHAPED_ORDERS) {
      const c = classifyIntentWithConfidence(p);
      expect(c.intent, p).toBe('new_build');
      expect(c.confidence, p).not.toBe('high');
      expect(userAskedForAnAppToBeBuilt(p), p).toBe(false);
    }
  });

  it('without the route’s decision they are still filed as chat, score 5 — today’s behaviour, unchanged', () => {
    for (const p of QUESTION_SHAPED_ORDERS) {
      const a = analyzeRequest({ prompt: p });
      expect(a.taskType, p).toBe('chat');
      expect(a.complexityScore, p).toBe(5);
    }
  });

  it('WITH it they are sized as an app whose kind we could not read', () => {
    for (const p of QUESTION_SHAPED_ORDERS) {
      const a = analyzeRequest({ prompt: p, buildIntent: 'new_build' });
      expect(a.taskType, p).toBe('app_unsized');
      expect(a.complexityScore, p).toBeGreaterThan(5);
    }
  });

  it('the precision refusals survive: a continuation is a verdict turn, not a new app', () => {
    // Autopsy 697b38ee, byte-identical sentence. `intent` says new_build at HIGH here — which is
    // exactly why the refusals had to be kept rather than replaced by the routing answer.
    const cont = 'Continue from where you left off and finish/fix the build so the app works end-to-end.';
    expect(describesWorkAlreadyStarted(cont)).toBe(true);
    expect(anAppWasOrderedButNotRecognised(cont, 'new_build')).toBe(false);
    expect(analyzeRequest({ prompt: cont, buildIntent: 'new_build' }).taskType).toBe('chat');
    for (const p of ['preview nahi chal raha', 'it isn’t working', 'dobara karo']) {
      expect(anAppWasOrderedButNotRecognised(p, 'new_build'), p).toBe(false);
    }
  });

  /**
   * 🔴 THE SIBLING FOUND WHILE WRITING THE CASE ABOVE, and it is why that case uses a curly
   * apostrophe. Every signal in `IntentClassifier` is written with a straight `'`; iOS smart
   * punctuation and Gboard both produce `’`. So the whole negated-contraction family was invisible
   * to a user typing on a phone — which is this product's primary surface.
   */
  it("a phone's curly apostrophe reads the same as a keyboard's straight one", () => {
    for (const [curly, straight] of [
      ['it isn’t working', "it isn't working"],
      ['it doesn’t work', "it doesn't work"],
      ['the page won’t load', "the page won't load"],
    ]) {
      expect(describesWorkAlreadyStarted(curly), curly).toBe(describesWorkAlreadyStarted(straight));
      expect(describesWorkAlreadyStarted(curly), curly).toBe(true);
    }
    expect(normalizeApostrophes('don’t ʼxʼ')).toBe("don't 'x'");
  });

  /** Hindi puts the negation either side of the verb; only one order was listed. */
  it('both Hindi word orders are a problem report', () => {
    expect(describesWorkAlreadyStarted('preview chal nahi raha')).toBe(true);
    expect(describesWorkAlreadyStarted('preview nahi chal raha')).toBe(true);
  });

  it('a real question, a greeting and an edit are all untouched', () => {
    for (const p of ['kya aap mujhe UPPCS GS5 GS6 padha sakte ho?', 'hi', 'thanks!']) {
      expect(analyzeRequest({ prompt: p, buildIntent: 'chat' }).taskType, p).toBe('chat');
    }
    // An edit is not an app being ordered — only `new_build` counts.
    expect(anAppWasOrderedButNotRecognised('isko thoda theek kar do', 'edit_existing')).toBe(false);
  });

  it('a request this module already recognises is never relabelled', () => {
    const a = analyzeRequest({ prompt: 'make a todo app', buildIntent: 'new_build' });
    expect(a.taskType).toBe('simple_app');
  });

  it('REVERSION GUARD: the route really passes its decision in', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    expect(src).toContain('buildIntent: intent');
  });
});

const stats = (o: Partial<WriteTypecheckStats> = {}): WriteTypecheckStats => ({ ...emptyWriteTypecheckStats(), ...o });

describe('three unreadable probes are a fact about the reader, never about the project', () => {
  it('an exhausted probe is its own state — not a "no"', () => {
    expect(probeExhausted('unknown', MAX_TSCONFIG_PROBES)).toBe(true);
    expect(probeExhausted('unknown', MAX_TSCONFIG_PROBES - 1)).toBe(false);
    // A genuine absence and a genuine yes are answers, so they are never "exhausted".
    expect(probeExhausted('no', MAX_TSCONFIG_PROBES)).toBe(false);
    expect(probeExhausted('yes', MAX_TSCONFIG_PROBES)).toBe(false);
    // The settle predicate it is built from is unchanged.
    expect(tsProjectSettled('unknown', MAX_TSCONFIG_PROBES)).toBe(true);
  });

  it('only a real "no" may say the project is not TypeScript', () => {
    const genuine = writeTypecheckSummary(stats({ skipped: 4, skippedNoTsconfig: 4, projectVerdict: 'no' }), true, 4);
    expect(genuine).toContain('no tsconfig.json was found');
    expect(genuine).toContain('4 TypeScript write(s) happened');
  });

  it('a probe that never answered says so, and accuses nothing', () => {
    const unread = writeTypecheckSummary(stats({ skipped: 23, probeFailures: 3, projectVerdict: 'unknown' }), true, 23);
    expect(unread).toContain('probe could not be read');
    expect(unread).toContain('never established');
    // 🔴 THE EXACT SENTENCE THE REPORT CARRIED, AND IT MUST NEVER RETURN.
    expect(unread).not.toContain('treated as non-TypeScript');
    expect(unread).not.toContain('the project is not TypeScript');
  });

  it('a compile run in the probe’s place is reported, not hidden', () => {
    const ran = writeTypecheckSummary(
      stats({ runs: 6, cleanRuns: 5, elapsedMs: 4200, compiledUnprobed: 6, probeFailures: 3, projectVerdict: 'unknown' }),
      true, 23,
    );
    expect(ran).toContain('6 run(s)');
    expect(ran).toContain('without the tsconfig.json probe ever answering');
    expect(ran).toContain('3 failed attempt(s)');
  });

  it('a clean run says nothing about probes — the ordinary path is unchanged', () => {
    expect(writeTypecheckSummary(stats({ runs: 4, cleanRuns: 4, elapsedMs: 3000 }), true, 9))
      .not.toContain('probe');
  });

  it('the new counters are part of "never touched" — they cannot forge a fact either', () => {
    expect(writeTypecheckUntouched(emptyWriteTypecheckStats())).toBe(true);
    expect(writeTypecheckUntouched(stats({ compiledUnprobed: 1 }))).toBe(false);
    expect(writeTypecheckUntouched(stats({ projectVerdict: 'yes' }))).toBe(false);
  });

  it('REVERSION GUARD: the dispatcher stands the compiler down only on a real "no"', () => {
    // `tsc` and `vitest` cannot see that a catch block latched the wrong verdict — which is exactly
    // how this shipped. So the decision is asserted at the source.
    const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    expect(src).toContain("if (this._tsProject === 'no') {");
    expect(src).toContain('const unprobed = probeExhausted(this._tsProject, this._tsProbeAttempts);');
    expect(src).toContain('if (unprobed) s.compiledUnprobed += 1;');
  });
});
