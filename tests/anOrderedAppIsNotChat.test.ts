// An ordered app is not chat (autopsy `31dc61fd`, 2026-09-20).
//
// 🔴 THE DEFECT. *"Create a upsc preparation aap"* was recorded as `taskType: 'chat'`,
// `complexityScore: 5` — **the score of the word "hi"** — for a request that then ran a 15.9-minute
// build and produced ten files.
//
// ⚠️ THE MISSPELLING IS NOT THE CAUSE, and chasing it would have fixed nothing. Measured before a line
// was written: `"Create a upsc preparation app"`, spelled correctly, scores 5 too. Every signal in
// `RequestAnalyser` is a NAMED DOMAIN or a NAMED KIND of app, and "upsc preparation" is neither.
//
// 🔑 THE CLASS: TWO MODULES ANSWER "IS THIS A BUILD?" AND ONE IS NEVER TOLD THE OTHER'S ANSWER.
// `IntentClassifier` said `new_build` — that is why a build ran at all. `detectTaskType` ends in
// `return 'chat'`, which is the SAME WORD the other module uses for the opposite decision. So the
// build report, the cost telemetry (`AgentV3CostTelemetry` groups by `taskType`) and the prompt audit
// all filed a real app build under "chat".
//
// 🔒 WHAT THIS DOES **NOT** DO, stated as a test rather than a promise: it does not move any build.
// The last describe block pins that every affected request keeps the same start tier, the same
// complexity verdict and the same borderline answer. The routing for these requests is already
// handled by the second opinion `signalsMatchedNothing` buys; guessing a higher number would be an
// unmeasured change to where real money is spent.

import { describe, it, expect } from 'vitest';
import {
  analyzeRequest, anAppWasOrderedButNotRecognised, signalsMatchedNothing,
} from '../src/server/AgentV3/RequestAnalyser';
import { userAskedForAnAppToBeBuilt } from '../src/server/AgentV3/IntentClassifier';
import { complexityFromScore, COMPLEX_SCORE_LINE, BORDERLINE_MARGIN } from '../src/server/AgentV3/complexityRouting';

/** The real prompt from the report, plus siblings that fail for the identical reason. */
const UNSIZED_APPS = [
  'Create a upsc preparation aap',      // ← report 31dc61fd, verbatim
  'Create a upsc preparation app',      // ← the misspelling is not the cause
  'Create a neet preparation app',
  'build a gurudwara langar seva app',
  'ek upsc preparation app banao',
];

/** Requests that must keep answering `chat`, each for a DIFFERENT reason. */
const STILL_CHAT: Array<[string, string]> = [
  ['a greeting', 'hi'],
  ['a greeting with words round it', 'hello there, how are you'],
  ['a capability QUESTION, not an order', 'can you generate images?'],
  ['a question that contains a build verb', 'what can you build for me?'],
  ['a continuation', 'Continue from where you left off and finish/fix the build so the app works end-to-end.'],
  ['thanks', 'thanks!'],
];

/** Requests this module already reads correctly — none may be relabelled. */
const ALREADY_READ: Array<[string, string]> = [
  ['a named simple app', 'make a todo app'],
  ['a named complex app', 'build a hospital management system with doctor logins, patient records, appointments and billing'],
  ['a named domain', 'E commerce website'],
];

describe('🔴 the defect: an ordered app was filed as chat', () => {
  for (const prompt of UNSIZED_APPS) {
    it(`"${prompt}" is an unsized APP, not chat`, () => {
      const r = analyzeRequest({ prompt });
      expect(r.taskType).toBe('app_unsized');
      expect(r.taskType).not.toBe('chat');
      // And never again the score of "hi".
      expect(r.complexityScore).toBeGreaterThan(analyzeRequest({ prompt: 'hi' }).complexityScore);
    });
  }
});

