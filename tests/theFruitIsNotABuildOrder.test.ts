/**
 * The fruit is not a build order — found by the control corpus of autopsy `f152c1ab`, 2026-09-20.
 *
 * `'banana'` — the Hindi gerund "to make" — sat in `NEW_BUILD_SIGNALS` as a bare word, and it is a
 * perfect homograph of the English fruit. Measured on `main` before this change:
 *
 *   "banana bread recipe batao"        -> new_build · HIGH · signal 'banana'
 *   "banana milkshake kaise banta hai" -> new_build · HIGH · signal 'banana'
 *
 * Somebody asking for a recipe got an app built — and HIGH confidence means the LLM intention-reader
 * is never consulted, so nothing downstream could correct it.
 *
 * ⚠️ Deleting the word was NOT the fix: `"mujhe ek app banana hai"`, `"app banana"` and a bare
 * `"banana hai"` are all real orders that depend on it. The signal is CONDITIONAL instead.
 *
 * No user paid for this one — a control in a corpus found it before a report did.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyIntentWithConfidence,
  firstNewBuildOrder,
  bananaMeansBuild,
  mentionsBuildNoun,
} from '../src/server/AgentV3/IntentClassifier';

/** The fruit, and other sentences where `banana` is food. None may read as a build. */
const THE_FRUIT: readonly string[] = [
  'banana bread recipe batao',
  'banana milkshake kaise banta hai',
  'banana khane ke fayde',
  'banana shake ki recipe',
  'kya banana healthy hai',
];

/** The gerund doing its real job. Every one was HIGH before this change and must stay HIGH. */
const REAL_ORDERS: readonly string[] = [
  'mujhe ek app banana hai',
  'app banana',
  'banana hai',
  'ek website banana hai',
  'mujhe ek dashboard banana tha',
  'ek billing tool banana chahta hoon',
  // The pair that proves the rule is about the SENTENCE, not the word: fruit and order together.
  'banana bread wala app banana hai',
];

describe('the fruit', () => {
  it('is not a build order', () => {
    for (const s of THE_FRUIT) {
      expect(bananaMeansBuild(s), s).toBe(false);
      expect(firstNewBuildOrder(s), s).toBeUndefined();
    }
  });

  it('is answered as chat, not built', () => {
    for (const s of THE_FRUIT) {
      expect(classifyIntentWithConfidence(s).intent, s).toBe('chat');
    }
  });
});

describe('the gerund doing its real job — nothing demoted', () => {
  it('still reads as a build order', () => {
    for (const s of REAL_ORDERS) {
      expect(firstNewBuildOrder(s), s).toBe('banana');
    }
  });

  it('still reaches HIGH confidence, exactly as before', () => {
    for (const s of REAL_ORDERS) {
      const v = classifyIntentWithConfidence(s);
      expect(v.intent, s).toBe('new_build');
      expect(v.confidence, s).toBe('high');
    }
  });
});

describe('the two halves of the condition', () => {
  it('a build noun in the sentence is enough', () => {
    expect(mentionsBuildNoun('app banana')).toBe(true);
    expect(mentionsBuildNoun('banana bread recipe batao')).toBe(false);
    expect(bananaMeansBuild('app banana')).toBe(true);
  });

  it('or the auxiliary that makes the gerund a statement of intent', () => {
    // No build noun anywhere — "banana hai" is still "[I] have to make [it]".
    expect(mentionsBuildNoun('banana hai')).toBe(false);
    expect(bananaMeansBuild('banana hai')).toBe(true);
    // …and the fruit is followed by a FOOD, never by `hai`.
    expect(bananaMeansBuild('banana shake ki recipe')).toBe(false);
  });

  it('a sentence without the word at all is never claimed by this signal', () => {
    expect(bananaMeansBuild('ek notes app banao')).toBe(false);
  });
});
