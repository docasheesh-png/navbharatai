/**
 * EVERY CONTROL STRING THE PROMPT ASKS THE MODEL FOR MUST HAVE A RENDERER (Q-600's sweep, 2026-10-09).
 *
 * 🔴 THE FAILURE THIS ENCODES, in the prompt's own words. `prompts.ts` told the model it "MUST
 * proactively" append `[ACTION_SECRET_HELPER:provider_name]` to every message about an API key, and
 * that doing so "immediately triggers our high-tech inline Direct-Fill Assistant in their chat window,
 * letting them paste and save it instantly". No such assistant existed. The only code that could even
 * remove the string was a local in `AIChat.tsx` that nothing called, so what the user actually read in
 * the message bubble was `[ACTION_SECRET_HELPER:gemini]`.
 *
 * Two defects from one cause: a control string leaked into content a person reads, and a feature was
 * promised to them that was never built (the second absolute rule). The cause is that the contract
 * between the prompt and the renderer had no holder — the prompt could ask for anything, and nothing
 * checked that the other end had kept up.
 *
 * `src/lib/chatMarkers.ts` is that holder now, and this test is what makes it one.
 *
 * 🔴 AND THE CONTRACT IS BROKEN AT BOTH ENDS, which only writing this test revealed. The first
 * assertion below is a guard on the guard — "the scan finds markers in the prompt" — and it FAILED:
 * `prompts.ts` names no `__MARKER__` at all. A whole-repo search (every extension, `server.ts` at the
 * root included, the stale `dist/` bundle excluded) finds `__SWITCH_TO_BUILD__`, `__URGENT_BUILD__`,
 * `__VIEW_PREVIEW__`, `__DEPLOY_ACTIONS__` and `__AUTO_PLAN__` in exactly ONE file: the renderer that
 * branches on them. **Nothing in the repository emits any of them**, so five user-facing buttons
 * ("View Live Preview", the deploy actions, the auto plan) can never appear.
 *
 * So the same class had already bitten once, one layer up, and been fixed as an instance. The
 * `__VIEW_PREVIEW__` button carries its own account of it: *"previously the flag was parsed but never
 * used, so a successful build offered no way to open the preview"*. A session found a parsed-and-unused
 * flag, correctly built the missing button — and never asked whether anything produced the flag. That
 * is the a38c6fef pattern exactly: the instance fixed, the class left alive.
 *
 * This test therefore checks BOTH directions, because either one alone is how the gap survived:
 *   → a marker the PROMPT asks for must be stripped (or the user reads it);
 *   ← a marker the RENDERER branches on must be emitted (or the branch is unreachable).
 * The second half is recorded in `BUILD_REPORT_QUEUE.md` rather than fixed here: deciding that the chat
 * AI should start emitting five CTAs is a product change, not a sweep.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  knownMarkerNames,
  stripChatMarkers,
  secretHelperProvider,
  CHAT_FLAG_MARKERS,
} from '../src/lib/chatMarkers';

const root = resolve(__dirname, '..');
const PROMPTS = readFileSync(resolve(root, 'src/server/lib/prompts.ts'), 'utf8');
const RENDERER = readFileSync(resolve(root, 'src/components/ide/AIChat.tsx'), 'utf8');

/**
 * Control strings the prompt is allowed to name WITHOUT the chat renderer handling them, each with the
 * surface that does. A marker is guilty until listed here, exactly as a collection is in the erase
 * censuses — the whole point is that the default is "somebody must handle this".
 */
const HANDLED_ELSEWHERE: Record<string, string> = {};

/**
 * Markers the renderer branches on that NOTHING in the repository emits — the reverse break, each with
 * the row that owns the decision. A branch listed here is accounted for, not accepted: the list may
 * only shrink, and the assertion below fails if a marker leaves it while still unreachable, or if a NEW
 * unreachable branch appears.
 */
const NO_EMITTER_YET: Record<string, string> = {
  __SWITCH_TO_BUILD__: 'Q-781',
  __URGENT_BUILD__: 'Q-781',
  __VIEW_PREVIEW__: 'Q-781',
  __DEPLOY_ACTIONS__: 'Q-781',
  __AUTO_PLAN__: 'Q-781',
};

/** Every file that could legitimately tell the model to emit a marker, or emit one itself. */
const EMITTER_SOURCES = ['src/server/lib/prompts.ts'];

