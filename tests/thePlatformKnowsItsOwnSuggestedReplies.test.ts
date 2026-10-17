// Q-1037 — THE PLATFORM MUST RECOGNISE THE WORDS IT PUT IN THE USER'S MOUTH.
//
// The defect, its class and its four siblings are written up in `platformSuggestedReplies.ts`. This file
// holds the behaviour, the precision, and a CENSUS that fails when a new `reply "…"` phrase is written
// into a user-facing string without being registered — so the class cannot come back one notice at a time.
//
// The measured "before", recorded so a reversion can be judged rather than guessed at:
//   "add it"            new_build/low   confirmed=FALSE (names-nothing-to-build)  → answered, not added
//   "add them"          new_build/low   confirmed=FALSE (names-nothing-to-build)  → answered, not added
//   "add it to this app" new_build/low  confirmed only because "app" is a PRODUCT_NOUN
//   "make it real"      new_build/HIGH  certain, and the wrong intent
//   "असली बनाओ" … and 9 more non-English forms of the same phrase: no signal at all in most scripts
//   "keep my changes"   chat/low        → a plain chat turn that RETURNS before GreenGuard's restore
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  PLATFORM_SUGGESTED_REPLIES,
  platformSuggestedReply,
  suggestedReplyKey,
  ADD_MISSING_FEATURE_REPLY_ONE,
  ADD_MISSING_FEATURE_REPLY_MANY,
  ADD_TO_THIS_APP_REPLY,
  MAKE_IT_REAL_REPLY,
} from '../src/server/AgentV3/platformSuggestedReplies';
import { fakeFeatureTails } from '../src/server/AgentV3/fakeFeatureScan';
import { classifyIntentWithConfidence } from '../src/server/AgentV3/IntentClassifier';
import { buildConfirmation } from '../src/server/AgentV3/buildConfirmation';
import { missingFeatureNotice, CONFIRMED_MISSING_PREFIX } from '../src/server/AgentV3/missingFeatureNotice';
import { unrelatedRequestFallback, unrelatedRequestSteer } from '../src/server/AgentV3/unrelatedRequest';
import { KEEP_CHANGES_PHRASE } from '../src/server/AgentV3/GreenGuard';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';

const ENGINE_DIR = join(process.cwd(), 'src/server/AgentV3');

