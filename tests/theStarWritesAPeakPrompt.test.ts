// The ⭐ star left of Send rewrites the user's brief into a peak-level prompt — and never invents a fact.
//
// Admin, 2026-09-21: "send button ke left me jo star hai, usko peak level promt banwana sikhao!" —
// named as "sabse bada realism lever". The craft layer already adds art direction to every send,
// silently; this is the visible half: the user's OWN words, rewritten on request, put back in their
// box to read and edit. It rides the ₹0 free chat ladder, one short call, and it is a REQUEST.
//
// The rule that matters most is the one a rewrite can break: drift. "Sharma Sweets, 98765 43210"
// rewritten into a beautiful brief that lost the phone number is worse than the plain brief. So the
// result is CHECKED, and a rewrite that dropped a number, an all-caps name or a Devanagari word is
// refused with an honest note — the user keeps their words.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  enhancerSystemPrompt, enhancerUserMessage, cleanEnhancedPrompt, factsToKeep, keepsTheFacts,
  decideEnhanced, enhanceImagePrompt, enhanceFailureMessage, ENHANCE_MAX_OUTPUT,
} from '../src/server/lib/imagePromptEnhancer';

const LEAKS = [/glm/i, /kimi/i, /gemini/i, /grok/i, /claude/i, /openai/i, /pollinations/i, /vertex/i];

describe('the instruction', () => {
  it('tells the model to keep every fact and to add none', () => {
    const s = enhancerSystemPrompt();
    expect(s).toMatch(/Keep EVERY concrete fact/);
    expect(s).toMatch(/Never add a slogan, a brand, a person, or any words to be drawn/);
    expect(s).toMatch(/Output ONLY the prompt/);
  });

  it('carries the picker settings so the rewrite agrees with them, and skips a "no preference" colour', () => {
    const u = enhancerUserMessage({ prompt: 'a tea stall', type: 'Photograph', style: 'Cinematic', colorHint: 'No preference' });
    expect(u).toContain('Image type: Photograph');
    expect(u).toContain('Style: Cinematic');
    expect(u).not.toMatch(/Colour:/);
    expect(u).toMatch(/Brief: a tea stall$/);
  });
});

describe('cleaning what a chat model wraps around an answer', () => {
  it('strips preambles, fences, quotes and bullets, and folds to one line', () => {
    expect(cleanEnhancedPrompt('Here is your prompt:\n"A tea stall at dawn"')).toBe('A tea stall at dawn');
    expect(cleanEnhancedPrompt('```\nA tea stall at dawn\n```')).toBe('A tea stall at dawn');
    expect(cleanEnhancedPrompt('Enhanced prompt — A tea stall\nat dawn')).toBe('A tea stall at dawn');
    expect(cleanEnhancedPrompt('- a tea stall\n- at dawn')).toBe('a tea stall at dawn');
  });

  it('is bounded', () => {
    expect(cleanEnhancedPrompt('x'.repeat(5000)).length).toBe(ENHANCE_MAX_OUTPUT);
  });
});

describe('🔒 the facts a rewrite must keep', () => {
  it('finds phone numbers, prices, all-caps names and Devanagari words — and not sentence-initial capitals', () => {
    const facts = factsToKeep('Make a banner for SHARMA SWEETS, phone 98765 43210, chai ₹10, नमस्ते');
    expect(facts).toEqual(expect.arrayContaining(['9876543210', 'SHARMA', 'SWEETS', 'नमस्ते']));
    expect(facts).not.toContain('Make');   // a sentence-initial capital is not a fact
    expect(facts).not.toContain('10');     // two digits is a quantity, not a phone number or price
    expect(factsToKeep('Make a logo for a tea shop')).toEqual([]);
  });

  it('a rewrite that dropped the phone number is refused; one that kept it (spaced differently) passes', () => {
    const original = 'banner for Sharma Sweets, call 98765 43210';
    expect(keepsTheFacts(original, 'A warm banner for Sharma Sweets, call 9876543210, golden light')).toBe(true);
    expect(keepsTheFacts(original, 'A warm banner for Sharma Sweets in golden light')).toBe(false);
  });

  it('a Devanagari word must survive as written', () => {
    expect(keepsTheFacts('logo with the word चाय', 'A flat logo with the word चाय in a clean circle')).toBe(true);
    expect(keepsTheFacts('logo with the word चाय', 'A flat logo with the word chai in a clean circle')).toBe(false);
  });
});

