// Autopsy c6e4c6ff (2026-09-18) — "E commerce website" scored 5, the score of the word "hi", and a
// 26.7-minute e-commerce build opened on the cheapest flash rung, which was then benched for
// answering 3.4x slower than budgeted.
//
// `detectTaskType` ends in `return 'chat'`, so it answered `chat` both to "this IS a chat message"
// and to "I recognised nothing". `AGENTV3_COMPLEX_TO_KIMI` asks a model only within +/-3 of the 40
// line, so at 5 it never opened — the code was certain, and wrong.
//
// The fix does NOT touch the score (startTier, escalationPath, the one-shot lane and the simple lane
// all read it). It makes the scorer ADMIT it has no opinion, which is the one thing that was missing.
import { describe, it, expect } from 'vitest';
import { analyzeRequest, signalsMatchedNothing, signalsCouldNotRead } from '../src/server/AgentV3/RequestAnalyser';
import { needsSecondOpinion, decideComplexity, COMPLEX_SCORE_LINE } from '../src/server/AgentV3/complexityRouting';

describe('the prompt that failed, and the space that caused it', () => {
  it('one space away from a pattern that scores 58', () => {
    // Measured, not assumed: COMPLEX_APP_SIGNAL carries `e-?commerce` — an optional HYPHEN, no space.
    expect(analyzeRequest({ prompt: 'ecommerce website' }).complexityScore).toBe(58);
    expect(analyzeRequest({ prompt: 'e-commerce website' }).complexityScore).toBe(58);
    expect(analyzeRequest({ prompt: 'E commerce website' }).complexityScore).toBe(5);
  });

  it('the scorer now admits it recognised nothing', () => {
    expect(signalsMatchedNothing('E commerce website')).toBe(true);
    expect(signalsMatchedNothing('hospital management system')).toBe(true);
  });

  it('and that admission is what buys the second opinion', () => {
    // 5 is nowhere near the 40 line, so the score-based ask cannot catch it on its own.
    expect(Math.abs(5 - COMPLEX_SCORE_LINE)).toBeGreaterThan(3);
    expect(needsSecondOpinion(5, 'E commerce website')).toBe(true);
    expect(needsSecondOpinion(5, 'hospital management system')).toBe(true);
  });

  it('a model that reads it as complex flips the verdict', async () => {
    const d = await decideComplexity(
      { prompt: 'E commerce website', score: 5 },
      async () => 'complex',
      { env: {} as NodeJS.ProcessEnv },
    );
    expect(d.verdict).toBe('complex');
    expect(d.source).toBe('model');
    expect(d.reason).toContain('recognised nothing');
  });
});

describe('a greeting is not "unrecognised" — it matched, and it must not buy a call', () => {
  for (const greeting of ['hi', 'hello', 'namaste', 'thanks', 'good morning', 'how are you']) {
    it(`"${greeting}"`, () => {
      expect(signalsMatchedNothing(greeting)).toBe(false);
      expect(needsSecondOpinion(5, greeting)).toBe(false);
    });
  }

  it('💸 a scrap is not an unrecognised request — it must not buy a call', () => {
    // The cost guard in complexityRouting.test.ts caught this: the first version of this predicate
    // had no minimum and made a two-letter scrap buy a model call.
    expect(signalsMatchedNothing('ऐप')).toBe(false);
    expect(signalsMatchedNothing('app')).toBe(false);
    expect(signalsMatchedNothing('🎨🎨🎨🎨🎨🎨🎨🎨')).toBe(false);
    // ...while the real requests clear the bar.
    expect(signalsMatchedNothing('E commerce website')).toBe(true);
    expect(signalsMatchedNothing('hospital management system')).toBe(true);
  });

  it('empty and whitespace ask nothing', () => {
    expect(signalsMatchedNothing('')).toBe(false);
    expect(signalsMatchedNothing('   ')).toBe(false);
    expect(needsSecondOpinion(5, '')).toBe(false);
  });
});

