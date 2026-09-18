import { describe, it, expect } from 'vitest';
import {
  analyzeRequest,
  signalsFoundNothing,
  signalsCouldNotRead,
  scriptNeutralFloor,
} from '../src/server/AgentV3/RequestAnalyser';
import { needsSecondOpinion, COMPLEX_SCORE_LINE } from '../src/server/AgentV3/complexityRouting';

/**
 * 🔴 A REQUEST THE SIGNALS RECOGNISE NOTHING IN IS NOT A GREETING EITHER (2026-09-18).
 *
 * `signalsCouldNotRead` fixed the case where the signals cannot read the SCRIPT. This is its
 * sibling, and the commoner one by far: every letter is Latin, every signal misses, and the request
 * scores **5 — the same 5 as the word "hi"**. Measured on `main` before this change, the prompts in
 * `REAL_REQUESTS` below each scored 5, took `startTier: 'gemini'`, and reported `ambiguous: false`
 * — a confident wrong answer about the biggest apps NavBharatAI is asked for.
 */

/** Real NavBharatAI requests. Every one of these scored 5 before this change. */
const REAL_REQUESTS = [
  'restaurant billing app with menu, KOT, GST invoice, table management and daily sales report',
  'kirana store billing software with stock, customers, udhaar khata and daily report',
  'medical store app — batch wise stock, expiry alert, GST bill, supplier ledger',
  'gym management app: members, plans, fee reminders, attendance, trainer schedule',
  'coaching institute app with batches, fees, tests, results and attendance',
  'salon appointment app with services, staff, slots, bills',
];

/**
 * 🔎 MEASURED GAP, recorded rather than hidden: `namesBusinessDomain` reaches six of the seven real
 * requests this file was written from, and NOT this one — "society management" is not among the
 * domains its classifier knows. It is the live proof that a vocabulary is always one word short,
 * and therefore the proof that the admission below still earns its place.
 */
const STILL_UNNAMED = ['society management app: flats, maintenance bills, complaints, notices, visitors'];

/** Things that must cost nothing and change in no way. */
const UNCHANGED = ['hi', 'thanks bhai', 'namaste'];
/** Questions: they name nothing, so the broader rule on `main` buys a call for them. See below. */
const BARE_QUESTIONS = ['what can you generate?', 'can I make money from this?'];

/**
 * ⚠️ UPDATED 2026-09-18, ON THE MERGED STATE — `main` SOLVED THESE PROMPTS BETTER, so the cases
 * below now assert the STRONGER outcome instead of this branch's target.
 *
 * This branch was gated against a `main` that predated `c222ae95` ("a prompt that names a business
 * domain is not a greeting"), which added `namesBusinessDomain` as a last resort before the bare
 * `return 'chat'`. Measured on today's `main`, every prompt in REAL_REQUESTS is now RECOGNISED and
 * scores **58 / complex_app** — where this file's original target was a 30 floor on `haiku`.
 *
 * So `signalsFoundNothing` is correctly FALSE for them: nothing is broken, the vocabulary simply
 * reaches them now. The predicate is still exercised — on a request that genuinely names no domain
 * (the Gita reader below), which is exactly the case it exists for and the case no keyword list will
 * ever cover.
 *
 * Nothing is weakened: every assertion is replaced by the measured current value, never deleted, and
 * this branch's own translate fix is proven on the `dukaan` prompt, which moves 10 → 58.
 */
