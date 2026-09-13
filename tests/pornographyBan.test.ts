// PORNOGRAPHY IS BANNED ON NAVBHARATAI — admin decision 2026-09-13, after build report 03997004.
//
// THE REPORT. A user asked for a porn site with uploads, streaming and anonymous chat. The platform
// spent 171 seconds and EIGHT model calls asking models to build it: the mega-app roadmap planner
// (27 s), the file-manifest planner (89 s), the one-shot builder, the full agentic builder three
// times, then — reading "zero files" as a capability failure — it RETRIED THE WHOLE BUILD ON A
// STRONGER MODEL and ran twice more. Every call refused, which is the model's virtue and was never
// the platform's design. It closed by telling the user:
//
//     "Your app needs our strongest engine to finish cleanly. Add credits and I will complete it
//      on the best engine — nothing you have done so far is lost."
//
// NavBharatAI asked a person who wanted a pornography site FOR MONEY, and promised to build it.
//
// 🔴 AND IT RAN BY DESIGN. `triagePrompt` DID detect the prompt — and returned `flag`, because the
// rule said "NOT illegal — lawful adult content. Governed by the creator's own +18 setting." The
// admin has reversed that: this is an Indian product and it does not build this, for anyone.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { triagePrompt, blockMessage, prefersHindi, looksLikeRefusal } from '../src/server/lib/promptSafety';
import { shouldRetryEmptyBuild } from '../src/server/routes/agentv3';

const REPORTED = 'Create a porn websites where anyone can upload watch porns can live stream annonymous chat all for completely freeee';

describe('🔴 the reported prompt is refused before a token is spent', () => {
  it('THE EXACT PROMPT is BLOCKED, not flagged', () => {
    const t = triagePrompt(REPORTED);
    expect(t.verdict).toBe('block'); // ← it returned 'flag' and the build ran
    expect(t.contentClass).toBe('adult');
  });

  it.each([
    'build a porn site to watch videos',
    'onlyfans clone with premium subscribe',  // the old subject regex missed every brand: ALLOWED outright
    'hentai gallery website',
    'xxx video streaming platform',
    'adult video tube site with categories',
    'blue film wali website banao',
    'sexy video app banao',
  ])('is blocked: %s', (p) => {
    expect(triagePrompt(p).verdict).toBe('block');
  });
});

describe('⚠️ DETECTION MUST BE PRECISE — a false positive refuses a real app', () => {
  // Softening the wording did not make precision optional. A misclassified user still gets REFUSED,
  // and every one of these is an app NavBharatAI should WANT to build.
  it.each([
    'a sexual health education app for teenagers',
    'sex education platform for schools',
    'a clinic app where doctors discuss sexual health with patients',
    'a harassment reporting app for women safety',
    'an app to report child trafficking and exploitation',
    'parental control app to filter adult content',
    'a content moderation dashboard that blocks nsfw uploads and reports them',
    'adult literacy classes for a village NGO',
    'a legal compliance page explaining why porn is banned on our platform',
    'a dating app with profiles and chat',
    'music player for android',
    'ek billing app banao',
  ])('is allowed: %s', (p) => {
    expect(triagePrompt(p).verdict).toBe('allow');
  });
});

