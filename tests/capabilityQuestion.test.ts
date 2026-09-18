// READ THE MOOD BEFORE OBEYING A KEYWORD.
//
// Admin-mandated 2026-09-13, after autopsy 5abad374: *"simple question ka just simple answer dena
// chahiye — app banane ki yahan jarurat hi kahan hai. Direct app mat bana do! Yeh system control karo —
// pehle dekhu user ka mood kya hai, kya woh sirf answer chahta hai, ya app banwana chahta hai."*
//
// THE REPORT: a user typed "Can you generate images?" — four words. `generate` is a build verb, so the
// keyword scanner returned new_build at HIGH confidence, and HIGH confidence SKIPS the LLM upgrade
// entirely. The engine built an "AI Image Studio" for 29 minutes, hit the wall-clock cap, and told the
// user their app was not ready. At minute 8 it had already ANSWERED the question in plain text.
//
// IT WAS NEVER ONE SENTENCE. Measured across ordinary phrasings, all of these hard-locked to "build an
// app" with the intention reader never consulted: "can I make money from this?", "what can you
// generate?", "how do I make a login page?", "should I create a react app or next js?". A PRICING
// QUESTION BUILT AN APP. The keyword is not the bug — the hard lock is.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyIntent,
  classifyIntentWithConfidence,
  classifyIntentSmart,
  readsAsQuestion,
  namesSpecificDeliverable,
} from '../src/server/AgentV3/IntentClassifier';

describe('a question gets an answer, not a 29-minute app', () => {
  it('THE EXACT PROMPT: "Can you generate images?"', () => {
    const got = classifyIntentWithConfidence('Can you generate images?');
    expect(got.intent).toBe('chat');
    expect(got.signal).toBe('question-no-deliverable');
    // LOW on purpose — the intention reader still decides. Only the hard lock is removed.
    expect(got.confidence).toBe('low');
  });

  it.each([
    'can you generate images',
    'what can you generate?',
    'Can you make images?',
    'can you build apps?',
    'does it support dark mode?',
    'kya aap image bana sakte ho?',
    'kya main app bana sakta hoon?',
    'app banane ka kya charge hai?',
  ])('is answered, not built: %s', (msg) => {
    expect(classifyIntentWithConfidence(msg).intent).toBe('chat');
  });
});

describe('a question that DOES name something to build keeps its intent but loses the hard lock', () => {
  // These are questions in form and orders in substance. The intent stays `new_build`, so nothing
  // regresses when the reader is slow or down — but the sentence now actually reaches the reader.
  it.each([
    'can you build me a todo app?',
    'how do I make a login page?',
    'what is the best way to build a dashboard?',
    'should I create a react app or next js?',
    'can I make money from this?',
  ])('reaches the intention reader: %s', (msg) => {
    const got = classifyIntentWithConfidence(msg);
    expect(got.confidence).toBe('low'); // ← the fix: HIGH would skip the reader entirely
  });

  it('and when the reader cannot run, a QUESTION is answered rather than built', async () => {
    // 🔴 CHANGED 2026-09-17 (admin: "simple question ke simple answer dene sikhao"). This used to pin
    // `new_build` — the keyword verdict standing when the reader is down, so "nothing regresses". But
    // for a message that READS AS A QUESTION the keyword verdict is exactly the guess the reader exists
    // to check, and the two mistakes are not the same size: wrong-toward-chat is one message (the reply
    // already offers to build), wrong-toward-build is a whole build nobody asked for.
    const verdict = await classifyIntentSmart('can you build me a todo app?', async () => { throw new Error('down'); });
    expect(verdict).toBe('chat');
    // A STATEMENT or ORDER with the reader down keeps the keyword verdict exactly as before — this is
    // what keeps a plain edit an edit when the free provider is slow.
    expect(await classifyIntentSmart('add a payment button', async () => { throw new Error('down'); })).toBe('new_build');
  });
});

describe('⚠️ AN ORDER IS NOT A QUESTION — the common path pays nothing for this', () => {
  // A false positive here would put a confirmation round-trip in front of every real build, which is
  // the opposite of what the admin asked for. Orders must stay HIGH and instant.
  it.each([
    ['build a notes app', 'new_build'],
    ['make me a shop app', 'new_build'],
    ['ek billing app banao', 'new_build'],
    ['create a portfolio site', 'new_build'],
    ['fix the login button', 'edit_existing'],
    ['please continue', 'edit_existing'],
    ['clone this landing page https://stripe.com', 'new_build'],
  ])('stays instant: %s', (msg, expected) => {
    const got = classifyIntentWithConfidence(msg);
    expect(got.intent).toBe(expected);
    expect(got.confidence).toBe('high');
  });
});

describe('🔴 an auxiliary opens an ORDER as often as a question', () => {
  // Caught by the existing suite before this shipped: "do it again" is a retry, and reading `do` as
  // interrogative turned a continuation into small talk — re-opening the "please continue" amnesia
  // this repo has already fixed once. An auxiliary counts as a question only with a question mark, or
  // when a second-person subject follows it.
  it.each(['do it again', 'try again', 'one more time', 'do this now'])('is an order: %s', (msg) => {
    expect(readsAsQuestion(msg)).toBe(false);
  });

  it.each(['can you generate images', 'do you support images', 'kya aap app bana sakte ho'])(
    'is a question even without the mark: %s', (msg) => {
      expect(readsAsQuestion(msg)).toBe(true);
    });

  it('a question mark settles it either way', () => {
    expect(readsAsQuestion('does it support dark mode?')).toBe(true);
    expect(readsAsQuestion('is it possible to add payments?')).toBe(true);
  });

  it('and "do it again" still resumes the build', () => {
    expect(classifyIntentWithConfidence('do it again').intent).toBe('edit_existing');
  });
});

