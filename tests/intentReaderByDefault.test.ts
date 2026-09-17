/**
 * THE READER IS THE DEFAULT; A KEYWORD MAY HARD-LOCK ONLY AN UNMISTAKABLE ORDER (admin 2026-09-17).
 *
 * Five autopsies in one week — 5abad374, 2c61f648, the alarm app, f5351721, cc8c9075 — were the same
 * shape: the keyword ladder claimed HIGH on a message it could not actually read, and HIGH skips the
 * LLM intention reader entirely. Each autopsy added a regex; the class never closed. Regex reads
 * words, the reader reads grammar. Admin, verbatim: *"user ka har woh message jo … unclear hai, hamesha
 * llm call karo … navbharatai ko simple question ke simple anser dene sikhao."*
 *
 * Three parts, and the builder's own self-awareness that makes the "simple answer" correct.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  classifyIntentWithConfidence, classifyIntentSmart, hasNegation, readsAsQuestion,
} from '../src/server/AgentV3/IntentClassifier';
import { architectSystemPrompt, NAVBHARATAI_UI_MAP } from '../src/server/AgentV3/systemPrompt';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const down = async () => { throw new Error('reader down'); };

describe('A — a doubt signal costs a keyword its lock, never its intent', () => {
  it('a NEGATION beside the build verb sends the message to the reader', () => {
    for (const m of [
      'make a movie app, not a quiz app',
      "don't make it a quiz, make a movie streaming app",
      'ek movie app banao, quiz wala nahi',
    ]) {
      const v = classifyIntentWithConfidence(m);
      expect(v.intent, m).toBe('new_build');       // the intent survives…
      expect(v.confidence, m).toBe('low');         // …only the hard lock is gone
    }
    expect(hasNegation('quiz app mat banana')).toBe(true);
    expect(hasNegation('ek billing app banao')).toBe(false);
  });

  it('🔒 A PLAIN ORDER KEEPS HIGH AND STILL PAYS NOTHING — the common path is untouched', async () => {
    let asked = 0;
    const counting = async () => { asked++; return 'chat'; };
    for (const order of ['build a notes app', 'ek billing app banao', 'build me a calculator app', 'fix the login bug']) {
      expect(classifyIntentWithConfidence(order).confidence, order).toBe('high');
      await classifyIntentSmart(order, counting);
    }
    expect(asked, 'no reader call for an unmistakable order').toBe(0);
  });

  it('⚠️ LENGTH IS NOT A DOUBT SIGNAL — five clear words stay HIGH, nine unclear ones do not', () => {
    expect(classifyIntentWithConfidence('build me a todo app').confidence).toBe('high');        // 5 words
    expect(classifyIntentWithConfidence('Tumnay jo app banana use main open kase karu').confidence).toBe('low'); // 9
  });
});

describe('B — when the reader cannot answer, a question is answered, not built', () => {
  it('a question with the reader down falls to chat', async () => {
    for (const q of ['can you build me a todo app?', 'jo app banaya use main kaise kholu', 'how do I make a login page']) {
      expect(readsAsQuestion(q.toLowerCase()), q).toBe(true);
      expect(await classifyIntentSmart(q, down), q).toBe('chat');
    }
  });

  it('🔒 a statement or order with the reader down keeps the keyword verdict, exactly as before', async () => {
    expect(await classifyIntentSmart('add a payment button', down)).toBe('new_build');
    expect(await classifyIntentSmart('make a movie app, not a quiz app', down)).toBe('new_build');
    expect(await classifyIntentSmart('please continue', down)).toBe('edit_existing');
  });
});

describe('C — "help" is a fourth answer, and the builder finally knows where its own buttons are', () => {
  it('the reader is offered "help" and it routes to the chat lane', async () => {
    let seen = '';
    const llm = async (p: string) => { seen = p; return 'help'; };
    // Deliberately NOT a question-shaped message: a question would reach chat through the reader-down
    // fallback anyway, which would let this test pass with the "help" branch deleted. This one is a
    // LOW new_build (an order with a negation), so only the reader's own "help" can make it chat.
    const m = 'make a movie app, not a quiz app';
    expect(classifyIntentWithConfidence(m)).toMatchObject({ intent: 'new_build', confidence: 'low' });
    expect(await classifyIntentSmart(m, llm)).toBe('chat');
    expect(seen).toMatch(/help\s+—\s+asking how to use NAVBHARATAI ITSELF/);
    expect(seen).toMatch(/chat, help, build, or edit/);
  });

  it('THE REPORTED ANSWER CAN NO LONGER HAPPEN: the map forbids npm/terminal/localhost and names the Preview tab', () => {
    expect(NAVBHARATAI_UI_MAP).toMatch(/Do NOT tell them to run npm, open a\s*terminal, or visit localhost/);
    expect(NAVBHARATAI_UI_MAP).toMatch(/"Preview" tab in the header/);
    expect(NAVBHARATAI_UI_MAP).toMatch(/"Publish" button/);
    expect(NAVBHARATAI_UI_MAP).toMatch(/"Files" tab/);
    expect(NAVBHARATAI_UI_MAP).toMatch(/"Restore all files"/);
    expect(NAVBHARATAI_UI_MAP).toMatch(/red Stop button/);
    expect(NAVBHARATAI_UI_MAP).toMatch(/"Report" button/);
    expect(NAVBHARATAI_UI_MAP).toMatch(/"Download APK"/);
  });

  it('🔒 ONE constant, TWO readers — the architect prompt AND the plain-chat lane carry the same map', () => {
    // The build lane: inside the static, cached architect prompt (no framework / opts needed).
    expect(architectSystemPrompt()).toContain(NAVBHARATAI_UI_MAP);
    // The chat lane: the inline prompt in routes/agentv3.ts, by name — a second hand-written copy is
    // how the two lanes would come to give different directions.
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toMatch(/import \{ summarizeFileTree, NAVBHARATAI_UI_MAP \} from '\.\.\/AgentV3\/systemPrompt'/);
    expect(route).toMatch(/LINK_POLICY \+[\s\S]{0,400}'\\n\\n' \+ NAVBHARATAI_UI_MAP \+ chatWorkspaceContext/);
  });

  it('the map is STATIC text, so it cannot bust the cache prefix', () => {
    // Two calls, same bytes: nothing in it depends on the date, the user or the project.
    expect(architectSystemPrompt('vite-react')).toContain(NAVBHARATAI_UI_MAP);
    expect(NAVBHARATAI_UI_MAP).not.toMatch(/\$\{|new Date|Date\.now/);
  });
});
