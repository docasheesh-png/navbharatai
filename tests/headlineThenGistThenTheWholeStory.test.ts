/**
 * HEADLINE, THEN THE GIST, THEN THE WHOLE STORY — and the three cases it must keep its hands off.
 *
 * Admin 2026-09-20: *"3 part me aya! 1. headline (1 ya maximum 2 line) me pure reply ka main point
 * … 2. uske niche summary 1 to 10 line … 3. last me pura answer … jaise newspaper me koi news hote
 * hai."* With the limit stated in the same message: *"agar user bole short answer do, ya ai ka answer
 * already short hi hai, to yeh system lagane ki jaruri nahi hai!!"*
 *
 * 🔑 THE TWO CONDITIONS LIVE IN DIFFERENT PLACES, AND NEITHER HALF IS OPTIONAL. Only the CALLER can
 * see what the user asked for ("short me batao"), and only the MODEL can see how long its own answer
 * turned out. So `answerShapeFor` refuses on the first and the directive text refuses on the second.
 * Dropping either one breaks a case the admin named explicitly.
 *
 * ⚠️ THE ASYMMETRY THAT JUSTIFIES A GENEROUS SHORT-WORD LIST: a wrong "the user wants it short"
 * costs exactly today's behaviour — a long answer with no headline, which is what free chat has
 * always produced. A wrong "shape it" costs a headline over three lines of text. So every doubt
 * resolves toward NOT shaping, and the precision tests below lock that direction in.
 *
 * Each test fails if its fix is reverted — checked by reverting each one.
 */
import { describe, it, expect } from 'vitest';
import {
  answerShapeFor, wantsShortAnswer, wantsVerbatimArtefact, ANSWER_SHAPE_DIRECTIVE,
} from '../src/server/AI/answerShape';

const shaped = (m: string): boolean => answerShapeFor(m) !== '';

describe('an ordinary question gets the newspaper shape', () => {
  it('🔒 a real question that deserves a long answer', () => {
    for (const q of [
      'GST kya hota hai aur chhote dukandar ko kaise register karna chahiye?',
      'Explain how UPI works behind the scenes',
      'मधुमेह में क्या खाना चाहिए और क्या नहीं?',
      'What is the difference between a mutual fund and an ETF?',
      'ghar par solar panel lagwane ka poora process batao',
    ]) {
      expect(shaped(q), q).toBe(true);
    }
  });

  it('the directive names all three parts, in order, with the admin\'s own limits', () => {
    const d = ANSWER_SHAPE_DIRECTIVE;
    expect(d).toMatch(/ONE line \(never more than two\)/);
    expect(d).toMatch(/between one and ten lines/);
    expect(d).toMatch(/\*\*bold text\*\*/);
    // The headline must be the CONCLUSION, not a title — the distinction the admin drew with
    // "pure reply ka main point".
    expect(d).toMatch(/must already\s+know what you concluded/);
    // It must forbid labels: a literal "Headline:" would be the newspaper look without the point.
    expect(d).toMatch(/NEVER label the parts/);
  });

  it('🔒 the directive carries the "your answer is already short" rule ITSELF', () => {
    // REVERSION GUARD: the caller cannot know the answer's length, so if this sentence is ever
    // removed the admin's second condition has no enforcement anywhere.
    expect(ANSWER_SHAPE_DIRECTIVE).toMatch(/naturally short/i);
    expect(ANSWER_SHAPE_DIRECTIVE).toMatch(/eight lines or fewer/i);
  });
});

