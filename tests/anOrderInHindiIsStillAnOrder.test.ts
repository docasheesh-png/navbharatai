/**
 * An order in Hindi is still an order — autopsy `f152c1ab`, 2026-09-20.
 *
 * The build report that produced this file recorded `taskType: 'chat'`, `complexityScore: 5` for
 * *"Mughe eak aisa app bna kar do jisme mai apna pdf file ko audio overview me bnaba saku"* — an
 * explicit order for an app, from the audience this product is built for.
 *
 * #3159 ("an ordered app is not chat") shipped SIX HOURS EARLIER and fixed exactly this class for
 * ENGLISH. Its own predicate, `anAppWasOrderedButNotRecognised`, is the AND of "signals matched
 * nothing" and `userAskedForAnAppToBeBuilt` — and the second half was English-shaped, so the Hindi
 * sibling walked straight through the new guard. That is rule 3 (hunt the siblings) failing inside
 * one day, which is why this suite exists rather than a widened word list.
 *
 * Every case below was measured BEFORE the fix was written.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyIntentWithConfidence,
  userAskedForAnAppToBeBuilt,
  firstNewBuildOrder,
} from '../src/server/AgentV3/IntentClassifier';
import { analyzeRequest, anAppWasOrderedButNotRecognised } from '../src/server/AgentV3/RequestAnalyser';

/** The exact prompt from the report, misspellings and all. */
const REPORTED =
  'Mughe eak aisa app bna kar do jisme mai apna pdf file ko audio overview me bnaba saku';

/**
 * Real Hindi/Hinglish build ORDERS. Each splits the verb (`bana KAR do`, `bana KE do`) or uses a
 * polite/causative ending that the surface-form list never carried.
 */
const ORDERS: readonly string[] = [
  REPORTED,
  // The same sentence spelled perfectly — proof the misspelling was never the cause.
  'Mujhe ek aisa app bana kar do jisme main apna pdf file ko audio overview me bana saku',
  'mujhe ek app bana kar do',
  'ek app bana ke do',
  'app bana kar dijiye',
  'ek website bana dijiye',
  'mujhe ek app banaiye',
  'ek dukaan ka app banwa do',
  'notes app bana dena',
  'bnado ek app',
  'app bna do',
  'mere liye ek billing app bana kar do please',
];

/**
 * The precision lock. A miss costs a mis-sized report; a false positive turns a question into a
 * HIGH-confidence build order, which this repo prices at 29 minutes and real money (autopsy
 * 5abad374). These must NEVER read as an order.
 */
const NOT_ORDERS: readonly string[] = [
  'maine ek app banaya hai', // past tense — a report, not an order
  'ye app kaise banaya', // a question about how something was made
  'app ban gaya?', // a state question
  'mujhe help chahiye',
  'kitna time lagega',
  'ye kaam ban raha hai',
  'app banane me kitna kharcha',
  'thanks bhai',
  'preview nahi chal raha',
  'banaras ke bare me batao', // a place name that opens with the stem
  'iska naam badal do', // an EDIT, and it ends in the same auxiliary
];

describe('the bana- family is a shape, not a word list', () => {
  it('reads every real order as a new-build order', () => {
    for (const order of ORDERS) {
      expect(firstNewBuildOrder(order.toLowerCase()), order).toBeTruthy();
    }
  });

  it('reads none of the controls as an order', () => {
    for (const control of NOT_ORDERS) {
      expect(firstNewBuildOrder(control.toLowerCase()), control).toBeUndefined();
    }
  });
});