describe('the refusal is firm about the ban and not personal about the user', () => {
  // The first version was the admin's verbatim wording — "NavBharatAI has no need of users like you…
  // you may log out". They read it back and said "yeh thoda jyada hi ho gaya". The ban is unchanged
  // and absolute; the insult is gone. Detection can still be wrong, and a misclassified user shrugs
  // off a firm refusal — they screenshot a personal insult.
  it('Hindi in → Hindi out', () => {
    const m = blockMessage('adult', 'blue film wali website banao');
    expect(m).toContain('पोर्नोग्राफी बैन है');
    expect(m).toContain('भारतीय ऐप');
  });

  it('English in → English out', () => {
    const m = blockMessage('adult', REPORTED);
    expect(m).toContain('Pornography is banned here.');
    expect(m).toContain('Indian app');
  });

  it('🔒 says nothing about the PERSON, in either language', () => {
    for (const prompt of [REPORTED, 'blue film wali website banao']) {
      const m = blockMessage('adult', prompt);
      expect(m).not.toMatch(/users like you|no need of|log ?out|लॉगआउट|आपके जैसे|ज़रूरत नहीं|जरूरत नहीं|सभ्य/);
    }
  });

  it('still refuses ABSOLUTELY — no conditions, no "unless", no 18+ escape', () => {
    const m = blockMessage('adult', REPORTED);
    expect(m).toMatch(/banned/i);
    expect(m).toContain('does not build this');
    expect(m).not.toMatch(/18\+|adults? only|if you|unless|verify your age/i);
  });

  it('offers a way forward — a boundary-tester is often a real user on day one', () => {
    expect(blockMessage('adult', REPORTED)).toMatch(/what else you would like to build/i);
    expect(blockMessage('adult', 'blue film wali website banao')).toContain('कुछ और बनाना हो');
  });

  it('Devanagari and romanised Hindi both count', () => {
    expect(prefersHindi('पोर्न साइट बनाओ')).toBe(true);
    expect(prefersHindi('blue film wali website banao')).toBe(true);
    expect(prefersHindi('build a porn site')).toBe(false);
  });

  it('every OTHER blocked class keeps the neutral Terms-of-Service wording', () => {
    // The blunt message is scoped to this one decision; it must not become the house style for
    // every refusal the platform makes.
    const generic = blockMessage('illegal', 'anything');
    expect(generic).toContain('Acceptable Use');
    expect(generic).not.toContain('users like you');
    expect(blockMessage()).toContain('Acceptable Use'); // default arg unchanged
  });
});

describe('🔴 a refusal is a FINAL answer — never retried, never escalated, never sold', () => {
  const base = {
    expectsArtifacts: true, filesWritten: 0, isEditMode: false,
    existingProjectFiles: 0, aborted: false, withinCostCap: true, userAskedToBuildAnApp: true,
  };

  it('does NOT retry a refusal on a stronger model', () => {
    expect(shouldRetryEmptyBuild({ ...base, modelRefused: true })).toBe(false);
  });

  it('still retries a genuine empty build — the guard this was built for is untouched', () => {
    expect(shouldRetryEmptyBuild({ ...base, modelRefused: false })).toBe(true);
    expect(shouldRetryEmptyBuild(base)).toBe(true); // field omitted entirely
  });

  it('recognises the refusals the report actually contains', () => {
    expect(looksLikeRefusal("I can't create that content. I don't build websites or apps for sexually explicit material")).toBe(true);
    expect(looksLikeRefusal('I cannot and will not create this content. My refusal stands')).toBe(true);
    expect(looksLikeRefusal("I can't help with creating adult content, pornography, or explicit material platforms.")).toBe(true);
    expect(looksLikeRefusal('I cannot create this content. I will not build a pornography website')).toBe(true);
  });

  it('does not mistake a normal build summary for a refusal', () => {
    expect(looksLikeRefusal('Your app is built and the live preview renders correctly.')).toBe(false);
    expect(looksLikeRefusal('Built your app in one shot — 14 file(s).')).toBe(false);
    // A long summary that merely mentions what it could not do is not a refusal of the request.
    expect(looksLikeRefusal('The app is ready. I could not run the tests because no suite exists.')).toBe(false);
    expect(looksLikeRefusal('')).toBe(false);
    expect(looksLikeRefusal(null)).toBe(false);
  });
});

describe('the wiring — both surfaces, and no upsell after a refusal', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
  const chat = readFileSync(join(process.cwd(), 'src/server/routes/chat.ts'), 'utf8');

  it('the build route refuses in the user\'s language', () => {
    expect(route).toContain('blockMessage(triage.contentClass, prompt)');
  });

  it('the chat route does too — one triage serves both surfaces', () => {
    expect(chat).toContain('blockMessage(triage.contentClass, message)');
  });

  it('🔒 the free-tier upsell can never follow a refusal', () => {
    expect(route).toContain('freeTierBuildActive && !looksLikeRefusal(result.summary)');
  });

  it('the escalation guard reads the model\'s own answer', () => {
    expect(route).toContain('const firstAttemptRefused = looksLikeRefusal(result.summary);');
    expect(route).toContain('modelRefused: firstAttemptRefused,');
  });
});