describe('the signals read every letter and recognised nothing', () => {
  it('every real SMB request is RECOGNISED now — the strongest form of "not a greeting"', () => {
    for (const prompt of REAL_REQUESTS) {
      // `namesBusinessDomain` (main, c222ae95) reaches these directly, so they never fall through
      // to the bare `return 'chat'` at all — a better outcome than the floor this file first asked
      // for, and measured rather than assumed.
      expect(signalsFoundNothing(prompt), prompt).toBe(false);
      expect(analyzeRequest({ prompt }).taskType, prompt).toBe('complex_app');
      // It is NOT the script case — that one was already fixed, and this is its sibling.
      expect(signalsCouldNotRead(prompt), prompt).toBe(false);
    }
  });

  it('a greeting matched a signal, so it is never in this state', () => {
    for (const prompt of ['hi', 'hello', 'thanks bhai', 'namaste', 'good morning']) {
      expect(signalsFoundNothing(prompt), prompt).toBe(false);
    }
  });

  it('scores each real request in the band it belongs in — 58, not 5', () => {
    for (const prompt of REAL_REQUESTS) {
      const r = analyzeRequest({ prompt });
      // The defect this file was opened for was a score of 5 — the score of the word "hi".
      expect(r.complexityScore, prompt).toBe(58);
      expect(r.complexityScore, prompt).toBeGreaterThan(COMPLEX_SCORE_LINE);
      // `unreadable` stays what its own docblock says it is: a SCRIPT fact.
      expect(r.unreadable, prompt).toBe(false);
    }
  });

  it('💸 and buys NO second opinion for them, because nothing is in doubt any more', () => {
    for (const prompt of REAL_REQUESTS) {
      const score = analyzeRequest({ prompt }).complexityScore;
      expect(Math.abs(score - COMPLEX_SCORE_LINE)).toBeGreaterThan(3);
      // A request the scorer places confidently and correctly must not pay for a model call. This
      // is the cost half of the same fix: recognising the prompt is cheaper than asking about it.
      expect(needsSecondOpinion(score, prompt), prompt).toBe(false);
    }
  });

  it('the vocabulary is one word short, and the admission catches exactly that', () => {
    for (const prompt of STILL_UNNAMED) {
      expect(signalsFoundNothing(prompt), prompt).toBe(true);
      expect(analyzeRequest({ prompt }).complexityScore, prompt).toBe(5);
      // The safety net, doing its job: unrecognised ⇒ ask, rather than open a real app on the
      // cheapest rung with total confidence.
      expect(needsSecondOpinion(5, prompt), prompt).toBe(true);
    }
  });

  it('the admission still fires where NO vocabulary reaches — the case it exists for', () => {
    // Names no business domain, matches no signal: the one state a keyword list can never cover,
    // and the reason `signalsFoundNothing` is kept rather than retired.
    const unnamed = 'a tool for my uncle to keep track of things';
    expect(signalsFoundNothing(unnamed)).toBe(true);
    expect(signalsCouldNotRead(unnamed)).toBe(false);
  });

  it('💸 buys nothing for a greeting or a short ask', () => {
    for (const prompt of UNCHANGED) {
      const r = analyzeRequest({ prompt });
      expect(r.complexityScore, prompt).toBe(5);
      expect(r.startTier, prompt).toBe('gemini');
      expect(scriptNeutralFloor(prompt), prompt).toBe(0);
      expect(needsSecondOpinion(r.complexityScore, prompt), prompt).toBe(false);
    }
  });

  /**
   * 🔴 OPEN COST ITEM, measured here and NOT fixed in this PR (rule 6) — and this branch's own design
   * was the one that would have prevented it.
   *
   * Both `'what can you generate?'` and `'can I make money from this?'` name nothing and match no signal, so `main`'s `signalsMatchedNothing`
   * fires and BUYS A MODEL CALL for a plain question. This branch's predicate was narrower — it also
   * required `scriptNeutralFloor(prompt) > 0`, i.e. real evidence of a multi-part request — and would
   * have answered "ask nobody" here.
   *
   * It is left as-is rather than quietly changed because the wiring on `main` is the one already
   * proven in production, and swapping a cost policy is the admin's call, not a merge conflict's.
   * Pinned so the day it changes, it changes deliberately.
   */
  it('a bare question still buys a call — the known cost of the broader rule', () => {
    for (const q of BARE_QUESTIONS) {
      expect(analyzeRequest({ prompt: q }).complexityScore, q).toBe(5);
      expect(scriptNeutralFloor(q), q).toBe(0);
      expect(needsSecondOpinion(5, q), q).toBe(true);
    }
  });

  it('leaves every request the signals DO read exactly as it was', () => {
    // Each of these matched a signal before the change and must be untouched by it.
    expect(analyzeRequest({ prompt: 'build a todo app' }).complexityScore).toBe(15);
    expect(analyzeRequest({ prompt: 'ecommerce website' }).complexityScore).toBe(58);
    expect(
      analyzeRequest({ prompt: 'ek hospital management system banao with patients, doctors, appointments, billing, pharmacy, lab reports and admin dashboard' }).complexityScore,
    ).toBe(58);
    for (const prompt of ['build a todo app', 'ecommerce website']) {
      expect(needsSecondOpinion(analyzeRequest({ prompt }).complexityScore, prompt), prompt).toBe(false);
    }
  });

  it('⚠️ only ever RAISES — a recognised complex request is never talked down by a word count', () => {
    // Long, many-part, and recognised: the floor must not touch it.
    const prompt = 'full-stack marketplace with auth, payments, checkout, orders, admin panel, chat';
    const r = analyzeRequest({ prompt });
    expect(signalsFoundNothing(prompt)).toBe(false);
    expect(r.complexityScore).toBeGreaterThanOrEqual(58);
  });

  it('a one-space spelling is the same word: "E commerce" scores what "ecommerce" scores', () => {
    const scores = ['ecommerce website', 'e-commerce website', 'E commerce website']
      .map((prompt) => analyzeRequest({ prompt }).complexityScore);
    expect(scores).toEqual([58, 58, 58]);
  });

  /**
   * 🔴 THE THIRD SIBLING, from build b6f88a72: not "no signal fired" but "the WRONG signal fired".
   * `RE.translate` carried `in hindi`, so a real user's app request classified as a TRANSLATION.
   */
  it('🔴 "in Hindi" is a language, not an order to translate', () => {
    const gita =
      'Build a Bhagavad Gita reader in Hindi: all eighteen chapters listed with their names, each ' +
      'shloka shown in Devanagari with a simple Hindi meaning below it, a verse of the day chosen ' +
      'from the date so it is the same for everyone all day, bookmarks saved in the browser, search ' +
      'across the Hindi meaning and the chapter name, and next and previous navigation inside a ' +
      'chapter. Large readable Devanagari, mobile-first, light/dark mode.';
    const r = analyzeRequest({ prompt: gita });
    // The shipped report recorded taskType 'translate', score 15, cheapest band. The VERB fix makes
    // it no longer a translation; it names no business domain either, so it lands in the one state
    // the admission exists for — and that is what buys it the second opinion rather than a floor.
    expect(r.taskType).not.toBe('translate');
    expect(signalsFoundNothing(gita)).toBe(true);
    expect(needsSecondOpinion(r.complexityScore, gita)).toBe(true);

    // Worst for exactly the users this app exists for.
    const dukaan = analyzeRequest({ prompt: 'ek dukaan ka app banao in hindi with stock, bills, customers' });
    expect(dukaan.taskType).not.toBe('translate');
    expect(dukaan.complexityScore).toBeGreaterThan(10);
  });

  it('⚠️ but a genuine translation request is still a translation', () => {
    expect(analyzeRequest({ prompt: 'translate this paragraph in hindi' }).taskType).toBe('translate');
    expect(analyzeRequest({ prompt: 'anuvad kar do' }).taskType).toBe('translate');
    // And a build request that merely mentions translating later is still the app.
    expect(analyzeRequest({ prompt: 'make a notes app, translate to english later' }).taskType).toBe('simple_app');
  });

  it('the script case it is a sibling of still behaves exactly as it did', () => {
    const devanagari = 'एक अस्पताल ऐप बनाओ, डॉक्टर लॉगिन, मरीज़ रिकॉर्ड, अपॉइंटमेंट, बिलिंग, रिपोर्ट';
    const r = analyzeRequest({ prompt: devanagari });
    expect(r.unreadable).toBe(true);
    expect(r.reasoning).toContain('cannot read this script');
    expect(r.complexityScore).toBeGreaterThan(5);
    expect(needsSecondOpinion(r.complexityScore, devanagari)).toBe(true);
  });
});