describe('the reported prompt, end to end', () => {
  it('is a HIGH-confidence new build, not a low-confidence guess', () => {
    const verdict = classifyIntentWithConfidence(REPORTED);
    expect(verdict.intent).toBe('new_build');
    expect(verdict.confidence).toBe('high');
  });

  it('answers userAskedForAnAppToBeBuilt — the predicate #3159 depends on', () => {
    expect(userAskedForAnAppToBeBuilt(REPORTED)).toBe(true);
  });

  it('reaches #3159s guard, so the build is no longer filed as chat', () => {
    expect(anAppWasOrderedButNotRecognised(REPORTED)).toBe(true);
    const analysis = analyzeRequest({ prompt: REPORTED } as never) as {
      taskType?: string;
      complexityScore?: number;
    };
    // Was 'chat' / 5 — the score of the word "hi" — in the report.
    expect(analysis.taskType).toBe('app_unsized');
    expect(analysis.complexityScore).toBeGreaterThanOrEqual(15);
  });
});

describe('what the fix deliberately does NOT change', () => {
  /**
   * The 2026-09-13 question rule demotes a question to LOW rather than flipping its intent. The new
   * shape is consulted BEFORE `doubt` is applied, so that rule must still bite.
   */
  it('a question still loses HIGH even when it carries the order shape', () => {
    const verdict = classifyIntentWithConfidence('kya aap ek app bana kar doge?');
    expect(verdict.confidence).toBe('low');
  });

  it('an English order is untouched', () => {
    const verdict = classifyIntentWithConfidence('build a pdf to audio overview app');
    expect(verdict.intent).toBe('new_build');
    expect(verdict.confidence).toBe('high');
  });

  it('a compact form the list already carried still matches, and still reports its own word', () => {
    expect(firstNewBuildOrder('ek notes app banao')).toBe('banao');
  });

  /**
   * 🔴 THE TRADE THIS FIX ALMOST MADE, held open so it cannot come back.
   *
   * The first draft claimed BARE verbs too. That is #3039's territory — `assessBuildInput` answers
   * an object-less ask with *"tell me what to make"* — and raising "Bnao" to HIGH also stops the
   * intention reader being consulted at all, making its fourth answer ("unclear") unreachable.
   * Three suites went red. The new shape recognises an order WITH AN OBJECT; a lone verb is not one.
   */
  it('a bare verb is still the object-less ask, not a build order', () => {
    expect(firstNewBuildOrder('bnao')).toBeUndefined();
    expect(firstNewBuildOrder('bnado')).toBeUndefined();
    expect(classifyIntentWithConfidence('Bnao').confidence).toBe('low');
  });

  /**
   * ⚠️ RECORDED, NOT FIXED (rule 6). "mujhe ek billing app chahiye" is a WANT-form, not an
   * imperative, and the same word carries "mujhe help chahiye". Recognising it needs a build NOUN
   * beside it, which is a different shape with its own false-positive risk — so it is left honest
   * here rather than guessed at, and named in PROGRESS.md as an open root cause.
   */
  it('the want-form is still unrecognised — stated, so nobody reads this suite as covering it', () => {
    expect(userAskedForAnAppToBeBuilt('mujhe ek billing app chahiye')).toBe(false);
  });

  /**
   * ✅ THE TRIPWIRE FIRED AND WAS ANSWERED — updated deliberately, exactly as it asked to be.
   *
   * This case used to assert the WRONG behaviour: `'banana'` sat in `NEW_BUILD_SIGNALS` as a bare
   * word and it is a homograph of the English fruit, so `"banana bread recipe batao"` was
   * `new_build · HIGH` and somebody asking for a recipe got an app built. It is fixed in
   * `bananaMeansBuild` — the gerund is now a CONDITIONAL signal, counted only where the sentence
   * names something buildable or completes it into a statement of intent ("banana hai").
   *
   * Kept here rather than moved: this corpus is what found it, and the pair below is the whole
   * point — the fruit and the order share a word and must part company.
   */
  it('the fruit is no longer a build order, and the order still is', () => {
    expect(firstNewBuildOrder('banana bread recipe batao')).toBeUndefined();
    expect(firstNewBuildOrder('mujhe ek app banana hai')).toBe('banana');
  });
});
