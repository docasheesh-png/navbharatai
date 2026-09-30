import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { summaryAdditions } from '../src/server/AgentV3/summaryAdditions';
import { detectAppRequirements, unconfiguredRequirements, appRequirementsNotice } from '../src/server/AgentV3/AppRequirements';
import { recipeFor, preferredOption } from '../src/lib/credentialRecipes';
import { architectSystemPrompt, AI_IN_APP_RULE } from '../src/server/AgentV3/systemPrompt';

/**
 * Admin 2026-09-30: when an app needs something from the user — a key, a secret, an answer, a choice —
 * the build's very last message must say so clearly, in the user's language. For "build an AI like
 * ChatGPT" that means: the app is ready; to answer questions it needs an AI key; a NavBharatAI API key
 * works, or the user's own key from another provider; ask me if you need help.
 */

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const REPLY = 'Your chat assistant is ready. It has a clean chat screen, message history and a typing indicator, and it works on phones.';
const NOTICE = '🔑 Your app is built. 1 thing needs a key from your own account to go fully live:\n• **AI for your app** — …';

describe('the platform\'s additions to a successful reply reach the screen', () => {
  it('sends what came after the reply the user already saw', () => {
    expect(summaryAdditions(`${REPLY}\n\n${NOTICE}`, [REPLY])).toEqual({ matched: true, text: NOTICE });
  });

  it('finds the reply through whitespace differences, line by line', () => {
    const streamed = 'Your app is ready.\nIt keeps   your history\nand works offline too, on every phone.';
    const summary = `Your app is ready.\n  It keeps your history\nand works offline too, on every phone.\n\n${NOTICE}`;
    expect(summaryAdditions(summary, [streamed])).toEqual({ matched: true, text: NOTICE });
  });

  it('keeps a prefix the platform put before the reply', () => {
    const r = summaryAdditions(`⚠️ The import failed, so this was built fresh.\n\n${REPLY}\n\n${NOTICE}`, [REPLY]);
    expect(r.text).toBe(`⚠️ The import failed, so this was built fresh.\n\n${NOTICE}`);
  });

  it('never repeats a line that was already narrated on its own', () => {
    const extra = '✅ Preview verified — I opened the running app in a browser and it renders correctly.';
    expect(summaryAdditions(`${REPLY}\n\n${extra}\n\n${NOTICE}`, [REPLY, extra]).text).toBe(NOTICE);
  });

  it('sends nothing when the reply cannot be found (a repeat is worse than a miss)', () => {
    expect(summaryAdditions(`${REPLY}\n\n${NOTICE}`, ['a completely different streamed reply that is long enough'])).toEqual({ matched: false, text: '' });
    expect(summaryAdditions('', [REPLY])).toEqual({ matched: false, text: '' });
  });

  it('nothing added ⇒ nothing sent', () => {
    expect(summaryAdditions(REPLY, [REPLY])).toEqual({ matched: true, text: '' });
  });

  it('the route records what was seen and sends the rest last (source guard)', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain("if (ev.type === 'narration' && typeof ev.text === 'string' && ev.text.trim().length >= 40 && narratedTexts.length < 400) narratedTexts.push(ev.text);");
    const send = route.indexOf('const added = summaryAdditions(result.summary, narratedTexts);');
    const result = route.indexOf("emit({ type: 'result', ...result, ...projectContinue");
    const notice = route.indexOf('const notice = appRequirementsNotice(missing,');
    expect(send).toBeGreaterThan(notice); // after the checklist is appended, so the checklist is in it
    expect(result).toBeGreaterThan(send); // and before the build's terminal event
    expect(route).toContain("process.env.AGENTV3_SUMMARY_ADDITIONS ?? '').trim().toLowerCase() !== 'off'");
  });
});

describe('an AI app is told it can run on a NavBharatAI key or the user\'s own', () => {
  const aiApp = {
    'package.json': JSON.stringify({ dependencies: { express: '^4.0.0' } }),
    'server/ai.ts': "const key = process.env.AI_API_KEY; const base = process.env.AI_BASE_URL ?? 'https://navbharatai.com/api/v1';",
  };

  it('names both routes, where each comes from, and offers help — in English', () => {
    const missing = unconfiguredRequirements(detectAppRequirements({ files: aiApp }), {});
    const notice = appRequirementsNotice(missing, null);
    expect(notice).toContain('Home → Other AI → Developer Tools → NavBharatAI API');
    expect(notice).toContain('OpenAI (ChatGPT), Anthropic (Claude), Google (Gemini) or xAI (Grok)');
    expect(notice).toContain('`AI_API_KEY`');
    expect(notice).toMatch(/ask me/);
  });

  it('and in the user\'s own language', () => {
    const missing = unconfiguredRequirements(detectAppRequirements({ files: aiApp }), {});
    for (const code of ['hi', 'bn', 'pa', 'gu', 'or', 'ta', 'te', 'kn', 'ml', 'ar']) {
      const n = appRequirementsNotice(missing, code);
      expect(n, code).toContain('NavBharatAI API key');
      expect(n, code).toContain('`AI_API_KEY`');
      expect(n, code).not.toMatch(/Either key works/);
    }
  });

  it('never promises a NavBharatAI key to an app written against one provider', () => {
    const openaiOnly = {
      'package.json': JSON.stringify({ dependencies: { openai: '^4.0.0' } }),
      'server/ai.ts': 'const key = process.env.OPENAI_API_KEY;',
    };
    const notice = appRequirementsNotice(unconfiguredRequirements(detectAppRequirements({ files: openaiOnly }), {}), null);
    expect(notice).toContain('`OPENAI_API_KEY`');
    expect(notice).not.toContain('NavBharatAI API');
  });

  it('a Claude- or Gemini-keyed app is no longer invisible to the checklist', () => {
    for (const [pkg, env] of [['@anthropic-ai/sdk', 'ANTHROPIC_API_KEY'], ['@google/genai', 'GEMINI_API_KEY']]) {
      const files = { 'package.json': JSON.stringify({ dependencies: { [pkg]: '1' } }), 'server/ai.ts': `process.env.${env}` };
      expect(detectAppRequirements({ files }).map((r) => r.id), pkg).toContain('app_ai_key');
    }
  });

  it('a key already saved is not asked for again', () => {
    expect(unconfiguredRequirements(detectAppRequirements({ files: aiApp }), { AI_API_KEY: 'nbai_x' })).toEqual([]);
  });

  it('the key card and "Guide me" point an AI_API_KEY app at the NavBharatAI API', () => {
    const option = preferredOption(recipeFor('app_ai_key'), { envVars: ['AI_API_KEY'], packages: [] });
    expect(option?.provider).toBe('NavBharatAI API');
    expect(option?.path).toBe('Home → Other AI → Developer Tools → NavBharatAI API → Create key');
  });
});

describe('the builder builds what the closing message promises', () => {
  it('writes AI on the server, through one configurable standard request', () => {
    expect(AI_IN_APP_RULE).toContain('SERVER code, never from browser code');
    expect(AI_IN_APP_RULE).toContain('AI_API_KEY');
    expect(AI_IN_APP_RULE).toContain('"https://navbharatai.com/api/v1"');
    expect(AI_IN_APP_RULE).toContain('never canned or fake answers');
  });

  it('asks last, in the user\'s language', () => {
    const p = architectSystemPrompt('vite-react');
    expect(p).toContain(AI_IN_APP_RULE);
    expect(p).toContain('ASK LAST');
    expect(p).toContain('put ALL of it at the');
  });
});