describe('“short answer do” — the shape stands down', () => {
  it('🔴 in every way people really type it', () => {
    for (const q of [
      'short me batao GST kya hai',
      'in one line, what is GST?',
      'GST kya hai? ek line me',
      'briefly explain the new tax slab',
      'tldr of the budget please',
      'संक्षेप में बताइए कि जीएसटी क्या है',
      'कम शब्दों में समझाओ',
      'chhote me batao',
      'keep it short — what is a mutual fund',
      'give me a concise answer about UPI limits',
    ]) {
      expect(wantsShortAnswer(q), q).toBe(true);
      // REVERSION GUARD: remove the caller-side check and every one of these gets shaped.
      expect(shaped(q), q).toBe(false);
    }
  });

  it('🔴 THE ONE THIS TEST ALREADY CAUGHT: a common adjective is not a request for brevity', () => {
    // The first draft matched `chhota/chhote`, `kam`, `jaldi` and `thode` as bare tokens. Every one
    // of these is a real, long question that would have silently lost its headline.
    for (const q of [
      'GST kya hota hai aur chhote dukandar ko kaise register karna chahiye?',
      'kam kharche me ghar kaise banaye, poora process batao',
      'English jaldi kaise seekhein? detail me batao',
      'thode paise se business shuru karne ke kya tareeke hain',
      'छोटे बच्चों के लिए कौन सी किताबें अच्छी हैं?',
    ]) {
      expect(wantsShortAnswer(q), q).toBe(false);
      expect(shaped(q), q).toBe(true);
    }
    // …and the PHRASE forms still work, which is how people really ask.
    for (const q of ['chhote me batao', 'kam shabdon me samjhao', 'thode shabdon me likho']) {
      expect(wantsShortAnswer(q), q).toBe(true);
    }
  });

  it('⚠️ PRECISION: a word that merely CONTAINS a short-word does not count', () => {
    // Whole tokens only — "shortcut", "shorts", "shortage" are not requests for brevity.
    for (const q of [
      'keyboard shortcut kaise banaye windows me',
      'best shorts video app kaunsa hai',
      'there is a water shortage in my area, what can I do',
      'summarizing tools ke baare me mat batao, main khud likhna chahta hoon',
    ]) {
      expect(wantsShortAnswer(q), q).toBe(false);
    }
  });
});

describe('when the answer IS the thing asked for, a news report would be absurd', () => {
  it('🔴 a song, poem, letter, translation or code is never shaped', () => {
    for (const q of [
      'ek udaas hindi gaana likho',
      'ek kavita likho baarish par',
      'write a poem about the monsoon',
      'मेरे लिए एक कहानी लिखो',
      'translate this into Tamil: good morning',
      'write the SQL for a join between orders and users',
      'boss ko chhutti ki email likh do',
      'ek shayari sunao',
    ]) {
      expect(wantsVerbatimArtefact(q), q).toBe(true);
      expect(shaped(q), q).toBe(false);
    }
  });

  it('🔒 the SONG test is the shared one, never a second list', () => {
    // A song is recognised by songcraft's own stricter rule (song word AND a writing verb), so the
    // two modules can never disagree about what a song is — the drifted-copy class.
    const src = String(require('fs').readFileSync('src/server/AI/answerShape.ts', 'utf8'));
    expect(src).toContain("isSongRequest");
    expect(src).toContain("from './songcraft'");
  });

  it('⚠️ PRECISION: merely mentioning one of those nouns is not asking for one', () => {
    // These are real questions ABOUT a topic and must still be shaped.
    for (const q of [
      'Premchand ke upanyas kis daur ke samaj ko dikhate hain aur unki bhasha kaisi thi?',
      'How does the Indian postal system deliver to remote villages?',
    ]) {
      expect(shaped(q), q).toBe(true);
    }
  });
});

describe('it can never cost an ordinary conversation anything', () => {
  it('an empty or blank message adds nothing', () => {
    expect(answerShapeFor('')).toBe('');
    expect(answerShapeFor('   ')).toBe('');
    expect(answerShapeFor(null as unknown as string)).toBe('');
    expect(answerShapeFor(undefined as unknown as string)).toBe('');
  });

  it('the block is appended, never substituted — the prompt before it is untouched', () => {
    const block = answerShapeFor('explain the new labour codes in detail');
    expect(block.startsWith('\n\n')).toBe(true);
    expect(block.trim()).toBe(ANSWER_SHAPE_DIRECTIVE);
  });

  it('it is wired into the FREE path only, and behind that condition', () => {
    const route = String(require('fs').readFileSync('src/server/routes/chat.ts', 'utf8'));
    expect(route).toContain('answerShapeFor');
    // REVERSION GUARD: dropping `isFree` would silently reshape every paid tier's replies too.
    expect(route).toMatch(/if \(isFree\) systemPrompt = `\$\{systemPrompt\}\$\{answerShapeFor\(message\)\}`/);
  });

  it('never throws, whatever it is handed', () => {
    for (const junk of [{}, [], 0, true, '🙏', '\u0000']) {
      expect(() => answerShapeFor(junk as unknown as string)).not.toThrow();
    }
  });
});
