/**
 * AUTOPSY 4499741f (2026-09-29) — a plain-JavaScript MP3 player, built on the weak tier.
 *
 * The user asked for a music player that takes YouTube links through an authorised backend, written
 * as index.html + style.css + script.js. Six separate verdicts about that one build were wrong, and
 * each is locked here against the report's own words:
 *
 *   1. "Proper messages show karo" made it a SOCIAL app (feed, moderation, media upload suggested).
 *   2. Four tool mentions of YouTube made it "LARGE — clone of YouTube".
 *   3. The roadmap planner answered a Roman-Hinglish request in Devanagari.
 *   4. The planner's own Nemotron call was counted as the build falling to ladder rung 4.
 *   5. The untouched seeded src/App.tsx was called "the starter" although index.html no longer loaded
 *      src/ at all — which blocked "done", resumed the builder, and cost four minutes of churn.
 *   6. A rewritten vite.config.ts counted as "TypeScript source", so a JavaScript app was type-checked
 *      with an unpinned compiler and ended YELLOW on "the project does not typecheck".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { analyzeAppScope, namesAsProduct } from '../src/server/lib/appScopeAnalyzer';
import { megaRoadmapUserPrompt, replyScriptLine } from '../src/server/lib/megaRoadmap';
import { ladderDepthUsed, rungIndexFor } from '../src/server/AgentV3/ladderDepth';
import { TIER_LADDERS } from '../src/server/AgentV3/tierLadder';
import { entryIsStillTheStarter, pageMountsSrc, STARTER_ENTRY_CONTENT } from '../src/server/AgentV3/stillTheStarterApp';
import { isTypeScriptSourcePath } from '../src/server/routes/agentv3';
import { TSC_ENSURE } from '../src/server/AgentV3/tscCommand';

// The report's prompt, abridged to the lines each verdict turned on — verbatim.
const PROMPT = [
  'Create a complete, modern, mobile-responsive **MP3 Music Player Website**.',
  '### 1. Main Concept',
  'Website mein user YouTube ka **video/playlist URL paste** karke apni music playlist mein songs add kar sake.',
  'Important: YouTube content ko directly MP3 mein convert/download karna copyright/platform rules ke against ho sakta hai.',
  '* "Paste YouTube / Music URL"',
  '* Add Song button',
  '### 9. Error Handling',
  'Proper messages show karo:',
  '* Invalid URL',
  'Create a proper API abstraction so that the frontend does NOT directly attempt unauthorized YouTube-to-MP3 downloading/conversion.',
].join('\n');

describe('1 · UI copy is not a social network', () => {
  it('the report prompt is not classified as social', () => {
    expect(analyzeRequirementGaps(PROMPT).domain).not.toBe('social');
  });
  it('messages an app shows its user, in English or Hinglish order', () => {
    for (const t of ['Proper messages show karo', 'show clear error messages', 'messages dikhao jab URL galat ho']) {
      expect(analyzeRequirementGaps(t).domain, t).toBe('general');
    }
  });
  it('a real messaging app still classifies', () => {
    expect(analyzeRequirementGaps('a realtime chat app with rooms, message history and user profiles').domain).toBe('social');
  });
});

describe('2 · a product used as a SOURCE is not a clone request', () => {
  it('none of the report prompt\'s four YouTube mentions asks for a YouTube clone', () => {
    expect(namesAsProduct(PROMPT, /\byoutube\b/i)).toBe(false);
    expect(analyzeAppScope(PROMPT).famousApp).toBeNull();
    expect(analyzeAppScope(PROMPT).signals.join(' ')).not.toMatch(/clone/i);
  });
  it('markdown, quotes and conversions no longer hide the tool noun', () => {
    const yt = /\byoutube\b/i;
    for (const t of ['YouTube ka **video/playlist URL**', '"Paste YouTube / Music URL"', 'YouTube content ko directly MP3 mein', 'unauthorized YouTube-to-MP3 conversion', 'import youtube music']) {
      expect(namesAsProduct(t, yt), t).toBe(false);
    }
  });
  it('🔒 a real clone request still escalates', () => {
    for (const t of ['youtube jaisa app banao', 'build a youtube clone with uploads and comments', 'make me youtube', 'make an app like Instagram']) {
      expect(analyzeAppScope(t).famousApp, t).not.toBeNull();
    }
  });
});

describe('3 · the planner is told which SCRIPT the user wrote in', () => {
  it('Roman Hinglish is Latin script, and the planner is told never to answer in Devanagari', () => {
    const line = replyScriptLine(PROMPT);
    expect(line).toMatch(/LATIN letters/);
    expect(line).toMatch(/NEVER use Devanagari/);
    expect(megaRoadmapUserPrompt(PROMPT, null, [])).toContain(line);
  });
  it('a request written in Devanagari is answered in its own script', () => {
    expect(replyScriptLine('मेरे लिए एक म्यूजिक प्लेयर बनाओ जिसमें प्लेलिस्ट हो')).toMatch(/Indian script/);
  });
  it('an empty request adds no line', () => {
    expect(replyScriptLine('')).toBe('');
  });
});

describe('4 · the planner\'s model is not a ladder rung', () => {
  const WEAK = TIER_LADDERS.weak;
  it('a slice that names a model no rung claims is unmatched, never rounded in by provider', () => {
    expect(rungIndexFor({ provider: 'NEMOTRON', model: 'nvidia/nemotron-3-ultra-550b-a55b', usage: { outputTokens: 3598 } }, WEAK)).toBeNull();
  });
  it('the report\'s build opened on rung 2 and stayed there', () => {
    const d = ladderDepthUsed([
      { provider: 'NEMOTRON', model: 'nvidia/nemotron-3-ultra-550b-a55b', usage: { outputTokens: 3598 } },
      { provider: 'KIMI', model: 'kimi-k2.7-code', usage: { outputTokens: 20475 } },
    ], WEAK);
    expect(d.depth).toBe(2);
    expect(d.unmatched).toBe(1);
  });
  it('a slice with no model still falls back to an unambiguous provider', () => {
    expect(rungIndexFor({ provider: 'KIMI', usage: { outputTokens: 10 } }, WEAK)).toBe(1);
  });
});

describe('5 · the page decides which file is the entry', () => {
  const readerOf = (files: Record<string, string>) => async (p: string) => {
    if (!(p in files)) throw new Error('ENOENT');
    return files[p];
  };
  const VANILLA_INDEX = '<!DOCTYPE html><html><head><link rel="stylesheet" href="style.css"></head><body><main id="app"></main><script type="module" src="/script.js"></script></body></html>';
  const SCAFFOLD_INDEX = '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';

  it('🔴 the report: a vanilla index.html beside an untouched App.tsx is NOT the starter', async () => {
    expect(await entryIsStillTheStarter(readerOf({ 'index.html': VANILLA_INDEX, 'src/App.tsx': STARTER_ENTRY_CONTENT }))).toBe(false);
  });
  it('the seeded page still mounting src/ with an untouched App.tsx IS the starter', async () => {
    expect(await entryIsStillTheStarter(readerOf({ 'index.html': SCAFFOLD_INDEX, 'src/App.tsx': STARTER_ENTRY_CONTENT }))).toBe(true);
  });
  it('an unreadable index.html changes nothing (a framework without one keeps today\'s check)', async () => {
    expect(await entryIsStillTheStarter(readerOf({ 'src/App.tsx': STARTER_ENTRY_CONTENT }))).toBe(true);
  });
  it('pageMountsSrc reads real script tags, not comments', () => {
    expect(pageMountsSrc(SCAFFOLD_INDEX)).toBe(true);
    expect(pageMountsSrc('<script type="module" src="./src/index.jsx"></script>')).toBe(true);
    expect(pageMountsSrc(VANILLA_INDEX)).toBe(false);
    expect(pageMountsSrc('<!-- <script type="module" src="/src/main.tsx"></script> --><script src="/app.js"></script>')).toBe(false);
  });
});

describe('6 · a tool\'s config file is not the app\'s TypeScript', () => {
  it('vite.config.ts and playwright.config.ts do not make a JavaScript app a TypeScript one', () => {
    expect(['vite.config.ts', 'playwright.config.ts', 'e2e/vitest.config.mts'].map(isTypeScriptSourcePath)).toEqual([false, false, false]);
    expect(['src/App.tsx', 'src/lib/player.ts', 'config.ts'].map(isTypeScriptSourcePath)).toEqual([true, true, true]);
  });
  it('the fallback compiler is pinned to the major our scaffolds declare', () => {
    expect(TSC_ENSURE).toContain('npm install typescript@5 --no-save');
    const scaffold = readFileSync(join(__dirname, '..', 'src/server/AgentV3/sandbox/AppMakerLab/generator/templates/ViteReactProviderContents.ts'), 'utf8');
    expect(scaffold).toMatch(/"typescript": "\^5\./);
  });
});