describe('a request the patterns DO recognise is unchanged — no new call is bought', () => {
  const recognised: Array<[string, number]> = [
    ['a calculator', 15],
    ['todo list app', 15],
    ['ecommerce website', 58],
    ['school ERP', 58],
    ['debug this error, it is not working', 45],
  ];
  for (const [prompt, score] of recognised) {
    it(`"${prompt}" stays at ${score} and asks nobody`, () => {
      expect(analyzeRequest({ prompt }).complexityScore).toBe(score);
      expect(signalsMatchedNothing(prompt)).toBe(false);
      // Only the +/-3 window may still ask — never this new path.
      expect(needsSecondOpinion(score, prompt)).toBe(Math.abs(score - COMPLEX_SCORE_LINE) <= 3);
    });
  }
});

describe('the SCORE is deliberately untouched — this fix changes the ASK, nothing else', () => {
  it('an unrecognised prompt keeps its score, task type and tier', () => {
    const a = analyzeRequest({ prompt: 'E commerce website' });
    expect(a.complexityScore).toBe(5);
    expect(a.taskType).toBe('chat');
    expect(a.startTier).toBe('gemini');
    // Changing any of these would move startTier, escalationPath, the one-shot lane and the simple
    // lane for every build — the blast radius this fix refuses to take on.
  });
});

describe('the two existing reasons still work, and are reported apart', () => {
  it('an unreadable script is still its own reason', async () => {
    const hindi = 'अस्पताल प्रबंधन प्रणाली डॉक्टर लॉगिन मरीज रिकॉर्ड';
    expect(signalsCouldNotRead(hindi)).toBe(true);
    const d = await decideComplexity({ prompt: hindi, score: 30 }, async () => 'complex', { env: {} as NodeJS.ProcessEnv });
    expect(d.reason).toContain('script the scorer reads');
    expect(d.reason).not.toContain('recognised nothing');
  });

  it('a borderline score is still its own reason', async () => {
    const d = await decideComplexity({ prompt: 'debug this error', score: 41 }, async () => 'complex', { env: {} as NodeJS.ProcessEnv });
    expect(d.reason).toContain('borderline');
  });
});

describe('it cannot break, hang or over-spend', () => {
  it('no llmCall ⇒ the deterministic verdict stands, and says why', async () => {
    const d = await decideComplexity({ prompt: 'E commerce website', score: 5 }, undefined, { env: {} as NodeJS.ProcessEnv });
    expect(d.verdict).toBe('simple');
    expect(d.source).toBe('deterministic');
    expect(d.reason).toContain('recognised nothing');
  });

  it('a throw, an empty answer and a paragraph all fall back to simple', async () => {
    const thrown = await decideComplexity({ prompt: 'E commerce website', score: 5 }, async () => { throw new Error('x'); }, { env: {} as NodeJS.ProcessEnv });
    const empty = await decideComplexity({ prompt: 'E commerce website', score: 5 }, async () => '', { env: {} as NodeJS.ProcessEnv });
    const essay = await decideComplexity({ prompt: 'E commerce website', score: 5 }, async () => 'Well, that depends on...', { env: {} as NodeJS.ProcessEnv });
    for (const d of [thrown, empty, essay]) expect(d.verdict).toBe('simple');
  });

  it('the kill switch still disables the whole thing', async () => {
    const d = await decideComplexity(
      { prompt: 'E commerce website', score: 5 },
      async () => 'complex',
      { env: { AGENTV3_COMPLEX_TO_KIMI: 'off' } as unknown as NodeJS.ProcessEnv },
    );
    expect(d.verdict).toBe('simple');
    expect(d.source).toBe('disabled');
  });
});

describe('REVERSION GUARD — derived from detectTaskType, never a second copy of the patterns', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const src = fs.readFileSync('src/server/AgentV3/RequestAnalyser.ts', 'utf8');
  const body = src.slice(src.indexOf('export function signalsMatchedNothing'), src.indexOf('/** Base complexity by task type'));

  it('asks the real function rather than re-listing the regexes', () => {
    expect(body).toContain('detectTaskType(p)');
    expect(body).toContain('RE.greeting');
    // A re-listed pattern set is the drift this repo has already paid for twice.
    expect(body).not.toContain('COMPLEX_APP_SIGNAL');
    expect(body).not.toMatch(/\/\\b\(.*\|.*\)\\b\//);
  });

  it('the router consults it', () => {
    const router = fs.readFileSync('src/server/AgentV3/complexityRouting.ts', 'utf8');
    const fn = router.slice(router.indexOf('export function needsSecondOpinion'), router.indexOf('export function parseComplexityAnswer'));
    expect(fn).toContain('signalsMatchedNothing');
  });
});