describe('the decision', () => {
  it('a good rewrite is accepted, cleaned', () => {
    const out = decideEnhanced('a tea stall', 'Here is your prompt: "A roadside tea stall at dawn, steam rising, 35mm, warm light"', true);
    expect(out).toEqual({ ok: true, prompt: 'A roadside tea stall at dawn, steam rising, 35mm, warm light' });
  });

  it('a router that did not succeed is "busy", never a made-up prompt', () => {
    const out = decideEnhanced('a tea stall', 'The AI service is temporarily busy.', false);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('busy');
  });

  it('empty, unchanged and fact-losing answers each fail honestly', () => {
    expect((decideEnhanced('a tea stall', '', true) as { reason: string }).reason).toBe('empty');
    expect((decideEnhanced('A tea stall at dawn, 35mm', 'a tea stall at dawn, 35mm', true) as { reason: string }).reason).toBe('unchanged');
    expect((decideEnhanced('banner, call 98765 43210', 'A lovely banner in golden light with warm tones', true) as { reason: string }).reason).toBe('lost-facts');
  });

  it('🔒 every failure message is branded and names no vendor, and says the words are kept', () => {
    for (const r of ['empty', 'unchanged', 'lost-facts', 'busy'] as const) {
      const m = enhanceFailureMessage(r);
      for (const leak of LEAKS) expect(m).not.toMatch(leak);
      expect(m).toMatch(/kept|Press send/);
    }
  });
});

describe('the call', () => {
  it('sends the system and user messages and returns the decided prompt', async () => {
    let seen: { system: string; user: string } | null = null;
    const out = await enhanceImagePrompt(
      { prompt: 'clinic logo', type: 'Modern app logo', style: 'Minimal' },
      async (system, user) => { seen = { system, user }; return { content: 'A flat minimal clinic logo, a single blue cross in a rounded square, clean white background, vector', ok: true }; },
    );
    expect(out.ok).toBe(true);
    expect(seen!.system).toBe(enhancerSystemPrompt());
    expect(seen!.user).toContain('Brief: clinic logo');
  });

  it('a slow model is "busy" after the clock, and a throw is "busy" too', async () => {
    const slow = await enhanceImagePrompt({ prompt: 'x y z' }, () => new Promise(() => {}), 20);
    expect(slow.ok).toBe(false);
    const boom = await enhanceImagePrompt({ prompt: 'x y z' }, async () => { throw new Error('ECONNRESET'); });
    expect(boom.ok).toBe(false);
  });

  it('an empty brief never calls the model', async () => {
    let calls = 0;
    await enhanceImagePrompt({ prompt: '   ' }, async () => { calls += 1; return { content: 'x', ok: true }; });
    expect(calls).toBe(0);
  });
});

describe('🔒 SOURCE — the route rides the free ladder, triages first, and the client puts the words in the box', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/imageGen.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const enh = route.slice(route.indexOf("app.post('/api/image/enhance-prompt'"));
  const gen = readFileSync(join(__dirname, '..', 'src/components/ide/AIImageGenerator.tsx'), 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('the route exists, requires an account, triages before the call, and calls the FREE universe', () => {
    expect(enh.length).toBeGreaterThan(0);
    const triage = enh.indexOf('await triageImageRequest(');
    const account = enh.indexOf('await requireAccountForCostlyAi(');
    const call = enh.indexOf("aiRouter.routeDetailed(");
    expect(triage).toBeGreaterThan(0);
    expect(account).toBeGreaterThan(0);
    expect(call).toBeGreaterThan(triage);
    expect(call).toBeGreaterThan(account);
    expect(enh).toMatch(/routeDetailed\([^)]*'navbharat'/);
  });

  it('the star calls the route, replaces the box, keeps an Undo, and the old keyword-pasting is gone', () => {
    expect(gen).toContain("fetch('/api/image/enhance-prompt'");
    expect(gen).toContain('setPrompt(data.prompt)');
    // ⚠️ `setEnhanceUndo(` alone is VACUOUS — the Undo button and the box's onChange both call it
    // with null. The guard is the PAIR: the original saved, then the box replaced. Proven by
    // reversion: dropping the save line fails this and nothing else.
    expect(gen).toMatch(/setEnhanceUndo\(original\);\s*setPrompt\(data\.prompt\);/);
    expect(gen).not.toContain('STYLE_ENHANCERS');
  });
});