describe('every marker the prompt asks for has a renderer', () => {
  /** `__NAME__` and `[NAME:value]`, as a prompt writes them. Takes the source so it is testable. */
  function markersNamedIn(src: string): string[] {
    const found = new Set<string>();
    for (const m of src.matchAll(/__[A-Z][A-Z0-9_]*__/g)) found.add(m[0]);
    for (const m of src.matchAll(/\[([A-Z][A-Z0-9_]*):[a-z_]+\]/g)) found.add(m[1]);
    return [...found].sort();
  }

  /**
   * A GUARD ON THE GUARD, and it has already earned its place twice.
   *
   * First it failed by asking for at least one marker in `prompts.ts` and getting zero — which is how
   * the reverse break in the header was found. Then it failed again, correctly: the prompt now names NO
   * marker, because the one instruction that did was the false promise this change removed. A census of
   * live content therefore cannot prove the scan works, and a scan that silently stops finding things
   * makes every assertion below pass vacuously. So the mechanism is proven on a FIXTURE instead, which
   * stays true whatever the prompt grows into.
   */
  it('the scan really extracts both marker shapes (proven on a fixture, not on live content)', () => {
    const fixture = 'append "__SWITCH_TO_BUILD__" and "[ACTION_SECRET_HELPER:provider_name]" to it.';
    expect(markersNamedIn(fixture)).toEqual(['ACTION_SECRET_HELPER', '__SWITCH_TO_BUILD__']);
    // Ordinary prose and a SCREAMING_CONSTANT must not be mistaken for a marker.
    expect(markersNamedIn('set MAX_TOKENS and read [a link](http://x) in Settings → Keys')).toEqual([]);
  });

  it('the prompt currently asks the model for no marker at all, which is why none can leak', () => {
    // The one it used to ask for is gone; stripping remains for the stored history that still has it.
    expect(markersNamedIn(PROMPTS)).toEqual([]);
    expect(PROMPTS).not.toContain('ACTION_SECRET_HELPER');
  });

  it('🔒 the renderer branches on no marker that nothing emits, beyond the recorded ones', () => {
    const emitted = new Set<string>();
    for (const file of EMITTER_SOURCES) {
      const src = readFileSync(resolve(root, file), 'utf8');
      for (const name of knownMarkerNames()) if (src.includes(name)) emitted.add(name);
    }
    const branched = CHAT_FLAG_MARKERS.filter((m) => RENDERER.includes(`includes('${m}')`));
    const unreachable = branched.filter((m) => !emitted.has(m));
    const unrecorded = unreachable.filter((m) => !(m in NO_EMITTER_YET));
    expect(
      unrecorded,
      'the renderer branches on a marker nothing emits, so that button can never appear. Make something '
      + 'emit it, delete the branch, or add it to NO_EMITTER_YET with the queue row that owns it:\n'
      + unrecorded.join('\n'),
    ).toEqual([]);
    // And the list may only shrink: a marker that gained an emitter must leave it, so the record cannot
    // quietly outlive the problem it describes.
    const stale = Object.keys(NO_EMITTER_YET).filter((m) => emitted.has(m));
    expect(stale, `these now have an emitter and must leave NO_EMITTER_YET: ${stale.join(', ')}`).toEqual([]);
  });

  it('🔒 names no marker that `chatMarkers.ts` does not know', () => {
    const known = new Set([...knownMarkerNames(), ...Object.keys(HANDLED_ELSEWHERE)]);
    const orphans = markersNamedIn(PROMPTS).filter((n) => !known.has(n));
    expect(
      orphans,
      'the prompt tells the model to emit a marker nothing strips, so the user will read it in the '
      + 'message bubble. Add it to `src/lib/chatMarkers.ts` and handle it, or add it to '
      + 'HANDLED_ELSEWHERE naming the surface that does:\n' + orphans.join('\n'),
    ).toEqual([]);
  });

  it('🔒 the renderer strips markers through the shared module, not its own private list', () => {
    // The original bug was a hand-written `.replace()` chain in the component that fell behind the
    // prompt. A chain here again would reproduce it exactly.
    expect(RENDERER).toContain('stripChatMarkers(text)');
    expect(RENDERER).not.toMatch(/\.replace\('__[A-Z_]+__',\s*''\)/);
  });

  it('removes the marker that was being shown to users, wherever the model put it', () => {
    // The prompt said "at the very beginning or end of your message", so both are the real input.
    expect(stripChatMarkers('[ACTION_SECRET_HELPER:gemini] Here is how to get your key.'))
      .toBe('Here is how to get your key.');
    expect(stripChatMarkers('Here is how to get your key. [ACTION_SECRET_HELPER:stripe]'))
      .toBe('Here is how to get your key.');
    // Case and spacing as a model would really vary them.
    expect(stripChatMarkers('a [action_secret_helper:OpenAI] b')).toBe('a b');
    // An empty value is still a marker, not text.
    expect(stripChatMarkers('a [ACTION_SECRET_HELPER:] b')).toBe('a b');
  });

  it('strips every flag marker, and leaves ordinary text exactly as the model wrote it', () => {
    for (const marker of CHAT_FLAG_MARKERS) {
      expect(stripChatMarkers(`before ${marker} after`)).toBe('before after');
    }
    // Markdown, code and punctuation a reply really contains must survive untouched.
    const prose = 'Paste it in **Settings → App Settings → Secrets & API Keys**.\n\n```\nKEY=value\n```';
    expect(stripChatMarkers(prose)).toBe(prose);
    expect(stripChatMarkers(null)).toBe('');
    expect(stripChatMarkers(undefined)).toBe('');
  });

  it('reads the provider back out, lower-cased, and the first one only', () => {
    expect(secretHelperProvider('x [ACTION_SECRET_HELPER:Gemini] y')).toBe('gemini');
    expect(secretHelperProvider('[ACTION_SECRET_HELPER: stripe ]')).toBe('stripe');
    expect(secretHelperProvider('[ACTION_SECRET_HELPER:gemini][ACTION_SECRET_HELPER:stripe]')).toBe('gemini');
    expect(secretHelperProvider('no marker here')).toBeNull();
    expect(secretHelperProvider('[ACTION_SECRET_HELPER:]')).toBeNull();
  });

  it('🔒 the prompt promises no way to save a key other than the two real vault doors', () => {
    // `SecretManager.tsx`: "This component is the vault's UI, and it is deliberately the ONLY one."
    // The removed instruction promised an inline assistant instead, and building one to make that
    // sentence true would have been a third implementation of saving a secret.
    expect(PROMPTS).not.toMatch(/Direct-Fill Assistant/i);
    expect(PROMPTS).toMatch(/Settings → App Settings → Secrets & API Keys/);
    expect(PROMPTS).toMatch(/Keys & Secrets/);
  });
});