describe('every reply the platform asks for is read with certainty, never guessed at', () => {
  it('each registered phrase is an EDIT of the app that is here, at HIGH confidence', () => {
    expect(PLATFORM_SUGGESTED_REPLIES.length).toBeGreaterThanOrEqual(14);
    for (const { phrase, intent } of PLATFORM_SUGGESTED_REPLIES) {
      const verdict = classifyIntentWithConfidence(phrase);
      expect(verdict.intent, phrase).toBe(intent);
      expect(verdict.confidence, `${phrase} — LOW is what sends a turn to the LLM reader, which may answer it as chat`)
        .toBe('high');
      expect(verdict.signal, phrase).toBe('platform-suggested-reply');
    }
  });

  it('and a build is CONFIRMED by it — this is the half that was actually broken', () => {
    // `buildConfirmation` answering false is what made the route set intent='chat', so the feature the
    // notice promised to add was never added. Asserted for every phrase, not just the reported one.
    for (const { phrase } of PLATFORM_SUGGESTED_REPLIES) {
      expect(buildConfirmation(phrase).confirmed, phrase).toBe(true);
    }
  });

  it('GreenGuard\'s restore phrase is reachable, and through GreenGuard\'s own list', () => {
    // The restore decision was always exact-phrase. REACHING it was not: a bare "keep my changes" is
    // chat/low, which makes a plain chat turn that returns long before the restore code.
    for (const typed of [KEEP_CHANGES_PHRASE, 'keep my changes and add a login', 'mere changes rakho', 'restore my changes']) {
      const verdict = classifyIntentWithConfidence(typed);
      expect(verdict.intent, typed).toBe('edit_existing');
      expect(verdict.confidence, typed).toBe('high');
    }
    // Not re-listed here or in the registry: GreenGuard owns those phrasings.
    const registry = readFileSync(join(ENGINE_DIR, 'platformSuggestedReplies.ts'), 'utf8');
    expect(registry, 'the restore phrasings stay in GreenGuard, consulted not copied').not.toContain('mere changes rakho');
  });

  it('politeness and the quotation marks a user copies are set aside', () => {
    for (const typed of ['add it', 'Add it', 'add it please', 'please add it', '"add it"', 'add it.', 'Add it, please!', 'add it karo', 'ok add it', '“add them”']) {
      expect(platformSuggestedReply(typed)?.phrase, typed).toBeTruthy();
      expect(classifyIntentWithConfidence(typed).intent, typed).toBe('edit_existing');
    }
  });

  it('but it is the WHOLE message, never a substring — HIGH confidence skips the reader', () => {
    // autopsy 5abad374: a keyword winning an argument the sentence's grammar had lost cost 29 minutes.
    for (const typed of [
      'add it and also build a new login page',
      'can you add it?',
      'why did you not add it',
      'make it real time with websockets',
      'add a dashboard',
    ]) {
      expect(platformSuggestedReply(typed), typed).toBeNull();
    }
  });

  it('a bare politeness word, or nothing, matches nothing', () => {
    for (const typed of ['', '   ', 'please', 'karo', 'ok', 'thanks', 'hi']) {
      expect(platformSuggestedReply(typed), JSON.stringify(typed)).toBeNull();
    }
    expect(suggestedReplyKey('please!!')).toBe('');
  });

  it('the notices COMPOSE their phrase from the registry — one home, so the two cannot drift', () => {
    const notice = missingFeatureNotice([`${CONFIRMED_MISSING_PREFIX} search`]);
    expect(notice).toContain(`Reply "${ADD_MISSING_FEATURE_REPLY_ONE}"`);
    expect(missingFeatureNotice([`${CONFIRMED_MISSING_PREFIX} search`, `${CONFIRMED_MISSING_PREFIX} cart`]))
      .toContain(`Reply "${ADD_MISSING_FEATURE_REPLY_MANY}"`);
    expect(unrelatedRequestFallback('calculator.tsx')).toContain(`reply "${ADD_TO_THIS_APP_REPLY}"`);

    // None of the three may spell the phrase out again as a literal.
    for (const file of ['missingFeatureNotice.ts', 'unrelatedRequest.ts']) {
      const src = readFileSync(join(ENGINE_DIR, file), 'utf8');
      expect(src, `${file} retypes a registered phrase instead of importing it`)
        .not.toMatch(/reply "(add it|add them|add it to this app)"/i);
    }
  });

  it('the twelve-language phrase is EXTRACTED from fakeFeatureScan, not retyped', () => {
    const tails = fakeFeatureTails();
    expect(tails.length).toBeGreaterThanOrEqual(11);
    // Every tail must yield exactly one quoted phrase, and that phrase must be registered. A twelfth
    // language added to that module with no quoted phrase — or a phrase the registry misses — fails here.
    const registered = new Set(PLATFORM_SUGGESTED_REPLIES.map((r) => suggestedReplyKey(r.phrase)));
    for (const tail of tails) {
      const quoted = [...tail.matchAll(/[“"„]([^“”"„‟]{2,40})[”"‟]/g)].map((m) => m[1].trim());
      expect(quoted.length, `this tail does not name exactly one phrase to type: ${tail.slice(0, 60)}`).toBe(1);
      expect(registered.has(suggestedReplyKey(quoted[0])), `unregistered: ${quoted[0]}`).toBe(true);
    }
    expect(registered.has(suggestedReplyKey(MAKE_IT_REAL_REPLY)), 'the English constant drifted from the tail it documents').toBe(true);
    // The registry must not carry a translation as a literal of its own.
    const registry = readFileSync(join(ENGINE_DIR, 'platformSuggestedReplies.ts'), 'utf8');
    for (const { phrase } of PLATFORM_SUGGESTED_REPLIES) {
      if (/^[\x20-\x7e]+$/.test(phrase)) continue; // the three English constants live here by design
      expect(registry, `${phrase} is retyped in the registry instead of read from its module`).not.toContain(`'${phrase}'`);
    }
  });

  it('a Hindi phrase we wrote ourselves is not capped to LOW — the cap is for guesses', () => {
    const hindi = PLATFORM_SUGGESTED_REPLIES.map((r) => r.phrase).find((p) => /[ऀ-ॿ]/.test(p));
    expect(hindi, 'fakeFeatureScan writes a Devanagari phrase; this test needs it').toBeTruthy();
    expect(classifyIntentWithConfidence(hindi!).confidence).toBe('high');
    // And the cap still works on everything else — asserted in the SCRIPT, which is what the cap reads.
    // (My first version of this line used romanised "ek todo app banao" and passed at HIGH for the honest
    // reason that it carries no Devanagari at all, proving nothing about the cap.)
    expect(classifyIntentWithConfidence('एक टोडो ऐप बनाओ').confidence).toBe('low');
  });

  it('the phrase in a model-written reply is ordered to stay verbatim', () => {
    // `unrelatedRequestSteer` asks the model to answer in the user's language. Without this instruction
    // the model translates the phrase it tells them to type, and a translation is registered nowhere.
    const steer = unrelatedRequestSteer('calculator.tsx', false);
    expect(steer).toContain(ADD_TO_THIS_APP_REPLY);
    expect(steer).toMatch(/EXACTLY as it is, in English/);
  });

  it('CENSUS — every user-facing `reply "…"` in the engine is registered or listed as already certain', () => {
    // 🔑 This is what locks the CLASS rather than the four instances. A new notice that tells the user to
    // type something lands here, and its phrase must either be registered or be named below WITH the
    // reason it is already read with certainty.
    //
    // ⚠️ ITS SHAPE IS `reply "…"`, WHICH IS HOW THIS CODEBASE WRITES THEM — every one of the nine found
    // by hand uses it. A future notice that asks for a phrase WITHOUT quoting it ("tell me to add it")
    // would pass this census unseen. Stated rather than left implied: the census is a net under the
    // known shape, not a proof that no other shape can exist.
    const ALREADY_CERTAIN = new Map<string, string>([
      ['fix it', '`fix` is an EDIT_SIGNAL → edit_existing/high'],
      ['fix them', 'as above'],
      ['fix these', 'as above'],
      ['fix the styling', 'as above'],
      ['continue', 'a CONTINUATION_SIGNAL → edit_existing/high'],
      ['make it real', 'registered; also matched here because the English tail states it literally'],
      ['yes', 'YES_WORDS / `isOfferAcceptance` — the offer path reads a bare yes before the ladder runs'],
    ]);
    // ⚠️ Keyed on the RAW phrase, not on `suggestedReplyKey`. "yes" is politeness, so the key function
    // strips it to the empty string — correct for matching a registered phrase ("yes add it" is "add it"),
    // and useless as a census key. Registered phrases are matched by key; already-certain ones by the word.

    const registered = new Set(PLATFORM_SUGGESTED_REPLIES.map((r) => suggestedReplyKey(r.phrase)));
    const unregistered: string[] = [];
    for (const name of readdirSync(ENGINE_DIR)) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
      if (name === 'platformSuggestedReplies.ts') continue;
      // ⚠️ COMMENTS STRIPPED FIRST. Without this the census fails on its own documentation: the write-ups
      // in this module and in IntentClassifier.ts quote `Reply "add it"` as evidence, and a census that
      // reads a comment as a shipped string is a census that can never go green.
      const src = stripCodeComments(readFileSync(join(ENGINE_DIR, name), 'utf8'));
      for (const m of src.matchAll(/\breply "([^"]{2,40})"/gi)) {
        const phrase = m[1].trim();
        if (phrase.includes('${')) continue; // composed from a constant — that IS the fix
        const key = suggestedReplyKey(phrase);
        if (registered.has(key) || ALREADY_CERTAIN.has(phrase.toLowerCase())) continue;
        unregistered.push(`${name}: reply "${phrase}"`);
      }
    }
    expect(unregistered, 'a notice tells the user to type this, and nothing recognises it — register it in platformSuggestedReplies.ts or add it to ALREADY_CERTAIN with the reason').toEqual([]);
  });
});
