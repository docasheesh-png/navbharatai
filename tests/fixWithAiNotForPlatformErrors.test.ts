// 🔴 THE PLATFORM FED THE BUILDER ITS OWN VOICE — AGAIN (autopsy fdd59ef8, 2026-09-17).
//
// The prompt of that build was, verbatim:
//
//     "Fix this error and continue building the app:
//
//      Please sign in to build with NavBharatAI Pro — builds run on a real account so usage can be
//      tracked."
//
// Both halves are OURS. The wrapper is the "Fix with AI" button's template; the body is our own 401
// sign-in notice (`routes/agentv3.ts`, returned BEFORE the stream opens). The builder scored it
// `debugging` at complexity 45, spent 76 seconds and a whole sandbox on it, and the model — correctly
// — answered "I need to sign in first" and called stop_build. The report then recorded
// "user said: Please sign in to build with NavBharatAI Pro", a sentence no user ever typed.
//
// #2987 fixed this class for two templates and said, in `platformFixRequest.ts`, that "a new platform
// template inherits the stand-down by adding one prefix". This was the third template, and it had
// never been migrated to that module.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isPlatformFixRequest,
  fixErrorAndContinuePrompt,
  errorCanBeFixedByEditingTheApp,
  FIX_ERROR_AND_CONTINUE_PREFIX,
  PLATFORM_COMPOSED_PREFIXES,
} from '../src/lib/platformFixRequest';

/** The exact prompt from the report, rebuilt from the two strings that really composed it. */
const SIGN_IN_NOTICE =
  'Please sign in to build with NavBharatAI Pro — builds run on a real account so usage can be tracked.';
const THE_REAL_PROMPT = fixErrorAndContinuePrompt(SIGN_IN_NOTICE);

describe('the third platform template is now recognised as ours', () => {
  it('🔴 the exact prompt from the report is recognised as platform-composed', () => {
    expect(THE_REAL_PROMPT.startsWith(FIX_ERROR_AND_CONTINUE_PREFIX)).toBe(true);
    expect(THE_REAL_PROMPT).toContain(SIGN_IN_NOTICE);
    expect(isPlatformFixRequest(THE_REAL_PROMPT)).toBe(true);
  });

  it('the prefix is in the shared set, so every reader inherits the stand-down', () => {
    expect(PLATFORM_COMPOSED_PREFIXES).toContain(FIX_ERROR_AND_CONTINUE_PREFIX);
  });

  it('a real user asking for the same thing in their own words is NOT platform-composed', () => {
    expect(isPlatformFixRequest('fix this error and keep going, the page is blank')).toBe(false);
    expect(isPlatformFixRequest('build me a todo app')).toBe(false);
    expect(isPlatformFixRequest('')).toBe(false);
    expect(isPlatformFixRequest(null)).toBe(false);
  });
});

describe('errorCanBeFixedByEditingTheApp — the structural test', () => {
  it('🔴 a refusal raised BEFORE the build started can never be about the app', () => {
    // No stream, no sandbox, no build, not one file touched — so there is no code to fix.
    expect(errorCanBeFixedByEditingTheApp({ beforeBuildStarted: true, message: SIGN_IN_NOTICE })).toBe(false);
    // …and it holds for every pre-start refusal, not just this one message. That is the whole point
    // of testing the STRUCTURE rather than keeping a list of phrases.
    for (const msg of [
      'A build is still running on your account. Press ⏹ Stop to end it, then send your message again.',
      'AgentV3 requires ANTHROPIC_API_KEY to be configured.',
      'Some refusal nobody has written yet.',
    ]) {
      expect(errorCanBeFixedByEditingTheApp({ beforeBuildStarted: true, message: msg }), msg).toBe(false);
    }
  });

  it('an error from the BUILD ITSELF keeps the button — today\'s behaviour, deliberately', () => {
    expect(errorCanBeFixedByEditingTheApp({
      beforeBuildStarted: false,
      message: "SyntaxError: Unexpected token '<' in src/App.tsx",
    })).toBe(true);
  });

  it('an empty message offers nothing — there is nothing to hand the builder', () => {
    expect(errorCanBeFixedByEditingTheApp({ beforeBuildStarted: false, message: '' })).toBe(false);
    expect(errorCanBeFixedByEditingTheApp({ beforeBuildStarted: false, message: null })).toBe(false);
  });
});

describe('🔒 reversion guards — the wiring', () => {
  const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const panel = stripComments(readFileSync(join(process.cwd(), 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8'));
  const hook = stripComments(readFileSync(join(process.cwd(), 'src/hooks/useAgentV3Build.ts'), 'utf8'));
  const route = stripComments(readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8'));

  it('the button is gated on the predicate, and no longer hard-codes the sentence', () => {
    expect(panel).toContain('errorCanBeFixedByEditingTheApp({ beforeBuildStarted: errorBeforeBuildStarted');
    expect(panel).toContain('fixErrorAndContinuePrompt(');
    expect(panel).not.toContain('`Fix this error and continue building the app:');
  });

  it('the hook raises the pre-start flag on an HTTP refusal and clears it when the error clears', () => {
    expect(hook).toContain('setErrorBeforeBuildStarted(true);');
    expect(hook).toContain('setErrorBeforeBuildStarted(false);');
    expect(hook).toContain('errorBeforeBuildStarted,');
  });

  it('🔒 the stop record no longer attributes OUR OWN prompt to the user', () => {
    expect(route).toContain('const platformComposed = isPlatformFixRequest(prompt);');
    expect(route).toContain('`engine gave the reason: ${reason}`');
    // The unconditional "user said" is gone — it may only appear on the non-platform branch.
    expect(route).not.toContain('detail: reason ? `user said: ${reason}` : undefined');
  });

  // ⚠️ THE NEAR-MISS THIS CASE EXISTS FOR. `isPlatformFixRequest` was used in the route with NO
  // import, and `npm run typecheck` PASSED — the frontend tsconfig excludes `src/server/**`, so only
  // `typecheck:server` catches it. That is the documented gap between the two-command habit and the
  // real CI gate, hit live while writing this fix.
  it('🔒 the route IMPORTS what it uses — the frontend typecheck cannot see this file', () => {
    const raw = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    expect(raw).toMatch(/import \{[^}]*isPlatformFixRequest[^}]*\} from '\.\.\/\.\.\/lib\/platformFixRequest'/);
  });
});