describe('the two halves of the mood test', () => {
  it('recognises a question with or without the mark', () => {
    expect(readsAsQuestion('can you generate images?')).toBe(true);
    expect(readsAsQuestion('can you generate images')).toBe(true); // plenty of users never type it
    expect(readsAsQuestion('kaise banau ek website')).toBe(true);
    expect(readsAsQuestion('kitna time lagta hai')).toBe(true);
    expect(readsAsQuestion('build a notes app')).toBe(false);
    expect(readsAsQuestion('')).toBe(false);
  });

  it('separates asking ABOUT app-building from asking FOR an app', () => {
    expect(namesSpecificDeliverable('can you build me a todo app')).toBe(true);
    expect(namesSpecificDeliverable('can you fix my footer')).toBe(true);
    expect(namesSpecificDeliverable('kya aap mere liye ek app bana sakte ho')).toBe(true);
    expect(namesSpecificDeliverable('can you generate images')).toBe(false);
    expect(namesSpecificDeliverable('what can you generate')).toBe(false);
  });
});

// 🔴 THE QUESTION AT THE END, NOT THE START (autopsy 2026-09-16, real build).
//
// THE REPORT: "मैं एक अलार्म ऐप बनाना चाहता हूं मेरे पास उसका prompt है क्या मैं prompt डालूं" — "I want
// to build an alarm app, I have its prompt, should I paste it?" Every check above this point requires
// the message to OPEN with a question word; this one asks its real question ("kya main… daaloon" —
// "should I…?") only at the very END, after a declarative lead-in that itself contains a build verb.
// The message hard-locked to new_build at HIGH confidence, skipped the LLM upgrade, and ran a real,
// billed weak-tier AgentV3 build (68 provider failures, cancelled by the user) for what should have
// been a one-line "haan, bhej dijiye" reply.
//
// It was ALSO typed in native Devanagari, where — unlike every other message in this file — no
// Romanized signal in the classifier can see it at all. This fix does not translate the whole
// classifier (see PROGRESS.md for that as a separate, open item); it adds ONLY this one unambiguous
// "should/may I…?" particle, in both scripts, anywhere in the sentence.
describe('🔴 a trailing "kya main/hum" asks its question at the END of the sentence, not the start', () => {
  it('THE EXACT REPORTED PROMPT (Devanagari, alarm app build)', () => {
    const prompt = 'मैं एक अलार्म ऐप बनाना चाहता हूं मेरे पास उसका prompt है क्या मैं prompt डालूं';
    expect(readsAsQuestion(prompt)).toBe(true);
    const got = classifyIntentWithConfidence(prompt);
    // The headline fix: this must NEVER be high-confidence new_build again — either it answers
    // directly as chat, or (if namesSpecificDeliverable still misses the Devanagari "एक") it at
    // least drops to LOW confidence so the intention reader gets a say. Both are strictly better
    // than the hard lock the report shows; neither is the bug this test guards against.
    expect(got.confidence).toBe('low');
    expect(got.intent).not.toBe('edit_existing');
  });

  it.each([
    'main ek alarm app banana chahta hoon, mere paas uska prompt hai, kya main prompt daaloon',
    'ek billing app chahiye, kya main details bhej doon?',
    'want to build a crm, kya hum call pe baat kar sakte hain',
  ])('reaches the intention reader instead of hard-locking: %s', (msg) => {
    expect(readsAsQuestion(msg)).toBe(true);
    expect(classifyIntentWithConfidence(msg).confidence).toBe('low');
  });

  it('an order that merely CONTAINS "main" is not swept in by accident', () => {
    // "main" appears here, but never as "kya main/aap/tum/hum" — must stay an instant, high-confidence
    // order, exactly like the "an order is not a question" block above.
    expect(readsAsQuestion('banao ek app jisme main apna kharcha track kar sakoon')).toBe(false);
  });

  it('a mid-sentence "kya" that is NOT the should-I particle does not falsely fire', () => {
    // "kya" here questions the following NOUN ("what problem"), not "should I/we" — the existing
    // WH_OPENERS/SOCIAL/ANSWER-ONLY signals already handle sentences like this; this test only
    // confirms the NEW mid-sentence check does not overreach into them.
    expect(/kya\s+(?:aap|tum|main|mai|hum|hume)\b/.test('mat banao, sirf batao kya problem hai')).toBe(false);
  });
});

describe('ONE intent ladder, not two that drift', () => {
  // `classifyIntent` used to be a second hand-maintained copy of the same rules that the route ALSO
  // calls, and the two had already drifted (whole-word scanner vs substring matcher). This fix would
  // have had to be written twice — precisely the duplication that let the July zombie-write fix reach
  // one of its two lanes and not the other, and cost a build two months later.
  it('the plain entry point delegates instead of re-implementing', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/IntentClassifier.ts'), 'utf8');
    const at = src.indexOf('export function classifyIntent(message: string): BuildIntent {');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 900)).toContain('return classifyIntentWithConfidence(message).intent;');
  });

  it('and therefore agrees with the confidence ladder on every case', () => {
    for (const msg of [
      'Can you generate images?', 'build a notes app', 'fix my footer', 'hello', 'please continue',
      'preview nahi chala', 'compare react and vue', 'can you build me a todo app?', '',
    ]) {
      expect(classifyIntent(msg)).toBe(classifyIntentWithConfidence(msg).intent);
    }
  });
});

describe('the intention reader is told the rule in its own terms', () => {
  it('a question gets answered even when it contains a build word', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/IntentClassifier.ts'), 'utf8');
    expect(src).toContain('If they are ASKING something, the answer is "chat"');
    expect(src).toContain('Choose "build" only when they want an app produced NOW.');
  });
});
