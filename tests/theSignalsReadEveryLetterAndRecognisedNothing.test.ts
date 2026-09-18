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
  'society management app: flats, maintenance bills, complaints, notices, visitors',
];

/** Things that must cost nothing and change in no way. */
const UNCHANGED = ['hi', 'thanks bhai', 'namaste', 'what can you generate?', 'can I make money from this?'];

describe('the signals read every letter and recognised nothing', () => {
  it('says so, rather than calling the request a greeting', () => {
    for (const prompt of REAL_REQUESTS) {
      expect(signalsFoundNothing(prompt), prompt).toBe(true);
      // It is NOT the script case — that one was already fixed, and this is its sibling.
      expect(signalsCouldNotRead(prompt), prompt).toBe(false);
    }
  });

  it('a greeting matched a signal, so it is never in this state', () => {
    for (const prompt of ['hi', 'hello', 'thanks bhai', 'namaste', 'good morning']) {
      expect(signalsFoundNothing(prompt), prompt).toBe(false);
    }
  });

  it('floors each real request on evidence that needs no vocabulary', () => {
    for (const prompt of REAL_REQUESTS) {
      const r = analyzeRequest({ prompt });
      expect(r.complexityScore, prompt).toBe(30); // BASE_SCORE.coding — the light band
      expect(r.startTier, prompt).toBe('haiku');
      expect(r.reasoning, prompt).toContain('recognised nothing in this request');
      // The honest unknown is reported, where it used to claim confidence.
      expect(r.ambiguous, prompt).toBe(true);
      // `unreadable` stays what its own docblock says it is: a SCRIPT fact.
      expect(r.unreadable, prompt).toBe(false);
    }
  });

  it('buys a second opinion for them — the ±3 rule alone never could', () => {
    for (const prompt of REAL_REQUESTS) {
      const score = analyzeRequest({ prompt }).complexityScore;
      // 30 is ten clear of the 40 line, so the borderline test says "no" on its own.
      expect(Math.abs(score - COMPLEX_SCORE_LINE)).toBeGreaterThan(3);
      expect(needsSecondOpinion(score, prompt), prompt).toBe(true);
    }
  });

  it('💸 buys nothing for a greeting, a question, or a short ask', () => {
    for (const prompt of UNCHANGED) {
      const r = analyzeRequest({ prompt });
      expect(r.complexityScore, prompt).toBe(5);
      expect(r.startTier, prompt).toBe('gemini');
      expect(scriptNeutralFloor(prompt), prompt).toBe(0);
      expect(needsSecondOpinion(r.complexityScore, prompt), prompt).toBe(false);
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

  it('the script case it is a sibling of still behaves exactly as it did', () => {
    const devanagari = 'एक अस्पताल ऐप बनाओ, डॉक्टर लॉगिन, मरीज़ रिकॉर्ड, अपॉइंटमेंट, बिलिंग, रिपोर्ट';
    const r = analyzeRequest({ prompt: devanagari });
    expect(r.unreadable).toBe(true);
    expect(r.reasoning).toContain('cannot read this script');
    expect(r.complexityScore).toBeGreaterThan(5);
    expect(needsSecondOpinion(r.complexityScore, devanagari)).toBe(true);
  });
});
