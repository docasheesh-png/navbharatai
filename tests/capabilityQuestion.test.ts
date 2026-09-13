// REGRESSION — a four-word question that cost 29 minutes (autopsy 5abad374, 2026-09-13).
//
// A user typed **"Can you generate images?"**. `generate` is a NEW_BUILD verb, so the keyword scanner
// returned `new_build` at HIGH confidence — and high confidence SKIPS the LLM upgrade entirely
// (`classifyIntentSmart` returns before asking it). The engine built an "AI Image Studio" for 29
// minutes, hit the wall-clock cap, and told the user the app was not ready. At minute 8 it had already
// ANSWERED the question in plain text — and kept building anyway.
//
// The verb in "can you <verb> …?" is the OBJECT of the question, never an imperative.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyIntent,
  classifyIntentWithConfidence,
  classifyIntentSmart,
  isCapabilityQuestion,
} from '../src/server/AgentV3/IntentClassifier';

describe('a capability question is a question, not a build order', () => {
  it('THE EXACT PROMPT: "Can you generate images?" no longer starts a build', () => {
    const got = classifyIntentWithConfidence('Can you generate images?');
    expect(got.intent).toBe('chat');
    expect(got.signal).toBe('capability-question');
    // LOW on purpose — the LLM upgrade, which sees the project and the conversation, still decides.
    // All that is removed is the HARD LOCK that stopped it from ever being asked.
    expect(got.confidence).toBe('low');
  });

  it.each([
    'can you generate images',
    'Can you make images?',
    'can you build apps?',
    'Can you make websites?',
    'Do you support images?',
    'are you able to make games?',
    'kya aap image bana sakte ho?',
    'kya aap app bana sakte ho',
  ])('is a question: %s', (msg) => {
    expect(classifyIntentWithConfidence(msg).intent).toBe('chat');
  });

  // PRECISION FIRST. A false positive here REFUSES A REAL BUILD, which is far worse than the bug
  // being fixed — so anything naming a specific deliverable must behave exactly as it does today.
  it.each([
    ['Can you build me a todo app?', 'new_build'],
    ['Can you make a landing page?', 'new_build'],
    ['can you create an image gallery for me', 'new_build'],
    ['Can you generate images for my shop app?', 'new_build'],
    ['kya aap mere liye ek app bana sakte ho', 'new_build'],
    ['Can you add dark mode?', 'new_build'],
    ['Can you fix my footer?', 'edit_existing'],
    ['build a notes app', 'new_build'],
    ['make a music player for android', 'new_build'],
  ])('still builds: %s', (msg, expected) => {
    expect(classifyIntentWithConfidence(msg).intent).toBe(expected);
  });

  it('a long message that merely opens with "can you" is a real request', () => {
    const long = 'can you build a full inventory system with suppliers, purchase orders and GST invoices';
    expect(classifyIntentWithConfidence(long).intent).toBe('new_build');
    expect(isCapabilityQuestion(long.toLowerCase())).toBe(false);
  });

  it('the LLM now gets consulted, where before it was locked out', async () => {
    // The whole point of returning LOW: `classifyIntentSmart` returns immediately on HIGH, so the
    // context-aware upgrade never ran for this sentence. It runs now — and can still say "build".
    const asked: string[] = [];
    const verdict = await classifyIntentSmart('Can you generate images?', async (p) => { asked.push(p); return 'chat'; });
    expect(asked).toHaveLength(1);
    expect(verdict).toBe('chat');

    const overridden = await classifyIntentSmart('Can you generate images?', async () => 'build');
    expect(overridden).toBe('new_build');
  });

  it('a failed LLM upgrade leaves the safe answer standing, not the 29-minute one', async () => {
    const verdict = await classifyIntentSmart('Can you generate images?', async () => { throw new Error('down'); });
    expect(verdict).toBe('chat');
  });
});

describe('ONE intent ladder, not two that drift', () => {
  // `classifyIntent` used to be a second, hand-maintained copy of the same rules, and the two had
  // ALREADY drifted (the confidence version uses the whole-word scanner that fixed a real mis-route;
  // this one still used the substring matcher). The route calls BOTH, so the capability fix would have
  // had to be written twice — precisely the duplication that let the July zombie-write fix reach one of
  // its two lanes and not the other, and cost a build two months later.
  it('the plain entry point delegates instead of re-implementing', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/IntentClassifier.ts'), 'utf8');
    const at = src.indexOf('export function classifyIntent(message: string): BuildIntent {');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 900)).toContain('return classifyIntentWithConfidence(message).intent;');
  });

  it('and therefore agrees with the confidence ladder on every case', () => {
    for (const msg of [
      'Can you generate images?', 'build a notes app', 'fix my footer', 'hello', 'please continue',
      'preview nahi chala', 'compare react and vue', 'Can you build me a todo app?', '',
    ]) {
      expect(classifyIntent(msg)).toBe(classifyIntentWithConfidence(msg).intent);
    }
  });
});
