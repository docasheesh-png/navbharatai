/**
 * AUTOPSY 12511a9c (2026-09-30) — our weak-tier notice, copied back, ran a whole build on our words.
 * See `src/server/AgentV3/platformNoticeEcho.ts`. The class has happened before (autopsy fdd59ef8, our
 * sign-in notice); this closes the door every client shares, installed phone apps included.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isPlatformNoticeEcho, platformNoticeEchoReply, platformNoticeTexts, normaliseNoticeText, MIN_ECHO_CHARS,
} from '../src/server/AgentV3/platformNoticeEcho';
import { weakTierWelcomeNotice, weakTierBuildFailedNotice } from '../src/server/AgentV3/weakTierNotice';

const REPORTED = "🌱 You're building on the **free Weak engine**. The stronger tiers show a 🔒 in the **⚙️ options button (just below the message box)** — they all unlock once you recharge.";

describe('our own notice is recognised', () => {
  it('the exact prompt from the report', () => {
    expect(isPlatformNoticeEcho(REPORTED)).toBe(true);
  });

  it('every variant in every language, with or without its markdown and spacing', () => {
    for (const lang of [null, 'hi', 'bn', 'pa', 'gu', 'or', 'ta', 'te', 'kn', 'ml', 'ar']) {
      for (let seed = 0; seed < 3; seed++) {
        const n = weakTierWelcomeNotice(lang, seed);
        expect(isPlatformNoticeEcho(n), `${lang}/${seed}`).toBe(true);
        expect(isPlatformNoticeEcho(`  ${n.replace(/\*\*/g, '')}\n`), `${lang}/${seed} plain`).toBe(true);
      }
      expect(isPlatformNoticeEcho(weakTierBuildFailedNotice(lang)), `${lang} failed`).toBe(true);
    }
  });

  it('a long piece of a notice — a partial selection — is still ours', () => {
    const piece = "The stronger tiers show a 🔒 in the ⚙️ options button (just below the message box)";
    expect(piece.length).toBeGreaterThanOrEqual(MIN_ECHO_CHARS);
    expect(isPlatformNoticeEcho(piece)).toBe(true);
  });

  it('🔒 PRECISION: the user\'s own words about the engine, a short fragment, or an ordinary request build as before', () => {
    for (const p of [
      'Calculator',
      'free Weak engine',
      'why am I on the free Weak engine? build me a calculator',
      'build a calculator app with a history panel and dark mode, like the free Weak engine note said',
      'options button',
      '',
    ]) expect(isPlatformNoticeEcho(p), p).toBe(false);
  });

  it('AGENTV3_NOTICE_ECHO=off turns it off', () => {
    expect(isPlatformNoticeEcho(REPORTED, { AGENTV3_NOTICE_ECHO: 'off' } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it('the notice list is built from the live notice module, so a reworded notice is covered by construction', () => {
    expect(platformNoticeTexts()).toContain(normaliseNoticeText(weakTierWelcomeNotice(null, 2)));
    expect(platformNoticeTexts().length).toBeGreaterThanOrEqual(20);
  });
});

describe('the answer, instead of a build', () => {
  it('names the earlier request when there is one, and never an engine vendor', () => {
    const r = platformNoticeEchoReply('Calculator');
    expect(r).toMatch(/NavBharatAI's own note/);
    expect(r).toContain('"Calculator"');
    expect(platformNoticeEchoReply(null)).toMatch(/Tell me what you would like to build/);
    for (const bad of ['GLM', 'Kimi', 'Claude', 'Gemini', 'Grok']) expect(r).not.toContain(bad);
  });

  it('🔒 the route turns it into a chat turn with a fixed answer, and never records it as a request', () => {
    const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    const decide = route.indexOf('const echoesPlatformNotice = isPlatformNoticeEcho(prompt);');
    expect(decide).toBeGreaterThan(0);
    expect(route.slice(decide, decide + 300)).toContain("intent = 'chat';");
    expect(decide).toBeLessThan(route.indexOf("const isPlainChatTurn = intent === 'chat'"));
    expect(route).toContain('reply = platformNoticeEchoReply(recentRequests.find((r) => !isPlatformNoticeEcho(r)) ?? null);');
    expect(route).toContain("if (!echoesPlatformNotice) chatMem.recordRequest(prompt, undefined, askFramework ? 'framework' : answerThenOffer ? 'offer' : 'chat');");
    expect(route).toMatch(/!chatSessionRecall && !echoesPlatformNotice && !answerProjectElsewhere/);
  });
});
