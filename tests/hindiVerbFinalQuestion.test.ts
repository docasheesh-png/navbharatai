/**
 * REPORT cc8c9075 (2026-09-17) — "Tumnay jo app banana use main open kase karu".
 *
 * *"The app you were to build — how do I open it?"* A question about an app the user already had.
 * The engine ANSWERED it correctly at minute 2.5 (dev server up, preview published, screenshot taken,
 * console clean, the live URL handed over) — then called that answer an empty build and **re-ran the
 * entire build one rung higher**. The second answer was worse: `npm run dev` and `localhost:5173`, a
 * URL on a machine the user does not have.
 *
 * Three links in one chain, each fixed and each tested here:
 *   1. `readsAsQuestion` could not see a question word at the END of a clause, so a verb-final Hindi
 *      question read as an order.
 *   2. `ANSWER_ONLY_PATTERNS` treated a negative CONSTRAINT inside an order ("… koi quiz app mat
 *      banana") as a refusal of the whole order.
 *   3. `userAskedForAnAppToBeBuilt` read `.intent` and discarded `.confidence`, so a LOW-confidence
 *      GUESS was enough to authorise a duplicate build.
 *
 * Link 3 is the one that spent the money, and it holds even if 1 and 2 are ever loosened.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyIntentWithConfidence, readsAsQuestion, userAskedForAnAppToBeBuilt,
} from '../src/server/AgentV3/IntentClassifier';
import { shouldRetryEmptyBuild } from '../src/server/routes/agentv3';

const REPORTED = 'Tumnay jo app banana use main open kase karu';

describe('a verb-final Hindi question is a question', () => {
  it('THE REPORTED MESSAGE is no longer a high-confidence build order', () => {
    const v = classifyIntentWithConfidence(REPORTED);
    expect(v.confidence, 'a question must never hard-lock — HIGH skips the intention reader').not.toBe('high');
    expect(userAskedForAnAppToBeBuilt(REPORTED)).toBe(false);
  });

  it('reads the question word wherever it lands, not only at the start', () => {
    for (const q of [
      'jo app banana use main open kase karu',
      'jo app banaya use main kaise kholu',
      'ab main isko kaise open karu',
      'yeh file main kahan rakhu',
      'iska apk main kaise banau',
      'mujhe kitne credit milega',
    ]) expect(readsAsQuestion(q.toLowerCase()), q).toBe(true);
  });

  it('🔒 AN ORDER IS STILL AN ORDER — the rule needs a FIRST-PERSON verb, which no imperative has', () => {
    // Hindi orders are second person (karo / banao / do / dena); "what shall I do" is karu / karun.
    // Different grammatical persons, so this cannot swallow a build request.
    for (const order of [
      'ek movie streaming app banao',
      'app banana',
      'mere liye ek billing app bana do',
      'isme dark mode add karo',
      'ab yeh kaam karo',
    ]) expect(readsAsQuestion(order.toLowerCase()), order).toBe(false);
    expect(classifyIntentWithConfidence('ek movie streaming app banao')).toMatchObject({
      intent: 'new_build', confidence: 'high',
    });
  });

  it('does not fire on a wh-word alone, nor on a first-person verb alone', () => {
    // Both halves are required: each on its own appears in ordinary statements. (A message that
    // OPENS with a wh-word is a question by the older `WH_OPENERS` rule and is not this one's case.)
    expect(readsAsQuestion('isme kitna time lagta hai')).toBe(false);   // wh-word, no first-person verb
    expect(readsAsQuestion('app me kitne page hai')).toBe(false);
    expect(readsAsQuestion('main ek app banau ga')).toBe(false);        // first-person verb, no wh-word
    // …and together they are a question, wherever they sit.
    expect(readsAsQuestion('ise main kaise karu')).toBe(true);
  });
});

describe('a negation can be a CONSTRAINT inside an order, not a refusal of it', () => {
  const WITH_CONSTRAINT =
    'Tum mujhe as a app bana kar do haha saree movie free mai steam ho moviebox app ki traha koi quiz app mat banana';

  it('an order carrying a "mat banana" caveat loses its hard lock', () => {
    const v = classifyIntentWithConfidence(WITH_CONSTRAINT);
    // The verdict is deliberately NOT flipped to a build — chat costs one message, a wrongly-started
    // build costs a whole build. What changes is that the sentence now reaches the intention reader.
    expect(v.confidence, 'a build order must not be hard-locked to chat by its own caveat').toBe('low');
  });

  it('🔒 THE ORIGINAL CASE IS UNTOUCHED — a bare refusal keeps its HIGH', () => {
    // Strip "build mat karna" out of this and nothing buildable is left, so it is a real refusal.
    for (const refusal of ['build mat karna, bas yeh batao!', 'just tell me, no code changes']) {
      expect(classifyIntentWithConfidence(refusal), refusal).toMatchObject({
        intent: 'chat', confidence: 'high', signal: 'answer-only',
      });
    }
  });
});

describe('a GUESS may not authorise a duplicate build', () => {
  it('userAskedForAnAppToBeBuilt requires HIGH confidence, not merely the intent', () => {
    // A question that names a deliverable keeps intent new_build and drops to LOW by design. That LOW
    // is the classifier saying "I could not tell" — it must not buy the expensive branch.
    const v = classifyIntentWithConfidence('can you build me a todo app?');
    expect(v.intent).toBe('new_build');
    expect(v.confidence).toBe('low');
    expect(userAskedForAnAppToBeBuilt('can you build me a todo app?')).toBe(false);
  });

  it('a real order still authorises it, so a genuinely empty build still retries', () => {
    for (const order of ['build me a todo app', 'ek billing app banao', 'Build a movie streaming app like MovieBox']) {
      expect(userAskedForAnAppToBeBuilt(order), order).toBe(true);
    }
  });

  it('END TO END: the reported turn no longer retries the whole build', () => {
    const turn = {
      expectsArtifacts: true,
      filesWritten: 0,
      isEditMode: true,
      existingProjectFiles: 16, // "✏️ Editing your existing app (16 source files)"
      aborted: false,
      withinCostCap: true,
    };
    expect(shouldRetryEmptyBuild({ ...turn, userAskedToBuildAnApp: userAskedForAnAppToBeBuilt(REPORTED) }))
      .toBe(false);
    // …and a genuine build order in the same workspace still does retry.
    expect(shouldRetryEmptyBuild({ ...turn, userAskedToBuildAnApp: userAskedForAnAppToBeBuilt('build me a todo app') }))
      .toBe(true);
  });
});
