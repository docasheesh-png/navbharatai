// The platform must recognise its own voice. Autopsy f5351721 (2026-09-17): NavBharatAI's own
// "Fix error" button composed a prompt saying "failed to BUILD … so the app BUILDS and runs", our own
// guard read it as a request for a new app, a correct zero-file answer was called a failure, and the
// whole build re-ran — 23 wasted minutes on top of the 12 it had already finished in, ₹261.77 billed.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PLATFORM_FIX_REQUEST_PREFIX, ANDROID_BUILD_FIX_PREFIX, PLATFORM_COMPOSED_PREFIXES,
  platformFixRequestPrompt, isPlatformFixRequest, looksLikeMachineError, MACHINE_ERROR_SIGNALS,
} from '../src/lib/platformFixRequest';
import { userAskedForAnAppToBeBuilt, classifyIntentWithConfidence } from '../src/server/AgentV3/IntentClassifier';

/** The exact text the real button produced in the autopsied build. */
const REAL_PROMPT = platformFixRequestPrompt(`[vite] failed to connect to websocket.
your current setup:
  (browser) 5173-ihkr2xh6teut9610xxd4t.e2b.app/ <--[HTTP]--> localhost:5173/ (server)
Check out your Vite / network configuration and https://vite.dev/config/server-options.html#server-hmr .`);

describe('🔴 the exact prompt that cost 23 minutes', () => {
  it('is no longer read as "the user asked for an app to be built"', () => {
    expect(userAskedForAnAppToBeBuilt(REAL_PROMPT)).toBe(false);
  });

  it('and the reason it used to be: the ladder still calls it new_build at HIGH confidence', () => {
    // Intent ROUTING is deliberately untouched — an edit/build lane for a fix request is correct.
    // What changed is only the separate question "may a zero-file outcome be called a failure?".
    expect(classifyIntentWithConfidence(REAL_PROMPT).intent).toBe('new_build');
    expect(classifyIntentWithConfidence(REAL_PROMPT).confidence).toBe('high');
  });

  it('matches none of the human-prose problem phrases — which is WHY it slipped through', () => {
    const humanProse = ["doesn't work", 'blank screen', 'nahi chala', 'is broken', 'not loading'];
    for (const phrase of humanProse) expect(REAL_PROMPT.toLowerCase()).not.toContain(phrase);
  });
});

describe('the template has ONE definition, and both sides use it', () => {
  it('composes prefix + error + suffix', () => {
    const p = platformFixRequestPrompt('BOOM');
    expect(p.startsWith(PLATFORM_FIX_REQUEST_PREFIX)).toBe(true);
    expect(p).toContain('BOOM');
  });

  it('recognises what it composes — the round trip that makes this a contract', () => {
    expect(isPlatformFixRequest(platformFixRequestPrompt('any error at all'))).toBe(true);
  });

  // ⚠️ REVERSION GUARD. If a future edit pastes the sentence back into a component, the two sides can
  // drift again and the guard silently stops matching — with nothing failing. This reads the real
  // files, so that edit fails here instead.
  it('🔒 no client file hard-codes the sentence any more', () => {
    for (const rel of ['src/App.tsx', 'src/components/agentv3/AgentV3Panel.tsx']) {
      const src = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(src, `${rel} must not re-hardcode the template`).not.toContain('in-browser preview failed to build');
      expect(src, `${rel} must call the shared composer`).toContain('platformFixRequestPrompt');
    }
  });

  it('🔒 the server guard imports the shared recogniser rather than re-deriving it', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/IntentClassifier.ts'), 'utf8');
    expect(src).toContain("from '../../lib/platformFixRequest'");
    expect(src).toContain('isPlatformFixRequest(message)');
  });
});

describe('a quoted prefix is discussion, not the request itself', () => {
  it('only an OPENING prefix counts', () => {
    expect(isPlatformFixRequest(`Why does it say "${PLATFORM_FIX_REQUEST_PREFIX}" every time?`)).toBe(false);
    expect(isPlatformFixRequest('   ' + platformFixRequestPrompt('x'))).toBe(true);  // leading space is fine
  });

  it('is empty-safe', () => {
    for (const v of ['', '   ', null, undefined]) expect(isPlatformFixRequest(v as string)).toBe(false);
  });
});

describe('💸 pasted machine output — the same class, typed by hand', () => {
  it('recognises real toolchain lines', () => {
    expect(looksLikeMachineError('Error: Cannot find module "react-router-dom"')).toBe(true);
    expect(looksLikeMachineError('TypeError: onSave is not a function')).toBe(true);
    expect(looksLikeMachineError('Build failed to compile, please fix')).toBe(true);
  });

  it('🔒 a genuine build request that merely MENTIONS errors keeps its old answer', () => {
    // The whole reason single words like "error"/"failed"/"fix" are absent from the list.
    for (const p of [
      'build me a dashboard that shows error rates by hour',
      'make an app to track failed payments',
      'create a bug tracker where users report errors',
    ]) {
      expect(looksLikeMachineError(p), p).toBe(false);
      expect(userAskedForAnAppToBeBuilt(p), p).toBe(true);
    }
  });

  it('every signal is a multi-word machine phrase, never a bare word', () => {
    for (const s of MACHINE_ERROR_SIGNALS) expect(s.trim().split(/\s+/).length).toBeGreaterThan(1);
  });
});

describe('🔒 nothing else about the guard moved', () => {
  it('ordinary build orders still count as asking for an app', () => {
    for (const p of ['build a notes app', 'ek billing app banao', 'create a landing page for my shop']) {
      expect(userAskedForAnAppToBeBuilt(p), p).toBe(true);
    }
  });

  it('continuation and human problem reports still stand down, as before', () => {
    for (const p of ['continue from where you left off', 'preview nahi chala', "the app doesn't work"]) {
      expect(userAskedForAnAppToBeBuilt(p), p).toBe(false);
    }
  });
});

// 🔎 THE SIBLING (rule 3). Hunting for other prompts the PLATFORM composes found a second one, and it
// is worse: it is dispatched with `autoSend: true`, so it starts a build with nothing for the user to
// press. Verified against the real guard before the fix — it returned `true` exactly as the preview
// button did.
describe('🔎 the Android build-failure request — same class, and it auto-sends', () => {
  const ANDROID = [
    `${ANDROID_BUILD_FIX_PREFIX} Please fix the app code so it builds.`,
    '',
    'What stopped it: A strict code check was blocking the packaging.',
    '',
    'The build log said:',
    '```',
    '> Task :app:processDebugResources FAILED',
    '```',
    '',
    'Fix the cause in the app source, then tell me what you changed.',
  ].join('\n');

  it('is recognised as platform-composed', () => {
    expect(isPlatformFixRequest(ANDROID)).toBe(true);
  });

  it('is no longer read as "the user asked for an app to be built"', () => {
    expect(userAskedForAnAppToBeBuilt(ANDROID)).toBe(false);
  });

  it('🔒 the server composes it from the SHARED constant, not its own copy', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/routes/mobileShip.ts'), 'utf8');
    expect(src).toContain('ANDROID_BUILD_FIX_PREFIX');
    // The literal sentence must exist in exactly one place — the contract.
    expect(src).not.toContain('My Android build failed on GitHub.');
  });

  it('🔒 every platform prefix is covered by the recogniser, so a new template cannot be forgotten', () => {
    for (const prefix of PLATFORM_COMPOSED_PREFIXES) {
      expect(isPlatformFixRequest(`${prefix} something went wrong`), prefix).toBe(true);
    }
    expect(PLATFORM_COMPOSED_PREFIXES.length).toBeGreaterThanOrEqual(2);
  });
});