describe('🔒 the precision lock — it is the AND of two facts', () => {
  it('“matched nothing” ALONE is not enough — a question is not an order', () => {
    // Each of these matched no signal, so a rule built on that fact alone would relabel them.
    for (const [, prompt] of STILL_CHAT.filter(([l]) => l.includes('question') || l.includes('continuation'))) {
      expect(signalsMatchedNothing(prompt)).toBe(true);
      expect(userAskedForAnAppToBeBuilt(prompt)).toBe(false);
      expect(anAppWasOrderedButNotRecognised(prompt)).toBe(false);
      expect(analyzeRequest({ prompt }).taskType).toBe('chat');
    }
  });

  it('“an app was ordered” ALONE is not enough — a recognised app keeps its real type', () => {
    // Each of these IS an order, and a rule built on that fact alone would overwrite a correct,
    // more specific answer with a vaguer one.
    for (const prompt of ['make a todo app', 'build a hospital management system with doctor logins, patient records, appointments and billing']) {
      expect(userAskedForAnAppToBeBuilt(prompt)).toBe(true);
      expect(signalsMatchedNothing(prompt)).toBe(false);
      expect(anAppWasOrderedButNotRecognised(prompt)).toBe(false);
    }
  });

  for (const [label, prompt] of STILL_CHAT) {
    it(`${label} is still chat`, () => {
      expect(analyzeRequest({ prompt }).taskType).toBe('chat');
    });
  }

  for (const [label, prompt] of ALREADY_READ) {
    it(`${label} keeps the type this module already got right`, () => {
      expect(analyzeRequest({ prompt }).taskType).not.toBe('app_unsized');
      expect(analyzeRequest({ prompt }).taskType).not.toBe('chat');
    });
  }

  it('empty and rubbish input never claim an app was ordered', () => {
    for (const prompt of ['', '   ', '...', '?']) {
      expect(anAppWasOrderedButNotRecognised(prompt)).toBe(false);
    }
    expect(anAppWasOrderedButNotRecognised(undefined as unknown as string)).toBe(false);
  });
});

describe('the pinned-tier path records it too', () => {
  it('a Strong/Power build does not file an unsized app under chat either', () => {
    // A pinned tier bypasses the ladder, so this changes no routing — but the report carries
    // `taskType` on this path as well, and it was lying here for the same reason.
    const r = analyzeRequest({ prompt: UNSIZED_APPS[0], powerMode: true, pinnedModel: 'sonnet' });
    expect(r.taskType).toBe('app_unsized');
    expect(r.complexityScore).toBe(100); // pinned — untouched
    expect(r.startTier).toBe('sonnet');
    expect(r.reasoning).toContain('app_unsized');
  });
});

describe('🔒 IT MOVES NO BUILD — the floor is provably routing-neutral', () => {
  // The claim in the code comment, asserted rather than promised. For every affected request the
  // start tier, the complex/simple verdict and the borderline answer must all be what they were
  // before the floor existed — which is checkable because the floor only ever RAISES a score, and
  // every score it can raise FROM maps to the same tier as the value it raises TO.
  const tierOf = (score: number) => (score <= 20 ? 'gemini' : score <= 40 ? 'haiku' : 'sonnet');
  const nearBoundary = (score: number) => [20, 40].some((b) => Math.abs(score - b) <= 3);

  for (const prompt of UNSIZED_APPS) {
    it(`"${prompt.slice(0, 32)}…" lands on the same tier as its pre-floor score`, () => {
      const r = analyzeRequest({ prompt });
      // The pre-floor score for these is the chat base, 5 — the number the report actually carried.
      expect(tierOf(5)).toBe(tierOf(r.complexityScore));
      expect(r.startTier).toBe(tierOf(5));
      expect(complexityFromScore(5)).toBe(complexityFromScore(r.complexityScore));
      expect(nearBoundary(5)).toBe(nearBoundary(r.complexityScore));
      expect(r.ambiguous).toBe(false);
    });
  }

  it('the floor sits strictly inside the cheapest tier, so it cannot cross a boundary', () => {
    // 15 is BASE_SCORE.simple_app. If someone later raises it past 20 this test fails, which is the
    // point: that would be a routing change and must be a deliberate, measured one.
    const floored = analyzeRequest({ prompt: UNSIZED_APPS[0] }).complexityScore;
    expect(floored).toBe(15);
    expect(tierOf(floored)).toBe('gemini');
    expect(Math.abs(floored - COMPLEX_SCORE_LINE)).toBeGreaterThan(BORDERLINE_MARGIN);
  });

  it('it RAISES only — a request already scoring above the floor is untouched', () => {
    // A long unrecognised order already picks up length adjustments; the floor must not cap it.
    const long = 'Create a upsc preparation app. ' + 'It should help aspirants revise every day. '.repeat(10);
    const r = analyzeRequest({ prompt: long });
    expect(r.taskType).toBe('app_unsized');
    expect(r.complexityScore).toBeGreaterThanOrEqual(15);
  });

  it('🔒 the second opinion still fires — this fix does not replace it', () => {
    // The floor makes the DETERMINISTIC answer honest. Buying a better one is still the model's job,
    // and the signal that pays for it must be unaffected.
    for (const prompt of UNSIZED_APPS) {
      expect(signalsMatchedNothing(prompt)).toBe(true);
    }
  });
});
